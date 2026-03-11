/* ================================================================
   C.N. Johnson Ventures — Unified API + Backend Sync Layer
   api.js  (replaces both api.js and api-sync.js)

   HOW TO USE:
   1. Add <script src="api.js"></script> BEFORE script.js in your HTML
   2. Remove any separate api-sync.js <script> tags
   3. Use window.API.createProduct(...) etc. for direct REST calls
   4. saveState() / loadState() are patched automatically for sync
   ================================================================ */

'use strict';

const API_BASE = 'https://cn-active-backend-1.onrender.com';

/* ════════════════════════════════════════════════════════════════
   CONSISTENT STORAGE KEYS — must match auth-guard.js & login.html
   ════════════════════════════════════════════════════════════════ */
const TOKEN_KEY   = 'cnj_access_token';
const REFRESH_KEY = 'cnj_refresh_token';
const EXPIRY_KEY  = 'cnjohnson_token_expiry';

/* ════════════════════════════════════════════════════════════════
   AUTH HELPERS
   ════════════════════════════════════════════════════════════════ */
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setTokens(access, refresh) {
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(EXPIRY_KEY, Date.now() + 60 * 60 * 1000); // 1hr
}

function clearAuthOnly() {
  // Never call localStorage.clear() — that wipes product/app state
  [TOKEN_KEY, REFRESH_KEY, EXPIRY_KEY, 'cnjohnson_auth'].forEach(k =>
    localStorage.removeItem(k)
  );
}

function authHeaders() {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/* ════════════════════════════════════════════════════════════════
   TOKEN REFRESH  (deduplicates concurrent calls)
   ════════════════════════════════════════════════════════════════ */
let _refreshPromise = null;

async function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;

  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.accessToken) {
        setTokens(data.accessToken, data.refreshToken || refresh);
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

/* ════════════════════════════════════════════════════════════════
   CORE FETCH WRAPPER
   - Auto-attaches Authorization header
   - Retries once after token refresh on 401
   - On save operations (_isSave: true) falls back locally instead
     of redirecting, so a form submit never logs the user out
   ════════════════════════════════════════════════════════════════ */
async function apiFetch(path, options = {}) {
  const isSave = !!options._isSave;
  delete options._isSave; // don't send this flag to the server

  const makeReq = (token) => fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  let res = await makeReq(getToken());

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await makeReq(newToken);
    } else {
      if (isSave) {
        console.warn('[Sync] Auth expired during save — data kept locally');
        return null;
      }
      clearAuthOnly();
      window.location.replace('login.html');
      return null;
    }
  }

  return res;
}

/* Convenience wrapper that throws on non-OK responses */
async function request(method, path, body) {
  const res = await apiFetch(path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res) throw new Error('Request failed — not authenticated');
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ════════════════════════════════════════════════════════════════
   LOGIN / LOGOUT
   ════════════════════════════════════════════════════════════════ */
window.apiLogin = async function (email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  setTokens(data.accessToken, data.refreshToken);
  if (data.user) localStorage.setItem('cnjohnson_auth', JSON.stringify(data.user));
  return data.user;
};

window.apiLogout = async function () {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { }
  clearAuthOnly();
  window.location.replace('login.html');
};

/* ════════════════════════════════════════════════════════════════
   window.API — direct REST methods (replaces old api.js)
   ════════════════════════════════════════════════════════════════ */
window.API = {
  // Auth
  login:  (data) => request('POST', '/api/auth/login',  data),
  logout: ()     => request('POST', '/api/auth/logout'),

  // Products
  getProducts:   ()          => request('GET',    '/api/products'),
  createProduct: (data)      => request('POST',   '/api/products',      data),
  updateProduct: (id, data)  => request('PUT',    `/api/products/${id}`, data),
  deleteProduct: (id)        => request('DELETE', `/api/products/${id}`),

  // Customers
  getCustomers:   ()         => request('GET',    '/api/customers'),
  createCustomer: (data)     => request('POST',   '/api/customers',       data),
  updateCustomer: (id, data) => request('PUT',    `/api/customers/${id}`,  data),
  deleteCustomer: (id)       => request('DELETE', `/api/customers/${id}`),

  // Suppliers
  getSuppliers:   ()         => request('GET',    '/api/suppliers'),
  createSupplier: (data)     => request('POST',   '/api/suppliers',       data),
  updateSupplier: (id, data) => request('PUT',    `/api/suppliers/${id}`,  data),
  deleteSupplier: (id)       => request('DELETE', `/api/suppliers/${id}`),

  // Sales
  completeSale: (data) => request('POST', '/api/sales', data),

  // Settings
  getSettings:    ()     => request('GET', '/api/settings'),
  updateSettings: (data) => request('PUT', '/api/settings', data),
};

/* ════════════════════════════════════════════════════════════════
   STATE SYNC — patches script.js saveState() / loadState()
   ════════════════════════════════════════════════════════════════ */
let _saveTimer = null;

window._syncSaveState = async function (state) {
  try {
    const res = await apiFetch('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state }),
      _isSave: true,
    });
    if (!res || !res.ok) {
      localStorage.setItem('cnjohnson_db_v1', JSON.stringify(state));
      console.warn('[Sync] Backend save failed, stored locally as fallback');
      window._showSyncStatus?.('Saved locally', '#f59e0b');
    } else {
      window._showSyncStatus?.('Synced ✓', '#22c55e');
    }
  } catch (err) {
    localStorage.setItem('cnjohnson_db_v1', JSON.stringify(state));
    console.warn('[Sync] Network error, stored locally:', err.message);
    window._showSyncStatus?.('Saved locally', '#f59e0b');
  }
};

window._syncLoadState = async function () {
  try {
    const res = await apiFetch('/api/state');
    if (res && res.ok) {
      const data = await res.json();
      if (data?.state) return data.state;
    }
  } catch (err) {
    console.warn('[Sync] Could not load from backend:', err.message);
  }
  try {
    const raw = localStorage.getItem('cnjohnson_db_v1');
    if (raw) return JSON.parse(raw);
  } catch { }
  return null;
};

/* ════════════════════════════════════════════════════════════════
   CLEAN DEFAULT STATE
   ════════════════════════════════════════════════════════════════ */
window._cleanDefaultState = function () {
  return {
    settings: {
      companyName: 'C.N. Johnson Ventures Limited',
      address: 'Aba, Abia State, Nigeria',
      phone: '+234 803 000 0000',
      email: 'info@cnjohnson.com',
      currency: '₦',
      taxRate: 7.5,
      lowStockThreshold: 10,
      invoicePrefix: 'INV',
      receiptPrefix: 'RCP',
      quotePrefix: 'QTE',
      debitNotePrefix: 'DN',
      creditNotePrefix: 'CN',
      nextInvoiceNo: 1001,
      nextReceiptNo: 5001,
      nextQuoteNo: 2001,
      nextDebitNoteNo: 3001,
      nextCreditNoteNo: 4001,
      enableBulkDiscount: true,
      loyaltyPointsRate: 1,
      loyaltyRedemptionRate: 100,
      repDailyTarget: 200000,
    },
    bulkDiscountTiers:   [],
    warehouses:          [],
    products:            [],
    customers:           [],
    suppliers:           [],
    salesReps:           [],
    sales:               [],
    invoices:            [],
    purchases:           [],
    expenses:            [],
    stockTransfers:      [],
    quotes:              [],
    debitNotes:          [],
    creditNotes:         [],
    loyaltyTransactions: [],
    priceHistory:        [],
    repActivityLog:      [],
  };
};

/* ════════════════════════════════════════════════════════════════
   PATCH script.js FUNCTIONS  (runs after all scripts load)
   ════════════════════════════════════════════════════════════════ */
window.addEventListener('load', () => {

  if (typeof defaultState === 'function') {
    window.defaultState = window._cleanDefaultState;
  }

  if (typeof saveState === 'function') {
    window.saveState = function () {
      try {
        localStorage.setItem('cnjohnson_db_v1', JSON.stringify(STATE));
      } catch (e) {
        console.warn('localStorage save failed', e);
      }
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => window._syncSaveState(STATE), 300);
    };
  }

  /* Sync status indicator */
  const indicator = document.createElement('div');
  indicator.id = 'sync-indicator';
  indicator.style.cssText = `
    position:fixed; bottom:1rem; right:1rem; z-index:99999;
    background:#1e293b; color:#94a3b8; font-size:.75rem;
    padding:.35rem .75rem; border-radius:20px;
    font-family:monospace; opacity:0; transition:opacity .3s;
    pointer-events:none;
  `;
  document.body.appendChild(indicator);

  window._showSyncStatus = function (msg, color = '#94a3b8') {
    indicator.textContent = msg;
    indicator.style.color = color;
    indicator.style.opacity = '1';
    clearTimeout(window._syncHideTimer);
    window._syncHideTimer = setTimeout(() => { indicator.style.opacity = '0'; }, 2500);
  };

});