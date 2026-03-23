/* ================================================================
   api_layer.js  —  C.N. Johnson Ventures
   Field names matched exactly to Prisma schema / DB columns.
   ================================================================ */
(function () {
  'use strict';

  const BASE = 'https://cn-active-backend-1.onrender.com/api';

  /* ── Token — checks every key auth-guard.js might use ────────── */
  const getToken = () =>
    localStorage.getItem('cnj_access_token') ||
    localStorage.getItem('cnjohnson_access_token') ||
    localStorage.getItem('accessToken') ||
    localStorage.getItem('token') || '';

  async function request(method, path, body = null) {
    const token = getToken();

    /* ── Token debug — visible in browser DevTools → Console ───── */
    if (!token) {
      console.error(`[API] ❌ NO TOKEN — ${method} ${path} will be rejected`);
      console.warn('[API] Keys in localStorage:', Object.keys(localStorage).join(', ') || '(empty)');
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

    // Parse response body regardless of ok/error so we can show the message
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Response wasn't JSON
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
    setToken: t => t
      ? localStorage.setItem('cnj_access_token', t)
      : localStorage.removeItem('cnj_access_token'),

    ping:     () => get('/ping'),
    fetchAll: () => get('/sync/all'),   // no auth needed — public endpoint

    /* ── Warehouses
         DB cols: name, location, description, manager             */
    getWarehouses:   ()      => get('/warehouses'),
    createWarehouse: d       => post('/warehouses', d),
    updateWarehouse: (id, d) => put(`/warehouses/${id}`, d),
    deleteWarehouse: id      => del(`/warehouses/${id}`),

    /* ── Products
         DB cols: name, sku, barcode, description, price, costPrice,
                  stock(Int), lowStockThreshold, unit, active,
                  categoryId, supplierId, warehouseId              */
    getProducts:   ()      => get('/products'),
    createProduct: d       => post('/products', d),
    updateProduct: (id, d) => patch(`/products/${id}`, d),
    deleteProduct: id      => del(`/products/${id}`),
    adjustStock:   (id, d) => patch(`/products/${id}/stock`, d),

    /* ── Customers
         DB cols: name, email, phone, address, customerType,
                  creditLimit, loyaltyPoints, balance,
                  totalPurchases, notes                            */
    getCustomers:   ()      => get('/customers'),
    createCustomer: d       => post('/customers', d),
    updateCustomer: (id, d) => put(`/customers/${id}`, d),
    deleteCustomer: id      => del(`/customers/${id}`),

    /* ── Suppliers
         DB cols: name, email, phone, address, contactPerson,
                  notes, balance                                   */
    getSuppliers:   ()      => get('/suppliers'),
    createSupplier: d       => post('/suppliers', d),
    updateSupplier: (id, d) => put(`/suppliers/${id}`, d),
    deleteSupplier: id      => del(`/suppliers/${id}`),

    /* ── Sales Reps
         DB cols: name, email, phone, warehouseId,
                  commission, totalSales, active                   */
    getSalesReps:   ()      => get('/sales-reps'),
    createSalesRep: d       => post('/sales-reps', d),
    updateSalesRep: (id, d) => put(`/sales-reps/${id}`, d),
    deleteSalesRep: id      => del(`/sales-reps/${id}`),

    /* ── Sales
         DB cols: receiptNo(required,unique), invoiceNo, customerId,
                  repId, warehouseId, subtotal, discount, tax,
                  total, paymentMethod, paymentStatus, pointsEarned,
                  pointsRedeemed, note
         SaleItem: productId, qty, price, discount, total          */
    getSales:   ()      => get('/sales'),
    createSale: d       => post('/sales', d),
    updateSale: (id, d) => patch(`/sales/${id}`, d),

    /* ── Purchases
         DB cols: purchaseNo(required,unique), supplierId(required),
                  warehouseId, total, paidAmount, note
         PurchaseItem: productId, qty, costPrice, total            */
    getPurchases:   ()  => get('/purchases'),
    createPurchase: d   => post('/purchases', d),

    /* ── Expenses
         DB cols: title(required), description, amount, category,
                  paidBy, note, date                               */
    getExpenses:   ()   => get('/expenses'),
    createExpense: d    => post('/expenses', d),
    deleteExpense: id   => del(`/expenses/${id}`),

    /* ── Quotes
         DB cols: quoteNo(required,unique), customerId, subtotal,
                  discount, tax, total, validUntil, note,
                  status(PENDING/ACCEPTED/REJECTED/EXPIRED)
         QuoteItem: productId, qty, price, discount, total         */
    getQuotes:   ()      => get('/quotes'),
    createQuote: d       => post('/quotes', d),
    updateQuote: (id, d) => patch(`/quotes/${id}`, d),

    /* ── Credit Notes
         DB cols: creditNo(required,unique), customerId, saleId,
                  amount, reason                                   */
    getCreditNotes:   ()  => get('/credit-notes'),
    createCreditNote: d   => post('/credit-notes', d),

    /* ── Bulk Discount Tiers
         DB cols: name, minQty, maxQty, discountPct, active
                  (settingsId = "global" set server-side)          */
    getDiscountTiers:   ()      => get('/discount-tiers'),
    createDiscountTier: d       => post('/discount-tiers', d),
    updateDiscountTier: (id, d) => put(`/discount-tiers/${id}`, d),
    deleteDiscountTier: id      => del(`/discount-tiers/${id}`),

    /* ── Stock Transfers
         DB cols: productId, fromWarehouseId, toWarehouseId,
                  qty, note                                        */
    createTransfer: d => post('/stock-transfers', d),

    /* ── Settings  (always id = "global")
         DB cols: companyName, address, phone, email, currency,
                  taxRate, lowStockThreshold, invoicePrefix,
                  receiptPrefix, quotePrefix, creditNotePrefix,
                  enableBulkDiscount, loyaltyPointsRate,
                  loyaltyRedemptionRate, nextInvoiceNo,
                  nextReceiptNo, nextQuoteNo, nextCreditNoteNo,
                  nextPurchaseNo                                   */
    getSettings:    ()  => get('/settings'),
    updateSettings: d   => patch('/settings', d),
  };

  console.log('[API] Ready →', BASE);
})();