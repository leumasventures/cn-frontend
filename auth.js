/**
 * auth.js — C.N. Johnson Ventures
 * Include on every protected page BEFORE any inline scripts.
 * DO NOT include on login.html, signup.html, or pending.html.
 */
(() => {
  'use strict';

  const API_BASE     = 'https://cn-active-backend-1.onrender.com';
  const PUBLIC_PAGES = ['login.html', 'signup.html', 'pending.html', 'index.html', ''];
  const currentPage  = window.location.pathname.split('/').pop();
  const IS_HTTPS     = location.protocol === 'https:';
  const SESSION_AGE  = 7 * 24 * 60 * 60; // 7 days

  // FIX: always use the root domain so cookies work on www. AND non-www
  const COOKIE_DOMAIN = 'cnjohnsonventures.com';

  if (PUBLIC_PAGES.includes(currentPage)) return;

  /* ── Cookie helpers ─────────────────────────────────────────────── */
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    const age    = maxAgeSeconds ? `; max-age=${maxAgeSeconds}` : '';
    const secure = IS_HTTPS ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}${age}; path=/; domain=${COOKIE_DOMAIN}; SameSite=Lax${secure}`;
  }

  function deleteCookie(name) {
    const secure = IS_HTTPS ? '; Secure' : '';
    document.cookie = `${name}=; max-age=0; path=/; domain=${COOKIE_DOMAIN}; SameSite=Lax${secure}`;
  }

  /* ── Token accessors ────────────────────────────────────────────── */
  function getToken()   { return getCookie('cnj_access_token'); }
  function getRefresh() { return getCookie('cnj_refresh_token'); }
  function getAuth() {
    try { return JSON.parse(getCookie('cnjohnson_auth') || 'null'); } catch { return null; }
  }

  function setTokens(access, refresh, user, expiresIn) {
    const age = expiresIn || SESSION_AGE;
    setCookie('cnj_access_token', access, age);
    if (refresh) setCookie('cnj_refresh_token', refresh, age * 24);
    if (user)    setCookie('cnjohnson_auth', JSON.stringify(user), age);
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
          setTokens(data.accessToken, data.refreshToken || refreshTok, data.user || getAuth(), data.expiresIn);
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
    const refreshTok = getRefresh();
    if (refreshTok) {
      refreshToken().then(newToken => {
        if (newToken) {
          window.location.reload();
        } else {
          console.warn('[CNJ] Refresh failed — redirecting to login');
          window.location.replace('login.html');
        }
      });
    } else {
      console.warn('[CNJ] No valid session — redirecting to login');
      window.location.replace('login.html');
    }
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

  // Proactive refresh 30 minutes before session ends
  setTimeout(() => refreshToken().catch(() => {}), (SESSION_AGE - 30 * 60) * 1000);

})();