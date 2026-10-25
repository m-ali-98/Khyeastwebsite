/* ==========================================================================
   Shared, runtime-configurable rate limits.
   --------------------------------------------------------------------------
   Every HTTP surface uses this one limiter so the admin switch really means
   "all limits", rather than disabling the contact form while an unrelated
   hard-coded limiter still blocks checkout or login.

   Hits and in-flight password reservations live in SQLite. Passenger workers
   therefore enforce one site-wide ceiling, and a restart cannot be used to
   reset an active abuse window. Rows expire after at most 24 hours and bucket
   identifiers are secret-keyed HMAC-SHA-256 values rather than reversible
   hashes of low-entropy IPs, phones, or authorities.
   ========================================================================== */
import crypto from 'node:crypto';

const SETTING_KEY = 'security.rateLimits';
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

const envMax = (environment, name, fallback) => {
  const value = Number(environment[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
};

/* Conservative ceilings keep public write/authentication endpoints resistant
   to bursts. IP buckets remain broader than per-phone buckets to account for
   carrier-grade NAT, and Admin can tune or temporarily disable the policy. */
export const rateLimitDefaults = (environment = process.env) => ({
  /* Evaluate environment values when the database/limiter is created, not at
     module import time. index.js deliberately loads server/.env after imports.
     Accepting an explicit environment also keeps the fallback policy directly
     testable without inheriting a developer machine's overrides. */
  enabled: !/^(0|false|off)$/i.test(String(environment.RATE_LIMITS_ENABLED ?? 'true')),
  rules: {
    message: { max: envMax(environment, 'RL_MAX_MESSAGE', 5), windowMs: 10 * 60 * 1000 },
    comment: { max: envMax(environment, 'RL_MAX_COMMENT', 5), windowMs: 10 * 60 * 1000 },
    order: { max: envMax(environment, 'RL_MAX_ORDER', 12), windowMs: 10 * 60 * 1000 },
    paymentRetry: { max: envMax(environment, 'RL_MAX_PAYMENT_RETRY', 5), windowMs: 10 * 60 * 1000 },
    /* Scoped to an authority only after its immutable order mapping succeeds,
       so random probes cannot fill a legitimate payment's bucket. */
    paymentCallback: { max: envMax(environment, 'RL_MAX_PAYMENT_CALLBACK', 12), windowMs: 10 * 60 * 1000 },
    adminLogin: { max: envMax(environment, 'RL_MAX_ADMIN_LOGIN', 8), windowMs: 15 * 60 * 1000 },
    otpPhone: { max: envMax(environment, 'RL_MAX_OTP_PHONE', 5), windowMs: 60 * 60 * 1000 },
    otpIp: { max: envMax(environment, 'RL_MAX_OTP_IP', 30), windowMs: 60 * 60 * 1000 },
    customerLogin: { max: envMax(environment, 'RL_MAX_CUSTOMER_LOGIN', 10), windowMs: 15 * 60 * 1000 },
    customerLoginIp: { max: envMax(environment, 'RL_MAX_CUSTOMER_LOGIN_IP', 30), windowMs: 15 * 60 * 1000 },
    register: { max: envMax(environment, 'RL_MAX_REGISTER', 40), windowMs: 60 * 60 * 1000 },
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
      windowMs: clamp(supplied.windowMs, 60_000, MAX_WINDOW_MS, fallback.windowMs),
    };
  }

  const enabled = source.enabled === undefined
    ? defaults.enabled
    : !/^(0|false|off|no)$/i.test(String(source.enabled));
  return { enabled, rules };
}

const retryAfterFor = (usage, rule, now) => usage.oldestCompleted == null
  ? 1
  : Math.max(1, Math.ceil((rule.windowMs - (now - usage.oldestCompleted)) / 1000));

export function createRateLimiter({ database, store, hashSecret }) {
  const secret = String(hashSecret || '');
  if (!secret) throw new Error('rate limiter hashSecret is required');
  /* ADMIN_SECRET is also used elsewhere, so domain-separate this HMAC. Even a
     database snapshot cannot dictionary-attack the small IPv4/phone keyspace
     without the server-side secret. All workers must receive the same value. */
  const bucketHash = (kind, key) => crypto
    .createHmac('sha256', secret)
    .update('khyeast-rate-limit-bucket:v1\u0000')
    .update(String(kind))
    .update('\u0000')
    .update(String(key || 'unknown'))
    .digest('hex');

  let settings = normalizeRateLimitSettings(store.getSetting(database, SETTING_KEY, {}));
  let fingerprint = JSON.stringify(settings);

  /* The settings row is shared too. Reading it on each operation makes the
     Admin off switch and policy edits visible to every Passenger worker. */
  const refreshSettings = () => {
    const next = normalizeRateLimitSettings(store.getSetting(database, SETTING_KEY, {}));
    const nextFingerprint = JSON.stringify(next);
    if (nextFingerprint !== fingerprint) {
      settings = next;
      fingerprint = nextFingerprint;
    }
    return settings;
  };

  const api = {
    settings: () => JSON.parse(JSON.stringify(refreshSettings())),
    scope: () => ({
      backend: 'sqlite',
      sharedAcrossWorkers: true,
      bucketKeying: 'hmac-sha256-v1',
    }),

    update(next) {
      settings = normalizeRateLimitSettings(next);
      fingerprint = JSON.stringify(settings);
      store.setSetting(database, SETTING_KEY, settings);
      /* A policy change starts clean. Clearing the shared table means every
         worker observes the same reset, including when limits are disabled. */
      store.clearRateLimitHits(database);
      return JSON.parse(fingerprint);
    },

    check(kind, key) {
      refreshSettings();
      const rule = settings.rules[kind];
      if (!settings.enabled || !rule) return { limited: false, retryAfter: 0 };
      const now = Date.now();
      const usage = store.getRateLimitUsage(database, {
        kind,
        bucketHash: bucketHash(kind, key),
        cutoff: now - rule.windowMs,
      });
      if (usage.count < rule.max) return { limited: false, retryAfter: 0 };
      return { limited: true, retryAfter: retryAfterFor(usage, rule, now) };
    },

    /** Atomically reserve capacity before async/expensive work. The reservation
     * itself is shared, so two workers cannot each admit a full scrypt burst. */
    reserve(kind, key) {
      refreshSettings();
      const rule = settings.rules[kind];
      const noop = () => {};
      if (!settings.enabled || !rule) return { limited: false, retryAfter: 0, finish: noop };
      const now = Date.now();
      const reservation = store.reserveRateLimitHit(database, {
        kind,
        bucketHash: bucketHash(kind, key),
        cutoff: now - rule.windowMs,
        max: rule.max,
        at: now,
      });
      if (reservation.limited) {
        return {
          limited: true,
          retryAfter: retryAfterFor(reservation, rule, now),
          finish: noop,
        };
      }
      let active = true;
      return {
        limited: false,
        retryAfter: 0,
        finish(record = false) {
          if (!active) return;
          active = false;
          const current = refreshSettings();
          const keep = Boolean(record && current.enabled && current.rules[kind]);
          store.finishRateLimitReservation(database, reservation.id, { record: keep });
        },
      };
    },

    /** Count one completed attempt. Callers use this only after validation, so
     * malformed probes do not spend a real visitor's allowance. */
    record(kind, key) {
      refreshSettings();
      const rule = settings.rules[kind];
      if (!settings.enabled || !rule) return;
      store.recordRateLimitHit(database, {
        kind,
        bucketHash: bucketHash(kind, key),
        at: Date.now(),
      });
    },

    clear(kind, key) {
      store.clearRateLimitBucket(database, {
        kind,
        bucketHash: bucketHash(kind, key),
      });
    },

    clearAll() {
      store.clearRateLimitHits(database);
    },
  };

  /* All normal windows are at most 24 hours. Each worker may run this cheap
     cleanup, but SQLite serialises it and the indexed DELETE remains bounded. */
  setInterval(() => {
    store.pruneRateLimitHits(database, Date.now() - MAX_WINDOW_MS);
  }, 10 * 60 * 1000).unref?.();

  return api;
}

export function rateLimitResponse(res, retryAfter, error = 'rate limited') {
  const seconds = Math.max(1, Math.ceil(Number(retryAfter) || 1));
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({ error, retryAfter: seconds });
}
