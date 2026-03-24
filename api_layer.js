/* ================================================================
   api_layer.js  —  C.N. Johnson Ventures
   Field names matched exactly to Prisma schema / DB columns.
   ================================================================ */
(function () {
  'use strict';

  const BASE = 'https://cn-active-backend-1.onrender.com/api';

  /* ── Token — reads from cookies (works across all devices) ────── */
  const getToken = () => {
    const match = document.cookie.match(/(?:^|; )cnj_access_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  };

  async function request(method, path, body = null) {
    const token = getToken();

    if (!token) {
      console.warn(`[API] ⚠️ NO TOKEN — ${method} ${path}`);
    } else {
      console.log(`[API] 🔑 ${method} ${path} — token: ${token.slice(0, 30)}…`);
    }

    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    console.log(`[API] → ${method} ${BASE}${path}`, body ?? '');

    let res;
    try {
      res = await fetch(`${BASE}${path}`, opts);
    } catch (networkErr) {
      console.error('[API] Network error:', networkErr.message);
      throw new Error('Network error — check your connection');
    }

    console.log(`[API] ← ${res.status} ${method} ${path}`);

    if (res.status === 401) {
      console.error('[API] 401 Unauthorized — redirecting to login');
      window.location.replace('login.html');
      throw new Error('Session expired — please log in again');
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`[${res.status}] ${text}`);
      return text;
    }

    if (!res.ok) {
      const msg = json?.message || json?.error || json?.msg || `Server error [${res.status}]`;
      console.error(`[API] ❌ ${res.status} ${method} ${path}:`, json);
      throw new Error(msg);
    }

    console.log(`[API] ✅ ${method} ${path}:`, json);
    return json;
  }

  const get   = p      => request('GET',    p);
  const post  = (p, b) => request('POST',   p, b);
  const put   = (p, b) => request('PUT',    p, b);
  const patch = (p, b) => request('PATCH',  p, b);
  const del   = p      => request('DELETE', p);

  window.API = {
    /* setToken kept for compatibility — now writes to cookie */
    setToken: t => {
      if (t) {
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `cnj_access_token=${encodeURIComponent(t)}; max-age=3600; path=/; SameSite=Lax${secure}`;
      } else {
        document.cookie = 'cnj_access_token=; max-age=0; path=/; SameSite=Lax';
      }
    },

    ping:     () => get('/ping'),
    fetchAll: () => get('/sync/all'),

    /* ── Warehouses ──────────────────────────────────────────────── */
    getWarehouses:   ()      => get('/warehouses'),
    createWarehouse: d       => post('/warehouses', d),
    updateWarehouse: (id, d) => put(`/warehouses/${id}`, d),
    deleteWarehouse: id      => del(`/warehouses/${id}`),

    /* ── Products ───────────────────────────────────────────────── */
    getProducts:   ()      => get('/products'),
    createProduct: d       => post('/products', d),
    updateProduct: (id, d) => patch(`/products/${id}`, d),
    deleteProduct: id      => del(`/products/${id}`),
    adjustStock:   (id, d) => patch(`/products/${id}/stock`, d),

    /* ── Customers ──────────────────────────────────────────────── */
    getCustomers:   ()      => get('/customers'),
    createCustomer: d       => post('/customers', d),
    updateCustomer: (id, d) => put(`/customers/${id}`, d),
    deleteCustomer: id      => del(`/customers/${id}`),

    /* ── Suppliers ──────────────────────────────────────────────── */
    getSuppliers:   ()      => get('/suppliers'),
    createSupplier: d       => post('/suppliers', d),
    updateSupplier: (id, d) => put(`/suppliers/${id}`, d),
    deleteSupplier: id      => del(`/suppliers/${id}`),

    /* ── Sales Reps ─────────────────────────────────────────────── */
    getSalesReps:   ()      => get('/sales-reps'),
    createSalesRep: d       => post('/sales-reps', d),
    updateSalesRep: (id, d) => put(`/sales-reps/${id}`, d),
    deleteSalesRep: id      => del(`/sales-reps/${id}`),

    /* ── Sales ──────────────────────────────────────────────────── */
    getSales:   ()      => get('/sales'),
    createSale: d       => post('/sales', d),
    updateSale: (id, d) => patch(`/sales/${id}`, d),

    /* ── Purchases ──────────────────────────────────────────────── */
    getPurchases:   ()  => get('/purchases'),
    createPurchase: d   => post('/purchases', d),

    /* ── Expenses ───────────────────────────────────────────────── */
    getExpenses:   ()   => get('/expenses'),
    createExpense: d    => post('/expenses', d),
    deleteExpense: id   => del(`/expenses/${id}`),

    /* ── Quotes ─────────────────────────────────────────────────── */
    getQuotes:   ()      => get('/quotes'),
    createQuote: d       => post('/quotes', d),
    updateQuote: (id, d) => patch(`/quotes/${id}`, d),

    /* ── Credit Notes ───────────────────────────────────────────── */
    getCreditNotes:   ()  => get('/credit-notes'),
    createCreditNote: d   => post('/credit-notes', d),

    /* ── Bulk Discount Tiers ────────────────────────────────────── */
    getDiscountTiers:   ()      => get('/discount-tiers'),
    createDiscountTier: d       => post('/discount-tiers', d),
    updateDiscountTier: (id, d) => put(`/discount-tiers/${id}`, d),
    deleteDiscountTier: id      => del(`/discount-tiers/${id}`),

    /* ── Stock Transfers ────────────────────────────────────────── */
    createTransfer: d => post('/stock-transfers', d),

    /* ── Settings ───────────────────────────────────────────────── */
    getSettings:    ()  => get('/settings'),
    updateSettings: d   => patch('/settings', d),
  };

  console.log('[API] Ready →', BASE);
})();