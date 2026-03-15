/* ================================================================
   sync.js  —  C.N. Johnson Ventures
   
   window.SYNC — pulls all collections from the MySQL backend
   and merges them into STATE on page load.
   
   Also provides:
   • SYNC.pushSettings()  — writes STATE.settings to DB
   • SYNC.ping()          — checks if backend is reachable
   
   Load AFTER api_layer.js and offline_queue.js,
   BEFORE script.js (so STATE exists when sync runs).
================================================================ */

(function () {
  'use strict';

  /* ── Status indicator in the page header ─────────────────── */
  function setStatus(state) {
    // state: 'syncing' | 'ok' | 'offline' | 'error'
    let dot = document.getElementById('sync-dot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'sync-dot';
      dot.style.cssText = `
        position:fixed;top:.7rem;left:50%;transform:translateX(-50%);
        z-index:99997;border-radius:20px;padding:.3rem .85rem;
        font-size:.75rem;font-weight:700;display:flex;align-items:center;
        gap:.4rem;transition:all .3s;pointer-events:none;`;
      document.body.appendChild(dot);
    }

    const cfg = {
      syncing: { bg:'#2563eb', text:'#fff', icon:'⟳', label:'Syncing…'         },
      ok:      { bg:'#d1fae5', text:'#065f46', icon:'✓', label:'DB Connected'  },
      offline: { bg:'#fef9c3', text:'#92400e', icon:'⚡', label:'Offline Mode' },
      error:   { bg:'#fee2e2', text:'#991b1b', icon:'✕', label:'DB Error'      },
    };
    const c = cfg[state] || cfg.offline;
    dot.style.background = c.bg;
    dot.style.color = c.text;
    dot.innerHTML = `<span>${c.icon}</span><span>${c.label}</span>`;

    // Auto-hide the "ok" badge after 4 s
    if (state === 'ok') {
      clearTimeout(dot._timer);
      dot._timer = setTimeout(() => { dot.style.opacity = '0'; }, 4000);
    } else {
      dot.style.opacity = '1';
    }
  }

  /* ── Merge helpers ───────────────────────────────────────── */

  /**
   * Merge a server array into a STATE array.
   * Items that exist locally (matched by _apiId or id) are updated.
   * New items from the server are added.
   * Local-only items (no _apiId yet) are preserved.
   *
   * @param {Array}  localArr   — e.g. STATE.products
   * @param {Array}  serverArr  — array from API response
   * @param {Function} mapFn   — transforms a server object to local shape
   */
  function mergeArray(localArr, serverArr, mapFn) {
    if (!Array.isArray(serverArr) || !serverArr.length) return localArr;

    const merged = [...localArr];

    serverArr.forEach(serverItem => {
      const localIdx = merged.findIndex(
        l => l._apiId === serverItem.id || l.id === serverItem.id
      );
      const mapped = mapFn(serverItem);

      if (localIdx >= 0) {
        // Update existing — preserve local fields like posCart state
        merged[localIdx] = { ...merged[localIdx], ...mapped, _apiId: serverItem.id };
      } else {
        merged.push({ ...mapped, _apiId: serverItem.id });
      }
    });

    return merged;
  }

  /* ── Field mappers (server → STATE shape) ─────────────────── */

  function mapWarehouse(s) {
    return { id: s.id, name: s.name, location: s.location || '', manager: s.manager || '', _apiId: s.id };
  }

  function mapProduct(s) {
    const stock = {};
    if (Array.isArray(s.warehouseStock)) {
      s.warehouseStock.forEach(ws => { stock[ws.warehouseId] = ws.quantity || 0; });
    }
    return {
      id:           s.id,
      _apiId:       s.id,
      name:         s.name,
      sku:          s.sku,
      barcode:      s.barcode       || '',
      category:     s.category      || '',
      unit:         s.unit          || '',
      costPrice:    parseFloat(s.costPrice)    || 0,
      sellingPrice: parseFloat(s.sellingPrice) || 0,
      reorderLevel: parseInt(s.reorderLevel)   || 10,
      supplierId:   s.supplierId    || '',
      description:  s.description   || '',
      stock,
    };
  }

  function mapCustomer(s) {
    return {
      id:             s.id,
      _apiId:         s.id,
      name:           s.name,
      customerType:   s.customerType   || 'retail',
      phone:          s.phone          || '',
      email:          s.email          || '',
      address:        s.address        || '',
      creditLimit:    parseFloat(s.creditLimit)    || 0,
      balance:        parseFloat(s.balance)        || 0,
      loyaltyPoints:  parseInt(s.loyaltyPoints)    || 0,
      totalPurchases: parseFloat(s.totalPurchases) || 0,
      notes:          s.notes          || '',
    };
  }

  function mapSupplier(s) {
    return {
      id:       s.id,
      _apiId:   s.id,
      name:     s.name,
      contact:  s.contact  || '',
      phone:    s.phone    || '',
      email:    s.email    || '',
      address:  s.address  || '',
      category: s.category || '',
      rating:   parseInt(s.rating) || 3,
      balance:  parseFloat(s.balance) || 0,
    };
  }

  function mapSalesRep(s) {
    return {
      id:          s.id,
      _apiId:      s.id,
      name:        s.name,
      phone:       s.phone       || '',
      email:       s.email       || '',
      warehouseId: s.warehouseId || '',
      commission:  parseFloat(s.commission) || 2,
      totalSales:  parseFloat(s.totalSales) || 0,
    };
  }

  function mapSale(s) {
    return {
      id:              s.id,
      receiptNo:       s.receiptNo      || null,
      invoiceNo:       s.invoiceNo      || null,
      customerId:      s.customerId     || '',
      customerName:    s.customerName   || 'Walk-in',
      repId:           s.repId          || '',
      repName:         s.repName        || '',
      warehouseId:     s.warehouseId    || '',
      items:           s.items          || [],
      subtotal:        parseFloat(s.subtotal)          || 0,
      totalBulkDisc:   parseFloat(s.totalBulkDisc)     || 0,
      totalManualDisc: parseFloat(s.totalManualDisc)   || 0,
      extraDiscPct:    parseFloat(s.extraDiscPct)      || 0,
      extraDiscAmt:    parseFloat(s.extraDiscAmt)      || 0,
      totalDiscountAmt:parseFloat(s.totalDiscountAmt)  || 0,
      taxAmt:          parseFloat(s.taxAmt)            || 0,
      redeemPts:       parseInt(s.redeemPts)           || 0,
      redeemVal:       parseFloat(s.redeemVal)         || 0,
      total:           parseFloat(s.total)             || 0,
      paymentMethod:   s.paymentMethod  || 'cash',
      paymentStatus:   s.paymentStatus  || 'paid',
      date:            s.date           || new Date().toISOString(),
      notes:           s.notes          || '',
      type:            s.type           || undefined,
    };
  }

  function mapPurchase(s) {
    return {
      id:            s.id,
      invoiceNo:     s.invoiceNo     || '',
      supplierId:    s.supplierId    || '',
      supplierName:  s.supplierName  || '',
      warehouseId:   s.warehouseId   || '',
      warehouseName: s.warehouseName || '',
      items:         s.items         || [],
      grandTotal:    parseFloat(s.grandTotal)    || 0,
      paymentStatus: s.paymentStatus || 'paid',
      paidAmt:       parseFloat(s.paidAmt)       || 0,
      owed:          parseFloat(s.owed)           || 0,
      notes:         s.notes         || '',
      date:          s.date          || new Date().toISOString(),
    };
  }

  function mapExpense(s) {
    return {
      id:          s.id,
      category:    s.category    || '',
      amount:      parseFloat(s.amount) || 0,
      date:        s.date        || new Date().toISOString(),
      paidBy:      s.paidBy      || '',
      description: s.description || '',
    };
  }

  function mapQuote(s) {
    return {
      id:           s.id,
      quoteNo:      s.quoteNo      || '',
      customerId:   s.customerId   || '',
      customerName: s.customerName || 'Walk-in',
      warehouseId:  s.warehouseId  || '',
      items:        s.items        || [],
      subtotal:     parseFloat(s.subtotal)    || 0,
      extraDiscPct: parseFloat(s.extraDiscPct)|| 0,
      taxAmt:       parseFloat(s.taxAmt)      || 0,
      total:        parseFloat(s.total)       || 0,
      validDays:    parseInt(s.validDays)     || 7,
      status:       s.status       || 'pending',
      date:         s.date         || new Date().toISOString(),
      notes:        s.notes        || '',
    };
  }

  function mapCreditNote(s) {
    return {
      id:                 s.id,
      creditNoteNo:       s.creditNoteNo       || '',
      originalInvoiceNo:  s.originalInvoiceNo  || '',
      customerId:         s.customerId         || '',
      customerName:       s.customerName       || '',
      amount:             parseFloat(s.amount) || 0,
      reason:             s.reason             || '',
      notes:              s.notes              || '',
      date:               s.date               || new Date().toISOString(),
      status:             s.status             || 'issued',
    };
  }

  function mapDiscountTier(s) {
    return {
      id:          s.id,
      name:        s.name,
      discountPct: parseFloat(s.discountPct) || 0,
      minQty:      parseInt(s.minQty)        || 0,
      maxQty:      parseInt(s.maxQty)        || 99999,
      productIds:  s.productIds              || [],
      active:      Boolean(s.active),
    };
  }

  function mapSettings(s) {
    if (!s) return {};
    // Only bring in fields that exist on the server record
    const allowed = [
      'companyName','address','phone','email','currency','taxRate',
      'lowStockThreshold','invoicePrefix','receiptPrefix','quotePrefix',
      'debitNotePrefix','creditNotePrefix',
      'nextInvoiceNo','nextReceiptNo','nextQuoteNo','nextDebitNoteNo','nextCreditNoteNo',
      'enableBulkDiscount','loyaltyPointsRate','loyaltyRedemptionRate','repDailyTarget',
    ];
    const out = {};
    allowed.forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
    return out;
  }

  /* ── Main pull function ──────────────────────────────────── */
  async function pullAll() {
    setStatus('syncing');

    let serverData;
    try {
      const res = await window.API.fetchAll();
      serverData = res?.data;
    } catch (err) {
      console.warn('[SYNC] Could not reach backend:', err.message);
      setStatus('offline');
      return false;
    }

    if (!serverData) {
      setStatus('error');
      return false;
    }

    /* ── Guard: STATE must exist. script.js defines it synchronously on
       parse, but if for any reason it isn't ready yet we retry up to
       20 times (2 seconds total) before giving up. ── */
    if (typeof window.STATE === 'undefined') {
      let resolved = false;
      await new Promise(resolve => {
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          if (typeof window.STATE !== 'undefined') {
            clearInterval(interval);
            resolved = true;
            resolve();
          } else if (attempts >= 20) {
            clearInterval(interval);
            resolve(); // resolve anyway, resolved stays false
          }
        }, 100);
      });
      if (!resolved) {
        console.warn('[SYNC] STATE not available after 2s — aborting');
        setStatus('error');
        return false;
      }
    }

    const ST = window.STATE;

    /* Merge each collection */
    if (serverData.warehouses)     ST.warehouses     = mergeArray(ST.warehouses,     serverData.warehouses,     mapWarehouse);
    if (serverData.products)       ST.products       = mergeArray(ST.products,       serverData.products,       mapProduct);
    if (serverData.customers)      ST.customers      = mergeArray(ST.customers,      serverData.customers,      mapCustomer);
    if (serverData.suppliers)      ST.suppliers      = mergeArray(ST.suppliers,      serverData.suppliers,      mapSupplier);
    if (serverData.salesReps)      ST.salesReps      = mergeArray(ST.salesReps,      serverData.salesReps,      mapSalesRep);
    if (serverData.sales)          ST.sales          = mergeArray(ST.sales,          serverData.sales,          mapSale);
    if (serverData.purchases)      ST.purchases      = mergeArray(ST.purchases,      serverData.purchases,      mapPurchase);
    if (serverData.expenses)       ST.expenses       = mergeArray(ST.expenses,       serverData.expenses,       mapExpense);
    if (serverData.quotes)         ST.quotes         = mergeArray(ST.quotes,         serverData.quotes,         mapQuote);
    if (serverData.creditNotes)    ST.creditNotes    = mergeArray(ST.creditNotes,    serverData.creditNotes,    mapCreditNote);
    if (serverData.bulkDiscountTiers) ST.bulkDiscountTiers = mergeArray(ST.bulkDiscountTiers, serverData.bulkDiscountTiers, mapDiscountTier);

    /* Merge settings (server wins for most fields) */
    if (serverData.settings) {
      ST.settings = { ...ST.settings, ...mapSettings(serverData.settings) };
    }

    /* Persist merged state back to localStorage */
    if (typeof window.saveState === 'function') window.saveState();

    setStatus('ok');
    console.log('[SYNC] ✅ Pull complete');
    return true;
  }

  /* ── Push settings to server ─────────────────────────────── */
  async function pushSettings() {
    if (!window.STATE) return;
    try {
      await window.API.updateSettings(window.STATE.settings);
      console.log('[SYNC] Settings pushed to DB');
    } catch (err) {
      console.warn('[SYNC] Settings push failed — queued', err);
      if (window.OfflineQueue) {
        window.OfflineQueue.add({ type: 'updateSettings', data: window.STATE.settings });
      }
    }
  }

  /* ── Ping DB ─────────────────────────────────────────────── */
  async function ping() {
    try {
      await window.API.ping();
      setStatus('ok');
      return true;
    } catch {
      setStatus('offline');
      return false;
    }
  }

  /* ── Public ──────────────────────────────────────────────── */
  window.SYNC = { pullAll, pushSettings, ping, setStatus };

  console.log('[SYNC] Module ready');
})();