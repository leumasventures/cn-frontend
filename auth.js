/**
 * auth.js — C.N. Johnson Ventures
 * Include on every protected page BEFORE any inline scripts.
 * DO NOT include on login.html, signup.html, or pending.html.
 *
 * Uses cookies for auth token storage so sessions work across all devices.
 *
 * Provides:
 *  - CNJ.token            — current access token
 *  - CNJ.user             — parsed user object
 *  - CNJ.role             — e.g. "CASHIER", "ADMIN", "MANAGER"
 *  - CNJ.fetch(url, opts) — drop-in fetch wrapper, auto-refreshes on 401
 *  - CNJ.logout()         — clears auth cookies and redirects to login
 */
(() => {
  'use strict';

  const API_BASE     = 'https://cn-active-backend-1.onrender.com';
  const PUBLIC_PAGES = ['login.html', 'signup.html', 'pending.html', 'index.html', ''];
  const currentPage  = window.location.pathname.split('/').pop();
  const IS_HTTPS     = location.protocol === 'https:';

  if (PUBLIC_PAGES.includes(currentPage)) return;

  /* ── Cookie helpers ─────────────────────────────────────────────── */
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    const age    = maxAgeSeconds ? `; max-age=${maxAgeSeconds}` : '';
    const secure = IS_HTTPS ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}${age}; path=/; SameSite=Lax${secure}`;
  }

  function deleteCookie(name) {
    const secure = IS_HTTPS ? '; Secure' : '';
    document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax${secure}`;
  }

  /* ── Token accessors ────────────────────────────────────────────── */
  function getToken()   { return getCookie('cnj_access_token'); }
  function getRefresh() { return getCookie('cnj_refresh_token'); }
  function getAuth() {
    try { return JSON.parse(getCookie('cnjohnson_auth') || 'null'); } catch { return null; }
  }

  function setTokens(access, refresh, expiresIn) {
    const age = expiresIn || 3600;
    setCookie('cnj_access_token', access, age);
    if (refresh) setCookie('cnj_refresh_token', refresh, age * 24);
  }

  function clearAuth() {
    ['cnj_access_token', 'cnj_refresh_token', 'cnjohnson_auth', 'cnj_pending_email']
      .forEach(deleteCookie);
  }

  /* ── Token refresh ──────────────────────────────────────────────── */
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

  /* ── Guard: redirect if not authenticated ───────────────────────── */
  const token = getToken();
  const auth  = getAuth();

  if (!token || !auth) {
    console.warn('[CNJ] No valid session — redirecting to login');
    window.location.replace('login.html');
    return;
  }

  /* ── Role guards ────────────────────────────────────────────────── */
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

  /* ── CNJ global ─────────────────────────────────────────────────── */
  window.CNJ = {
    user:  auth,
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
          'Authorization': `Bearer ${tok}`,
          ...(opts.headers || {}),
        },
      });

      let res = await makeReq(getToken());

      if (res.status === 401) {
        const newToken = await refreshToken();
        if (newToken) {
          res = await makeReq(newToken);
        } else {
          clearAuth();
          window.location.replace('login.html');
          return res;
        }
      }

      return res;
    },

    logout() {
      clearAuth();
      window.location.replace('login.html');
    },
  };

  /* ── Proactive silent refresh after 55 minutes ──────────────────── */
  setTimeout(() => refreshToken().catch(() => {}), 55 * 60 * 1000);

})();