/**
 * auth-guard.js — C.N. Johnson Ventures
 * Include on every protected page BEFORE any inline scripts.
 * DO NOT also include auth.js — this file replaces it entirely.
 *
 * localStorage usage is LIMITED TO AUTH TOKENS ONLY:
 *   cnj_access_token, cnj_refresh_token, cnjohnson_auth, cnjohnson_token_expiry
 *
 * NO business/app data is stored in localStorage.
 * All products, sales, customers, etc. are fetched from the DB on every page load.
 *
 * Provides:
 *  - CNJ.token        — current access token (always fresh)
 *  - CNJ.fetch(url, opts) — drop-in fetch wrapper that auto-refreshes on 401
 *  - CNJ.logout()     — clears auth tokens and redirects
 */
(() => {
  'use strict';

  const API_BASE     = 'https://cn-active-backend-1.onrender.com';
  const PUBLIC_PAGES = ['login.html', 'signup.html', 'pending.html', 'index.html', ''];
  const currentPage  = window.location.pathname.split('/').pop();

  if (PUBLIC_PAGES.includes(currentPage)) return;

  // ── Auth token keys (the ONLY things stored in localStorage) ──────
  const K = {
    token:   'cnj_access_token',
    refresh: 'cnj_refresh_token',
    auth:    'cnjohnson_auth',
    expiry:  'cnjohnson_token_expiry',
  };

  function getToken()   { return localStorage.getItem(K.token); }
  function getRefresh() { return localStorage.getItem(K.refresh); }
  function getAuth()    { try { return JSON.parse(localStorage.getItem(K.auth)); } catch { return null; } }

  function setTokens(access, refresh, expiresIn) {
    localStorage.setItem(K.token, access);
    if (refresh) localStorage.setItem(K.refresh, refresh);
    const ms = expiresIn ? expiresIn * 1000 : 60 * 60 * 1000;
    localStorage.setItem(K.expiry, Date.now() + ms);
  }

  function clearAuth() {
    // Remove ONLY auth keys — app state is in-memory (STATE) and the DB, not localStorage
    [K.token, K.refresh, K.auth, K.expiry].forEach(k => localStorage.removeItem(k));
  }

  // ── Token refresh ────────────────────────────────────────────────
  let _refreshPromise = null;

  async function refreshToken() {
    if (_refreshPromise) return _refreshPromise;
    const refreshTok = getRefresh();
    if (!refreshTok) return null;

    _refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refreshToken: refreshTok }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.accessToken) {
          setTokens(data.accessToken, data.refreshToken || refreshTok, data.expiresIn);
          return data.accessToken;
        }
      } catch (e) {
        console.warn('[CNJ] Token refresh failed:', e.message);
      }
      return null;
    })();

    const result = await _refreshPromise;
    _refreshPromise = null;
    return result;
  }

  // ── Guard: check auth on page load ───────────────────────────────
  const token = getToken();
  const auth  = getAuth();

  if (!token || !auth) {
    window.location.replace('login.html');
    return;
  }

  const expiry = Number(localStorage.getItem(K.expiry) || 0);
  if (expiry && Date.now() > expiry) {
    refreshToken().then(newToken => {
      if (!newToken) {
        clearAuth();
        window.location.replace('login.html');
      }
    });
  }

  // ── Role guards ──────────────────────────────────────────────────
  const role = auth.role;
  if (role === 'CASHIER' && currentPage !== 'pos.html') {
    window.location.replace('pos.html');
    return;
  }
  const ADMIN_ONLY = ['admin.html', 'admin-users.html', 'users.html'];
  if (role === 'MANAGER' && ADMIN_ONLY.includes(currentPage)) {
    window.location.replace('dashboard.html');
    return;
  }

  // ── CNJ global ───────────────────────────────────────────────────
  window.CNJ = {
    user:      auth,
    role,
    get token() { return getToken(); },

    isAdmin:   role === 'ADMIN',
    isManager: role === 'MANAGER',
    isCashier: role === 'CASHIER',

    async fetch(url, opts = {}) {
      const makeReq = (tok) => fetch(url, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok}`,
          ...(opts.headers || {}),
        },
      });

      let res = await makeReq(getToken());

      if (res.status === 401) {
        const newToken = await refreshToken();
        if (newToken) {
          res = await makeReq(newToken);
        } else {
          const method = (opts.method || 'GET').toUpperCase();
          if (method === 'GET') {
            clearAuth();
            window.location.replace('login.html');
            return res;
          }
        }
      }
      return res;
    },

    logout() {
      // Clears ONLY auth tokens — no other localStorage keys are used by this app
      clearAuth();
      window.location.replace('login.html');
    },
  };

  // Silently refresh token 1 minute before expiry
  const msUntilExpiry = expiry ? expiry - Date.now() : 0;
  const refreshIn     = Math.max(msUntilExpiry - 60_000, 0);
  if (refreshIn < 14 * 60 * 1000) {
    setTimeout(() => {
      refreshToken().catch(() => {});
    }, refreshIn);
  }

})();