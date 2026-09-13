import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { localizeState } from '../../shared/i18n/index.js';
import { useLocale } from '../i18n/LocaleContext';

const Ctx = createContext(null);

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export const tokenGet = () => localStorage.getItem('ky_admin_token') || '';
export const tokenSet = (t) => (t ? localStorage.setItem('ky_admin_token', t) : localStorage.removeItem('ky_admin_token'));

export const api = async (path, { method = 'GET', body, auth = false, formData } = {}) => {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${tokenGet()}`;
  if (body && !formData) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
  if (!res.ok) {
    /* Carry the status and the server's explanation onto the error. Callers
       need them to tell a refusal apart from a failure — a 409 when stock is
       too low to re-reserve a cancelled order is something the admin can act
       on, and it used to surface as a generic "api error 409" with the real
       message discarded. */
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw Object.assign(new Error(payload?.error || `api error ${res.status}`), {
      status: res.status,
      detail: payload?.detail || '',
    });
  }
  return res.json();
};

/* Entity arrays are rendered by components that dereference fields directly
   (card.slug, card.featured, card.image). A null or primitive row therefore
   throws during render and blanks the entire site rather than hiding one
   item. content.json is hand-editable and admin-writable, so a malformed row
   is reachable without an attacker — drop them at the boundary. */
const ENTITY_ARRAYS = ['products', 'posts', 'brands'];
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* deep-merge remote state over defaults (arrays & primitives replaced) */
function mergeState(base, remote) {
  const out = clone(base);
  if (!remote || typeof remote !== 'object') return out;
  for (const key of Object.keys(out)) {
    if (!(key in remote)) continue;
    const rv = remote[key];
    if (Array.isArray(out[key])) out[key] = Array.isArray(rv) ? rv : out[key];
    else if (out[key] && typeof out[key] === 'object') out[key] = { ...out[key], ...rv };
    else out[key] = rv;
  }
  for (const key of ENTITY_ARRAYS) {
    if (Array.isArray(out[key])) out[key] = out[key].filter(isPlainObject);
  }
  return out;
}

/* -------------------------------------------------------------------------
   Offline-first content cache.
   On a slow connection the /api/content round-trip is what makes the first
   screen wait. We render the last known content from localStorage instantly
   ("stale-while-revalidate") and quietly swap in the fresh copy when it lands.
   ------------------------------------------------------------------------- */
const CACHE_KEY = 'ky_content_cache_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // keep for a day

const cacheRead = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (!data || Date.now() - at > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
};
const cacheWrite = (data) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {}
};

export function ContentProvider({ children }) {
  const { locale } = useLocale();
  const cached = typeof window !== 'undefined' ? cacheRead() : null;
  const [state, setState] = useState(() => (cached ? mergeState(DEFAULT_STATE, cached) : clone(DEFAULT_STATE)));
  const [ready, setReady] = useState(Boolean(cached));
  const [backend, setBackend] = useState(false);

  /* Re-read the server copy on demand. Stock changes constantly (every order,
     every order-status change), so the snapshot taken at page load goes stale
     while the admin works. This backs the refresh button on the shop tab. */
  const reload = useCallback(async () => {
    const r = await fetch('/api/content', { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('no api'), { status: r.status });
    const data = await r.json();
    setState(mergeState(DEFAULT_STATE, data));
    setBackend(true);
    cacheWrite(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/content')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
      .then((data) => {
        if (!alive) return;
        setState(mergeState(DEFAULT_STATE, data));
        setBackend(true);
        cacheWrite(data);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next) => {
    setState(next);
    cacheWrite(next);
    await api('/api/content', { method: 'PUT', body: next, auth: true });
  }, []);

  /* Persian is the base language; English and Arabic are overlays applied on
     top of it (shipped translation first, admin-edited overrides second), so
     an untranslated key still renders instead of vanishing. */
  const view = useMemo(() => localizeState(state, locale), [state, locale]);
  const fallback = useMemo(() => localizeState(DEFAULT_STATE, locale), [locale]);

  const value = useMemo(
    () => ({
      state,
      locale,
      ready,
      backend,
      save,
      reload,
      t: (k) => view.texts?.[k] ?? fallback.texts[k] ?? '',
      m: (k) => view.media?.[k] ?? fallback.media[k] ?? '',
      l: (k) => view.links?.[k] ?? fallback.links[k] ?? '#',
      col: (k) => view.collections?.[k] ?? fallback.collections[k] ?? [],
      products: view.products ?? [],
      posts: view.posts ?? [],
      brands: view.brands ?? fallback.brands,
    }),
    [state, view, fallback, locale, ready, backend, save, reload]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => useContext(Ctx);
