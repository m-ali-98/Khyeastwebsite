/* Site-origin validation shared by payment callbacks, SMS links and CSRF
 * checks. Never derive a production callback from an arbitrary Host header. */
export function parseSiteOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u0020\\]/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash
    ) return '';
    return url.origin;
  } catch {
    return '';
  }
}

const trustedHosts = (env) => String(env?.TRUSTED_HOSTS || '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const requestOrigin = (req) => {
  const host = String(req?.get?.('host') || req?.headers?.host || '').trim().toLowerCase();
  const protocol = String(req?.protocol || '').toLowerCase();
  if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return '';
  if (!['http', 'https'].includes(protocol)) return '';
  return `${protocol}://${host}`;
};

export function isTrustedCallbackBase(value, req, env = process.env) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const candidate = parseSiteOrigin(raw);
  if (!candidate) return false;
  const parsed = new URL(candidate);
  const production = env?.NODE_ENV === 'production';
  if (production && parsed.protocol !== 'https:') return false;

  const pinned = parseSiteOrigin(env?.PUBLIC_ORIGIN);
  if (pinned && candidate === pinned) return true;

  /* Aliases are explicitly opt-in even when a canonical PUBLIC_ORIGIN exists. */
  if (trustedHosts(env).includes(parsed.host.toLowerCase())) return true;

  /* In development only, an operator may pin the exact validated request
     origin. Production must always have a deployment-level trust boundary. */
  if (pinned || production || trustedHosts(env).length) return false;
  return candidate === requestOrigin(req);
}

export function safeOrigin(req, configuredBase, env = process.env) {
  const configured = String(configuredBase || '').trim();
  if (configured) {
    /* A stale or tampered setting is not permission to fall back to a new
       arbitrary Host. Refuse payment/SMS URL generation until it is corrected. */
    return isTrustedCallbackBase(configured, req, env) ? parseSiteOrigin(configured) : '';
  }

  const production = env?.NODE_ENV === 'production';
  const pinned = parseSiteOrigin(env?.PUBLIC_ORIGIN);
  if (pinned) {
    if (production && !pinned.startsWith('https://')) return '';
    return pinned;
  }

  const host = String(req?.get?.('host') || req?.headers?.host || '').trim().toLowerCase();
  const trusted = trustedHosts(env);
  if (trusted.length && !trusted.includes(host)) return '';
  if (!host || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) return '';
  const origin = requestOrigin(req);
  if (!origin || (production && (!origin.startsWith('https://') || !trusted.length))) return '';
  return origin;
}

/** Origins allowed to accompany browser state changes. A canonical origin is
 * always accepted, while explicitly trusted production aliases are HTTPS-only
 * and are validated independently of the request Host. The validated current
 * origin remains available in development and TRUSTED_HOSTS-only deployments. */
export function trustedCsrfOrigins(req, env = process.env) {
  const allowed = new Set();
  const production = env?.NODE_ENV === 'production';
  const pinned = parseSiteOrigin(env?.PUBLIC_ORIGIN);
  if (pinned && (!production || pinned.startsWith('https://'))) allowed.add(pinned);

  const current = safeOrigin(req, '', env);
  if (current && (!production || current.startsWith('https://'))) allowed.add(current);

  for (const host of trustedHosts(env)) {
    const alias = parseSiteOrigin(`https://${host}`);
    if (alias) allowed.add(alias);
  }
  return [...allowed];
}
