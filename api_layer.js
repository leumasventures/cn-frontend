/* ================================================================
   api_layer.js  —  C.N. Johnson Ventures
   All window.API.* methods used by script_db_patch.js.
   
   SETUP:
   1. Set API_BASE_URL below to your backend URL.
   2. Load this BEFORE script_db_patch.js in your HTML:
        <script src="api_layer.js"></script>
        <script src="offline_queue.js"></script>
        <script src="sync.js"></script>
        <script src="script.js"></script>
        <script src="script_db_patch.js"></script>
   ================================================================ */

(function () {
  'use strict';

  /* ── CONFIGURE THIS ─────────────────────────────────────────── */
  const API_BASE_URL = window.API_BASE_URL || 'http://localhost:3000/api';
  const REQUEST_TIMEOUT_MS = 10000;                    // 10 s before we treat as offline
  /* ─────────────────────────────────────────────────────────────── */

  /* ── Auth token — read from login.js storage key on load ────── */
  let _authToken = localStorage.getItem('cnj_access_token') || '';

  /* ── Auto-refresh token before it expires ────────────────────
     login.js stores expiry as 'cnjohnson_token_expiry' (epoch ms).
     We refresh 60 s before expiry so API calls never hit 401.      */
  async function maybeRefreshToken() {
    const expiry     = parseInt(localStorage.getItem('cnjohnson_token_expiry') || '0');
    const refreshTok = localStorage.getItem('cnj_refresh_token');
    if (!refreshTok || !expiry) return;

    const msUntilExpiry = expiry - Date.now();
    if (msUntilExpiry > 60_000) return;   // still fresh — nothing to do

    try {
      const res  = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken: refreshTok }),
      });
      const data = await res.json();
      if (data.accessToken) {
        _authToken = data.accessToken;
        localStorage.setItem('cnj_access_token', _authToken);
        if (data.refreshToken)
          localStorage.setItem('cnj_refresh_token', data.refreshToken);
        localStorage.setItem('cnjohnson_token_expiry', Date.now() + 15 * 60 * 1000);
        console.log('[API] Token refreshed ✅');
      }
    } catch (err) {
      console.warn('[API] Token refresh failed:', err.message);
    }
  }

  /* Check on load and every 30 s */
  maybeRefreshToken();
  setInterval(maybeRefreshToken, 30_000);

  /* ── Redirect to login on 401 ─────────────────────────────── */
  function handleUnauthorized() {
    localStorage.removeItem('cnj_access_token');
    localStorage.removeItem('cnj_refresh_token');
    localStorage.removeItem('cnjohnson_token_expiry');
    window.location.href = 'login.html';
  }

  /* ── Core fetch wrapper ──────────────────────────────────────── */
  async function request(method, path, body = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers = { 'Content-Type': 'application/json' };
    if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;

    const opts = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, opts);
      clearTimeout(timer);

      if (!res.ok) {
        if (res.status === 401) {
          handleUnauthorized();
          throw new Error('Session expired — redirecting to login');
        }
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`[${res.status}] ${errText}`);
      }

      // 204 No Content
      if (res.status === 204) return { ok: true, data: null };

      const json = await res.json();
      return { ok: true, data: json };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error('Request timed out — server may be offline');
      }
      throw err;
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  const get    = (path)         => request('GET',    path);
  const post   = (path, body)   => request('POST',   path, body);
  const put    = (path, body)   => request('PUT',    path, body);
  const patch  = (path, body)   => request('PATCH',  path, body);
  const del    = (path)         => request('DELETE', path);

  /* ================================================================
     PUBLIC API
     Every method returns a Promise that resolves to { ok, data }
     or rejects with an Error (caller handles offline fallback).
  ================================================================ */
  window.API = {

    /* Token management */
    setToken(token) {
      _authToken = token || '';
      if (_authToken) localStorage.setItem('cnj_access_token', _authToken);
      else localStorage.removeItem('cnj_access_token');
    },

    ping: () => get('/ping'),

    /* ── SYNC (pull all) ──────────────────────────────────────── */
    fetchAll: () => get('/sync/all'),

    /* ── WAREHOUSES ─────────────────────────────────────────────
       GET    /warehouses
       POST   /warehouses          body: { name, location, manager }
       PUT    /warehouses/:id      body: { name, location, manager }
       DELETE /warehouses/:id
    ────────────────────────────────────────────────────────────── */
    getWarehouses:    ()        => get('/warehouses'),
    createWarehouse:  (data)    => post('/warehouses', data),
    updateWarehouse:  (id, data)=> put(`/warehouses/${id}`, data),
    deleteWarehouse:  (id)      => del(`/warehouses/${id}`),

    /* ── PRODUCTS ───────────────────────────────────────────────
       GET    /products
       POST   /products
       PUT    /products/:id
       DELETE /products/:id
       PATCH  /products/:id/stock   body: { warehouseId, type, quantity, reason }
    ────────────────────────────────────────────────────────────── */
    getProducts:    ()        => get('/products'),
    createProduct:  (data)    => post('/products', data),
    updateProduct:  (id, data)=> put(`/products/${id}`, data),
    deleteProduct:  (id)      => del(`/products/${id}`),
    adjustStock:    (id, data)=> patch(`/products/${id}/stock`, data),

    /* ── CUSTOMERS ──────────────────────────────────────────────
       GET    /customers
       POST   /customers
       PUT    /customers/:id
       DELETE /customers/:id
    ────────────────────────────────────────────────────────────── */
    getCustomers:   ()        => get('/customers'),
    createCustomer: (data)    => post('/customers', data),
    updateCustomer: (id, data)=> put(`/customers/${id}`, data),
    deleteCustomer: (id)      => del(`/customers/${id}`),

    /* ── SUPPLIERS ──────────────────────────────────────────────
       GET    /suppliers
       POST   /suppliers
       PUT    /suppliers/:id
       DELETE /suppliers/:id
    ────────────────────────────────────────────────────────────── */
    getSuppliers:   ()        => get('/suppliers'),
    createSupplier: (data)    => post('/suppliers', data),
    updateSupplier: (id, data)=> put(`/suppliers/${id}`, data),
    deleteSupplier: (id)      => del(`/suppliers/${id}`),

    /* ── SALES REPS ─────────────────────────────────────────────
       GET    /sales-reps
       POST   /sales-reps
       PUT    /sales-reps/:id
       DELETE /sales-reps/:id
    ────────────────────────────────────────────────────────────── */
    getSalesReps:   ()        => get('/sales-reps'),
    createSalesRep: (data)    => post('/sales-reps', data),
    updateSalesRep: (id, data)=> put(`/sales-reps/${id}`, data),
    deleteSalesRep: (id)      => del(`/sales-reps/${id}`),

    /* ── SALES / RECEIPTS / INVOICES ────────────────────────────
       GET    /sales
       POST   /sales               (POS checkout)
       PATCH  /sales/:id           (e.g. mark paid)
    ────────────────────────────────────────────────────────────── */
    getSales:       ()        => get('/sales'),
    createSale:     (data)    => post('/sales', data),
    updateSale:     (id, data)=> patch(`/sales/${id}`, data),

    /* ── PURCHASES ──────────────────────────────────────────────
       GET    /purchases
       POST   /purchases
    ────────────────────────────────────────────────────────────── */
    getPurchases:   ()        => get('/purchases'),
    createPurchase: (data)    => post('/purchases', data),

    /* ── EXPENSES ───────────────────────────────────────────────
       GET    /expenses
       POST   /expenses
       DELETE /expenses/:id
    ────────────────────────────────────────────────────────────── */
    getExpenses:    ()        => get('/expenses'),
    createExpense:  (data)    => post('/expenses', data),
    deleteExpense:  (id)      => del(`/expenses/${id}`),

    /* ── QUOTES ─────────────────────────────────────────────────
       GET    /quotes
       POST   /quotes
       PATCH  /quotes/:id          (status update / convert)
    ────────────────────────────────────────────────────────────── */
    getQuotes:      ()        => get('/quotes'),
    createQuote:    (data)    => post('/quotes', data),
    updateQuote:    (id, data)=> patch(`/quotes/${id}`, data),

    /* ── CREDIT NOTES ───────────────────────────────────────────
       GET    /credit-notes
       POST   /credit-notes
    ────────────────────────────────────────────────────────────── */
    getCreditNotes:   ()        => get('/credit-notes'),
    createCreditNote: (data)    => post('/credit-notes', data),

    /* ── BULK DISCOUNT TIERS ────────────────────────────────────
       GET    /discount-tiers
       POST   /discount-tiers
       PUT    /discount-tiers/:id
       DELETE /discount-tiers/:id
    ────────────────────────────────────────────────────────────── */
    getDiscountTiers:    ()        => get('/discount-tiers'),
    createDiscountTier:  (data)    => post('/discount-tiers', data),
    updateDiscountTier:  (id, data)=> put(`/discount-tiers/${id}`, data),
    deleteDiscountTier:  (id)      => del(`/discount-tiers/${id}`),

    /* ── STOCK TRANSFERS ────────────────────────────────────────
       POST   /stock-transfers
    ────────────────────────────────────────────────────────────── */
    createTransfer: (data) => post('/stock-transfers', data),

    /* ── SETTINGS ───────────────────────────────────────────────
       GET    /settings
       PUT    /settings
    ────────────────────────────────────────────────────────────── */
    getSettings:    ()     => get('/settings'),
    updateSettings: (data) => put('/settings', data),
  };

  console.log('[API] Layer ready →', API_BASE_URL);
})();