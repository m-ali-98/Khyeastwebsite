/* ==========================================================================
   Shared, runtime-configurable rate limits.
   --------------------------------------------------------------------------
   Every HTTP surface uses this one limiter so the admin switch really means
   "all limits", rather than disabling the contact form while an unrelated
   hard-coded limiter still blocks checkout or login.

   Counters intentionally stay in memory. They are short-lived abuse signals,
   not business records; persisting them would turn a server restart into a
   surprising lockout and add a database write to every public request.
   ========================================================================== */

const SETTING_KEY = 'security.rateLimits';

const envMax = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
};

/* IP ceilings are deliberately generous. Iranian mobile networks and office
   gateways put many real people behind one public address; per-phone OTP caps
   remain tighter because they protect both SMS spend and a person's inbox. */
export const rateLimitDefaults = () => ({
  /* Evaluate environment values when the database/limiter is created, not at
     module import time. index.js deliberately loads server/.env after imports. */
  enabled: !/^(0|false|off)$/i.test(String(process.env.RATE_LIMITS_ENABLED ?? 'true')),
  rules: {
    message: { max: envMax('RL_MAX_MESSAGE', 30), windowMs: 10 * 60 * 1000 },
    comment: { max: envMax('RL_MAX_COMMENT', 30), windowMs: 10 * 60 * 1000 },
    order: { max: envMax('RL_MAX_ORDER', 60), windowMs: 10 * 60 * 1000 },
    paymentRetry: { max: envMax('RL_MAX_PAYMENT_RETRY', 20), windowMs: 10 * 60 * 1000 },
    adminLogin: { max: envMax('RL_MAX_ADMIN_LOGIN', 30), windowMs: 15 * 60 * 1000 },
    otpPhone: { max: envMax('RL_MAX_OTP_PHONE', 5), windowMs: 60 * 60 * 1000 },
    otpIp: { max: envMax('RL_MAX_OTP_IP', 120), windowMs: 60 * 60 * 1000 },
    customerLogin: { max: envMax('RL_MAX_CUSTOMER_LOGIN', 30), windowMs: 15 * 60 * 1000 },
    customerLoginIp: { max: envMax('RL_MAX_CUSTOMER_LOGIN_IP', 120), windowMs: 15 * 60 * 1000 },
    register: { max: envMax('RL_MAX_REGISTER', 120), windowMs: 60 * 60 * 1000 },
  },
});

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeRateLimitSettings(input = {}) {
  const defaults = rateLimitDefaults();
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const suppliedRules = source.rules && typeof source.rules === 'object' && !Array.isArray(source.rules)
    ? source.rules
    : {};
  const rules = {};

  for (const [kind, fallback] of Object.entries(defaults.rules)) {
    const supplied = suppliedRules[kind] && typeof suppliedRules[kind] === 'object'
      ? suppliedRules[kind]
      : {};
    rules[kind] = {
      max: clamp(supplied.max, 1, 100_000, fallback.max),
      /* The panel currently keeps the published windows, but normalising the
         value here makes the API forward-compatible and prevents a malformed
         payload from creating a zero-duration or multi-year bucket. */
      windowMs: clamp(supplied.windowMs, 60_000, 24 * 60 * 60 * 1000, fallback.windowMs),
    };
  }

  const enabled = source.enabled === undefined
    ? defaults.enabled
    : !/^(0|false|off|no)$/i.test(String(source.enabled));
  return { enabled, rules };
}

export function createRateLimiter({ database, store }) {
  let settings = normalizeRateLimitSettings(store.getSetting(database, SETTING_KEY, {}));
  let fingerprint = JSON.stringify(settings);
  const hits = new Map();

  /* Passenger may run several Node workers against the same SQLite file. Read
     the tiny settings row at each limited request so an Admin change (most
     importantly the global off switch) reaches every worker, not only the one
     that happened to serve the PUT. Counters remain local abuse signals. */
  const refreshSettings = () => {
    const next = normalizeRateLimitSettings(store.getSetting(database, SETTING_KEY, {}));
    const nextFingerprint = JSON.stringify(next);
    if (nextFingerprint !== fingerprint) {
      settings = next;
      fingerprint = nextFingerprint;
      hits.clear();
    }
    return settings;
  };

  const bucketId = (kind, key) => `${kind}\u0000${String(key || 'unknown')}`;
  const recent = (kind, key, now = Date.now()) => {
    const rule = settings.rules[kind];
    if (!rule) return [];
    const id = bucketId(kind, key);
    const kept = (hits.get(id) || []).filter((time) => now - time < rule.windowMs);
    if (kept.length) hits.set(id, kept);
    else hits.delete(id);
    return kept;
  };

  const api = {
    settings: () => JSON.parse(JSON.stringify(refreshSettings())),

    update(next) {
      settings = normalizeRateLimitSettings(next);
      fingerprint = JSON.stringify(settings);
      store.setSetting(database, SETTING_KEY, settings);
      /* A policy change starts clean and, when disabled, takes effect
         immediately. Other Passenger workers clear on their next check. */
      hits.clear();
      return JSON.parse(fingerprint);
    },

    check(kind, key) {
      refreshSettings();
      const rule = settings.rules[kind];
      if (!settings.enabled || !rule) return { limited: false, retryAfter: 0 };
      const now = Date.now();
      const times = recent(kind, key, now);
      if (times.length < rule.max) return { limited: false, retryAfter: 0 };
      return {
        limited: true,
        retryAfter: Math.max(1, Math.ceil((rule.windowMs - (now - times[0])) / 1000)),
      };
    },

    record(kind, key) {
      refreshSettings();
      const rule = settings.rules[kind];
      if (!settings.enabled || !rule) return;
      const id = bucketId(kind, key);
      hits.set(id, [...recent(kind, key), Date.now()]);
    },

    clear(kind, key) {
      hits.delete(bucketId(kind, key));
    },

    clearAll() {
      hits.clear();
    },
  };

  /* One bounded sweep for every rule. check()/record() also prune their own
     bucket, so this is only memory housekeeping for addresses that disappear. */
  setInterval(() => {
    const now = Date.now();
    for (const id of [...hits.keys()]) {
      const split = id.indexOf('\u0000');
      if (split < 0) {
        hits.delete(id);
        continue;
      }
      recent(id.slice(0, split), id.slice(split + 1), now);
    }
  }, 10 * 60 * 1000).unref?.();

  return api;
}

export function rateLimitResponse(res, retryAfter, error = 'rate limited') {
  const seconds = Math.max(1, Math.ceil(Number(retryAfter) || 1));
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({ error, retryAfter: seconds });
}
