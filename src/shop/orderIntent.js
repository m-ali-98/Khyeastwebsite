const STORAGE_KEY = 'ky_shop_order_intent_v1';
const LOCK_NAME = 'ky-shop-checkout-order-intent';
const INTENT_TTL_MS = 30 * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomId(cryptoApi) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') throw new Error('secure randomness unavailable');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function payloadFingerprint(payload, cryptoApi) {
  const serialized = JSON.stringify(payload);
  if (cryptoApi?.subtle?.digest && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(serialized);
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  /* Old/insecure browser fallback: the fingerprint is only a local lookup key,
     never an authentication credential. Keep the customer note itself out of
     localStorage even if WebCrypto is not present. */
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function readIntent(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (
      value && typeof value === 'object' &&
      UUID_V4.test(String(value.id || '')) &&
      typeof value.fingerprint === 'string' &&
      Number.isFinite(value.createdAt)
    ) return value;
  } catch {
    // Corrupt or unavailable storage means a new intent, never a failed order.
  }
  return null;
}

/** Return the same opaque order ID for the same checkout intent across tabs.
 * The server uses the existing orders.id primary key to serialize replays. */
const browserStorage = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};
const browserLocks = () => {
  try { return globalThis.navigator?.locks || null; } catch { return null; }
};

export async function checkoutOrderId(payload, options = {}) {
  const storage = Object.hasOwn(options, 'storage') ? options.storage : browserStorage();
  const locks = Object.hasOwn(options, 'locks') ? options.locks : browserLocks();
  const cryptoApi = options.cryptoApi || globalThis.crypto;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const fingerprint = await payloadFingerprint(payload, cryptoApi);
  const resolve = () => {
    const current = readIntent(storage);
    if (
      current?.fingerprint === fingerprint &&
      now >= current.createdAt && now - current.createdAt < INTENT_TTL_MS
    ) return current.id;

    const created = { id: randomId(cryptoApi), fingerprint, createdAt: now };
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(created));
    } catch {
      // The per-tab submission lock still protects same-tab retries.
    }
    return created.id;
  };

  if (typeof locks?.request === 'function') {
    try {
      return await locks.request(LOCK_NAME, { mode: 'exclusive' }, resolve);
    } catch {
      // Fall through for browsers with a partial Web Locks implementation.
    }
  }

  const candidate = resolve();
  /* localStorage has no compare-and-set. A short settle window makes racing
     legacy browsers converge on the last cross-tab write before the POST. */
  if (storage) await new Promise((done) => setTimeout(done, 25));
  const confirmed = readIntent(storage);
  return confirmed?.fingerprint === fingerprint ? confirmed.id : candidate;
}

export function clearCheckoutOrderId(id, storage = browserStorage()) {
  try {
    const current = readIntent(storage);
    if (current?.id === id) storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort; server idempotency remains authoritative.
  }
}
