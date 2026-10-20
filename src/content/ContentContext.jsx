import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { localizeState } from '../../shared/i18n/index.js';
import { useLocale } from '../i18n/LocaleContext';

const Ctx = createContext(null);

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export const api = async (path, { method = 'GET', body, auth: _auth = false, formData } = {}) => {
  const headers = {};
  if (body && !formData) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
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
      code: payload?.code || '',
      detail: payload?.detail || '',
      field: payload?.field || '',
      retryAfter: Number(payload?.retryAfter || res.headers.get('Retry-After') || 0),
    });
  }
  return res.json();
};

/* -------------------------------------------------------------------------
   Live content, not a persisted browser snapshot.

   The previous stale-while-revalidate cache could paint yesterday's copy from
   localStorage and keep it for an entire open session. Content now always comes
   from a no-store request. `reload` de-duplicates concurrent callers so first
   paint, a route change and an admin refresh can safely ask for freshness at
   the same time without racing three responses into state.
   ------------------------------------------------------------------------- */
const LEGACY_CONTENT_CACHE_KEY = 'ky_content_cache_v1';

export function ContentProvider({ children }) {
  const { locale } = useLocale();
  const [state, setState] = useState(() => clone(DEFAULT_STATE));
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(null);
  const persistedState = useRef(state);
  const saveTail = useRef(Promise.resolve());
  const saveRevision = useRef(0);

  /* Re-read the complete public snapshot. Stock can move after an order and
     copy can be published while somebody is browsing, so callers must never
     receive an HTTP/browser-cached response. */
  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;

    setRefreshing(true);
    const request = (async () => {
      const r = await fetch('/api/content', { cache: 'no-store' });
      if (!r.ok) throw Object.assign(new Error('no api'), { status: r.status });
      const data = await r.json();
      const next = mergeContentState(DEFAULT_STATE, data);
      persistedState.current = next;
      setState(next);
      setBackend(true);
      return data;
    })()
      .catch((error) => {
        setBackend(false);
        throw error;
      })
      .finally(() => {
        if (inFlight.current !== request) return;
        inFlight.current = null;
        setRefreshing(false);
        setReady(true);
      });

    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    /* Remove snapshots written by older releases; leaving the key behind makes
       a rollback or a second tab capable of resurrecting stale public copy. */
    try {
      localStorage.removeItem(LEGACY_CONTENT_CACHE_KEY);
    } catch {}
    reload().catch(() => {});
  }, [reload]);

  const save = useCallback((next, { optimistic = true } = {}) => {
    const revision = ++saveRevision.current;

    /* Controlled text/link/media inputs save on every change and must repaint
       immediately or the browser drops keystrokes while the request is in
       flight. Rich-text publish flows pass optimistic:false: a sanitizer 400
       then leaves the accepted snapshot visible and keeps the editor open. */
    if (optimistic) setState(next);

    /* Preserve invocation order. Apart from preventing older responses from
       winning, this gives a rollback one unambiguous last-persisted snapshot. */
    const request = saveTail.current
      .catch(() => {})
      .then(() => api('/api/content', { method: 'PUT', body: next, auth: true }));
    saveTail.current = request;

    return request
      .then(() => {
        persistedState.current = next;
        if (!optimistic && revision === saveRevision.current) setState(next);
        setBackend(true);
      })
      .catch((error) => {
        /* A later optimistic edit already supersedes this request. If the
           latest request itself fails, roll the controls back to what the
           server most recently accepted rather than displaying a false save. */
        if (revision === saveRevision.current) setState(persistedState.current);
        throw error;
      });
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
      refreshing,
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
    [state, view, fallback, locale, ready, backend, refreshing, save, reload]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => useContext(Ctx);
