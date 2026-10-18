/* ==========================================================================
   Customer account state.
   --------------------------------------------------------------------------
   The session lives in an HttpOnly cookie, so there is deliberately nothing
   to store here: this file never holds a token, and a refresh re-reads the
   session from the server rather than trusting anything in the tab. The only
   client state is the profile, the addresses and the orders, all of which
   come from one /api/account/me call.
   ========================================================================== */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const AccountCtx = createContext(null);

/* Every call is same-origin and must carry the cookie; fetch does not send
   credentials cross-origin by default, and 'same-origin' says exactly what
   is meant. The Origin header the browser attaches is what the server's
   CSRF check reads. */
async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    /* Session state is private and mutable. In particular, `/me` before an
       order or after logout must never be replayed from the HTTP cache after
       the customer signs back in. */
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body is not an error by itself */
  }
  if (!res.ok) {
    const err = new Error(data.error || 'request failed');
    err.status = res.status;
    err.fields = data.fields || null;
    err.retryAfter = data.retryAfter || null;
    throw err;
  }
  return data;
}

export function AccountProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [orders, setOrders] = useState([]);
  /* Only the newest session read may update the account. A slow `/me` started
     before login/logout can otherwise arrive last and overwrite the new
     session with stale customer or order data. */
  const refreshVersion = useRef(0);
  /* 'loading' until the first /me resolves. Pages must be able to tell "not
     signed in" from "we do not know yet", or a protected page flashes its
     signed-out state on every refresh. */
  const [status, setStatus] = useState('loading');

  const apply = useCallback((d) => {
    setCustomer(d.customer || null);
    setAddresses(d.addresses || []);
    setOrders(d.orders || []);
    setStatus(d.customer ? 'in' : 'out');
  }, []);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const data = await call('/api/account/me');
      if (version === refreshVersion.current) apply(data);
      return data;
    } catch {
      /* Network trouble is not "signed out": clearing the session here
         would log someone out every time their phone lost signal. */
      if (version === refreshVersion.current) setStatus((s) => (s === 'loading' ? 'out' : s));
      return null;
    }
  }, [apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Login/register/reset return the complete account snapshot in the same
     response that establishes the cookie. Applying that response directly
     avoids a follow-up `/me` racing cookie storage or a stale browser cache.
     The generation also prevents an older initial `/me` from winning later. */
  const establish = useCallback(async (url, body) => {
    const version = ++refreshVersion.current;
    const data = await call(url, { method: 'POST', body });
    if (version === refreshVersion.current) apply(data);
    return data;
  }, [apply]);

  const api = useMemo(
    () => ({
      requestCode: (phone, purpose = 'register') => call('/api/account/otp', { method: 'POST', body: { phone, purpose } }),
      verifyCode: (phone, code, purpose = 'register') =>
        call('/api/account/otp/verify', { method: 'POST', body: { phone, code, purpose } }),
      register: (payload) => establish('/api/account/register', payload),
      login: (phone, password) => establish('/api/account/login', { phone, password }),
      resetPassword: (ticket, password) => establish('/api/account/reset', { ticket, password }),
      logout: async () => {
        /* Invalidate a `/me` already in flight before revoking its cookie. */
        refreshVersion.current += 1;
        await call('/api/account/logout', { method: 'POST', body: {} });
        setCustomer(null);
        setAddresses([]);
        setOrders([]);
        setStatus('out');
      },
      saveProfile: async (profile) => {
        const d = await call('/api/account/profile', { method: 'PUT', body: profile });
        setCustomer(d.customer);
        return d;
      },
      changePassword: (current, password) => call('/api/account/password', { method: 'POST', body: { current, password } }),
      addAddress: async (a) => {
        const d = await call('/api/account/addresses', { method: 'POST', body: a });
        setAddresses(d.addresses);
        return d;
      },
      updateAddress: async (id, a) => {
        const d = await call(`/api/account/addresses/${id}`, { method: 'PUT', body: a });
        setAddresses(d.addresses);
        return d;
      },
      removeAddress: async (id) => {
        const d = await call(`/api/account/addresses/${id}`, { method: 'DELETE' });
        setAddresses(d.addresses);
        return d;
      },
      makeDefault: async (id) => {
        const d = await call(`/api/account/addresses/${id}/default`, { method: 'POST', body: {} });
        setAddresses(d.addresses);
        return d;
      },
      refresh,
    }),
    [establish, refresh]
  );

  const value = useMemo(
    () => ({ customer, addresses, orders, status, signedIn: status === 'in', ...api }),
    [customer, addresses, orders, status, api]
  );

  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAccount() {
  return useContext(AccountCtx) || { status: 'out', signedIn: false, customer: null, addresses: [], orders: [] };
}
