/* ================================================================
   sync.js  —  C.N. Johnson Ventures
================================================================ */

(function () {
  'use strict';

  /* ── Status indicator ─────────────────────────────────────── */
  function setStatus(state) {
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
      syncing: { bg:'#2563eb', text:'#fff',    icon:'⟳', label:'Syncing…'      },
      ok:      { bg:'#d1fae5', text:'#065f46', icon:'✓', label:'DB Connected'  },
      offline: { bg:'#fef9c3', text:'#92400e', icon:'⚡', label:'Offline Mode' },
      error:   { bg:'#fee2e2', text:'#991b1b', icon:'✕', label:'DB Error'      },
    };
    const c = cfg[state] || cfg.offline;
    dot.style.background = c.bg;
    dot.style.color      = c.text;
    dot.innerHTML        = `<span>${c.icon}</span><span>${c.label}</span>`;
    if (state === 'ok') {
      clearTimeout(dot._timer);
      dot._timer = setTimeout(() => { dot.style.opacity = '0'; }, 4000);
    } else {
      dot.style.opacity = '1';
    }
  }

  /* ── Generic merge ───────────────────────────────────────── */
  function mergeArray(localArr, serverArr, mapFn) {
    if (!Array.isArray(serverArr) || !serverArr.length) return localArr;
    const merged = [...localArr];
    serverArr.forEach(serverItem => {
      const idx = merged.findIndex(
        l => l._apiId === serverItem.id || l.id === serverItem.id
      );
      const mapped = mapFn(serverItem);
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...mapped, _apiId: serverItem.id };
      } else {
        merged.push({ ...mapped, _apiId: serverItem.id });
      }
    });
    return merged;
  }

  /* ── Smart product merge (preserves per-warehouse stock map) */
  function mergeProducts(localArr, serverArr) {
    if (!Array.isArray(serverArr) || !serverArr.length) return localArr;
    const merged = [...localArr];
    serverArr.forEach(serverItem => {
      const idx        = merged.findIndex(
        l => l._apiId === serverItem.id || l.id === serverItem.id
      );
      const mapped     = mapProduct(serverItem);
      const serverFlat = mapped._serverTotal || 0;

      if (idx >= 0) {
        const existing  = merged[idx];
        // Compute local total, ignoring all sentinel keys
        const localKeys = Object.keys(existing.stock || {})
          .filter(k => k !== '__server_total__' && k !== '__default__' && k !== '_serverTotal');
        const localTotal = localKeys.reduce((a, k) => a + (existing.stock[k] || 0), 0);

        let finalStock;
        if (localTotal === serverFlat) {
          // Totals match — local per-warehouse split is still valid
          finalStock = existing.stock;
        } else {
          // Server total differs (stock changed on another device).
          // Scale existing proportions to new total, or assign to first warehouse.
          const warehouses = window.STATE?.warehouses || [];
          if (localKeys.length === 0 || localTotal === 0) {
            finalStock = {};
            if (warehouses.length > 0) {
              warehouses.forEach((wh, i) => { finalStock[wh.id] = i === 0 ? serverFlat : 0; });
            } else {
              finalStock['__default__'] = serverFlat;
            }
          } else {
            finalStock = {};
            localKeys.forEach(k => {
              finalStock[k] = Math.round((existing.stock[k] / localTotal) * serverFlat);
            });
            // Fix rounding drift on the first warehouse key
            const scaledTotal = Object.values(finalStock).reduce((a, b) => a + b, 0);
            if (scaledTotal !== serverFlat && localKeys[0]) {
              finalStock[localKeys[0]] = Math.max(
                0,
                finalStock[localKeys[0]] + (serverFlat - scaledTotal)
              );
            }
          }
        }
        mapped.stock = finalStock;
        merged[idx] = { ...existing, ...mapped, stock: finalStock, _apiId: serverItem.id };
      } else {
        // Brand-new product — assign all stock to first warehouse
        const warehouses = window.STATE?.warehouses || [];
        const stock      = {};
        if (warehouses.length > 0) {
          warehouses.forEach((wh, i) => { stock[wh.id] = i === 0 ? serverFlat : 0; });
        } else {
          stock['__default__'] = serverFlat;
        }
        mapped.stock = stock;
        merged.push({ ...mapped, _apiId: serverItem.id });
      }
    });
    return merged;
  }

  /* ── Field mappers ───────────────────────────────────────── */

  function mapWarehouse(s) {
    return {
      id:       s.id,
      _apiId:   s.id,
      name:     s.name,
      location: s.location || '',
      manager:  s.manager  || '',
    };
  }

  function mapProduct(s) {
    const flatStock = parseInt(s.stock) || 0;
    return {
      id:           s.id,
      _apiId:       s.id,
      name:         s.name         || '',
      sku:          s.sku          || '',
      barcode:      s.barcode      || '',
      category:     s.category?.name || s.category || '',
      categoryId:   s.categoryId   || s.category?.id || null,
      unit:         s.unit         || '',
      costPrice:    parseFloat(s.costPrice)                         || 0,
      sellingPrice: parseFloat(s.price       || s.sellingPrice)     || 0,
      reorderLevel: parseInt(s.lowStockThreshold || s.reorderLevel) || 10,
      supplierId:   s.supplierId   || '',
      description:  s.description  || '',
      _serverTotal: flatStock,   // used by mergeProducts; cleaned up in post-merge step
      stock:        {},          // mergeProducts fills this in
    };
  }

  function mapCustomer(s) {
    return {
      id:             s.id,
      _apiId:         s.id,
      name:           s.name           || '',
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
      contact:  s.contactPerson || s.contact || '',
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
      phone:       s.phone             || '',
      email:       s.email             || '',
      warehouseId: s.warehouseId || s.warehouse?.id || '',
      commission:  parseFloat(s.commission) || 2,
      totalSales:  parseFloat(s.totalSales) || 0,
    };
  }

  function mapSale(s) {
    const items = (s.items || []).map(i => ({
      productId:            i.productId,
      name:                 i.product?.name || i.productName || '',
      unit:                 i.product?.unit || i.unit        || '',
      qty:                  i.qty,
      unitPrice:            parseFloat(i.price)    || 0,
      costPrice:            parseFloat(i.product?.costPrice || i.costPrice) || 0,
      discount:             parseFloat(i.discount) || 0,
      total:                parseFloat(i.total)    || 0,
      bulkDiscountPct:      i.bulkDiscountPct      || 0,
      manualDiscountPct:    i.manualDiscountPct     || 0,
      effectiveDiscountPct: i.effectiveDiscountPct  || 0,
      lineDiscount:         i.lineDiscount          || 0,
    }));

    // The DB Sale schema has a single `discount` field.
    // Map it to totalDiscountAmt only — not to both bulk and total —
    // to avoid double-counting in reports.
    const discountAmt = parseFloat(s.totalDiscountAmt || s.discount) || 0;

    return {
      id:               s.id,
      _apiId:           s.id,
      receiptNo:        s.receiptNo      || null,
      invoiceNo:        s.invoiceNo      || null,
      customerId:       s.customerId     || '',
      customerName:     s.customer?.name || s.customerName || 'Walk-in',
      repId:            s.repId          || '',
      repName:          s.repName        || '',
      warehouseId:      s.warehouseId    || '',
      items,
      subtotal:         parseFloat(s.subtotal)        || 0,
      totalBulkDisc:    parseFloat(s.totalBulkDisc)   || 0,  // no s.discount fallback
      totalManualDisc:  parseFloat(s.totalManualDisc)  || 0,
      extraDiscPct:     parseFloat(s.extraDiscPct)     || 0,
      extraDiscAmt:     parseFloat(s.extraDiscAmt)     || 0,
      totalDiscountAmt: discountAmt,                          // single source of truth
      taxAmt:           parseFloat(s.taxAmt || s.tax)  || 0,
      redeemPts:        parseInt(s.redeemPts || s.pointsRedeemed) || 0,
      redeemVal:        parseFloat(s.redeemVal)        || 0,
      total:            parseFloat(s.total)            || 0,
      paymentMethod:    (s.paymentMethod || 'cash').toLowerCase(),
      paymentStatus:    s.paymentStatus  || 'paid',
      date:             s.createdAt || s.date || new Date().toISOString(),
      notes:            s.note || s.notes || '',
      type:             s.type || undefined,
    };
  }

  function mapPurchase(s) {
    return {
      id:            s.id,
      _apiId:        s.id,
      invoiceNo:     s.purchaseNo    || s.invoiceNo    || '',
      supplierId:    s.supplierId    || '',
      supplierName:  s.supplier?.name || s.supplierName || '',
      warehouseId:   s.warehouseId   || '',
      warehouseName: s.warehouse?.name || s.warehouseName || '',
      items:         (s.items || []).map(i => ({
        productId: i.productId,
        name:      i.product?.name || i.productName || '',
        unit:      i.product?.unit || i.unit        || '',
        qty:       i.qty,
        cost:      parseFloat(i.costPrice) || 0,
      })),
      grandTotal:    parseFloat(s.total || s.grandTotal) || 0,
      paymentStatus: s.paymentStatus || 'paid',
      paidAmt:       parseFloat(s.paidAmount || s.paidAmt) || 0,
      owed:          parseFloat(s.owed)        || 0,
      notes:         s.note || s.notes         || '',
      date:          s.createdAt || s.date     || new Date().toISOString(),
    };
  }

  function mapExpense(s) {
    return {
      id:          s.id,
      _apiId:      s.id,
      category:    s.category    || '',
      amount:      parseFloat(s.amount) || 0,
      date:        s.date || s.createdAt || new Date().toISOString(),
      paidBy:      s.paidBy      || '',
      description: s.description || s.title || '',
    };
  }

  function mapQuote(s) {
    return {
      id:           s.id,
      _apiId:       s.id,
      quoteNo:      s.quoteNo      || '',
      customerId:   s.customerId   || '',
      customerName: s.customer?.name || s.customerName || 'Walk-in',
      warehouseId:  s.warehouseId  || '',
      items:        s.items        || [],
      subtotal:     parseFloat(s.subtotal)     || 0,
      extraDiscPct: parseFloat(s.extraDiscPct) || 0,
      taxAmt:       parseFloat(s.taxAmt || s.tax) || 0,
      total:        parseFloat(s.total)        || 0,
      validDays:    parseInt(s.validDays)      || 7,
      status:       (s.status || 'pending').toLowerCase(), // DB returns uppercase enum
      date:         s.createdAt || s.date || new Date().toISOString(),
      notes:        s.note || s.notes || '',
    };
  }

  function mapCreditNote(s) {
    return {
      id:                s.id,
      _apiId:            s.id,
      creditNoteNo:      s.creditNo  || s.creditNoteNo      || '',
      originalInvoiceNo: s.originalInvoiceNo || '',
      customerId:        s.customerId        || '',
      customerName:      s.customer?.name || s.customerName || '',
      amount:            parseFloat(s.amount) || 0,
      reason:            s.reason            || '',
      notes:             s.note || s.notes   || '',
      date:              s.createdAt || s.date || new Date().toISOString(),
      status:            s.status            || 'issued',
    };
  }

  function mapDiscountTier(s) {
    return {
      id:          s.id,
      _apiId:      s.id,
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

  /* ── Extract array from various response shapes ──────────── */
  function extractArray(data, ...keys) {
    for (const key of keys) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    if (Array.isArray(data)) return data;
    return null;
  }

  /* ── Unwrap the sync/all response robustly ───────────────── */
  // Backend may return any of these shapes after api_layer wraps it:
  //   res.data = { products, warehouses, … }            ← direct payload
  //   res.data = { data: { products, warehouses, … } }  ← nested data key
  //   res.data = { success, data: { products, … } }     ← success + nested
  function unwrapSyncResponse(res) {
    const d1 = res?.data;
    if (!d1) return null;

    // d1 has known collection keys — use directly
    if (d1.products || d1.warehouses || d1.customers || d1.sales) return d1;

    // d1.data has collection keys — one level deeper
    const d2 = d1?.data;
    if (d2 && (d2.products || d2.warehouses || d2.customers || d2.sales)) return d2;

    // Fall back to d1 and let extractArray return null for missing keys
    return d1;
  }

  /* ── Main pull ───────────────────────────────────────────── */
  async function pullAll() {
    setStatus('syncing');

    let serverData;
    try {
      const res = await window.API.fetchAll();
      serverData = unwrapSyncResponse(res);
    } catch (err) {
      console.warn('[SYNC] Could not reach backend:', err.message);
      setStatus('offline');
      return false;
    }

    if (!serverData) { setStatus('error'); return false; }

    /* Wait for STATE */
    if (typeof window.STATE === 'undefined') {
      let resolved = false;
      await new Promise(resolve => {
        let attempts = 0;
        const iv = setInterval(() => {
          attempts++;
          if (typeof window.STATE !== 'undefined') {
            clearInterval(iv); resolved = true; resolve();
          } else if (attempts >= 20) {
            clearInterval(iv); resolve();
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

    // 1. Warehouses first (mergeProducts needs them)
    const warehouses = extractArray(serverData, 'warehouses');
    if (warehouses) ST.warehouses = mergeArray(ST.warehouses, warehouses, mapWarehouse);

    // 2. Products — smart merge preserving per-warehouse stock
    const products = extractArray(serverData, 'products');
    if (products) ST.products = mergeProducts(ST.products, products);

    // 3. Customers
    const customers = extractArray(serverData, 'customers');
    if (customers) ST.customers = mergeArray(ST.customers, customers, mapCustomer);

    // 4. Suppliers
    const suppliers = extractArray(serverData, 'suppliers');
    if (suppliers) ST.suppliers = mergeArray(ST.suppliers, suppliers, mapSupplier);

    // 5. Sales Reps — no 'data' fallback to avoid accidentally merging wrong array
    const salesReps = extractArray(serverData, 'salesReps');
    if (salesReps) ST.salesReps = mergeArray(ST.salesReps, salesReps, mapSalesRep);

    // 6. Sales
    const sales = extractArray(serverData, 'sales');
    if (sales) ST.sales = mergeArray(ST.sales, sales, mapSale);

    // 7. Purchases
    const purchases = extractArray(serverData, 'purchases');
    if (purchases) ST.purchases = mergeArray(ST.purchases, purchases, mapPurchase);

    // 8. Expenses
    const expenses = extractArray(serverData, 'expenses');
    if (expenses) ST.expenses = mergeArray(ST.expenses, expenses, mapExpense);

    // 9. Quotes
    const quotes = extractArray(serverData, 'quotes');
    if (quotes) ST.quotes = mergeArray(ST.quotes, quotes, mapQuote);

    // 10. Credit Notes
    const creditNotes = extractArray(serverData, 'creditNotes');
    if (creditNotes) ST.creditNotes = mergeArray(ST.creditNotes, creditNotes, mapCreditNote);

    // 11. Bulk Discount Tiers
    const tiers = extractArray(serverData, 'bulkDiscountTiers');
    if (tiers) ST.bulkDiscountTiers = mergeArray(ST.bulkDiscountTiers, tiers, mapDiscountTier);

    // 12. Settings
    if (serverData.settings)
      ST.settings = { ...ST.settings, ...mapSettings(serverData.settings) };

    // 13. Post-merge stock cleanup
    const firstWhId = ST.warehouses?.[0]?.id;
    if (firstWhId) {
      ST.products.forEach(p => {
        // Migrate __default__ stock to first warehouse
        if (p.stock?.['__default__'] !== undefined) {
          p.stock[firstWhId] = (p.stock[firstWhId] || 0) + p.stock['__default__'];
          delete p.stock['__default__'];
        }

        // Clean up all sentinel keys from stock object
        delete p.stock?.['__server_total__'];
        delete p.stock?.['_serverTotal'];

        // If no real warehouse keys have stock but _serverTotal is on the
        // product object itself, assign it to the first warehouse
        const whKeys        = ST.warehouses.map(w => w.id);
        const hasAnyWhStock = whKeys.some(k => (p.stock?.[k] ?? -1) >= 0);
        if (!hasAnyWhStock && (p._serverTotal || 0) > 0) {
          if (!p.stock) p.stock = {};
          p.stock[firstWhId] = p._serverTotal;
        }
        delete p._serverTotal;
      });
    }

    if (typeof window.saveState === 'function') window.saveState();
    setStatus('ok');
    console.log('[SYNC] ✅ Pull complete');
    return true;
  }

  /* ── Push settings ───────────────────────────────────────── */
  async function pushSettings() {
    if (!window.STATE) return;
    try {
      await window.API.updateSettings(window.STATE.settings);
      console.log('[SYNC] Settings pushed to DB');
    } catch (err) {
      console.warn('[SYNC] Settings push failed — queued', err);
      if (window.OfflineQueue)
        window.OfflineQueue.add({ type: 'updateSettings', data: window.STATE.settings });
    }
  }

  /* ── Ping ────────────────────────────────────────────────── */
  async function ping() {
    try { await window.API.ping(); setStatus('ok'); return true; }
    catch { setStatus('offline'); return false; }
  }

  window.SYNC = { pullAll, pushSettings, ping, setStatus };
  console.log('[SYNC] Module ready');
})();