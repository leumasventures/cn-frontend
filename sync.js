/* ================================================================
   C.N. Johnson Ventures Ltd — API Sync Layer
   sync.js · Load AFTER api.js, BEFORE script.js
   Keeps localStorage working while syncing with backend API.
   ================================================================ */

'use strict';

const SYNC_KEY = 'cnjohnson_last_sync';

/* ════════════════════════════════════════════════════════════════
   SYNC MANAGER
   ════════════════════════════════════════════════════════════════ */
window.SYNC = {

  online: navigator.onLine,

  /* ── Check if API is reachable ── */
  async ping() {
    try {
      const res = await fetch('http://localhost:5000/');
      return res.ok;
    } catch { return false; }
  },

  /* ── Pull all data from API into STATE ── */
  async pullAll() {
    if (!window.API) return;
    try {
      const [products, customers, suppliers, settings, salesRes] = await Promise.allSettled([
        window.API.getProducts(),
        window.API.getCustomers(),
        window.API.getSuppliers(),
        window.API.getSettings(),
        window.API.getSales ? window.API.getSales() : Promise.resolve(null),
      ]);

      if (products.status === 'fulfilled' && products.value?.products) {
        STATE.products = products.value.products.map(p => ({
          id:           p.id,
          name:         p.name,
          sku:          p.sku || '',
          barcode:      p.barcode || '',
          category:     p.category?.name || p.categoryId || 'General',
          unit:         p.unit || 'Unit',
          costPrice:    p.costPrice || 0,
          sellingPrice: p.price || 0,
          stock:        { wh1: p.stock || 0 },
          reorderLevel: p.lowStockThreshold || STATE.settings.lowStockThreshold,
          supplierId:   p.supplierId || '',
          description:  p.description || '',
          _apiId:       p.id,
        }));
        console.log(`✅ Synced ${STATE.products.length} products`);
      }

      if (customers.status === 'fulfilled' && customers.value?.customers) {
        STATE.customers = customers.value.customers.map(c => ({
          id:             c.id,
          name:           c.name,
          phone:          c.phone || '',
          email:          c.email || '',
          address:        c.address || '',
          creditLimit:    500000,
          balance:        c.balance || 0,
          totalPurchases: 0,
          loyaltyPoints:  c.loyaltyPoints || 0,
          customerType:   'retail',
          notes:          '',
          _apiId:         c.id,
        }));
        console.log(`✅ Synced ${STATE.customers.length} customers`);
      }

      if (suppliers.status === 'fulfilled' && suppliers.value?.suppliers) {
        STATE.suppliers = suppliers.value.suppliers.map(s => ({
          id:       s.id,
          name:     s.name,
          contact:  s.phone || '',
          phone:    s.phone || '',
          email:    s.email || '',
          address:  s.address || '',
          category: 'General',
          balance:  s.balance || 0,
          rating:   4,
          _apiId:   s.id,
        }));
        console.log(`✅ Synced ${STATE.suppliers.length} suppliers`);
      }

      if (settings.status === 'fulfilled' && settings.value?.settings) {
        const s = settings.value.settings;
        Object.assign(STATE.settings, {
          companyName:         s.companyName || STATE.settings.companyName,
          address:             s.address     || STATE.settings.address,
          phone:               s.phone       || STATE.settings.phone,
          email:               s.email       || STATE.settings.email,
          currency:            s.currency === 'USD' ? '₦' : (s.currency || '₦'),
          taxRate:             s.taxRate     ?? STATE.settings.taxRate,
          lowStockThreshold:   s.lowStockThreshold ?? STATE.settings.lowStockThreshold,
          invoicePrefix:       s.invoicePrefix  || STATE.settings.invoicePrefix,
          receiptPrefix:       s.receiptPrefix  || STATE.settings.receiptPrefix,
          quotePrefix:         s.quotePrefix    || STATE.settings.quotePrefix,
          enableBulkDiscount:  s.enableBulkDiscount ?? STATE.settings.enableBulkDiscount,
          loyaltyPointsRate:   s.loyaltyPointsRate   ?? STATE.settings.loyaltyPointsRate,
          loyaltyRedemptionRate: s.loyaltyRedemptionRate ?? STATE.settings.loyaltyRedemptionRate,
        });
        console.log('✅ Synced settings');
      }

      if (salesRes?.status === 'fulfilled' && salesRes.value?.sales) {
        STATE.sales = salesRes.value.sales.map(s => ({
          id:            s.id,
          receiptNo:     s.receiptNo,
          invoiceNo:     s.receiptNo,
          customerId:    s.customerId || '',
          customerName:  s.customer?.name || 'Walk-in',
          repId:         s.salesRepId || '',
          repName:       s.salesRepName || '',
          items:         (s.items || []).map(i => ({
            productId:   i.productId,
            productName: i.product?.name || '',
            qty:         i.qty,
            unitPrice:   i.price,
            effectiveDiscountPct: i.discount || 0,
            lineDiscount: i.discount ? (i.qty * i.price * i.discount / 100) : 0,
            total:        i.total,
          })),
          subtotal:      s.subtotal,
          taxAmt:        s.tax,
          total:         s.total,
          extraDiscAmt:  s.discount,
          paymentMethod: s.paymentMethod?.toLowerCase() || 'cash',
          paymentStatus: s.paymentMethod === 'CREDIT' ? 'unpaid' : 'paid',
          redeemPts:     s.pointsRedeemed || 0,
          notes:         s.note || '',
          date:          s.createdAt,
          _apiId:        s.id,
        }));
        console.log(`✅ Synced ${STATE.sales.length} sales`);
      }

      saveState();
      localStorage.setItem(SYNC_KEY, new Date().toISOString());
      SYNC.showBanner('✅ Data synced from server.', 'success');

    } catch (err) {
      console.warn('Sync pull failed:', err.message);
      SYNC.showBanner('⚠ Running offline — using local data.', 'warn');
    }
  },

  /* ── Push a sale to the API ── */
  async pushSale(sale) {
    if (!window.API) return;
    try {
      const payload = {
        customerId:     sale.customerId || null,
        items:          sale.items.map(i => ({
          productId: i.productId,
          qty:       i.qty,
          price:     i.unitPrice,
          discount:  i.effectiveDiscountPct || 0,
          total:     parseFloat(((i.qty * i.unitPrice) * (1 - (i.effectiveDiscountPct || 0) / 100)).toFixed(2)),
        })),
        paymentMethod:  (sale.paymentMethod || 'cash').toUpperCase(),
        subtotal:       parseFloat((sale.subtotal || 0).toFixed(2)),
        discount:       parseFloat((sale.extraDiscAmt || 0).toFixed(2)),
        tax:            parseFloat((sale.taxAmt || 0).toFixed(2)),
        total:          parseFloat((sale.total || 0).toFixed(2)),
        pointsRedeemed: sale.redeemPts || 0,
        note:           sale.notes || '',
        salesRepId:     sale.repId   || null,
        salesRepName:   sale.repName || null,
        origin:         sale.origin  || null,
      };
      const res = await window.API.completeSale(payload);
      console.log('✅ Sale pushed to API:', res?.sale?.receiptNo);
    } catch (err) {
      console.warn('⚠ Sale push failed (saved locally):', err.message);
    }
  },

  /* ── Push a customer to the API ── */
  async pushCustomer(customer) {
    if (!window.API) return;
    try {
      if (customer._apiId && !customer._apiId.startsWith('C')) {
        await window.API.updateCustomer(customer._apiId, {
          name: customer.name, email: customer.email,
          phone: customer.phone, address: customer.address,
        });
      } else {
        const res = await window.API.createCustomer({
          name: customer.name, email: customer.email || undefined,
          phone: customer.phone, address: customer.address,
          loyaltyPoints: customer.loyaltyPoints || 0,
        });
        if (res?.customer?.id) customer._apiId = res.customer.id;
      }
      saveState();
      console.log('✅ Customer synced:', customer.name);
    } catch (err) {
      console.warn('⚠ Customer push failed:', err.message);
    }
  },

  /* ── Push a product to the API ── */
  async pushProduct(product) {
    if (!window.API) return;
    try {
      const payload = {
        name:             product.name,
        sku:              product.sku,
        barcode:          product.barcode || undefined,
        price:            product.sellingPrice,
        costPrice:        product.costPrice,
        stock:            Object.values(product.stock || {}).reduce((a, b) => a + b, 0),
        lowStockThreshold: product.reorderLevel,
        unit:             product.unit,
        description:      product.description,
      };
      if (product._apiId && !product._apiId.startsWith('P')) {
        await window.API.updateProduct(product._apiId, payload);
      } else {
        const res = await window.API.createProduct(payload);
        if (res?.product?.id) product._apiId = res.product.id;
      }
      saveState();
      console.log('✅ Product synced:', product.name);
    } catch (err) {
      console.warn('⚠ Product push failed:', err.message);
    }
  },

  /* ── Push a supplier to the API ── */
  async pushSupplier(supplier) {
    if (!window.API) return;
    try {
      const payload = {
        name: supplier.name, email: supplier.email || undefined,
        phone: supplier.phone, address: supplier.address,
      };
      if (supplier._apiId && !supplier._apiId.startsWith('S')) {
        await window.API.updateSupplier(supplier._apiId, payload);
      } else {
        const res = await window.API.createSupplier(payload);
        if (res?.supplier?.id) supplier._apiId = res.supplier.id;
      }
      saveState();
      console.log('✅ Supplier synced:', supplier.name);
    } catch (err) {
      console.warn('⚠ Supplier push failed:', err.message);
    }
  },

  /* ── Push settings to the API ── */
  async pushSettings() {
    if (!window.API) return;
    try {
      const s = STATE.settings;
      await window.API.updateSettings({
        companyName:          s.companyName,
        address:              s.address,
        phone:                s.phone,
        email:                s.email,
        taxRate:              s.taxRate,
        lowStockThreshold:    s.lowStockThreshold,
        invoicePrefix:        s.invoicePrefix,
        receiptPrefix:        s.receiptPrefix,
        quotePrefix:          s.quotePrefix,
        enableBulkDiscount:   s.enableBulkDiscount,
        loyaltyPointsRate:    s.loyaltyPointsRate,
        loyaltyRedemptionRate: s.loyaltyRedemptionRate,
      });
      console.log('✅ Settings pushed to API');
    } catch (err) {
      console.warn('⚠ Settings push failed:', err.message);
    }
  },

  /* ── Status banner ── */
  showBanner(msg, type = 'info') {
    const colors = { info: '#2563eb', success: '#16a34a', warn: '#d97706', error: '#dc2626' };
    let banner = document.getElementById('sync-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sync-banner';
      banner.style.cssText = `position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);
        z-index:99998;padding:.6rem 1.5rem;border-radius:20px;font-size:.82rem;font-weight:600;
        color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:opacity .4s;`;
      document.body.append(banner);
    }
    banner.style.background = colors[type] || colors.info;
    banner.style.opacity = '1';
    banner.textContent = msg;
    clearTimeout(banner._t);
    banner._t = setTimeout(() => { banner.style.opacity = '0'; }, 3500);
  },
};

/* ════════════════════════════════════════════════════════════════
   PATCH SAVE FUNCTIONS — intercept local saves and push to API
   ════════════════════════════════════════════════════════════════ */

/* Patch completeSale to also push to API */
document.addEventListener('DOMContentLoaded', () => {
  // Wait for script.js to load first
  setTimeout(() => {

    /* ── Patch openAddCustomer save ── */
    const _origAddCust = window.openAddCustomer;
    window.openAddCustomer = function () {
      _origAddCust?.();
      // Hook into modal save via MutationObserver
      const observer = new MutationObserver(() => {
        const saveBtn = document.getElementById('modal-save');
        if (saveBtn && !saveBtn._syncPatched) {
          saveBtn._syncPatched = true;
          const _origClick = saveBtn.onclick;
          saveBtn.onclick = async function (e) {
            const prevLen = STATE.customers.length;
            _origClick?.(e);
            if (STATE.customers.length > prevLen) {
              const newCust = STATE.customers[STATE.customers.length - 1];
              await SYNC.pushCustomer(newCust);
            }
          };
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    /* ── Patch openAddProduct save ── */
    const _origAddProd = window.openAddProduct;
    window.openAddProduct = function () {
      _origAddProd?.();
      const observer = new MutationObserver(() => {
        const saveBtn = document.getElementById('modal-save');
        if (saveBtn && !saveBtn._syncPatched) {
          saveBtn._syncPatched = true;
          const _origClick = saveBtn.onclick;
          saveBtn.onclick = async function (e) {
            const prevLen = STATE.products.length;
            _origClick?.(e);
            if (STATE.products.length > prevLen) {
              const newProd = STATE.products[STATE.products.length - 1];
              await SYNC.pushProduct(newProd);
            }
          };
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    /* ── Patch openAddSupplier save ── */
    const _origAddSup = window.openAddSupplier;
    window.openAddSupplier = function () {
      _origAddSup?.();
      const observer = new MutationObserver(() => {
        const saveBtn = document.getElementById('modal-save');
        if (saveBtn && !saveBtn._syncPatched) {
          saveBtn._syncPatched = true;
          const _origClick = saveBtn.onclick;
          saveBtn.onclick = async function (e) {
            const prevLen = STATE.suppliers.length;
            _origClick?.(e);
            if (STATE.suppliers.length > prevLen) {
              const newSup = STATE.suppliers[STATE.suppliers.length - 1];
              await SYNC.pushSupplier(newSup);
            }
          };
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    /* ── Patch saveSettings to also push ── */
    const _origSaveSettings = window.saveSettings;
    window.saveSettings = async function () {
      _origSaveSettings?.();
      await SYNC.pushSettings();
    };

    /* ── Patch completeSale to also push ── */
    const _origComplete = window.completeSale;
    window.completeSale = async function () {
      const prevLen = STATE.sales.length;
      _origComplete?.();
      if (STATE.sales.length > prevLen) {
        const newSale = STATE.sales[STATE.sales.length - 1];
        await SYNC.pushSale(newSale);
      }
    };

    console.log('✅ Sync patches applied');

  }, 100);
});

/* ════════════════════════════════════════════════════════════════
   INIT — Pull data on page load
   ════════════════════════════════════════════════════════════════ */
window.addEventListener('load', async () => {
  const token = sessionStorage.getItem('cnjohnson_access_token');
  if (!token) return; // not logged in

  const isUp = await SYNC.ping();
  if (!isUp) {
    SYNC.showBanner('⚠ Server offline — using local data.', 'warn');
    return;
  }

  SYNC.showBanner('🔄 Syncing data from server…', 'info');
  await SYNC.pullAll();

  // Re-render current section after sync
  setTimeout(() => {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    if (typeof window.showSection === 'function') {
      window.showSection(hash);
    }
  }, 200);
});

/* Online/offline detection */
window.addEventListener('online',  () => { SYNC.online = true;  SYNC.showBanner('🌐 Back online — syncing…', 'success'); SYNC.pullAll(); });
window.addEventListener('offline', () => { SYNC.online = false; SYNC.showBanner('📴 Offline — changes saved locally.', 'warn'); });

/* ── Wait for STATE to be available then init ── */
function waitForState(cb, tries = 0) {
  if (typeof STATE !== 'undefined' && typeof saveState === 'function') {
    cb();
  } else if (tries < 50) {
    setTimeout(() => waitForState(cb, tries + 1), 100);
  } else {
    console.warn('SYNC: STATE never became available.');
  }
}

// Replace the load listener logic
window.addEventListener('load', () => {
  const token = sessionStorage.getItem('cnjohnson_access_token');
  if (!token) return;

  waitForState(async () => {
    const isUp = await SYNC.ping();
    if (!isUp) {
      SYNC.showBanner('⚠ Server offline — using local data.', 'warn');
      return;
    }
    SYNC.showBanner('🔄 Syncing data from server…', 'info');
    await SYNC.pullAll();
    setTimeout(() => {
      const hash = window.location.hash.replace('#', '') || 'dashboard';
      if (typeof window.showSection === 'function') window.showSection(hash);
    }, 200);
  });
});