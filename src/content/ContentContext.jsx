import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import DEFAULT_STATE from '../../shared/contentDefaults.js';
import { mergeContentState } from '../../shared/contentState.js';
import { CONTENT_REVISION_HEADER, parseContentRevision } from '../../shared/contentRevision.js';
import { localizeState } from '../../shared/i18n/index.js';
import { safeSocialLinks } from '../../shared/socialLinks.js';
import { normalizePublicView } from '../../shared/persianCopy.js';
import { useLocale } from '../i18n/LocaleContext';

const Ctx = createContext(null);

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* React content editors update one top-level bucket at a time. Preserve that
   boundary over HTTP instead of serialising the complete CMS tree for every
   field: unchanged object identities are the same ones held by state. */
const changedBuckets = (current, next) => {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return {};
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => !Object.is(current?.[key], value)),
  );
};

export const api = async (path, { method = 'GET', body, auth: _auth = false, formData, headers: extraHeaders = {} } = {}) => {
  const headers = { ...extraHeaders };
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
      problem: payload?.problem || '',
      detail: payload?.detail || '',
      field: payload?.field || '',
      revision: parseContentRevision(payload?.revision ?? res.headers.get(CONTENT_REVISION_HEADER)),
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
  const [contentAvailable, setContentAvailable] = useState(false);
  const [contentConflict, setContentConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(null);
  const stateRef = useRef(state);
  const persistedState = useRef(state);
  const contentRevision = useRef(null);
  const saveTail = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const bucketRevisions = useRef(new Map());
  const pendingAutosaves = useRef(new Map());
  const optimisticBuckets = useRef(new Map());
  const flushAutosavesRef = useRef(() => {});

  /* Re-read the complete public snapshot. Stock can move after an order and
     copy can be published while somebody is browsing, so callers must never
     receive an HTTP/browser-cached response. */
  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;

    setRefreshing(true);
    const request = (async () => {
      /* Do not let a GET started behind an in-flight PATCH replace its accepted
         optimistic value with an older snapshot. Queue any pending debounce
         batch first, then wait until the server has accepted or refused it. */
      flushAutosavesRef.current();
      await saveTail.current.catch(() => {});
      const r = await fetch('/api/content', { cache: 'no-store' });
      if (!r.ok) throw Object.assign(new Error('no api'), { status: r.status });
      const data = await r.json();
      const persistedNext = mergeContentState(DEFAULT_STATE, data);
      const next = { ...persistedNext };
      const persisted = r.headers.get('x-khyeast-content-status') !== 'fallback';
      const serverRevision = parseContentRevision(r.headers.get(CONTENT_REVISION_HEADER));
      const localRevision = ++saveRevision.current;
      for (const key of Object.keys(next)) {
        const optimistic = optimisticBuckets.current.get(key);
        if (optimistic) next[key] = optimistic.value;
        else bucketRevisions.current.set(key, localRevision);
      }
      contentRevision.current = persisted ? serverRevision : null;
      persistedState.current = persistedNext;
      stateRef.current = next;
      setState(next);
      setBackend(true);
      setContentAvailable(persisted && serverRevision !== null);
      return data;
    })()
      .catch((error) => {
        setBackend(false);
        setContentAvailable(false);
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

  const persistChanges = useCallback((changes, { revisions, optimistic }) => {
    if (optimistic) {
      for (const [key, value] of Object.entries(changes)) {
        optimisticBuckets.current.set(key, { value, revision: revisions[key] });
      }
    }

    /* Keep writes ordered, but send only changed top-level buckets. Each write
       carries the revision of the GET (or preceding accepted PATCH) that its
       draft is based on; reading a revision inside the request would compare
       current state with itself and miss stale tabs entirely. */
    const request = saveTail.current
      .catch(() => {})
      .then(() => {
        const expectedRevision = contentRevision.current;
        if (expectedRevision === null) {
          throw Object.assign(new Error('content revision unavailable; reload before saving'), {
            code: 'content-revision-unavailable',
          });
        }
        return api('/api/content', {
          method: 'PATCH',
          body: { changes },
          auth: true,
          headers: { [CONTENT_REVISION_HEADER]: String(expectedRevision) },
        });
      })
      .then((result) => {
        const acceptedRevision = parseContentRevision(result?.revision);
        if (acceptedRevision === null) {
          throw Object.assign(new Error('server did not return a valid content revision'), {
            code: 'invalid-content-revision-response',
          });
        }
        contentRevision.current = acceptedRevision;
        return result;
      });
    saveTail.current = request;

    return request
      .then((result) => {
        persistedState.current = { ...persistedState.current, ...changes };
        if (optimistic) {
          for (const key of Object.keys(changes)) {
            if (optimisticBuckets.current.get(key)?.revision === revisions[key]) {
              optimisticBuckets.current.delete(key);
            }
          }
        }

        /* Explicit editors keep their draft outside the context and opt out of
           optimistic state. Publish their accepted buckets only if no newer
           edit to the same bucket has superseded this request. */
        if (!optimistic) {
          const accepted = Object.fromEntries(
            Object.entries(changes).filter(([key]) => bucketRevisions.current.get(key) === revisions[key]),
          );
          if (Object.keys(accepted).length) {
            const nextState = { ...stateRef.current, ...accepted };
            stateRef.current = nextState;
            setState(nextState);
          }
        }
        setBackend(true);
        setContentAvailable(true);
        setContentConflict(false);
        return result;
      })
      .catch((error) => {
        if (optimistic) {
          /* Roll back only buckets still owned by this failed revision. A later
             edit in another bucket remains visible, and a newer edit in this
             bucket will be handled by its own queued request. */
          const rollback = Object.fromEntries(
            Object.keys(changes)
              .filter((key) => bucketRevisions.current.get(key) === revisions[key])
              .map((key) => [key, persistedState.current[key]]),
          );
          if (Object.keys(rollback).length) {
            const nextState = { ...stateRef.current, ...rollback };
            stateRef.current = nextState;
            setState(nextState);
          }
          for (const key of Object.keys(changes)) {
            if (optimisticBuckets.current.get(key)?.revision === revisions[key]) {
              optimisticBuckets.current.delete(key);
            }
          }
        }
        if (error?.code === 'content-unavailable') setContentAvailable(false);
        if (error?.code === 'content-conflict') {
          setContentConflict(true);
          /* The failed request is already settled when this task runs, so
             reload can safely wait on saveTail without awaiting itself. */
          window.setTimeout(() => reload().catch(() => {}), 0);
        }
        throw error;
      });
  }, [reload]);

  const save = useCallback((next, { optimistic = true } = {}) => {
    const changes = changedBuckets(stateRef.current, next);
    if (!Object.keys(changes).length) return Promise.resolve({ ok: true, unchanged: true });

    /* A discrete action (for example, an uploaded media URL) supersedes an
       older debounced value in the same bucket. Remove that stale pending
       fragment before it can be queued after the newer explicit save. */
    const supersededOptimistic = [];
    for (const [pendingKey, pending] of pendingAutosaves.current) {
      for (const bucket of Object.keys(changes)) {
        const pendingRevision = pending.revisions[bucket];
        delete pending.changes[bucket];
        delete pending.revisions[bucket];
        if (optimisticBuckets.current.get(bucket)?.revision === pendingRevision) {
          optimisticBuckets.current.delete(bucket);
          supersededOptimistic.push(bucket);
        }
      }
      if (Object.keys(pending.changes).length) continue;
      if (pending.timer) clearTimeout(pending.timer);
      pendingAutosaves.current.delete(pendingKey);
      for (const { resolve } of pending.waiters) resolve({ ok: true, superseded: true });
    }
    if (!optimistic && supersededOptimistic.length) {
      const reset = Object.fromEntries(
        supersededOptimistic.map((bucket) => [bucket, persistedState.current[bucket]]),
      );
      const resetState = { ...stateRef.current, ...reset };
      stateRef.current = resetState;
      setState(resetState);
    }

    const revision = ++saveRevision.current;
    const revisions = Object.fromEntries(Object.keys(changes).map((key) => [key, revision]));
    for (const key of Object.keys(changes)) bucketRevisions.current.set(key, revision);

    /* Immediate optimistic paint remains the default for discrete Admin
       actions. Rich-text publish flows use optimistic:false so a sanitizer
       refusal leaves the accepted snapshot visible and their draft intact. */
    if (optimistic) {
      const nextState = { ...stateRef.current, ...changes };
      stateRef.current = nextState;
      setState(nextState);
    }
    return persistChanges(changes, { revisions, optimistic });
  }, [persistChanges]);

  const autosave = useCallback((next, { delay = 700, key = 'content-fields' } = {}) => {
    const changes = changedBuckets(stateRef.current, next);
    if (!Object.keys(changes).length) return Promise.resolve({ ok: true, unchanged: true });

    const revision = ++saveRevision.current;
    for (const bucket of Object.keys(changes)) bucketRevisions.current.set(bucket, revision);

    /* Controlled inputs still repaint synchronously. Only persistence is
       delayed, and repeated keystrokes coalesce into the newest bucket value. */
    const nextState = { ...stateRef.current, ...changes };
    stateRef.current = nextState;
    setState(nextState);
    for (const [bucket, value] of Object.entries(changes)) {
      optimisticBuckets.current.set(bucket, { value, revision });
    }

    let pending = pendingAutosaves.current.get(key);
    if (!pending) {
      pending = { changes: {}, revisions: {}, waiters: [], timer: null };
      pendingAutosaves.current.set(key, pending);
    }
    pending.changes = { ...pending.changes, ...changes };
    for (const bucket of Object.keys(changes)) pending.revisions[bucket] = revision;
    if (pending.timer) clearTimeout(pending.timer);

    const result = new Promise((resolve, reject) => pending.waiters.push({ resolve, reject }));
    pending.timer = setTimeout(() => {
      pendingAutosaves.current.delete(key);
      persistChanges(pending.changes, { revisions: pending.revisions, optimistic: true })
        .then((value) => pending.waiters.forEach(({ resolve }) => resolve(value)))
        .catch((error) => pending.waiters.forEach(({ reject }) => reject(error)));
    }, Math.max(0, Number(delay) || 0));
    return result;
  }, [persistChanges]);

  flushAutosavesRef.current = () => {
    for (const [key, pending] of [...pendingAutosaves.current]) {
      if (pending.timer) clearTimeout(pending.timer);
      pendingAutosaves.current.delete(key);
      persistChanges(pending.changes, { revisions: pending.revisions, optimistic: true })
        .then((value) => pending.waiters.forEach(({ resolve }) => resolve(value)))
        .catch((error) => pending.waiters.forEach(({ reject }) => reject(error)));
    }
  };

  /* Persian is the base language; English, Arabic and Russian are overlays
     applied on top of it (shipped translation first, Admin overrides second).
     Public locale packs are coverage-tested so their visible copy is complete. */
  const view = useMemo(() => normalizePublicView(localizeState(state, locale)), [state, locale]);
  const fallback = useMemo(() => normalizePublicView(localizeState(DEFAULT_STATE, locale)), [locale]);

  const value = useMemo(
    () => ({
      state,
      locale,
      ready,
      backend,
      contentAvailable,
      contentConflict,
      refreshing,
      save,
      autosave,
      reload,
      t: (k) => view.texts?.[k] ?? fallback.texts[k] ?? '',
      m: (k) => view.media?.[k] ?? fallback.media[k] ?? '',
      l: (k) => view.links?.[k] ?? fallback.links[k] ?? '#',
      col: (k) => {
        const collection = view.collections?.[k] ?? fallback.collections[k] ?? [];
        return k === 'socials' ? safeSocialLinks(collection) : collection;
      },
      products: view.products ?? [],
      posts: view.posts ?? [],
      gallery: view.gallery ?? [],
      brands: view.brands ?? fallback.brands,
    }),
    [state, view, fallback, locale, ready, backend, contentAvailable, contentConflict, refreshing, save, autosave, reload]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => useContext(Ctx);
