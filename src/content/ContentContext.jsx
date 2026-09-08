import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import DEFAULT_STATE from '../../shared/contentDefaults.js';

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
  if (!res.ok) throw new Error(`api error ${res.status}`);
  return res.json();
};

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
  return out;
}

export function ContentProvider({ children }) {
  const [state, setState] = useState(() => clone(DEFAULT_STATE));
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/content')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no api'))))
      .then((data) => {
        if (!alive) return;
        setState(mergeState(DEFAULT_STATE, data));
        setBackend(true);
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next) => {
    setState(next);
    await api('/api/content', { method: 'PUT', body: next, auth: true });
  }, []);

  const value = useMemo(
    () => ({
      state,
      ready,
      backend,
      save,
      t: (k) => state.texts?.[k] ?? DEFAULT_STATE.texts[k] ?? '',
      m: (k) => state.media?.[k] ?? DEFAULT_STATE.media[k] ?? '',
      l: (k) => state.links?.[k] ?? DEFAULT_STATE.links[k] ?? '#',
      col: (k) => state.collections?.[k] ?? DEFAULT_STATE.collections[k] ?? [],
      products: state.products ?? [],
      posts: state.posts ?? [],
      brands: state.brands ?? DEFAULT_STATE.brands,
    }),
    [state, ready, backend, save]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => useContext(Ctx);
