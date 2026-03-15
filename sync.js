/* ================================================================
   C.N. Johnson Ventures — Unified Sync Layer  (sync.js)
   ================================================================
   ARCHITECTURE:
   - DB is the single source of truth for all shared data
   - On load: fetch everything fresh from DB → update STATE → render
   - Every write: push to DB immediately
   - If DB unreachable: save to localStorage (offline queue)
   - When back online: flush offline queue to DB automatically
   - localStorage is ONLY a fallback, never the primary source
   ================================================================ */

'use strict';

const OFFLINE_QUEUE_KEY = 'cnj_offline_queue';
const LOCAL_STATE_KEY   = 'cnjohnson_db_v1';

/* ════════════════════════════════════════════════════════════════
   OFFLINE QUEUE  — stores failed writes for later retry
   ════════════════════════════════════════════════════════════════ */
const OfflineQueue = {
  get() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
    catch { return []; }
  },
  add(item) {
    const q = this.get();
    q.push({ ...item, queuedAt: new Date().toISOString() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    console.log(`[Sync] Queued offline: ${item.type}`);
  },
  clear() { localStorage.removeItem(OFFLINE_QUEUE_KEY); },
  set(q)  { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); },
};

/* ════════════════════════════════════════════════════════════════
   MAIN SYNC OBJECT
   ════════════════════════════════════════════════════════════════ */
window.SYNC = {

  _online: navigator.onLine,
  _pulling: false,

  get online() { return this._online; },
  set online(v) {
    const wasOffline = !this._online;
    this._online = v;
    if (v && wasOffline) {
      console.log('[Sync] Back online — flushing queue...');
      this.flushOfflineQueue();
    }
  },

  /* ── Check reachability ── */
  async ping() {
    try {
      const base = window.API_BASE || 'https://cn-active-backend-1.onrender.com';
      const res = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(4000),
      });
      return res.ok;
    } catch { return false; }
  },

  /* ════════════════════════════════════════════════════════════
     PULL ALL  — load everything from DB into STATE
     Called on: page load, coming back online, manual refresh
     ════════════════════════════════════════════════════════════ */
  async pullAll() {
    if (this._pulling) return;
    this._pulling = true;
    this.showBanner('🔄 Loading data…', 'info');

    try {
      const token = localStorage.getItem('cnj_access_token')
                 || localStorage.getItem('cnjohnson_access_token');
      if (!token) { this._pulling = false; return; }

      // Fetch all data in parallel
      const [
        productsRes, customersRes, suppliersRes, warehousesRes,
        settingsRes, salesRes, expensesRes, purchasesRes,
        quotesRes, creditNotesRes, stockTransfersRes,
      ] = await Promise.allSettled([
        window.API.getProducts(),
        window.API.getCustomers(),
        window.API.getSuppliers(),
        window.API.getWarehouses(),
        window.API.getSettings(),
        window.API.getSales({ limit: 500 }),
        window.API.getExpenses(),
        window.API.getPurchases(),
        window.API.getQuotes(),
        window.API.getCreditNotes(),
        window.API.getStockTransfers(),
      ]);

      let anyFailed = false;

      /* ── Products ── */
      if (productsRes.status === 'fulfilled' && productsRes.value?.products) {
        STATE.products = productsRes.value.products.map(p => ({
          id:           p.id,
          name:         p.name,
          sku:          p.sku || '',
          barcode:      p.barcode || '',
          category:     p.category?.name || p.categoryId || 'General',
          categoryId:   p.categoryId || '',
          unit:         p.unit || 'Unit',
          costPrice:    p.costPrice || 0,
          sellingPrice: p.price || 0,
          price:        p.price || 0,
          stock:        { wh1: p.stock || 0 },
          reorderLevel: p.lowStockThreshold || STATE.settings?.lowStockThreshold || 10,
          supplierId:   p.supplierId || '',
          warehouseId:  p.warehouseId || '',
          description:  p.description || '',
          active:       p.active !== false,
          _apiId:       p.id,
        }));
      } else anyFailed = true;

      /* ── Customers ── */
      if (customersRes.status === 'fulfilled' && customersRes.value?.customers) {
        STATE.customers = customersRes.value.customers.map(c => ({
          id:             c.id,
          name:           c.name,
          phone:          c.phone || '',
          email:          c.email || '',
          address:        c.address || '',
          creditLimit:    c.creditLimit || 500000,
          balance:        c.balance || 0,
          totalPurchases: 0,
          loyaltyPoints:  c.loyaltyPoints || 0,
          customerType:   'retail',
          notes:          '',
          _apiId:         c.id,
        }));
      } else anyFailed = true;

      /* ── Suppliers ── */
      if (suppliersRes.status === 'fulfilled' && suppliersRes.value?.suppliers) {
        STATE.suppliers = suppliersRes.value.suppliers.map(s => ({
          id:       s.id,
          name:     s.name,
          contact:  s.contactPerson || s.phone || '',
          phone:    s.phone || '',
          email:    s.email || '',
          address:  s.address || '',
          notes:    s.notes || '',
          balance:  s.balance || 0,
          _apiId:   s.id,
        }));
      } else anyFailed = true;

      /* ── Warehouses ── */
      if (warehousesRes.status === 'fulfilled' && warehousesRes.value?.warehouses) {
        STATE.warehouses = warehousesRes.value.warehouses.map(w => ({
          id:          w.id,
          name:        w.name,
          location:    w.location || '',
          description: w.description || '',
          _apiId:      w.id,
        }));
      }

      /* ── Settings ── */
      if (settingsRes.status === 'fulfilled' && settingsRes.value?.settings) {
        const s = settingsRes.value.settings;
        Object.assign(STATE.settings, {
          companyName:           s.companyName  || STATE.settings.companyName,
          address:               s.address      || STATE.settings.address,
          phone:                 s.phone        || STATE.settings.phone,
          email:                 s.email        || STATE.settings.email,
          currency:              s.currency === 'USD' ? '₦' : (s.currency || '₦'),
          taxRate:               s.taxRate      ?? STATE.settings.taxRate,
          lowStockThreshold:     s.lowStockThreshold ?? STATE.settings.lowStockThreshold,
          invoicePrefix:         s.invoicePrefix    || STATE.settings.invoicePrefix,
          receiptPrefix:         s.receiptPrefix    || STATE.settings.receiptPrefix,
          quotePrefix:           s.quotePrefix      || STATE.settings.quotePrefix,
          enableBulkDiscount:    s.enableBulkDiscount ?? STATE.settings.enableBulkDiscount,
          loyaltyPointsRate:     s.loyaltyPointsRate   ?? STATE.settings.loyaltyPointsRate,
          loyaltyRedemptionRate: s.loyaltyRedemptionRate ?? STATE.settings.loyaltyRedemptionRate,
          nextInvoiceNo:         s.nextInvoiceNo  || STATE.settings.nextInvoiceNo,
          nextReceiptNo:         s.nextReceiptNo  || STATE.settings.nextReceiptNo,
          nextQuoteNo:           s.nextQuoteNo    || STATE.settings.nextQuoteNo,
          nextCreditNoteNo:      s.nextCreditNoteNo || STATE.settings.nextCreditNoteNo,
          nextPurchaseNo:        s.nextPurchaseNo || STATE.settings.nextPurchaseNo,
        });
        if (s.bulkDiscountTiers?.length) {
          STATE.bulkDiscountTiers = s.bulkDiscountTiers;
        }
      }

      /* ── Sales ── */
      if (salesRes.status === 'fulfilled' && salesRes.value?.sales) {
        STATE.sales = salesRes.value.sales.map(s => ({
          id:            s.id,
          receiptNo:     s.receiptNo,
          invoiceNo:     s.receiptNo,
          customerId:    s.customerId || '',
          customerName:  s.customer?.name || 'Walk-in',
          repId:         s.salesRepId || '',
          repName:       s.salesRepName || '',
          items:         (s.items || []).map(i => ({
            productId:            i.productId,
            productName:          i.product?.name || '',
            qty:                  i.qty,
            unitPrice:            i.price,
            effectiveDiscountPct: i.discount || 0,
            lineDiscount:         i.discount ? +((i.qty * i.price * i.discount) / 100).toFixed(2) : 0,
            total:                i.total,
          })),
          subtotal:      s.subtotal,
          taxAmt:        s.tax,
          total:         s.total,
          extraDiscAmt:  s.discount || 0,
          extraDiscPct:  0,
          paymentMethod: (s.paymentMethod || 'CASH').toLowerCase(),
          paymentStatus: s.paymentMethod === 'CREDIT' ? 'unpaid' : 'paid',
          redeemPts:     s.pointsRedeemed || 0,
          notes:         s.note || '',
          date:          s.createdAt,
          _apiId:        s.id,
        }));
      } else anyFailed = true;

      /* ── Expenses ── */
      if (expensesRes.status === 'fulfilled' && expensesRes.value?.expenses) {
        STATE.expenses = expensesRes.value.expenses.map(e => ({
          id:          e.id,
          title:       e.description || e.title || '',
          description: e.description || '',
          amount:      e.amount || 0,
          category:    e.category || '',
          note:        e.notes || e.note || '',
          date:        e.date || e.createdAt,
          _apiId:      e.id,
        }));
      }

      /* ── Purchases ── */
      if (purchasesRes.status === 'fulfilled' && purchasesRes.value?.purchases) {
        STATE.purchases = purchasesRes.value.purchases.map(p => ({
          id:           p.id,
          purchaseNo:   p.purchaseNo,
          supplierId:   p.supplierId || '',
          supplierName: p.supplier?.name || '',
          items:        (p.items || []).map(i => ({
            productId:   i.productId,
            productName: i.product?.name || '',
            qty:         i.qty,
            costPrice:   i.costPrice,
            total:       i.total,
          })),
          total:      p.total,
          paidAmount: p.paidAmount || 0,
          note:       p.notes || p.note || '',
          date:       p.createdAt,
          _apiId:     p.id,
        }));
      }

      /* ── Quotes ── */
      if (quotesRes.status === 'fulfilled' && quotesRes.value?.quotes) {
        STATE.quotes = quotesRes.value.quotes.map(q => ({
          id:           q.id,
          quoteNo:      q.quoteNo,
          customerId:   q.customerId || '',
          customerName: q.customer?.name || '',
          items:        (q.items || []).map(i => ({
            productId:   i.productId,
            productName: i.product?.name || '',
            qty:         i.qty,
            unitPrice:   i.unitPrice || i.price || 0,
            discountPct: i.discountPct || 0,
            total:       i.total,
          })),
          subtotal:   q.subtotal,
          total:      q.total,
          status:     q.status || 'PENDING',
          validUntil: q.validUntil,
          note:       q.notes || q.note || '',
          date:       q.createdAt,
          _apiId:     q.id,
        }));
      }

      /* ── Credit Notes ── */
      if (creditNotesRes.status === 'fulfilled' && creditNotesRes.value?.creditNotes) {
        STATE.creditNotes = creditNotesRes.value.creditNotes.map(cn => ({
          id:           cn.id,
          creditNo:     cn.creditNo,
          customerId:   cn.customerId || '',
          customerName: cn.customer?.name || '',
          saleId:       cn.saleId || '',
          amount:       cn.amount,
          reason:       cn.reason || '',
          date:         cn.createdAt,
          _apiId:       cn.id,
        }));
      }

      /* ── Stock Transfers ── */
      if (stockTransfersRes.status === 'fulfilled' && stockTransfersRes.value?.transfers) {
        STATE.stockTransfers = stockTransfersRes.value.transfers.map(t => ({
          id:              t.id,
          productId:       t.productId,
          productName:     t.product?.name || '',
          fromWarehouseId: t.fromWarehouseId,
          fromName:        t.fromWarehouse?.name || '',
          toWarehouseId:   t.toWarehouseId,
          toName:          t.toWarehouse?.name || '',
          qty:             t.qty,
          note:            t.note || '',
          date:            t.createdAt,
          _apiId:          t.id,
        }));
      }

      /* ── Save to localStorage as offline fallback ── */
      this._saveLocalFallback();

      const status = anyFailed ? '⚠ Partial sync — some data may be outdated' : '✅ All data loaded';
      this.showBanner(status, anyFailed ? 'warn' : 'success');
      console.log('[Sync] pullAll complete');

      /* Re-render current section */
      setTimeout(() => {
        const hash = window.location.hash.replace('#', '') || 'dashboard';
        if (typeof window.showSection === 'function') window.showSection(hash);
      }, 100);

    } catch (err) {
      console.warn('[Sync] pullAll failed:', err.message);
      this._loadLocalFallback();
      this.showBanner('⚠ Offline — showing local data', 'warn');
    } finally {
      this._pulling = false;
    }
  },

  /* ════════════════════════════════════════════════════════════
     PUSH HELPERS — each write type
     ════════════════════════════════════════════════════════════ */
  async pushSale(sale) {
    const payload = {
      customerId:     sale.customerId || null,
      items:          sale.items.map(i => ({
        productId: i.productId,
        qty:       i.qty,
        price:     i.unitPrice,
        discount:  i.effectiveDiscountPct || 0,
        total:     +((i.qty * i.unitPrice) * (1 - (i.effectiveDiscountPct || 0) / 100)).toFixed(2),
      })),
      paymentMethod:  (sale.paymentMethod || 'cash').toUpperCase(),
      subtotal:       +((sale.subtotal || 0)).toFixed(2),
      discount:       +((sale.extraDiscAmt || 0)).toFixed(2),
      tax:            +((sale.taxAmt || 0)).toFixed(2),
      total:          +((sale.total || 0)).toFixed(2),
      pointsRedeemed: sale.redeemPts || 0,
      note:           sale.notes || '',
      salesRepId:     sale.repId   || null,
      salesRepName:   sale.repName || null,
      origin:         sale.origin  || null,
    };
    await this._push('sale', () => window.API.completeSale(payload), payload, sale.id);
  },

  async pushProduct(product, isUpdate = false) {
    const payload = {
      name:              product.name,
      sku:               product.sku || undefined,
      barcode:           product.barcode || undefined,
      price:             product.sellingPrice || product.price,
      costPrice:         product.costPrice,
      stock:             Object.values(product.stock || {}).reduce((a, b) => a + b, 0),
      lowStockThreshold: product.reorderLevel,
      unit:              product.unit,
      description:       product.description,
      categoryId:        product.categoryId || undefined,
      supplierId:        product.supplierId || undefined,
      warehouseId:       product.warehouseId || undefined,
    };
    if (isUpdate && product._apiId && !product._apiId.startsWith('P')) {
      await this._push('product_update', () => window.API.updateProduct(product._apiId, payload), payload, product._apiId);
    } else {
      const res = await this._push('product_create', () => window.API.createProduct(payload), payload, product.id);
      if (res?.product?.id) { product._apiId = res.product.id; this._saveLocalFallback(); }
    }
  },

  async pushCustomer(customer, isUpdate = false) {
    const payload = {
      name:          customer.name,
      email:         customer.email   || undefined,
      phone:         customer.phone   || undefined,
      address:       customer.address || undefined,
      loyaltyPoints: customer.loyaltyPoints || 0,
    };
    if (isUpdate && customer._apiId && !customer._apiId.startsWith('C')) {
      await this._push('customer_update', () => window.API.updateCustomer(customer._apiId, payload), payload, customer._apiId);
    } else {
      const res = await this._push('customer_create', () => window.API.createCustomer(payload), payload, customer.id);
      if (res?.customer?.id) { customer._apiId = res.customer.id; this._saveLocalFallback(); }
    }
  },

  async pushSupplier(supplier, isUpdate = false) {
    const payload = {
      name:          supplier.name,
      email:         supplier.email   || undefined,
      phone:         supplier.phone   || undefined,
      address:       supplier.address || undefined,
      contactPerson: supplier.contact || undefined,
      notes:         supplier.notes   || undefined,
    };
    if (isUpdate && supplier._apiId && !supplier._apiId.startsWith('S')) {
      await this._push('supplier_update', () => window.API.updateSupplier(supplier._apiId, payload), payload, supplier._apiId);
    } else {
      const res = await this._push('supplier_create', () => window.API.createSupplier(payload), payload, supplier.id);
      if (res?.supplier?.id) { supplier._apiId = res.supplier.id; this._saveLocalFallback(); }
    }
  },

  async pushSettings() {
    const s = STATE.settings;
    const payload = {
      companyName:           s.companyName,
      address:               s.address,
      phone:                 s.phone,
      email:                 s.email,
      taxRate:               s.taxRate,
      lowStockThreshold:     s.lowStockThreshold,
      invoicePrefix:         s.invoicePrefix,
      receiptPrefix:         s.receiptPrefix,
      quotePrefix:           s.quotePrefix,
      enableBulkDiscount:    s.enableBulkDiscount,
      loyaltyPointsRate:     s.loyaltyPointsRate,
      loyaltyRedemptionRate: s.loyaltyRedemptionRate,
    };
    await this._push('settings', () => window.API.updateSettings(payload), payload, 'global');
  },

  async pushExpense(expense) {
    const payload = {
      description: expense.title || expense.description,
      amount:      expense.amount,
      category:    expense.category || undefined,
      note:        expense.note     || undefined,
      date:        expense.date     || undefined,
    };
    const res = await this._push('expense', () => window.API.createExpense(payload), payload, expense.id);
    if (res?.expense?.id) { expense._apiId = res.expense.id; this._saveLocalFallback(); }
  },

  /* ════════════════════════════════════════════════════════════
     GENERIC PUSH — tries DB, falls back to offline queue
     ════════════════════════════════════════════════════════════ */
  async _push(type, apiCall, payload, localId) {
    if (!window.API) return null;
    try {
      const res = await apiCall();
      console.log(`[Sync] ✅ ${type}:`, localId);
      return res;
    } catch (err) {
      console.warn(`[Sync] ⚠ ${type} failed — queued for retry:`, err.message);
      OfflineQueue.add({ type, payload, localId });
      this._saveLocalFallback();
      return null;
    }
  },

  /* ════════════════════════════════════════════════════════════
     FLUSH OFFLINE QUEUE  — retry all queued writes
     ════════════════════════════════════════════════════════════ */
  async flushOfflineQueue() {
    const queue = OfflineQueue.get();
    if (!queue.length) return;

    console.log(`[Sync] Flushing ${queue.length} queued items...`);
    this.showBanner(`🔄 Syncing ${queue.length} offline change(s)…`, 'info');

    const remaining = [];
    for (const item of queue) {
      try {
        await this._dispatchQueueItem(item);
        console.log(`[Sync] ✅ Flushed: ${item.type}`);
      } catch (err) {
        console.warn(`[Sync] ⚠ Still failed: ${item.type}`, err.message);
        remaining.push(item);
      }
    }

    if (remaining.length) {
      OfflineQueue.set(remaining);
      this.showBanner(`⚠ ${remaining.length} item(s) still pending`, 'warn');
    } else {
      OfflineQueue.clear();
      this.showBanner('✅ All offline changes synced!', 'success');
      await this.pullAll(); // re-pull to get clean server state
    }
  },

  async _dispatchQueueItem(item) {
    switch (item.type) {
      case 'sale':             return window.API.completeSale(item.payload);
      case 'product_create':   return window.API.createProduct(item.payload);
      case 'product_update':   return window.API.updateProduct(item.localId, item.payload);
      case 'customer_create':  return window.API.createCustomer(item.payload);
      case 'customer_update':  return window.API.updateCustomer(item.localId, item.payload);
      case 'supplier_create':  return window.API.createSupplier(item.payload);
      case 'supplier_update':  return window.API.updateSupplier(item.localId, item.payload);
      case 'settings':         return window.API.updateSettings(item.payload);
      case 'expense':          return window.API.createExpense(item.payload);
      default: console.warn('[Sync] Unknown queue item type:', item.type);
    }
  },

  /* ════════════════════════════════════════════════════════════
     LOCAL FALLBACK HELPERS
     ════════════════════════════════════════════════════════════ */
  _saveLocalFallback() {
    try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(STATE)); }
    catch (e) { console.warn('[Sync] localStorage save failed:', e.message); }
  },

  _loadLocalFallback() {
    try {
      const raw = localStorage.getItem(LOCAL_STATE_KEY);
      if (raw) { Object.assign(STATE, JSON.parse(raw)); console.log('[Sync] Loaded from localStorage fallback'); }
    } catch (e) { console.warn('[Sync] localStorage load failed:', e.message); }
  },

  /* ── Status banner ── */
  showBanner(msg, type = 'info') {
    const colors = { info: '#2563eb', success: '#16a34a', warn: '#d97706', error: '#dc2626' };
    let b = document.getElementById('sync-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'sync-banner';
      b.style.cssText = `position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);
        z-index:99998;padding:.6rem 1.5rem;border-radius:20px;font-size:.82rem;
        font-weight:600;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.2);
        transition:opacity .4s;pointer-events:none;`;
      document.body.append(b);
    }
    b.style.background = colors[type] || colors.info;
    b.style.opacity = '1';
    b.textContent = msg;
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.style.opacity = '0'; }, 3500);
  },
};

/* ════════════════════════════════════════════════════════════════
   PATCH script.js WRITE FUNCTIONS
   Intercept every user action and push to DB
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {

    /* saveState — only write to localStorage (DB writes happen per-action) */
    if (typeof window.saveState === 'function') {
      window.saveState = function () { SYNC._saveLocalFallback(); };
    }

    /* completeSale */
    const _origSale = window.completeSale;
    if (_origSale) {
      window.completeSale = async function () {
        const prevLen = STATE.sales.length;
        _origSale();
        if (STATE.sales.length > prevLen) {
          await SYNC.pushSale(STATE.sales[STATE.sales.length - 1]);
        }
      };
    }

    /* Add Product */
    _patchModal('openAddProduct', () => STATE.products,
      item => SYNC.pushProduct(item, false));

    /* Add Customer */
    _patchModal('openAddCustomer', () => STATE.customers,
      item => SYNC.pushCustomer(item, false));

    /* Add Supplier */
    _patchModal('openAddSupplier', () => STATE.suppliers,
      item => SYNC.pushSupplier(item, false));

    /* saveSettings */
    const _origSettings = window.saveSettings;
    if (_origSettings) {
      window.saveSettings = async function () {
        _origSettings();
        await SYNC.pushSettings();
      };
    }

    console.log('[Sync] ✅ All patches applied');
  }, 150);
});

function _patchModal(fnName, getList, onNew) {
  const orig = window[fnName];
  if (!orig) return;
  window[fnName] = function (...args) {
    orig(...args);
    const obs = new MutationObserver(() => {
      const btn = document.getElementById('modal-save');
      if (btn && !btn._syncPatched) {
        btn._syncPatched = true;
        const origClick = btn.onclick;
        btn.onclick = async function (e) {
          const prev = getList().length;
          origClick?.(e);
          if (getList().length > prev) await onNew(getList()[getList().length - 1]);
        };
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  };
}

/* ════════════════════════════════════════════════════════════════
   INIT — Pull from DB on every page load
   ════════════════════════════════════════════════════════════════ */
window.addEventListener('load', () => {
  const token = localStorage.getItem('cnj_access_token')
             || localStorage.getItem('cnjohnson_access_token');
  if (!token) return;

  _waitForState(async () => {
    const isUp = await SYNC.ping();
    if (!isUp) {
      SYNC._loadLocalFallback();
      SYNC.showBanner('📴 Offline — showing local data. Changes will sync when reconnected.', 'warn');
      return;
    }
    await SYNC.pullAll();
    await SYNC.flushOfflineQueue();
  });
});

/* Online / offline detection */
window.addEventListener('online',  () => { SYNC.online = true;  SYNC.showBanner('🌐 Back online — syncing…', 'success'); });
window.addEventListener('offline', () => { SYNC.online = false; SYNC.showBanner('📴 Offline — changes will sync when reconnected', 'warn'); });

function _waitForState(cb, tries = 0) {
  if (typeof STATE !== 'undefined' && typeof saveState === 'function') { cb(); }
  else if (tries < 50) { setTimeout(() => _waitForState(cb, tries + 1), 100); }
  else { console.warn('[Sync] STATE never became available'); }
}