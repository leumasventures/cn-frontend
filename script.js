/* ================================================================
   C.N. Johnson Ventures Ltd — script.js  (DB-First Edition)
   ─────────────────────────────────────────────────────────────────
   STORAGE POLICY:
     localStorage  →  auth tokens ONLY (managed by auth-guard.js)
     In-memory     →  STATE object (ephemeral, re-fetched each page)
     Database      →  single source of truth for ALL business data

   Every read/write for business data goes through API (api_layer.js).
   STATE is never persisted to localStorage or sessionStorage.
   ================================================================ */
'use strict';

/* ════════════════════════════════════════════════════════════════
   1.  IN-MEMORY STATE  (populated from DB on every page load)
   ════════════════════════════════════════════════════════════════ */
const STATE = {
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
    creditNotePrefix: 'CN',
    enableBulkDiscount: true,
    loyaltyPointsRate: 1,
    loyaltyRedemptionRate: 100,
    nextInvoiceNo: 1001,
    nextReceiptNo: 5001,
    nextQuoteNo: 2001,
    nextCreditNoteNo: 4001,
    nextPurchaseNo: 3001,
    repDailyTarget: 200000,
  },
  warehouses: [],
  products: [],
  customers: [],
  suppliers: [],
  salesReps: [],
  sales: [],
  purchases: [],
  expenses: [],
  quotes: [],
  creditNotes: [],
  bulkDiscountTiers: [],
  stockTransfers: [],
  priceHistory: [],   // client-side audit log only (not persisted)
};

// NOTE: window.STATE is intentionally NOT exposed.
// If you need to debug in DevTools, temporarily set window._debug_STATE = STATE
// inside loadAllData() and remove it before going to production.

/* ════════════════════════════════════════════════════════════════
   2.  UTILITIES
   ════════════════════════════════════════════════════════════════ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const sym   = () => STATE.settings.currency || '₦';
const fmt   = n  => sym() + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum= n  => Number(n || 0).toLocaleString('en-NG');
const uid   = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().split('T')[0];
const nowISO= () => new Date().toISOString();
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtPct  = n  => Number(n || 0).toFixed(1) + '%';
const el = id => document.getElementById(id);

function totalStock(product) {
  return Object.values(product.stock || {}).reduce((a, b) => a + b, 0);
}
function getWarehouseName(id) {
  return STATE.warehouses.find(x => x.id === id)?.name || id;
}

/* ── Number generators — always update DB counter after use ── */
function nextNo(field, prefix) {
  const n = STATE.settings[field]++;
  API.updateSettings({ [field]: STATE.settings[field] }).catch(() => {});
  return `${STATE.settings[prefix]}-${String(n).padStart(5, '0')}`;
}
const nextReceiptNo    = () => nextNo('nextReceiptNo',    'receiptPrefix');
const nextInvoiceNo    = () => nextNo('nextInvoiceNo',    'invoicePrefix');
const nextQuoteNo      = () => nextNo('nextQuoteNo',      'quotePrefix');
const nextCreditNoteNo = () => nextNo('nextCreditNoteNo', 'creditNotePrefix');
const nextPurchaseNo   = () => nextNo('nextPurchaseNo',   'receiptPrefix');

/* ── Bulk discount helpers ── */
function getBulkDiscount(productId, qty) {
  if (!STATE.settings.enableBulkDiscount) return 0;
  const hits = STATE.bulkDiscountTiers
    .filter(t => t.active && qty >= t.minQty && qty <= (t.maxQty ?? 99999) &&
      (!t.productIds?.length || t.productIds.includes(productId)))
    .sort((a, b) => b.discountPct - a.discountPct);
  return hits[0]?.discountPct || 0;
}
function getNextBulkTier(productId, qty) {
  if (!STATE.settings.enableBulkDiscount) return null;
  return STATE.bulkDiscountTiers
    .filter(t => t.active && t.minQty > qty &&
      (!t.productIds?.length || t.productIds.includes(productId)))
    .sort((a, b) => a.minQty - b.minQty)[0] || null;
}

/* ── Loading overlay ── */
function showLoading(msg = 'Loading…') {
  let ov = document.getElementById('db-loading');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'db-loading';
    ov.style.cssText = `position:fixed;inset:0;background:rgba(255,255,255,.88);z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;
      font-size:1rem;color:#1e40af;font-weight:600;backdrop-filter:blur(3px);`;
    ov.innerHTML = `<div style="width:40px;height:40px;border:4px solid #bfdbfe;
      border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite;"></div>
      <div id="db-loading-msg">${msg}</div>`;
    document.body.appendChild(ov);
  } else {
    document.getElementById('db-loading-msg').textContent = msg;
  }
}
function hideLoading() { document.getElementById('db-loading')?.remove(); }

/* ── Toast ── */
function toast(msg, type = 'info') {
  let wrap = $('#toast-wrap');
  if (!wrap) {
    wrap = Object.assign(document.createElement('div'), { id: 'toast-wrap' });
    wrap.style.cssText = 'position:fixed;top:1.2rem;right:1.2rem;z-index:99999;display:flex;flex-direction:column;gap:.5rem;';
    document.body.append(wrap);
  }
  const colors = { info: '#2563eb', success: '#16a34a', warn: '#d97706', error: '#dc2626' };
  const t = document.createElement('div');
  t.style.cssText = `padding:.75rem 1.25rem;border-radius:8px;color:#fff;font-size:.875rem;font-weight:500;
    background:${colors[type] || colors.info};box-shadow:0 4px 20px rgba(0,0,0,.2);
    opacity:0;transform:translateX(1rem);transition:all .3s;max-width:360px;`;
  t.textContent = msg;
  wrap.append(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'none'; });
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(1rem)'; setTimeout(() => t.remove(), 320); }, 4200);
}

function confirm2(msg) { return window.confirm(msg); }

/* ── Modal ── */
function modal(title, bodyHTML, onSave, saveLabel = 'Save', width = '580px') {
  $('#app-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'app-modal';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;
    display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:2rem;width:min(${width},95vw);
      max-height:90vh;overflow-y:auto;box-shadow:0 25px 80px rgba(0,0,0,.3);animation:modalIn .25s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h3 style="margin:0;font-size:1.25rem;color:#1f2937;">${title}</h3>
        <button id="modal-x" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6b7280;padding:.2rem .5rem;">×</button>
      </div>
      <div id="modal-body">${bodyHTML}</div>
      <div style="display:flex;gap:.75rem;justify-content:flex-end;margin-top:1.75rem;padding-top:1rem;border-top:1px solid #e5e7eb;">
        <button id="modal-cancel" style="background:#f3f4f6;color:#374151;border:none;">Cancel</button>
        ${onSave ? `<button id="modal-save">${saveLabel}</button>` : ''}
      </div>
    </div>`;
  document.body.append(overlay);
  const close = () => overlay.remove();
  $('#modal-x', overlay).onclick = close;
  $('#modal-cancel', overlay).onclick = close;
  overlay.onclick = e => { if (e.target === overlay) close(); };
  if (onSave) {
    const btn = $('#modal-save', overlay);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Saving…';
      try { await onSave(overlay, close); }
      catch (err) { console.error('[Modal]', err); toast('Save failed: ' + err.message, 'error'); }
      finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = saveLabel; } }
    };
  }
}

/* ════════════════════════════════════════════════════════════════
   3.  DATA LOADING — maps DB shapes to STATE
       All data comes from the API. STATE is rebuilt on each load.
   ════════════════════════════════════════════════════════════════ */

const mapWarehouse = s => ({
  id: s.id, name: s.name || '',
  location: s.location || '', manager: s.manager || '',
  description: s.description || '',
});

const mapProduct = s => {
  const flatStock = parseInt(s.stock) || 0;
  const stock = {};
  if (STATE.warehouses.length) {
    STATE.warehouses.forEach((w, i) => { stock[w.id] = i === 0 ? flatStock : 0; });
  } else {
    stock['__default__'] = flatStock;
  }
  return {
    id: s.id, name: s.name || '', sku: s.sku || '',
    barcode: s.barcode || '', description: s.description || '',
    sellingPrice: parseFloat(s.price) || 0,
    costPrice: parseFloat(s.costPrice) || 0,
    unit: s.unit || '', active: s.active !== false,
    reorderLevel: parseInt(s.lowStockThreshold) || 10,
    category: s.category?.name || s.category || '',
    categoryId: s.categoryId || null,
    supplierId: s.supplierId || '',
    warehouseId: s.warehouseId || '',
    stock,
  };
};

const mapCustomer = s => ({
  id: s.id, name: s.name || '',
  email: s.email || '', phone: s.phone || '', address: s.address || '',
  customerType: s.customerType || 'retail',
  creditLimit: parseFloat(s.creditLimit) || 0,
  loyaltyPoints: parseInt(s.loyaltyPoints) || 0,
  balance: parseFloat(s.balance) || 0,
  totalPurchases: parseFloat(s.totalPurchases) || 0,
  notes: s.notes || '',
});

const mapSupplier = s => ({
  id: s.id, name: s.name || '',
  email: s.email || '', phone: s.phone || '', address: s.address || '',
  contactPerson: s.contactPerson || '',
  notes: s.notes || '',
  balance: parseFloat(s.balance) || 0,
});

const mapSalesRep = s => ({
  id: s.id, name: s.name || '',
  email: s.email || '', phone: s.phone || '',
  warehouseId: s.warehouseId || '',
  commission: parseFloat(s.commission) || 2,
  totalSales: parseFloat(s.totalSales) || 0,
  active: s.active !== false,
});

const mapSaleItem = i => ({
  productId: i.productId,
  name: i.product?.name || i.name || '',
  unit: i.product?.unit || i.unit || '',
  qty: parseInt(i.qty) || 0,
  unitPrice: parseFloat(i.price) || 0,
  costPrice: parseFloat(i.product?.costPrice || i.costPrice) || 0,
  discount: parseFloat(i.discount) || 0,
  lineDiscount: parseFloat(i.discount) || 0,
  total: parseFloat(i.total) || 0,
  bulkDiscountPct: 0, manualDiscountPct: 0, effectiveDiscountPct: 0,
});

const mapSale = s => ({
  id: s.id,
  receiptNo: s.receiptNo || null,
  invoiceNo: s.invoiceNo || null,
  customerId: s.customerId || '',
  customerName: s.customer?.name || 'Walk-in',
  repId: s.repId || '',
  repName: '',
  warehouseId: s.warehouseId || '',
  items: (s.items || []).map(mapSaleItem),
  subtotal: parseFloat(s.subtotal) || 0,
  totalDiscountAmt: parseFloat(s.discount) || 0,
  taxAmt: parseFloat(s.tax) || 0,
  total: parseFloat(s.total) || 0,
  paymentMethod: (s.paymentMethod || 'cash').toLowerCase(),
  paymentStatus: s.paymentStatus || 'paid',
  redeemPts: parseInt(s.pointsRedeemed) || 0,
  redeemVal: 0,
  date: s.createdAt || nowISO(),
  notes: s.note || '',
  type: s.type || undefined,
});

const mapPurchase = s => ({
  id: s.id,
  invoiceNo: s.purchaseNo || '',
  supplierId: s.supplierId || '',
  supplierName: s.supplier?.name || '',
  warehouseId: s.warehouseId || '',
  warehouseName: s.warehouse?.name || '',
  items: (s.items || []).map(i => ({
    productId: i.productId,
    name: i.product?.name || '',
    unit: i.product?.unit || '',
    qty: parseInt(i.qty) || 0,
    cost: parseFloat(i.costPrice) || 0,
  })),
  grandTotal: parseFloat(s.total) || 0,
  paidAmt: parseFloat(s.paidAmount) || 0,
  owed: Math.max(0, (parseFloat(s.total) || 0) - (parseFloat(s.paidAmount) || 0)),
  paymentStatus: (parseFloat(s.paidAmount) || 0) >= (parseFloat(s.total) || 0) ? 'paid'
    : (parseFloat(s.paidAmount) || 0) > 0 ? 'partial' : 'credit',
  notes: s.note || s.notes || '',
  date: s.createdAt || nowISO(),
});

const mapExpense = s => ({
  id: s.id,
  category: s.category || '',
  description: s.description || s.title || '',
  title: s.title || s.description || '',
  amount: parseFloat(s.amount) || 0,
  paidBy: s.paidBy || '',
  date: s.date || s.createdAt || nowISO(),
  notes: s.note || '',
});

const mapQuote = s => ({
  id: s.id,
  quoteNo: s.quoteNo || '',
  customerId: s.customerId || '',
  customerName: s.customer?.name || 'Walk-in',
  items: (s.items || []).map(i => ({
    productId: i.productId,
    name: i.product?.name || '',
    unit: i.product?.unit || '',
    qty: parseInt(i.qty) || 0,
    unitPrice: parseFloat(i.price) || 0,
    discount: parseFloat(i.discount) || 0,
    effectiveDiscountPct: parseFloat(i.discount) || 0,
    total: parseFloat(i.total) || 0,
  })),
  subtotal: parseFloat(s.subtotal) || 0,
  extraDiscPct: parseFloat(s.discount) || 0,
  taxAmt: parseFloat(s.tax) || 0,
  total: parseFloat(s.total) || 0,
  validDays: s.validUntil
    ? Math.ceil((new Date(s.validUntil) - new Date(s.createdAt)) / 86400000)
    : 7,
  status: (s.status || 'PENDING').toLowerCase(),
  date: s.createdAt || nowISO(),
  notes: s.note || '',
});

const mapCreditNote = s => ({
  id: s.id,
  creditNoteNo: s.creditNo || '',
  originalInvoiceNo: s.sale?.invoiceNo || s.saleId || '',
  customerId: s.customerId || '',
  customerName: s.customer?.name || '',
  amount: parseFloat(s.amount) || 0,
  reason: s.reason || '',
  notes: '',
  date: s.createdAt || nowISO(),
  status: 'issued',
});

const mapDiscountTier = s => ({
  id: s.id,
  name: s.name || '',
  discountPct: parseFloat(s.discountPct) || 0,
  minQty: parseInt(s.minQty) || 0,
  maxQty: s.maxQty != null ? parseInt(s.maxQty) : 99999,
  productIds: s.productIds || [],
  active: Boolean(s.active),
});

const mapSettings = s => {
  if (!s) return {};
  const map = {
    companyName: s.companyName, address: s.address, phone: s.phone,
    email: s.email, currency: s.currency, taxRate: s.taxRate,
    lowStockThreshold: s.lowStockThreshold,
    invoicePrefix: s.invoicePrefix, receiptPrefix: s.receiptPrefix,
    quotePrefix: s.quotePrefix, creditNotePrefix: s.creditNotePrefix,
    enableBulkDiscount: s.enableBulkDiscount,
    loyaltyPointsRate: s.loyaltyPointsRate,
    loyaltyRedemptionRate: s.loyaltyRedemptionRate,
    nextInvoiceNo: s.nextInvoiceNo, nextReceiptNo: s.nextReceiptNo,
    nextQuoteNo: s.nextQuoteNo, nextCreditNoteNo: s.nextCreditNoteNo,
    nextPurchaseNo: s.nextPurchaseNo,
  };
  const out = {};
  Object.entries(map).forEach(([k, v]) => { if (v !== undefined && v !== null) out[k] = v; });
  return out;
};

/* ── Extract array from various server response shapes ── */
function arr(data, ...keys) {
  for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
  if (Array.isArray(data)) return data;
  return null;
}

/* ── Sync status pill ── */
function setSyncStatus(state) {
  let dot = document.getElementById('sync-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'sync-dot';
    dot.style.cssText = `position:fixed;top:.65rem;left:50%;transform:translateX(-50%);
      z-index:99997;border-radius:20px;padding:.28rem .85rem;font-size:.73rem;font-weight:700;
      display:flex;align-items:center;gap:.4rem;pointer-events:none;transition:opacity .4s;`;
    document.body.appendChild(dot);
  }
  const cfg = {
    syncing: { bg: '#2563eb', fg: '#fff',    ic: '⟳', lb: 'Syncing…'     },
    ok:      { bg: '#d1fae5', fg: '#065f46', ic: '✓', lb: 'DB Connected'  },
    error:   { bg: '#fee2e2', fg: '#991b1b', ic: '✕', lb: 'DB Error'      },
  };
  const c = cfg[state] || cfg.error;
  dot.style.background = c.bg; dot.style.color = c.fg; dot.style.opacity = '1';
  dot.innerHTML = `<span>${c.ic}</span><span>${c.lb}</span>`;
  if (state === 'ok') setTimeout(() => { dot.style.opacity = '0'; }, 3000);
}

/* ── Master data loader — fetches everything fresh from the DB ── */
async function loadAllData() {
  setSyncStatus('syncing');
  try {
    let d = null;
    try {
      const raw = await API.fetchAll();
      d = raw?.data?.warehouses  ? raw.data
        : raw?.warehouses        ? raw
        : raw?.data              ? raw.data
        : raw;
    } catch (e) {
      console.warn('[Data] /sync/all unavailable, fetching individually:', e.message);
    }

    const hasBulk = d && (d.warehouses || d.products || d.customers || d.sales);

    if (!hasBulk) {
      const [r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12] = await Promise.allSettled([
        API.getWarehouses(), API.getProducts(), API.getCustomers(),
        API.getSuppliers(),  API.getSalesReps(), API.getSales(),
        API.getPurchases(),  API.getExpenses(),  API.getQuotes(),
        API.getCreditNotes(), API.getDiscountTiers(), API.getSettings(),
      ]);
      const v = r => r.status === 'fulfilled' ? r.value : null;
      d = {
        warehouses:       arr(v(r1),  'warehouses')   || v(r1)  || [],
        products:         arr(v(r2),  'products')     || v(r2)  || [],
        customers:        arr(v(r3),  'customers')    || v(r3)  || [],
        suppliers:        arr(v(r4),  'suppliers')    || v(r4)  || [],
        salesReps:        arr(v(r5),  'salesReps','sales_reps') || v(r5) || [],
        sales:            arr(v(r6),  'sales')        || v(r6)  || [],
        purchases:        arr(v(r7),  'purchases')    || v(r7)  || [],
        expenses:         arr(v(r8),  'expenses')     || v(r8)  || [],
        quotes:           arr(v(r9),  'quotes')       || v(r9)  || [],
        creditNotes:      arr(v(r10), 'creditNotes')  || v(r10) || [],
        bulkDiscountTiers:arr(v(r11), 'bulkDiscountTiers','discountTiers','tiers') || v(r11) || [],
        settings:         v(r12)?.settings || v(r12)  || null,
      };
    }

    // Warehouses must be mapped first (products depend on warehouse list)
    const whs = arr(d, 'warehouses');
    if (whs) STATE.warehouses = whs.map(mapWarehouse);

    const prods = arr(d, 'products');
    if (prods) STATE.products = prods.map(mapProduct);

    const custs = arr(d, 'customers');
    if (custs) STATE.customers = custs.map(mapCustomer);

    const sups = arr(d, 'suppliers');
    if (sups) STATE.suppliers = sups.map(mapSupplier);

    const reps = arr(d, 'salesReps', 'sales_reps', 'reps');
    if (reps) STATE.salesReps = reps.map(mapSalesRep);

    const sales = arr(d, 'sales');
    if (sales) STATE.sales = sales.map(mapSale);

    const purs = arr(d, 'purchases');
    if (purs) STATE.purchases = purs.map(mapPurchase);

    const exps = arr(d, 'expenses');
    if (exps) STATE.expenses = exps.map(mapExpense);

    const qts = arr(d, 'quotes');
    if (qts) STATE.quotes = qts.map(mapQuote);

    const cns = arr(d, 'creditNotes', 'credit_notes');
    if (cns) STATE.creditNotes = cns.map(mapCreditNote);

    const tiers = arr(d, 'bulkDiscountTiers', 'discountTiers', 'tiers', 'discount_tiers');
    if (tiers) STATE.bulkDiscountTiers = tiers.map(mapDiscountTier);

    const sett = d.settings || (d.id === 'global' ? d : null);
    if (sett) STATE.settings = { ...STATE.settings, ...mapSettings(sett) };

    setSyncStatus('ok');
  } catch (err) {
    console.error('[Data] loadAllData failed:', err);
    setSyncStatus('error');
    toast('Could not load data: ' + err.message, 'error');
  }
}

async function refreshSection(id) {
  await loadAllData();
  renderSection(id);
}

/* ════════════════════════════════════════════════════════════════
   4.  NAVIGATION
   ════════════════════════════════════════════════════════════════ */
const RENDERS = {};

async function showSection(id) {
  $$('section').forEach(s => s.classList.remove('active'));
  $$('.sidebar a').forEach(a => a.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  $(`.sidebar a[href="#${id}"]`)?.classList.add('active');
  await loadAllData();
  renderSection(id);
}

function renderSection(id) {
  RENDERS[id]?.();
}

/* ════════════════════════════════════════════════════════════════
   5.  DASHBOARD
   ════════════════════════════════════════════════════════════════ */
function renderDashboard() {
  if (!el('todaySales')) return;
  const tStr = today();
  const todaySales = STATE.sales.filter(s => s.date?.startsWith(tStr)).reduce((a, s) => a + s.total, 0);
  const lowStock   = STATE.products.filter(p => totalStock(p) <= (p.reorderLevel || STATE.settings.lowStockThreshold));
  const receivables= STATE.customers.reduce((a, c) => a + (c.balance || 0), 0);
  const mth        = new Date().toISOString().slice(0, 7);
  const monthRev   = STATE.sales.filter(s => s.date?.startsWith(mth)).reduce((a, s) => a + s.total, 0);
  const invValue   = STATE.products.reduce((a, p) => a + totalStock(p) * p.costPrice, 0);
  const payables   = STATE.suppliers.reduce((a, s) => a + (s.balance || 0), 0);
  const todayExp   = STATE.expenses.filter(e => (e.date || '').startsWith(tStr)).reduce((a, e) => a + e.amount, 0);
  const pendQ      = STATE.quotes.filter(q => q.status === 'pending').length;

  el('todaySales').textContent    = fmtNum(todaySales.toFixed(2));
  el('lowStockCount').textContent = lowStock.length;
  el('customerCount').textContent = STATE.customers.length;
  el('totalDebt').textContent     = fmtNum(receivables.toFixed(2));

  const ext = $('#dashboard-extended');
  if (!ext) return;
  ext.innerHTML = `
    <div class="stats-grid" style="margin-top:1.5rem;">
      <div class="stat-card" style="border-left:5px solid #8b5cf6;"><h3>Monthly Revenue</h3>
        <div class="value">${fmt(monthRev)}</div>
        <div style="font-size:.8rem;color:#64748b;">${new Date().toLocaleString('en-NG',{month:'long',year:'numeric'})}</div>
      </div>
      <div class="stat-card" style="border-left:5px solid #06b6d4;"><h3>Inventory Value</h3>
        <div class="value">${fmt(invValue)}</div>
        <div style="font-size:.8rem;color:#64748b;">${STATE.products.length} products</div>
      </div>
      <div class="stat-card" style="border-left:5px solid #f43f5e;"><h3>Supplier Payables</h3>
        <div class="value">${fmt(payables)}</div>
        <div style="font-size:.8rem;color:#64748b;">${STATE.suppliers.filter(s=>s.balance>0).length} outstanding</div>
      </div>
      <div class="stat-card" style="border-left:5px solid #10b981;"><h3>All-Time Sales</h3>
        <div class="value">${fmt(STATE.sales.reduce((a,s)=>a+s.total,0))}</div>
        <div style="font-size:.8rem;color:#64748b;">${STATE.sales.length} transactions</div>
      </div>
      <div class="stat-card" style="border-left:5px solid #f59e0b;"><h3>Today's Expenses</h3>
        <div class="value">${fmt(todayExp)}</div>
        <div style="font-size:.8rem;color:#64748b;">Net: ${fmt(todaySales - todayExp)}</div>
      </div>
      <div class="stat-card" style="border-left:5px solid #0891b2;"><h3>Pending Quotes</h3>
        <div class="value">${pendQ}</div>
        <div style="font-size:.8rem;"><a href="#quotes" onclick="showSection('quotes')" style="color:#0891b2;">View →</a></div>
      </div>
    </div>
    ${lowStock.length ? `
      <div class="card" style="margin-top:1.5rem;border-left:4px solid #f59e0b;">
        <h3 style="color:#92400e;margin-bottom:1rem;">⚠ Low Stock Alerts (${lowStock.length})</h3>
        <table><thead><tr><th>Product</th><th>Stock</th><th>Reorder Level</th><th>Action</th></tr></thead>
        <tbody>${lowStock.map(p=>`<tr>
          <td>${p.name}</td>
          <td style="color:#dc2626;font-weight:700;">${totalStock(p)} ${p.unit}</td>
          <td>${p.reorderLevel || STATE.settings.lowStockThreshold}</td>
          <td><button onclick="showSection('purchases')" style="font-size:.8rem;padding:.3rem .7rem;">Reorder</button></td>
        </tr>`).join('')}</tbody></table>
      </div>` : ''}
    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">Recent Sales</h3>
      ${STATE.sales.length ? `
        <table><thead><tr><th>Receipt/Invoice</th><th>Customer</th><th>Date</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${STATE.sales.slice(-10).reverse().map(s=>`<tr>
          <td style="font-family:monospace;">${s.receiptNo||s.invoiceNo||'—'}</td>
          <td>${s.customerName||'Walk-in'}</td><td>${fmtDate(s.date)}</td>
          <td>${fmt(s.total)}</td>
          <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus||'paid'}</span></td>
        </tr>`).join('')}</tbody></table>` : '<p style="color:#9ca3af;text-align:center;padding:2rem;">No sales yet.</p>'}
    </div>`;
}

/* ════════════════════════════════════════════════════════════════
   6.  WAREHOUSES
   ════════════════════════════════════════════════════════════════ */
function renderWarehouses() {
  const sec = $('#warehouse');
  sec.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Warehouses / Stores</h2>
        <button onclick="openAddWarehouse()">+ Add Warehouse</button>
      </div>
      <div id="wh-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem;"></div>
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">Stock Transfer Between Warehouses</h3>
      ${transferFormHTML()}
    </div>`;
  renderWarehouseGrid();
}

function renderWarehouseGrid() {
  const g = $('#wh-grid'); if (!g) return;
  g.innerHTML = STATE.warehouses.map(w => {
    const whProds = STATE.products.filter(p => (p.stock[w.id] || 0) > 0);
    const val = whProds.reduce((s, p) => s + (p.stock[w.id] || 0) * p.costPrice, 0);
    return `<div class="stat-card" style="border-left:5px solid var(--primary);">
      <div style="display:flex;justify-content:space-between;">
        <h3 style="font-size:1.1rem;">${w.name}</h3>
        <div>
          <button onclick="editWarehouse('${w.id}')" style="font-size:.75rem;padding:.2rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
          <button onclick="deleteWarehouse('${w.id}')" style="font-size:.75rem;padding:.2rem .6rem;background:#dc2626;">Del</button>
        </div>
      </div>
      <p style="color:#64748b;font-size:.85rem;margin:.3rem 0;">📍 ${w.location} &nbsp;|&nbsp; 👤 ${w.manager}</p>
      <div class="value" style="font-size:1.5rem;">${fmt(val)}</div>
      <p style="font-size:.8rem;color:#64748b;">${whProds.length} product lines in stock</p>
    </div>`;
  }).join('') || '<p style="color:#9ca3af;">No warehouses yet.</p>';
}

function transferFormHTML() {
  const po = STATE.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const wo = STATE.warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  return `
    <div class="form-grid">
      <div><label>Product</label><select id="tf-product" style="width:100%;">${po}</select></div>
      <div><label>From Warehouse</label><select id="tf-from" style="width:100%;">${wo}</select></div>
      <div><label>To Warehouse</label><select id="tf-to" style="width:100%;">${wo}</select></div>
      <div><label>Quantity</label><input id="tf-qty" type="number" min="1" style="width:100%;"></div>
      <div><label>Note</label><input id="tf-note" style="width:100%;"></div>
    </div>
    <button onclick="doTransfer()">Transfer Stock</button>`;
}

async function doTransfer() {
  const productId = $('#tf-product').value;
  const fromWarehouseId = $('#tf-from').value;
  const toWarehouseId   = $('#tf-to').value;
  const qty  = parseInt($('#tf-qty').value);
  const note = $('#tf-note').value.trim();
  if (!productId || !fromWarehouseId || !toWarehouseId || !qty) return toast('Fill all fields.', 'warn');
  if (fromWarehouseId === toWarehouseId) return toast('From and To must differ.', 'warn');
  const product = STATE.products.find(p => p.id === productId);
  if (!product) return;
  if (qty > (product.stock[fromWarehouseId] || 0)) return toast(`Only ${product.stock[fromWarehouseId]||0} available.`, 'error');
  try {
    await API.createTransfer({ productId, fromWarehouseId, toWarehouseId, qty, note });
    toast('Stock transferred.', 'success');
    await refreshSection('warehouse');
  } catch (e) { toast(e.message, 'error'); }
}

function openAddWarehouse() {
  modal('Add Warehouse', `
    <div class="form-grid">
      <div><label>Name *</label><input id="wh-name" style="width:100%;"></div>
      <div><label>Location</label><input id="wh-location" style="width:100%;"></div>
      <div><label>Manager</label><input id="wh-manager" style="width:100%;"></div>
    </div>`, async (overlay, close) => {
    const name = $('#wh-name', overlay).value.trim();
    if (!name) return toast('Name required.', 'warn');
    await API.createWarehouse({
      name,
      location: $('#wh-location', overlay).value.trim() || null,
      manager:  $('#wh-manager',  overlay).value.trim() || null,
    });
    close(); await refreshSection('warehouse'); toast('Warehouse added.', 'success');
  });
}

function editWarehouse(id) {
  const w = STATE.warehouses.find(x => x.id === id); if (!w) return;
  modal('Edit Warehouse', `
    <div class="form-grid">
      <div><label>Name</label><input id="wh-name" style="width:100%;" value="${w.name}"></div>
      <div><label>Location</label><input id="wh-location" style="width:100%;" value="${w.location}"></div>
      <div><label>Manager</label><input id="wh-manager" style="width:100%;" value="${w.manager}"></div>
    </div>`, async (overlay, close) => {
    await API.updateWarehouse(id, {
      name:     $('#wh-name',     overlay).value.trim() || w.name,
      location: $('#wh-location', overlay).value.trim() || null,
      manager:  $('#wh-manager',  overlay).value.trim() || null,
    });
    close(); await refreshSection('warehouse'); toast('Updated.', 'success');
  });
}

async function deleteWarehouse(id) {
  if (!confirm2('Delete warehouse?')) return;
  await API.deleteWarehouse(id);
  await refreshSection('warehouse'); toast('Deleted.', 'warn');
}

/* ════════════════════════════════════════════════════════════════
   7.  PRODUCTS
   ════════════════════════════════════════════════════════════════ */
function renderProducts() {
  const cats = [...new Set(STATE.products.map(p => p.category).filter(Boolean))];
  $('#products').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Products & Inventory</h2>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          <input id="prod-search" type="search" placeholder="Search…" style="width:200px;">
          <select id="prod-cat-filter" style="width:160px;">
            <option value="">All Categories</option>
            ${cats.map(c=>`<option>${c}</option>`).join('')}
          </select>
          <button onclick="openAddProduct()">+ Add Product</button>
          <button onclick="exportProductsXLSX()" style="background:#16a34a;">⬇ Export</button>
        </div>
      </div>
      <div id="products-table-wrap"></div>
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <h3>Price Change History</h3>
      <div id="price-history-wrap" style="margin-top:1rem;"></div>
    </div>`;
  $('#prod-search').oninput = renderProductsTable;
  $('#prod-cat-filter').onchange = renderProductsTable;
  renderProductsTable();
  renderPriceHistory();
}

function renderProductsTable() {
  const search = ($('#prod-search')?.value || '').toLowerCase();
  const cat    = $('#prod-cat-filter')?.value || '';
  const low    = STATE.settings.lowStockThreshold;
  const list   = STATE.products.filter(p =>
    (!cat || p.category === cat) &&
    (!search || p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search))
  );
  const wrap = $('#products-table-wrap'); if (!wrap) return;
  if (!list.length) { wrap.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:2rem;">No products found.</p>'; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>Unit</th><th>Cost</th><th>Price</th><th>Margin</th><th>Stock</th><th>Value</th><th>Actions</th></tr></thead>
      <tbody>${list.map(p => {
        const stk = totalStock(p), val = stk * p.costPrice;
        const isLow = stk <= (p.reorderLevel || low);
        const margin = p.sellingPrice > 0 ? ((p.sellingPrice - p.costPrice) / p.sellingPrice * 100) : 0;
        return `<tr style="${isLow ? 'background:#fef9c3;' : ''}">
          <td style="font-family:monospace;">${p.sku}</td>
          <td><strong>${p.name}</strong>${p.barcode ? `<br><small style="color:#9ca3af;">🔢 ${p.barcode}</small>` : ''}</td>
          <td><span class="badge badge-blue">${p.category || '—'}</span></td>
          <td>${p.unit}</td>
          <td>${fmt(p.costPrice)}</td><td>${fmt(p.sellingPrice)}</td>
          <td style="color:${margin>=20?'#16a34a':margin>=10?'#d97706':'#dc2626'};font-weight:600;">${fmtPct(margin)}</td>
          <td style="font-weight:700;color:${isLow?'#dc2626':'#16a34a'};">
            ${fmtNum(stk)} ${p.unit} ${isLow ? '⚠' : ''}
            <div style="font-size:.75rem;color:#64748b;">
              ${STATE.warehouses.map(w=>`${w.name.split('–')[0].trim()}: ${p.stock[w.id]||0}`).join(' | ')}
            </div>
          </td>
          <td>${fmt(val)}</td>
          <td style="white-space:nowrap;">
            <button onclick="editProduct('${p.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
            <button onclick="adjustStock('${p.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Stock</button>
            <button onclick="deleteProduct('${p.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr>
        <td colspan="8" style="font-weight:700;text-align:right;">Total Inventory Value:</td>
        <td style="font-weight:700;">${fmt(list.reduce((s,p)=>s+totalStock(p)*p.costPrice,0))}</td><td></td>
      </tr></tfoot>
    </table>`;
}

function renderPriceHistory() {
  const wrap = $('#price-history-wrap'); if (!wrap) return;
  if (!STATE.priceHistory.length) { wrap.innerHTML = '<p style="color:#9ca3af;">No price changes recorded yet.</p>'; return; }
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Product</th><th>Old Cost</th><th>New Cost</th><th>Old Price</th><th>New Price</th><th>By</th></tr></thead>
    <tbody>${STATE.priceHistory.slice(-30).reverse().map(h=>`
      <tr><td>${fmtDate(h.date)}</td><td>${h.productName}</td>
        <td>${fmt(h.oldCost)}</td><td>${fmt(h.newCost)}</td>
        <td>${fmt(h.oldSell)}</td><td>${fmt(h.newSell)}</td>
        <td>${h.changedBy||'User'}</td></tr>`).join('')}
    </tbody></table>`;
}

function productFormHTML(p = {}) {
  const cats = [...new Set(STATE.products.map(x => x.category).filter(Boolean))];
  const supOpts = STATE.suppliers.map(s => `<option value="${s.id}" ${p.supplierId===s.id?'selected':''}>${s.name}</option>`).join('');
  const whOpts  = STATE.warehouses.map(w => `<option value="${w.id}" ${p.warehouseId===w.id?'selected':''}>${w.name}</option>`).join('');
  const whFields= STATE.warehouses.map(w => `
    <div><label>Stock in ${w.name}</label>
      <input type="number" id="ps-${w.id}" style="width:100%;" min="0" value="${p.stock?.[w.id]??0}">
    </div>`).join('');
  return `
    <div class="form-grid">
      <div><label>Name *</label><input id="pf-name" style="width:100%;" value="${p.name||''}"></div>
      <div><label>SKU</label><input id="pf-sku" style="width:100%;" value="${p.sku||''}"></div>
      <div><label>Barcode</label><input id="pf-barcode" style="width:100%;" value="${p.barcode||''}"></div>
      <div><label>Category</label>
        <input id="pf-cat" style="width:100%;" list="cat-dl" value="${p.category||''}">
        <datalist id="cat-dl">${cats.map(c=>`<option>${c}</option>`).join('')}</datalist>
      </div>
      <div><label>Unit</label><input id="pf-unit" style="width:100%;" value="${p.unit||''}"></div>
      <div><label>Cost Price (₦)</label><input id="pf-cost" type="number" style="width:100%;" value="${p.costPrice||''}"></div>
      <div><label>Selling Price (₦) *</label><input id="pf-sell" type="number" style="width:100%;" value="${p.sellingPrice||''}"></div>
      <div><label>Reorder Level</label><input id="pf-reorder" type="number" style="width:100%;" value="${p.reorderLevel||10}"></div>
      <div><label>Supplier</label><select id="pf-sup" style="width:100%;"><option value="">None</option>${supOpts}</select></div>
      <div><label>Primary Warehouse</label><select id="pf-wh" style="width:100%;"><option value="">None</option>${whOpts}</select></div>
      <div style="grid-column:1/-1;"><label>Description</label><input id="pf-desc" style="width:100%;" value="${p.description||''}"></div>
      <div style="grid-column:1/-1;"><strong>Stock by Warehouse</strong></div>
      ${whFields}
    </div>`;
}

function openAddProduct() {
  modal('Add Product', productFormHTML(), async (overlay, close) => {
    const name  = $('#pf-name', overlay).value.trim();
    const price = parseFloat($('#pf-sell', overlay).value);
    if (!name)      return toast('Name required.', 'warn');
    if (isNaN(price)) return toast('Selling price required.', 'warn');

    let totalStockQty = 0;
    STATE.warehouses.forEach(w => {
      totalStockQty += parseInt($(`#ps-${w.id}`, overlay).value) || 0;
    });

    await API.createProduct({
      name,
      sku:              $('#pf-sku',     overlay).value.trim() || null,
      barcode:          $('#pf-barcode', overlay).value.trim() || null,
      description:      $('#pf-desc',   overlay).value.trim() || null,
      price,
      costPrice:        parseFloat($('#pf-cost',    overlay).value) || 0,
      stock:            totalStockQty,
      lowStockThreshold:parseInt($('#pf-reorder', overlay).value) || 10,
      unit:             $('#pf-unit', overlay).value.trim() || null,
      supplierId:       $('#pf-sup',  overlay).value || null,
      warehouseId:      $('#pf-wh',   overlay).value || null,
      category:         $('#pf-cat',  overlay).value.trim() || null,
    });
    close(); await refreshSection('products'); toast('Product added.', 'success');
  });
}

function editProduct(id) {
  const p = STATE.products.find(x => x.id === id); if (!p) return;
  modal(`Edit – ${p.name}`, productFormHTML(p), async (overlay, close) => {
    const oldCost = p.costPrice, oldSell = p.sellingPrice;
    const newCost = parseFloat($('#pf-cost', overlay).value) || p.costPrice;
    const newSell = parseFloat($('#pf-sell', overlay).value) || p.sellingPrice;

    let totalStockQty = 0;
    STATE.warehouses.forEach(w => { totalStockQty += parseInt($(`#ps-${w.id}`, overlay).value) || 0; });

    await API.updateProduct(id, {
      name:             $('#pf-name',    overlay).value.trim() || p.name,
      sku:              $('#pf-sku',     overlay).value.trim() || null,
      barcode:          $('#pf-barcode', overlay).value.trim() || null,
      description:      $('#pf-desc',   overlay).value.trim() || null,
      price:            newSell,
      costPrice:        newCost,
      stock:            totalStockQty,
      lowStockThreshold:parseInt($('#pf-reorder', overlay).value) || p.reorderLevel,
      unit:             $('#pf-unit', overlay).value.trim() || null,
      supplierId:       $('#pf-sup',  overlay).value || null,
      warehouseId:      $('#pf-wh',   overlay).value || null,
      category:         $('#pf-cat',  overlay).value.trim() || null,
    });

    if (oldCost !== newCost || oldSell !== newSell) {
      STATE.priceHistory.push({ date: nowISO(), productId: id, productName: p.name,
        oldCost, newCost, oldSell, newSell, changedBy: 'User' });
    }
    close(); await refreshSection('products'); toast('Product updated.', 'success');
  });
}

function adjustStock(id) {
  const p = STATE.products.find(x => x.id === id); if (!p) return;
  const whOpts = STATE.warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
  modal(`Adjust Stock – ${p.name}`, `
    <div class="form-grid">
      <div><label>Warehouse</label><select id="adj-wh" style="width:100%;">${whOpts}</select></div>
      <div><label>Type</label>
        <select id="adj-type" style="width:100%;">
          <option value="add">Add</option>
          <option value="sub">Subtract</option>
          <option value="set">Set Exact</option>
        </select></div>
      <div><label>Quantity</label><input id="adj-qty" type="number" min="0" style="width:100%;"></div>
      <div><label>Reason</label><input id="adj-reason" style="width:100%;"></div>
    </div>
    <p style="margin-top:.5rem;color:#64748b;font-size:.875rem;">
      Current total: <strong>${totalStock(p)} ${p.unit}</strong>
    </p>`, async (overlay, close) => {
    const qty = parseFloat($('#adj-qty', overlay).value);
    if (isNaN(qty) || qty < 0) return toast('Enter a valid quantity.', 'warn');
    await API.adjustStock(id, {
      warehouseId: $('#adj-wh',     overlay).value,
      type:        $('#adj-type',   overlay).value,
      quantity:    qty,
      reason:      $('#adj-reason', overlay).value.trim(),
    });
    close(); await refreshSection('products'); toast('Stock adjusted.', 'success');
  });
}

async function deleteProduct(id) {
  if (!confirm2('Delete this product permanently?')) return;
  await API.deleteProduct(id);
  await refreshSection('products'); toast('Deleted.', 'warn');
}

function exportProductsXLSX() {
  const rows = STATE.products.map(p => ({
    SKU: p.sku, Name: p.name, Category: p.category, Unit: p.unit,
    'Cost Price': p.costPrice, 'Selling Price': p.sellingPrice,
    'Margin %': p.sellingPrice > 0 ? ((p.sellingPrice-p.costPrice)/p.sellingPrice*100).toFixed(1) : 0,
    'Total Stock': totalStock(p), 'Inventory Value': totalStock(p)*p.costPrice,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Products');
  XLSX.writeFile(wb, 'cnjohnson_products.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   8.  BULK DISCOUNT TIERS
   ════════════════════════════════════════════════════════════════ */
function renderBulkDiscounts() {
  const sec = $('#bulk-discounts'); if (!sec) return;
  sec.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0;">Bulk Quantity Discount Tiers</h2>
          <p style="color:#64748b;font-size:.875rem;margin:.3rem 0 0;">Auto-applied at POS based on item quantity.</p>
        </div>
        <div style="display:flex;gap:.75rem;align-items:center;">
          <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;">
            <input type="checkbox" ${STATE.settings.enableBulkDiscount?'checked':''} onchange="toggleBulkDiscounts(this.checked)">
            Enable Bulk Discounts
          </label>
          <button onclick="openAddDiscountTier()">+ Add Tier</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Min Qty</th><th>Max Qty</th><th>Discount %</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${STATE.bulkDiscountTiers.map(t=>`
          <tr>
            <td><strong>${t.name}</strong></td>
            <td>${fmtNum(t.minQty)}</td>
            <td>${(t.maxQty||0)>=99999?'Unlimited':fmtNum(t.maxQty||0)}</td>
            <td><span style="font-size:1.1rem;font-weight:700;color:#2563eb;">${t.discountPct}%</span></td>
            <td><label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
              <input type="checkbox" ${t.active?'checked':''} onchange="toggleDiscountTier('${t.id}',this.checked)"> Active
            </label></td>
            <td style="white-space:nowrap;">
              <button onclick="editDiscountTier('${t.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
              <button onclick="deleteDiscountTier('${t.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function toggleBulkDiscounts(enabled) {
  await API.updateSettings({ enableBulkDiscount: enabled });
  STATE.settings.enableBulkDiscount = enabled;
  toast(`Bulk discounts ${enabled?'enabled':'disabled'}.`, 'info');
}

async function toggleDiscountTier(id, active) {
  await API.updateDiscountTier(id, { active });
  const t = STATE.bulkDiscountTiers.find(x => x.id === id);
  if (t) { t.active = active; renderBulkDiscounts(); }
}

function discountTierFormHTML(t = {}) {
  return `
    <div class="form-grid">
      <div><label>Tier Name *</label><input id="dt-name" style="width:100%;" value="${t.name||''}"></div>
      <div><label>Discount % *</label><input id="dt-pct" type="number" min="0.1" max="99" step="0.5" style="width:100%;" value="${t.discountPct||''}"></div>
      <div><label>Min Quantity *</label><input id="dt-min" type="number" min="1" style="width:100%;" value="${t.minQty||''}"></div>
      <div><label>Max Quantity (0 = unlimited)</label><input id="dt-max" type="number" min="0" style="width:100%;" value="${(t.maxQty||0)>=99999?0:(t.maxQty||0)}"></div>
    </div>`;
}

function openAddDiscountTier() {
  modal('Add Bulk Discount Tier', discountTierFormHTML(), async (overlay, close) => {
    const name = $('#dt-name', overlay).value.trim();
    const pct  = parseFloat($('#dt-pct', overlay).value);
    const min  = parseInt($('#dt-min',  overlay).value);
    const maxR = parseInt($('#dt-max',  overlay).value) || 0;
    if (!name || isNaN(pct) || isNaN(min)) return toast('Fill required fields.', 'warn');
    await API.createDiscountTier({ name, discountPct: pct, minQty: min, maxQty: maxR || null, active: true });
    close(); await refreshSection('bulk-discounts'); toast('Tier added.', 'success');
  });
}

function editDiscountTier(id) {
  const t = STATE.bulkDiscountTiers.find(x => x.id === id); if (!t) return;
  modal(`Edit Tier – ${t.name}`, discountTierFormHTML(t), async (overlay, close) => {
    const maxR = parseInt($('#dt-max', overlay).value) || 0;
    await API.updateDiscountTier(id, {
      name:        $('#dt-name', overlay).value.trim() || t.name,
      discountPct: parseFloat($('#dt-pct', overlay).value) || t.discountPct,
      minQty:      parseInt($('#dt-min', overlay).value) || t.minQty,
      maxQty:      maxR || null,
    });
    close(); await refreshSection('bulk-discounts'); toast('Tier updated.', 'success');
  });
}

async function deleteDiscountTier(id) {
  if (!confirm2('Delete this tier?')) return;
  await API.deleteDiscountTier(id);
  await refreshSection('bulk-discounts'); toast('Deleted.', 'warn');
}

/* ════════════════════════════════════════════════════════════════
   9.  POINT OF SALE
   ════════════════════════════════════════════════════════════════ */
let posCart = [];
let posWarehouse = '';

function renderPOS() {
  if (!posWarehouse && STATE.warehouses.length) posWarehouse = STATE.warehouses[0].id;
  const cOpts = `<option value="">Walk-in Customer</option>` +
    STATE.customers.map(c=>`<option value="${c.id}">${c.name}${c.balance>0?' ⚠('+fmt(c.balance)+' owed)':''}</option>`).join('');
  const rOpts = `<option value="">No Rep</option>` + STATE.salesReps.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  const wOpts = STATE.warehouses.map(w=>`<option value="${w.id}" ${w.id===posWarehouse?'selected':''}>${w.name}</option>`).join('');

  $('#pos').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 420px;gap:1.5rem;align-items:start;">
      <div><div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h2 style="margin:0;">Point of Sale</h2>
          ${STATE.settings.enableBulkDiscount?`<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:.4rem .75rem;font-size:.8rem;color:#1e40af;font-weight:600;">✓ Bulk Discounts Active</div>`:''}
        </div>
        <div class="form-grid" style="margin-bottom:1rem;">
          <div><label>Warehouse</label><select id="pos-wh" style="width:100%;" onchange="posWarehouse=this.value;renderProductPalette();">${wOpts}</select></div>
          <div><label>Customer</label><select id="pos-customer" style="width:100%;" onchange="onPOSCustomerChange()">${cOpts}</select></div>
          <div><label>Sales Rep</label><select id="pos-rep" style="width:100%;">${rOpts}</select></div>
          <div><label>Payment Method</label>
            <select id="pos-payment" style="width:100%;">
              <option value="cash">Cash</option><option value="transfer">Bank Transfer</option>
              <option value="pos-machine">POS Machine</option><option value="credit">Credit (Invoice)</option>
              <option value="cheque">Cheque</option><option value="split">Split Payment</option>
            </select>
          </div>
        </div>
        <div id="pos-loyalty-banner" style="display:none;background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.875rem;"></div>
        <input id="pos-prod-search" type="search" placeholder="Search or scan barcode…" style="width:100%;margin-bottom:1rem;" oninput="renderProductPalette();">
        <div id="pos-product-palette" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem;max-height:360px;overflow-y:auto;"></div>
      </div></div>

      <div class="card" style="position:sticky;top:1rem;">
        <h3 style="margin-bottom:1rem;">🛒 Cart</h3>
        <div id="pos-cart-items" style="max-height:340px;overflow-y:auto;"></div>
        <div id="pos-bulk-savings" style="display:none;background:#f0fdf4;border-radius:8px;padding:.6rem 1rem;margin-top:.75rem;font-size:.8rem;color:#15803d;font-weight:600;"></div>
        <div style="border-top:1px solid #e5e7eb;margin-top:1rem;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#64748b;"><span>Subtotal:</span><strong id="pos-subtotal">₦0.00</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#16a34a;font-weight:600;display:none;" id="pos-bulk-line">
            <span>🏷 Bulk Discount:</span><strong id="pos-bulk-discount">₦0.00</strong>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
            <label>Extra Discount (%):</label>
            <input id="pos-discount" type="number" min="0" max="100" value="0" style="width:80px;text-align:right;" oninput="updatePOSTotals()">
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#64748b;"><span>Tax (${STATE.settings.taxRate}%):</span><strong id="pos-tax">₦0.00</strong></div>
          <div style="display:flex;justify-content:space-between;font-size:1.4rem;font-weight:700;border-top:2px solid #e5e7eb;padding-top:.75rem;">
            <span>TOTAL:</span><span id="pos-total">₦0.00</span>
          </div>
        </div>
        <div style="margin-top:.5rem;">
          <label>Amount Tendered (₦):</label>
          <input id="pos-tendered" type="number" min="0" style="width:100%;margin-top:.25rem;" oninput="updateChange()">
          <div id="pos-change-display" style="margin-top:.4rem;font-weight:600;"></div>
        </div>
        <div id="pos-loyalty-redeem" style="display:none;background:#fdf4ff;border-radius:8px;padding:.6rem 1rem;margin-top:.75rem;">
          <label style="color:#7c3aed;">🌟 Redeem Loyalty Points</label>
          <div style="display:flex;gap:.5rem;margin-top:.4rem;">
            <input id="pos-redeem-pts" type="number" min="0" placeholder="Points" style="flex:1;" oninput="updatePOSTotals()">
            <span id="pos-points-value" style="display:flex;align-items:center;color:#7c3aed;font-weight:600;font-size:.875rem;white-space:nowrap;"></span>
          </div>
        </div>
        <div style="margin-top:1rem;display:flex;gap:.75rem;flex-direction:column;">
          <button onclick="completeSale()" style="font-size:1rem;padding:.9rem;">✔ Complete Sale</button>
          <div style="display:flex;gap:.75rem;">
            <button onclick="saveAsQuote()" style="flex:1;background:#0891b2;font-size:.875rem;">📄 Save as Quote</button>
            <button onclick="clearCart()" style="flex:1;background:#6b7280;font-size:.875rem;">🗑 Clear</button>
          </div>
        </div>
      </div>
    </div>`;
  renderProductPalette();
  renderCartItems();
}

function onPOSCustomerChange() {
  const c = STATE.customers.find(x => x.id === $('#pos-customer')?.value);
  const banner = $('#pos-loyalty-banner'), rd = $('#pos-loyalty-redeem');
  if (c && c.loyaltyPoints > 0) {
    const val = c.loyaltyPoints * (STATE.settings.loyaltyRedemptionRate || 100);
    if (banner) { banner.style.display='block'; banner.innerHTML=`🌟 <strong>${c.name}</strong> has <strong>${c.loyaltyPoints} pts</strong> (worth ${fmt(val)})`; }
    if (rd) rd.style.display = 'block';
  } else {
    if (banner) banner.style.display = 'none';
    if (rd)     rd.style.display = 'none';
  }
}

function renderProductPalette() {
  const search = ($('#pos-prod-search')?.value || '').toLowerCase();
  const wh = $('#pos-wh')?.value || posWarehouse;
  posWarehouse = wh;
  const list = STATE.products.filter(p =>
    (p.stock[wh] || 0) > 0 &&
    (!search || p.name.toLowerCase().includes(search) || (p.sku||'').toLowerCase().includes(search) || (p.barcode||'').includes(search))
  );
  const pal = $('#pos-product-palette'); if (!pal) return;
  pal.innerHTML = list.map(p => {
    const tiers = STATE.bulkDiscountTiers.filter(t=>t.active&&(!t.productIds?.length||t.productIds.includes(p.id))).sort((a,b)=>a.minQty-b.minQty);
    const label = tiers[0] ? `${tiers[0].discountPct}%@${tiers[0].minQty}+` : '';
    return `<div onclick="addToCart('${p.id}')" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
        padding:1rem;cursor:pointer;transition:all .15s;user-select:none;position:relative;"
        onmouseover="this.style.background='#eff6ff';this.style.borderColor='#2563eb';"
        onmouseout="this.style.background='#f8fafc';this.style.borderColor='#e2e8f0';">
      ${label?`<div style="position:absolute;top:-8px;right:-8px;background:#16a34a;color:#fff;border-radius:20px;font-size:.65rem;padding:.15rem .5rem;font-weight:700;">BULK ${label}</div>`:''}
      <div style="font-weight:600;font-size:.875rem;">${p.name}</div>
      <div style="color:#2563eb;font-weight:700;">${fmt(p.sellingPrice)}</div>
      <div style="font-size:.75rem;color:#64748b;margin-top:.3rem;">Stock: ${fmtNum(p.stock[wh]||0)} ${p.unit}</div>
    </div>`;
  }).join('') || `<p style="color:#9ca3af;grid-column:1/-1;text-align:center;padding:2rem;">No products in this warehouse.</p>`;
}

function addToCart(productId) {
  const product = STATE.products.find(p => p.id === productId); if (!product) return;
  const existing = posCart.find(i => i.productId === productId);
  if (existing) {
    if (existing.qty >= (product.stock[posWarehouse]||0)) return toast('Not enough stock.','warn');
    existing.qty++;
  } else {
    if (!(product.stock[posWarehouse]||0)) return toast('Out of stock.','warn');
    posCart.push({ productId, name: product.name, unit: product.unit, unitPrice: product.sellingPrice, costPrice: product.costPrice, qty: 1, manualDiscountPct: 0 });
  }
  renderCartItems(); updatePOSTotals();
}

function renderCartItems() {
  const wrap = $('#pos-cart-items'); if (!wrap) return;
  if (!posCart.length) { wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:1rem;">Cart is empty.</p>'; return; }
  wrap.innerHTML = posCart.map((item,i) => {
    const bulk = getBulkDiscount(item.productId, item.qty);
    const eff  = Math.max(bulk, item.manualDiscountPct||0);
    const line = item.qty * item.unitPrice * (1-eff/100);
    const next = getNextBulkTier(item.productId, item.qty);
    return `<div style="padding:.6rem 0;border-bottom:1px solid #f3f4f6;">
      <div style="display:flex;align-items:center;gap:.5rem;">
        <div style="flex:1;font-size:.875rem;">
          <div style="font-weight:600;">${item.name}</div>
          <div style="color:#64748b;font-size:.8rem;">${fmt(item.unitPrice)} / ${item.unit}</div>
        </div>
        <div style="display:flex;align-items:center;gap:.25rem;">
          <button onclick="changeQty(${i},-1)" style="width:26px;height:26px;padding:0;text-align:center;">−</button>
          <input type="number" value="${item.qty}" min="1" style="width:52px;text-align:center;padding:.2rem;" onchange="setQty(${i},this.value)">
          <button onclick="changeQty(${i},1)"  style="width:26px;height:26px;padding:0;text-align:center;">+</button>
        </div>
        <div style="min-width:85px;text-align:right;font-weight:700;">${fmt(line)}</div>
        <button onclick="removeCartItem(${i})" style="background:#fee2e2;color:#dc2626;border:none;width:26px;height:26px;border-radius:6px;cursor:pointer;">×</button>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem;margin-top:.4rem;flex-wrap:wrap;">
        ${bulk>0?`<span style="background:#d1fae5;color:#065f46;border-radius:20px;font-size:.72rem;padding:.15rem .6rem;font-weight:700;">🏷 ${bulk}% bulk</span>`:''}
        <div style="display:flex;align-items:center;gap:.3rem;margin-left:auto;">
          <span style="font-size:.75rem;color:#64748b;">Extra %:</span>
          <input type="number" min="0" max="100" value="${item.manualDiscountPct||0}"
            style="width:50px;font-size:.78rem;padding:.15rem .3rem;text-align:center;"
            onchange="setItemDiscount(${i},this.value)">
        </div>
      </div>
      ${next&&STATE.settings.enableBulkDiscount?`<div style="margin-top:.35rem;font-size:.75rem;color:#b45309;background:#fef9c3;border-radius:6px;padding:.25rem .6rem;">
        💡 Add ${next.minQty-item.qty} more → get <strong>${next.discountPct}% off</strong></div>`:''}
    </div>`;
  }).join('');
}

function setItemDiscount(i,v){ posCart[i].manualDiscountPct=Math.max(0,Math.min(100,parseFloat(v)||0)); renderCartItems(); updatePOSTotals(); }
function changeQty(i,d){
  posCart[i].qty=Math.max(1,posCart[i].qty+d);
  const p=STATE.products.find(x=>x.id===posCart[i].productId);
  if(p&&posCart[i].qty>(p.stock[posWarehouse]||0)){posCart[i].qty--;return toast('Not enough stock.','warn');}
  renderCartItems(); updatePOSTotals();
}
function setQty(i,v){ posCart[i].qty=Math.max(1,parseInt(v)||1); renderCartItems(); updatePOSTotals(); }
function removeCartItem(i){ posCart.splice(i,1); renderCartItems(); updatePOSTotals(); }
function clearCart(){ posCart=[]; renderCartItems(); updatePOSTotals(); }

function updatePOSTotals() {
  let subtotal=0, bulkSaving=0;
  posCart.forEach(item=>{
    const base=item.qty*item.unitPrice;
    const bulk=getBulkDiscount(item.productId,item.qty);
    const eff=Math.max(bulk,item.manualDiscountPct||0);
    if(bulk>0) bulkSaving+=base*(bulk/100);
    subtotal+=base*(1-eff/100);
  });
  const extraPct=parseFloat($('#pos-discount')?.value)||0;
  const afterDisc=subtotal*(1-extraPct/100);
  const custId=$('#pos-customer')?.value;
  const cust=STATE.customers.find(c=>c.id===custId);
  let redeemVal=0;
  const rEl=$('#pos-redeem-pts');
  if(rEl&&cust){
    const pts=Math.min(parseFloat(rEl.value)||0, cust.loyaltyPoints||0);
    redeemVal=pts*(STATE.settings.loyaltyRedemptionRate||100);
    const pv=$('#pos-points-value'); if(pv) pv.textContent=pts>0?`= ${fmt(redeemVal)}`:'';
  }
  const tax=afterDisc*STATE.settings.taxRate/100;
  const total=Math.max(0,afterDisc+tax-redeemVal);
  if($('#pos-subtotal')) $('#pos-subtotal').textContent=fmt(subtotal);
  if($('#pos-tax'))      $('#pos-tax').textContent=fmt(tax);
  if($('#pos-total'))    $('#pos-total').textContent=fmt(total);
  const sv=$('#pos-bulk-savings'), bl=$('#pos-bulk-line');
  if(sv){sv.style.display=bulkSaving>0?'block':'none'; sv.textContent=`🏷 Bulk saving: ${fmt(bulkSaving)}`;}
  if(bl) bl.style.display=bulkSaving>0?'flex':'none';
  if($('#pos-bulk-discount')) $('#pos-bulk-discount').textContent='-'+fmt(bulkSaving);
  updateChange();
}
function updateChange(){
  const tendered=parseFloat($('#pos-tendered')?.value)||0;
  const total=parseFloat($('#pos-total')?.textContent?.replace(/[^0-9.]/g,'')||'0');
  const cd=$('#pos-change-display'); if(!cd)return;
  if(tendered>0){ const ch=tendered-total; cd.style.color=ch>=0?'#16a34a':'#dc2626'; cd.textContent=ch>=0?`Change: ${fmt(ch)}`:`Balance Due: ${fmt(Math.abs(ch))}`; }
  else cd.textContent='';
}

async function completeSale() {
  if (!posCart.length) return toast('Cart is empty.', 'warn');

  let subtotal=0, totalDiscount=0, bulkDiscount=0;
  const saleItems = posCart.map(item => {
    const base=item.qty*item.unitPrice;
    const bulk=getBulkDiscount(item.productId,item.qty);
    const eff=Math.max(bulk,item.manualDiscountPct||0);
    const discAmt=base*(eff/100);
    totalDiscount+=discAmt; if(bulk>0) bulkDiscount+=base*(bulk/100);
    subtotal+=base-discAmt;
    return { productId:item.productId, qty:item.qty, price:item.unitPrice, discount:eff, total:(base-discAmt) };
  });

  const extraPct=parseFloat($('#pos-discount')?.value)||0;
  const extraDiscAmt=subtotal*(extraPct/100);
  const afterDisc=subtotal-extraDiscAmt;
  const tax=afterDisc*STATE.settings.taxRate/100;

  const custId=$('#pos-customer')?.value||'';
  const cust=STATE.customers.find(c=>c.id===custId);
  let redeemPts=0, redeemVal=0;
  if(cust){
    const rEl=$('#pos-redeem-pts');
    redeemPts=Math.min(parseFloat(rEl?.value)||0, cust.loyaltyPoints||0);
    redeemVal=redeemPts*(STATE.settings.loyaltyRedemptionRate||100);
  }
  const total=Math.max(0,afterDisc+tax-redeemVal);
  const payment=$('#pos-payment')?.value||'cash';
  const repId=$('#pos-rep')?.value||'';
  const isCredit=payment==='credit';

  if(isCredit&&cust&&(cust.balance||0)+total>cust.creditLimit)
    return toast(`Credit limit of ${fmt(cust.creditLimit)} would be exceeded.`,'error');

  const pointsEarned=Math.floor(total/1000*(STATE.settings.loyaltyPointsRate||1));
  const receiptNo = isCredit ? nextInvoiceNo() : nextReceiptNo();

  const payload = {
    receiptNo,
    invoiceNo:      isCredit ? receiptNo : null,
    customerId:     custId || null,
    salesRepId:     repId  || null,
    warehouseId:    posWarehouse || null,
    items:          saleItems,
    subtotal:       posCart.reduce((s,i)=>s+i.qty*i.unitPrice,0),
    discount:       totalDiscount + extraDiscAmt,
    tax,
    total,
    paymentMethod:  payment,
    paymentStatus:  isCredit ? 'unpaid' : 'paid',
    pointsEarned,
    pointsRedeemed: redeemPts,
    note:           '',
  };

  showLoading('Processing sale…');
  try {
    const result = await API.createSale(payload);
    const discMsg = (totalDiscount+extraDiscAmt)>0 ? ` (saved ${fmt(totalDiscount+extraDiscAmt)})` : '';
    toast(`${isCredit?'Invoice':'Receipt'} ${receiptNo} recorded. Total: ${fmt(total)}${discMsg}`, 'success');

    const localSale = {
      ...payload, id: result?.id || result?.sale?.id || uid(),
      customerName: cust?.name||'Walk-in',
      repName: STATE.salesReps.find(r=>r.id===repId)?.name||'',
      items: posCart.map((item,i)=>({...item,...saleItems[i], lineDiscount: saleItems[i].total*saleItems[i].discount/100, effectiveDiscountPct: saleItems[i].discount })),
      totalDiscountAmt: totalDiscount+extraDiscAmt, taxAmt: tax, redeemVal,
    };
    printReceipt(localSale);
    clearCart();
    await loadAllData();
    renderDashboard();
  } catch(e) { toast(e.message, 'error'); }
  finally { hideLoading(); }
}

async function saveAsQuote() {
  if (!posCart.length) return toast('Cart is empty.', 'warn');
  const custId=$('#pos-customer')?.value||'';
  const extraPct=parseFloat($('#pos-discount')?.value)||0;

  const items=posCart.map(item=>{
    const bulk=getBulkDiscount(item.productId,item.qty);
    const eff=Math.max(bulk,item.manualDiscountPct||0);
    return { productId:item.productId, qty:item.qty, price:item.unitPrice, discount:eff, total:item.qty*item.unitPrice*(1-eff/100) };
  });
  const subtotal=items.reduce((s,i)=>s+i.total,0);
  const afterDisc=subtotal*(1-extraPct/100);
  const tax=afterDisc*STATE.settings.taxRate/100;
  const total=afterDisc+tax;
  const qNo=nextQuoteNo();
  const validUntil=new Date(Date.now()+7*86400000).toISOString();

  await API.createQuote({ quoteNo:qNo, customerId:custId||null, items, subtotal, discount:extraPct, tax, total, validUntil, note:'', status:'PENDING' });
  toast(`Quote ${qNo} saved.`, 'success');
}

function printReceipt(sale) {
  const win=window.open('','_blank','width=420,height=700'); if(!win)return;
  const s=STATE.settings;
  const itemsHTML=(sale.items||[]).map(i=>{
    const base=i.qty*(i.unitPrice||i.price||0);
    const disc=i.effectiveDiscountPct||i.discount||0;
    const discLine=disc>0?`<tr><td colspan="3" style="font-size:10px;color:#555;">Discount ${disc}%:</td><td style="text-align:right;font-size:10px;color:#555;">-${fmt(base*disc/100)}</td></tr>`:'';
    return `<tr><td>${i.name}</td><td style="text-align:center;">${i.qty} ${i.unit||''}</td><td style="text-align:right;">${fmt(i.unitPrice||i.price||0)}</td><td style="text-align:right;">${fmt(i.total||base)}</td></tr>${discLine}`;
  }).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
    <style>body{font-family:'Courier New',monospace;font-size:12px;max-width:340px;margin:0 auto;padding:1rem;}
    h2{text-align:center;font-size:14px;}.center{text-align:center;}table{width:100%;border-collapse:collapse;}td{padding:2px 0;}
    .sep{border-top:1px dashed #000;margin:6px 0;}.total{font-size:15px;font-weight:bold;}@media print{button{display:none;}}</style>
    </head><body>
    <h2>${s.companyName}</h2><p class="center">${s.address}</p><p class="center">${s.phone}</p>
    <div class="sep"></div>
    <p><strong>${sale.invoiceNo?'INVOICE':'RECEIPT'}:</strong> ${sale.invoiceNo||sale.receiptNo}</p>
    <p><strong>Date:</strong> ${fmtDate(sale.date||nowISO())}</p>
    <p><strong>Customer:</strong> ${sale.customerName||'Walk-in'}</p>
    <p><strong>Payment:</strong> ${(sale.paymentMethod||'').toUpperCase()}</p>
    ${sale.repName?`<p><strong>Rep:</strong> ${sale.repName}</p>`:''}
    <div class="sep"></div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${itemsHTML}</tbody></table>
    <div class="sep"></div>
    <table>
      <tr><td>Subtotal:</td><td style="text-align:right;">${fmt(sale.subtotal||0)}</td></tr>
      ${(sale.totalDiscountAmt||sale.discount||0)>0?`<tr><td>Discounts:</td><td style="text-align:right;color:#16a34a;">-${fmt(sale.totalDiscountAmt||sale.discount||0)}</td></tr>`:''}
      <tr><td>Tax (${s.taxRate}%):</td><td style="text-align:right;">${fmt(sale.taxAmt||sale.tax||0)}</td></tr>
      ${(sale.redeemVal||0)>0?`<tr><td>Points Redeemed:</td><td style="text-align:right;color:#7c3aed;">-${fmt(sale.redeemVal)}</td></tr>`:''}
      <tr class="total"><td>TOTAL:</td><td style="text-align:right;">${fmt(sale.total)}</td></tr>
    </table>
    <div class="sep"></div>
    <p class="center">Thank you for your business!</p>
    <p class="center" style="font-size:10px;">${s.email}</p>
    <button onclick="window.print()" style="width:100%;margin-top:1rem;padding:.5rem;cursor:pointer;">Print</button>
    </body></html>`);
  win.document.close();
}

/* ════════════════════════════════════════════════════════════════
   10. CUSTOMERS
   ════════════════════════════════════════════════════════════════ */
function renderCustomers() {
  $('#customers').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Customers</h2>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          <input id="cust-search" type="search" placeholder="Search…" style="width:200px;" oninput="renderCustomersTable()">
          <select id="cust-type-filter" style="width:140px;" onchange="renderCustomersTable()">
            <option value="">All Types</option><option value="retail">Retail</option><option value="wholesale">Wholesale</option>
          </select>
          <button onclick="openAddCustomer()">+ Add Customer</button>
          <button onclick="exportCustomersXLSX()" style="background:#16a34a;">⬇ Export</button>
        </div>
      </div>
      <div id="customers-table-wrap"></div>
    </div>`;
  renderCustomersTable();
}

function renderCustomersTable() {
  const search=($('#cust-search')?.value||'').toLowerCase();
  const tf=$('#cust-type-filter')?.value||'';
  const list=STATE.customers.filter(c=>(!tf||c.customerType===tf)&&(c.name.toLowerCase().includes(search)||(c.phone||'').includes(search)||(c.email||'').toLowerCase().includes(search)));
  const wrap=$('#customers-table-wrap'); if(!wrap)return;
  if(!list.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No customers.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Name</th><th>Type</th><th>Phone</th><th>Credit Limit</th><th>Balance</th><th>Loyalty Pts</th><th>Total Purchases</th><th>Actions</th></tr></thead>
    <tbody>${list.map(c=>`<tr>
      <td><strong>${c.name}</strong><br><small style="color:#9ca3af;">${c.address||''}</small></td>
      <td><span class="badge badge-${c.customerType==='wholesale'?'blue':'green'}">${c.customerType||'retail'}</span></td>
      <td>${c.phone||'—'}</td><td>${fmt(c.creditLimit)}</td>
      <td style="color:${(c.balance||0)>0?'#dc2626':'#16a34a'};font-weight:700;">${fmt(c.balance||0)}</td>
      <td><span style="color:#7c3aed;font-weight:600;">🌟 ${fmtNum(c.loyaltyPoints||0)}</span></td>
      <td>${fmt(c.totalPurchases||0)}</td>
      <td style="white-space:nowrap;">
        <button onclick="editCustomer('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
        <button onclick="recordPayment('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Pay</button>
        <button onclick="viewCustomerHistory('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">History</button>
        <button onclick="deleteCustomer('${c.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function customerFormHTML(c={}) {
  return `<div class="form-grid">
    <div><label>Name *</label><input id="cf-name" style="width:100%;" value="${c.name||''}"></div>
    <div><label>Type</label>
      <select id="cf-type" style="width:100%;">
        <option value="retail" ${c.customerType==='retail'?'selected':''}>Retail</option>
        <option value="wholesale" ${c.customerType==='wholesale'?'selected':''}>Wholesale</option>
      </select></div>
    <div><label>Phone</label><input id="cf-phone" style="width:100%;" value="${c.phone||''}"></div>
    <div><label>Email</label><input id="cf-email" style="width:100%;" value="${c.email||''}"></div>
    <div><label>Address</label><input id="cf-address" style="width:100%;" value="${c.address||''}"></div>
    <div><label>Credit Limit (₦)</label><input id="cf-credit" type="number" style="width:100%;" value="${c.creditLimit||0}"></div>
    <div><label>Loyalty Points</label><input id="cf-loyalty" type="number" style="width:100%;" value="${c.loyaltyPoints||0}"></div>
    <div style="grid-column:1/-1;"><label>Notes</label><textarea id="cf-notes" style="width:100%;height:60px;">${c.notes||''}</textarea></div>
  </div>`;
}

function openAddCustomer() {
  modal('Add Customer', customerFormHTML(), async (overlay,close) => {
    const name=$('#cf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    await API.createCustomer({
      name, customerType:$('#cf-type',overlay).value,
      phone:$('#cf-phone',overlay).value.trim()||null,
      email:$('#cf-email',overlay).value.trim()||null,
      address:$('#cf-address',overlay).value.trim()||null,
      creditLimit:parseFloat($('#cf-credit',overlay).value)||0,
      loyaltyPoints:parseInt($('#cf-loyalty',overlay).value)||0,
      notes:$('#cf-notes',overlay).value.trim()||null,
    });
    close(); await refreshSection('customers'); toast('Customer added.','success');
  });
}

function editCustomer(id) {
  const c=STATE.customers.find(x=>x.id===id); if(!c)return;
  modal(`Edit – ${c.name}`, customerFormHTML(c), async (overlay,close) => {
    await API.updateCustomer(id,{
      name:$('#cf-name',overlay).value.trim()||c.name,
      customerType:$('#cf-type',overlay).value,
      phone:$('#cf-phone',overlay).value.trim()||null,
      email:$('#cf-email',overlay).value.trim()||null,
      address:$('#cf-address',overlay).value.trim()||null,
      creditLimit:parseFloat($('#cf-credit',overlay).value)||c.creditLimit,
      loyaltyPoints:parseInt($('#cf-loyalty',overlay).value)||0,
      notes:$('#cf-notes',overlay).value.trim()||null,
    });
    close(); await refreshSection('customers'); toast('Updated.','success');
  });
}

function recordPayment(id) {
  const c=STATE.customers.find(x=>x.id===id); if(!c)return;
  modal(`Record Payment – ${c.name}`,`
    <p style="margin-bottom:1rem;">Outstanding: <strong style="color:#dc2626;">${fmt(c.balance||0)}</strong></p>
    <div class="form-grid">
      <div><label>Amount (₦)</label><input id="pay-amt" type="number" style="width:100%;" value="${c.balance||0}"></div>
      <div><label>Method</label>
        <select id="pay-method" style="width:100%;"><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos-machine">POS</option><option value="cheque">Cheque</option></select></div>
      <div><label>Date</label><input id="pay-date" type="date" style="width:100%;" value="${today()}"></div>
      <div><label>Reference</label><input id="pay-ref" style="width:100%;"></div>
    </div>`, async (overlay,close) => {
    const amt=parseFloat($('#pay-amt',overlay).value)||0;
    if(amt<=0) return toast('Enter a valid amount.','warn');
    if(amt>c.balance) return toast(`Exceeds balance of ${fmt(c.balance)}.`,'warn');
    const rNo=nextReceiptNo();
    await API.createSale({
      receiptNo:rNo, customerId:id, warehouseId:null, repId:null,
      items:[], subtotal:amt, discount:0, tax:0, total:amt,
      paymentMethod:$('#pay-method',overlay).value, paymentStatus:'paid',
      pointsEarned:0, pointsRedeemed:0,
      note:$('#pay-ref',overlay).value.trim()||null,
    });
    close(); await refreshSection('customers'); toast(`Payment of ${fmt(amt)} recorded.`,'success');
  });
}

function viewCustomerHistory(id) {
  const c=STATE.customers.find(x=>x.id===id); if(!c)return;
  const txns=STATE.sales.filter(s=>s.customerId===id).slice(-30).reverse();
  modal(`History – ${c.name}`,`
    <p>Total: <strong>${fmt(c.totalPurchases||0)}</strong> | Outstanding: <strong style="color:#dc2626;">${fmt(c.balance||0)}</strong> | Points: <strong style="color:#7c3aed;">🌟 ${fmtNum(c.loyaltyPoints||0)}</strong></p>
    ${txns.length?`<table><thead><tr><th>Date</th><th>Ref</th><th>Total</th><th>Method</th><th>Status</th></tr></thead>
    <tbody>${txns.map(s=>`<tr>
      <td>${fmtDate(s.date)}</td>
      <td style="font-family:monospace;">${s.invoiceNo||s.receiptNo||'—'}</td>
      <td>${fmt(s.total)}</td><td>${s.paymentMethod||'—'}</td>
      <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus||'paid'}</span></td>
    </tr>`).join('')}</tbody></table>`:'<p style="color:#9ca3af;">No transactions.</p>'}`,null,'Close');
}

async function deleteCustomer(id) {
  if(!confirm2('Delete customer?'))return;
  await API.deleteCustomer(id);
  await refreshSection('customers'); toast('Deleted.','warn');
}

function exportCustomersXLSX() {
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(STATE.customers.map(c=>({
    Name:c.name,Type:c.customerType||'retail',Phone:c.phone,Email:c.email||'',
    Address:c.address||'','Credit Limit':c.creditLimit,'Balance':c.balance||0,
    'Loyalty Points':c.loyaltyPoints||0,'Total Purchases':c.totalPurchases||0,
  }))),'Customers');
  XLSX.writeFile(wb,'cnjohnson_customers.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   11. SUPPLIERS
   ════════════════════════════════════════════════════════════════ */
function renderSuppliers() {
  $('#suppliers').innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Suppliers</h2>
      <button onclick="openAddSupplier()">+ Add Supplier</button>
    </div>
    <div id="suppliers-table-wrap"></div>
  </div>`;
  renderSuppliersTable();
}

function renderSuppliersTable() {
  const wrap=$('#suppliers-table-wrap'); if(!wrap)return;
  if(!STATE.suppliers.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No suppliers.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Name</th><th>Contact Person</th><th>Phone</th><th>Notes</th><th>Balance Owed</th><th>Actions</th></tr></thead>
    <tbody>${STATE.suppliers.map(s=>`<tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.contactPerson||'—'}</td>
      <td>${s.phone||'—'}</td>
      <td>${s.notes||'—'}</td>
      <td style="color:${(s.balance||0)>0?'#dc2626':'#16a34a'};font-weight:700;">${fmt(s.balance||0)}</td>
      <td style="white-space:nowrap;">
        <button onclick="editSupplier('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
        <button onclick="paySupplier('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Pay</button>
        <button onclick="deleteSupplier('${s.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function supplierFormHTML(s={}) {
  return `<div class="form-grid">
    <div><label>Company Name *</label><input id="sf-name" style="width:100%;" value="${s.name||''}"></div>
    <div><label>Contact Person</label><input id="sf-contact" style="width:100%;" value="${s.contactPerson||''}"></div>
    <div><label>Phone</label><input id="sf-phone" style="width:100%;" value="${s.phone||''}"></div>
    <div><label>Email</label><input id="sf-email" style="width:100%;" value="${s.email||''}"></div>
    <div><label>Address</label><input id="sf-address" style="width:100%;" value="${s.address||''}"></div>
    <div style="grid-column:1/-1;"><label>Notes</label><textarea id="sf-notes" style="width:100%;height:60px;">${s.notes||''}</textarea></div>
  </div>`;
}

function openAddSupplier() {
  modal('Add Supplier', supplierFormHTML(), async (overlay,close) => {
    const name=$('#sf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    await API.createSupplier({
      name,
      contactPerson:$('#sf-contact',overlay).value.trim()||null,
      phone:$('#sf-phone',overlay).value.trim()||null,
      email:$('#sf-email',overlay).value.trim()||null,
      address:$('#sf-address',overlay).value.trim()||null,
      notes:$('#sf-notes',overlay).value.trim()||null,
    });
    close(); await refreshSection('suppliers'); toast('Supplier added.','success');
  });
}

function editSupplier(id) {
  const s=STATE.suppliers.find(x=>x.id===id); if(!s)return;
  modal(`Edit – ${s.name}`, supplierFormHTML(s), async (overlay,close) => {
    await API.updateSupplier(id,{
      name:$('#sf-name',overlay).value.trim()||s.name,
      contactPerson:$('#sf-contact',overlay).value.trim()||null,
      phone:$('#sf-phone',overlay).value.trim()||null,
      email:$('#sf-email',overlay).value.trim()||null,
      address:$('#sf-address',overlay).value.trim()||null,
      notes:$('#sf-notes',overlay).value.trim()||null,
    });
    close(); await refreshSection('suppliers'); toast('Updated.','success');
  });
}

function paySupplier(id) {
  const s=STATE.suppliers.find(x=>x.id===id); if(!s)return;
  modal(`Pay Supplier – ${s.name}`,`
    <p>Balance owed: <strong style="color:#dc2626;">${fmt(s.balance||0)}</strong></p>
    <div class="form-grid">
      <div><label>Amount (₦)</label><input id="sp-amt" type="number" style="width:100%;" value="${s.balance||0}"></div>
      <div><label>Method</label><select id="sp-method" style="width:100%;"><option>Cash</option><option>Transfer</option><option>Cheque</option></select></div>
      <div><label>Reference</label><input id="sp-ref" style="width:100%;"></div>
    </div>`, async (overlay,close) => {
    const amt=parseFloat($('#sp-amt',overlay).value)||0;
    if(amt>(s.balance||0))return toast('Exceeds balance.','warn');
    await API.updateSupplier(id,{ balance:Math.max(0,(s.balance||0)-amt) });
    close(); await refreshSection('suppliers'); toast(`Payment of ${fmt(amt)} recorded.`,'success');
  });
}

async function deleteSupplier(id) {
  if(!confirm2('Delete supplier?'))return;
  await API.deleteSupplier(id);
  await refreshSection('suppliers'); toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   12. SALES REPS
   ════════════════════════════════════════════════════════════════ */
function renderSalesReps() {
  $('#sales-reps').innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Sales Representatives</h2>
      <button onclick="openAddRep()">+ Add Rep</button>
    </div>
    <div id="reps-table-wrap"></div>
  </div>`;
  renderRepsTable();
}

function renderRepsTable() {
  const wrap=$('#reps-table-wrap'); if(!wrap)return;
  if(!STATE.salesReps.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No reps yet.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Name</th><th>Phone</th><th>Warehouse</th><th>Commission %</th><th>Total Sales</th><th>Commission Earned</th><th>Actions</th></tr></thead>
    <tbody>${STATE.salesReps.map(r=>`<tr>
      <td><strong>${r.name}</strong></td><td>${r.phone||'—'}</td>
      <td>${getWarehouseName(r.warehouseId)}</td>
      <td>${r.commission}%</td><td>${fmt(r.totalSales||0)}</td>
      <td>${fmt((r.totalSales||0)*r.commission/100)}</td>
      <td style="white-space:nowrap;">
        <button onclick="editRep('${r.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
        <button onclick="deleteRep('${r.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function repFormHTML(r={}) {
  const wo=STATE.warehouses.map(w=>`<option value="${w.id}" ${r.warehouseId===w.id?'selected':''}>${w.name}</option>`).join('');
  return `<div class="form-grid">
    <div><label>Full Name *</label><input id="rf-name" style="width:100%;" value="${r.name||''}"></div>
    <div><label>Phone</label><input id="rf-phone" style="width:100%;" value="${r.phone||''}"></div>
    <div><label>Email</label><input id="rf-email" style="width:100%;" value="${r.email||''}"></div>
    <div><label>Warehouse</label><select id="rf-wh" style="width:100%;"><option value="">None</option>${wo}</select></div>
    <div><label>Commission %</label><input id="rf-comm" type="number" min="0" max="50" style="width:100%;" value="${r.commission||2}"></div>
  </div>`;
}

function openAddRep() {
  modal('Add Sales Rep', repFormHTML(), async (overlay,close) => {
    const name=$('#rf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    await API.createSalesRep({
      name,
      phone:$('#rf-phone',overlay).value.trim()||null,
      email:$('#rf-email',overlay).value.trim()||null,
      warehouseId:$('#rf-wh',overlay).value||null,
      commission:parseFloat($('#rf-comm',overlay).value)||2,
    });
    close(); await refreshSection('sales-reps'); toast('Rep added.','success');
  });
}

function editRep(id) {
  const r=STATE.salesReps.find(x=>x.id===id); if(!r)return;
  modal(`Edit – ${r.name}`, repFormHTML(r), async (overlay,close) => {
    await API.updateSalesRep(id,{
      name:$('#rf-name',overlay).value.trim()||r.name,
      phone:$('#rf-phone',overlay).value.trim()||null,
      email:$('#rf-email',overlay).value.trim()||null,
      warehouseId:$('#rf-wh',overlay).value||null,
      commission:parseFloat($('#rf-comm',overlay).value)||r.commission,
    });
    close(); await refreshSection('sales-reps'); toast('Updated.','success');
  });
}

async function deleteRep(id) {
  if(!confirm2('Delete rep?'))return;
  await API.deleteSalesRep(id);
  await refreshSection('sales-reps'); toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   13. PURCHASES
   ════════════════════════════════════════════════════════════════ */
let purchaseItems=[];

function renderPurchases() {
  const supOpts=STATE.suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const whOpts=STATE.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  const prOpts=STATE.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku||''})</option>`).join('');
  $('#purchases').innerHTML=`
    <div class="card">
      <h2 style="margin-bottom:1.5rem;">Record Purchase</h2>
      <div class="form-grid">
        <div><label>Supplier *</label><select id="pu-supplier" style="width:100%;"><option value="">— Select —</option>${supOpts}</select></div>
        <div><label>Warehouse</label><select id="pu-wh" style="width:100%;">${whOpts}</select></div>
        <div><label>Purchase/Invoice No.</label><input id="pu-no" style="width:100%;" placeholder="Auto if blank"></div>
        <div><label>Date</label><input id="pu-date" type="date" style="width:100%;" value="${today()}"></div>
      </div>
      <h3 style="margin:1.5rem 0 .75rem;">Items</h3>
      <div class="form-grid" style="align-items:end;">
        <div><label>Product</label><select id="pu-prod" style="width:100%;"><option value="">— Select —</option>${prOpts}</select></div>
        <div><label>Qty</label><input id="pu-qty" type="number" min="1" style="width:100%;"></div>
        <div><label>Unit Cost (₦)</label><input id="pu-cost" type="number" min="0" style="width:100%;"></div>
        <div><button onclick="addPurchaseItem()">+ Add</button></div>
      </div>
      <div id="purchase-items-wrap" style="margin-top:1rem;"></div>
      <div id="purchase-total" style="text-align:right;font-size:1.2rem;font-weight:700;margin-top:1rem;"></div>
      <div class="form-grid" style="margin-top:1rem;">
        <div><label>Payment</label>
          <select id="pu-pay-status" style="width:100%;">
            <option value="paid">Paid in Full</option>
            <option value="credit">On Credit</option>
            <option value="partial">Partial Payment</option>
          </select></div>
        <div><label>Amount Paid (₦)</label><input id="pu-paid-amt" type="number" min="0" style="width:100%;"></div>
        <div style="grid-column:1/-1;"><label>Notes</label><input id="pu-notes" style="width:100%;"></div>
      </div>
      <button onclick="savePurchase()" style="margin-top:1.5rem;font-size:1rem;padding:.9rem 2rem;">✔ Save Purchase</button>
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">Purchase History</h3>
      <div id="purchase-history-wrap"></div>
    </div>`;
  purchaseItems=[];
  renderPurchaseItemsWrap();
  renderPurchaseHistory();
}

function addPurchaseItem(){
  const pid=$('#pu-prod').value, qty=parseInt($('#pu-qty').value)||0, cost=parseFloat($('#pu-cost').value)||0;
  if(!pid||qty<=0||cost<=0)return toast('Select product, qty and cost.','warn');
  const p=STATE.products.find(x=>x.id===pid); if(!p)return;
  const ex=purchaseItems.find(i=>i.productId===pid);
  if(ex){ex.qty+=qty;ex.cost=cost;}
  else purchaseItems.push({productId:pid,name:p.name,unit:p.unit||'',qty,cost});
  renderPurchaseItemsWrap();
  $('#pu-qty').value=''; $('#pu-cost').value='';
}

function renderPurchaseItemsWrap(){
  const wrap=$('#purchase-items-wrap'); if(!wrap)return;
  if(!purchaseItems.length){wrap.innerHTML='';$('#purchase-total').textContent='';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th></th></tr></thead>
    <tbody>${purchaseItems.map((i,idx)=>`<tr>
      <td>${i.name}</td><td>${i.qty} ${i.unit}</td>
      <td>${fmt(i.cost)}</td><td>${fmt(i.qty*i.cost)}</td>
      <td><button onclick="removePurchaseItem(${idx})" class="danger" style="font-size:.8rem;padding:.2rem .5rem;">✕</button></td>
    </tr>`).join('')}</tbody></table>`;
  const gt=purchaseItems.reduce((s,i)=>s+i.qty*i.cost,0);
  $('#purchase-total').textContent=`Grand Total: ${fmt(gt)}`;
}
function removePurchaseItem(idx){purchaseItems.splice(idx,1);renderPurchaseItemsWrap();}

async function savePurchase(){
  if(!purchaseItems.length)return toast('Add at least one item.','warn');
  const supplierId=$('#pu-supplier').value;
  if(!supplierId)return toast('Select a supplier.','warn');
  const whId=$('#pu-wh').value;
  const grandTotal=purchaseItems.reduce((s,i)=>s+i.qty*i.cost,0);
  const payStatus=$('#pu-pay-status').value;
  const paidAmt=parseFloat($('#pu-paid-amt').value)||0;
  const paidAmount=payStatus==='paid'?grandTotal:payStatus==='partial'?paidAmt:0;
  const purchaseNo=$('#pu-no').value.trim() || `PUR-${Date.now()}`;

  showLoading('Saving purchase…');
  try {
    await API.createPurchase({
      supplierId,
      warehouseId:   whId || null,
      invoiceNo:     purchaseNo,
      grandTotal,
      paidAmount,
      paymentStatus: payStatus,
      note:          $('#pu-notes').value.trim() || null,
      items: purchaseItems.map(i => ({
        productId: i.productId,
        qty:       i.qty,
        costPrice: i.cost,
        total:     i.qty * i.cost,
      })),
    });
    toast(`Purchase ${purchaseNo} saved.`,'success');
    purchaseItems=[];
    await refreshSection('purchases');
  } catch(e){ toast(e.message,'error'); }
  finally{ hideLoading(); }
}

function renderPurchaseHistory(){
  const wrap=$('#purchase-history-wrap'); if(!wrap)return;
  if(!STATE.purchases.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No purchases yet.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Date</th><th>Purchase No.</th><th>Supplier</th><th>Warehouse</th><th>Total</th><th>Paid</th><th>Owed</th></tr></thead>
    <tbody>${STATE.purchases.slice(-30).reverse().map(p=>`<tr>
      <td>${fmtDate(p.date)}</td>
      <td style="font-family:monospace;">${p.invoiceNo||'—'}</td>
      <td>${p.supplierName}</td><td>${p.warehouseName||'—'}</td>
      <td>${fmt(p.grandTotal)}</td><td>${fmt(p.paidAmt)}</td>
      <td style="color:${p.owed>0?'#dc2626':'#16a34a'};">${p.owed>0?fmt(p.owed):'Paid'}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ════════════════════════════════════════════════════════════════
   14. INVOICES
   ════════════════════════════════════════════════════════════════ */
function renderInvoices(){
  $('#invoices').innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Invoices (Credit Sales)</h2>
      <div style="display:flex;gap:.75rem;">
        <select id="inv-filter" style="width:160px;" onchange="renderInvoicesTable()">
          <option value="">All</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option>
        </select>
        <button onclick="exportInvoicesXLSX()" style="background:#16a34a;">⬇ Export</button>
      </div>
    </div>
    <div id="invoices-table-wrap"></div>
  </div>`;
  renderInvoicesTable();
}

function renderInvoicesTable(){
  const filter=$('#inv-filter')?.value||'';
  const wrap=$('#invoices-table-wrap'); if(!wrap)return;
  const list=STATE.sales.filter(s=>s.invoiceNo&&(!filter||s.paymentStatus===filter)).reverse();
  if(!list.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No invoices.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Invoice No.</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${list.map(s=>`<tr>
      <td style="font-family:monospace;"><strong>${s.invoiceNo}</strong></td>
      <td>${fmtDate(s.date)}</td><td>${s.customerName}</td><td>${fmt(s.total)}</td>
      <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus}</span></td>
      <td style="white-space:nowrap;">
        <button onclick="printInvoice('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Print</button>
        <button onclick="issueCreditNote('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#8b5cf6;margin-right:.3rem;">Credit Note</button>
        ${s.paymentStatus!=='paid'?`<button onclick="markInvoicePaid('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;">Mark Paid</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3" style="font-weight:700;text-align:right;">Total Outstanding:</td>
      <td style="font-weight:700;color:#dc2626;">${fmt(list.filter(s=>s.paymentStatus!=='paid').reduce((a,s)=>a+s.total,0))}</td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>`;
}

function printInvoice(id){ const s=STATE.sales.find(x=>x.id===id); if(s) printReceipt(s); }

async function markInvoicePaid(id){
  const s=STATE.sales.find(x=>x.id===id); if(!s)return;
  if(!confirm2(`Mark invoice ${s.invoiceNo} as paid?`))return;
  await API.updateSale(id,{paymentStatus:'paid'});
  await refreshSection('invoices'); toast('Marked as paid.','success');
}

function issueCreditNote(saleId){
  const s=STATE.sales.find(x=>x.id===saleId); if(!s)return;
  modal(`Issue Credit Note for ${s.invoiceNo}`,`
    <p style="margin-bottom:1rem;">Invoice: <strong>${s.invoiceNo}</strong> | Amount: <strong>${fmt(s.total)}</strong></p>
    <div class="form-grid">
      <div><label>Credit Amount (₦)</label><input id="cn-amt" type="number" style="width:100%;" value="${s.total}"></div>
      <div><label>Reason</label>
        <select id="cn-reason" style="width:100%;">
          <option value="Goods Returned">Goods Returned</option>
          <option value="Overcharge Correction">Overcharge Correction</option>
          <option value="Damaged Goods">Damaged Goods</option>
          <option value="Other">Other</option>
        </select></div>
      <div style="grid-column:1/-1;"><label>Notes</label><textarea id="cn-notes" style="width:100%;height:60px;"></textarea></div>
    </div>`, async (overlay,close) => {
    const amt=parseFloat($('#cn-amt',overlay).value)||0;
    if(amt<=0||amt>s.total)return toast('Invalid amount.','warn');
    const cnNo=nextCreditNoteNo();
    await API.createCreditNote({
      creditNo:     cnNo,
      creditNoteNo: cnNo,
      customerId:   s.customerId || null,
      saleId:       saleId,
      amount:       amt,
      reason:       $('#cn-reason', overlay).value,
    });
    close(); await refreshSection('invoices'); toast(`Credit Note ${cnNo} issued.`,'success');
  });
}

function exportInvoicesXLSX(){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(STATE.sales.filter(s=>s.invoiceNo).map(s=>({
    'Invoice No.':s.invoiceNo,Date:fmtDate(s.date),Customer:s.customerName,Total:s.total,Status:s.paymentStatus,
  }))),'Invoices');
  XLSX.writeFile(wb,'cnjohnson_invoices.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   15. QUOTES
   ════════════════════════════════════════════════════════════════ */
function renderQuotes(){
  const sec=$('#quotes'); if(!sec)return;
  sec.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Price Quotations</h2>
      <select id="qt-filter" style="width:140px;" onchange="renderQuotesTable()">
        <option value="">All</option><option value="pending">Pending</option>
        <option value="accepted">Accepted</option><option value="rejected">Rejected</option>
      </select>
    </div>
    <div id="quotes-table-wrap"></div>
  </div>`;
  renderQuotesTable();
}

function renderQuotesTable(){
  const filter=$('#qt-filter')?.value||'';
  const wrap=$('#quotes-table-wrap'); if(!wrap)return;
  const list=STATE.quotes.filter(q=>!filter||q.status===filter).reverse();
  if(!list.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No quotes. Create from POS.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Quote No.</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${list.map(q=>`<tr>
      <td style="font-family:monospace;"><strong>${q.quoteNo}</strong></td>
      <td>${fmtDate(q.date)}</td><td>${q.customerName}</td><td>${fmt(q.total)}</td>
      <td><span class="badge badge-${q.status==='accepted'?'green':q.status==='rejected'?'red':'yellow'}">${q.status}</span></td>
      <td style="white-space:nowrap;">
        <button onclick="printQuote('${q.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Print</button>
        ${q.status==='pending'?`
          <button onclick="convertQuoteToSale('${q.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Convert</button>
          <button onclick="updateQuoteStatus('${q.id}','REJECTED')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Reject</button>`:''}
      </td>
    </tr>`).join('')}</tbody></table>`;
}

function convertQuoteToSale(quoteId){
  const q=STATE.quotes.find(x=>x.id===quoteId); if(!q)return;
  if(!confirm2(`Convert Quote ${q.quoteNo} to sale?`))return;
  posCart=q.items.map(i=>({...i, unitPrice:i.unitPrice||i.price, manualDiscountPct:i.discount||0}));
  posWarehouse=q.warehouseId||'';
  API.updateQuote(quoteId,{status:'ACCEPTED'}).catch(()=>{});
  showSection('pos');
  setTimeout(()=>{
    const sel=$('#pos-customer');
    if(sel&&q.customerId){sel.value=q.customerId;onPOSCustomerChange();}
    renderCartItems(); updatePOSTotals();
  },300);
  toast(`Quote ${q.quoteNo} loaded into POS.`,'success');
}

async function updateQuoteStatus(quoteId,status){
  await API.updateQuote(quoteId,{status});
  await refreshSection('quotes'); toast(`Quote marked as ${status.toLowerCase()}.`,'info');
}

function printQuote(quoteId){
  const q=STATE.quotes.find(x=>x.id===quoteId); if(!q)return;
  const s=STATE.settings;
  const win=window.open('','_blank','width=560,height=700'); if(!win)return;
  win.document.write(`<!DOCTYPE html><html><head><title>Quote ${q.quoteNo}</title>
    <style>body{font-family:Georgia,serif;max-width:600px;margin:2rem auto;padding:1rem;}
    h1{color:#1e40af;}table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #e5e7eb;padding:.5rem;font-size:.875rem;}th{background:#f8fafc;}
    @media print{button{display:none;}}</style></head><body>
    <h1>PRICE QUOTATION</h1>
    <div style="display:flex;justify-content:space-between;margin-bottom:1.5rem;">
      <div><h3>${s.companyName}</h3><p>${s.address}</p><p>${s.phone}</p></div>
      <div style="text-align:right;"><p><strong>Quote:</strong> ${q.quoteNo}</p><p><strong>Date:</strong> ${fmtDate(q.date)}</p></div>
    </div>
    <p><strong>To:</strong> ${q.customerName}</p>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Total</th></tr></thead>
    <tbody>${q.items.map(i=>`<tr>
      <td>${i.name||i.productId}</td><td>${i.qty}</td>
      <td>${fmt(i.unitPrice||i.price||0)}</td>
      <td>${i.discount||0}%</td>
      <td>${fmt(i.total||0)}</td>
    </tr>`).join('')}</tbody></table>
    <table style="margin-top:1rem;width:280px;margin-left:auto;">
      <tr><td>Subtotal:</td><td style="text-align:right;">${fmt(q.subtotal)}</td></tr>
      <tr><td>Tax:</td><td style="text-align:right;">${fmt(q.taxAmt)}</td></tr>
      <tr style="font-weight:bold;"><td>TOTAL:</td><td style="text-align:right;">${fmt(q.total)}</td></tr>
    </table>
    <button onclick="window.print()" style="margin-top:1rem;padding:.5rem 1.5rem;cursor:pointer;">Print</button>
    </body></html>`);
  win.document.close();
}

/* ════════════════════════════════════════════════════════════════
   16. CREDIT NOTES
   ════════════════════════════════════════════════════════════════ */
function renderCreditNotes(){
  const sec=$('#credit-notes'); if(!sec)return;
  sec.innerHTML=`<div class="card">
    <h2 style="margin-bottom:1.5rem;">Credit Notes & Returns</h2>
    <div id="cn-table-wrap"></div>
  </div>`;
  const wrap=$('#cn-table-wrap');
  if(!STATE.creditNotes.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No credit notes.</p>';return;}
  wrap.innerHTML=`<table>
    <thead><tr><th>Credit Note No.</th><th>Date</th><th>Customer</th><th>Original Invoice</th><th>Amount</th><th>Reason</th></tr></thead>
    <tbody>${STATE.creditNotes.slice().reverse().map(cn=>`<tr>
      <td style="font-family:monospace;"><strong>${cn.creditNoteNo}</strong></td>
      <td>${fmtDate(cn.date)}</td><td>${cn.customerName||'—'}</td>
      <td style="font-family:monospace;">${cn.originalInvoiceNo||'—'}</td>
      <td style="color:#dc2626;font-weight:700;">-${fmt(cn.amount)}</td>
      <td>${cn.reason||'—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ════════════════════════════════════════════════════════════════
   17. EXPENSES
   ════════════════════════════════════════════════════════════════ */
function renderExpenses(){
  const sec=$('#expenses'); if(!sec)return;
  sec.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Operational Expenses</h2>
      <button onclick="openAddExpense()">+ Record Expense</button>
    </div>
    <div id="expenses-table-wrap"></div>
  </div>`;
  renderExpensesTable();
}

function renderExpensesTable(){
  const wrap=$('#expenses-table-wrap'); if(!wrap)return;
  if(!STATE.expenses.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No expenses.</p>';return;}
  const total=STATE.expenses.reduce((s,e)=>s+(e.amount||0),0);
  wrap.innerHTML=`<table>
    <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid By</th><th>Actions</th></tr></thead>
    <tbody>${STATE.expenses.slice(-50).reverse().map(e=>`<tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="badge badge-blue">${e.category||'—'}</span></td>
      <td>${e.description||e.title||'—'}</td>
      <td style="font-weight:700;">${fmt(e.amount)}</td>
      <td>${e.paidBy||'—'}</td>
      <td><button onclick="deleteExpense('${e.id}')" class="danger" style="font-size:.8rem;padding:.2rem .5rem;">Del</button></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;">Total:</td><td style="font-weight:700;">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
  </table>`;
}

function openAddExpense(){
  modal('Record Expense',`
    <div class="form-grid">
      <div><label>Category</label>
        <input id="ex-cat" style="width:100%;" list="ex-cats" placeholder="e.g. Transport">
        <datalist id="ex-cats">
          ${['Transport','Fuel','Rent','Salary','Utilities','Maintenance','Marketing','Office Supplies','Food','Other'].map(c=>`<option>${c}</option>`).join('')}
        </datalist></div>
      <div><label>Description / Title *</label><input id="ex-title" style="width:100%;" placeholder="What was this for?"></div>
      <div><label>Amount (₦) *</label><input id="ex-amt" type="number" min="0" style="width:100%;"></div>
      <div><label>Date</label><input id="ex-date" type="date" style="width:100%;" value="${today()}"></div>
      <div><label>Paid By</label><input id="ex-by" style="width:100%;"></div>
      <div style="grid-column:1/-1;"><label>Note</label><textarea id="ex-note" style="width:100%;height:50px;"></textarea></div>
    </div>`, async (overlay,close) => {
    const title=$('#ex-title',overlay).value.trim();
    const amt=parseFloat($('#ex-amt',overlay).value);
    if(!title||isNaN(amt)||amt<=0)return toast('Description and amount required.','warn');
    await API.createExpense({
      title,
      description:title,
      amount:amt,
      category:$('#ex-cat',overlay).value.trim()||null,
      paidBy:$('#ex-by',overlay).value.trim()||null,
      note:$('#ex-note',overlay).value.trim()||null,
      date:$('#ex-date',overlay).value||today(),
    });
    close(); await refreshSection('expenses'); toast('Expense recorded.','success');
  });
}

async function deleteExpense(id){
  if(!confirm2('Delete this expense?'))return;
  await API.deleteExpense(id);
  await refreshSection('expenses'); toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   18. REPORTS
   ════════════════════════════════════════════════════════════════ */
function renderReports(){
  $('#reports').innerHTML=`<div class="card">
    <h2 style="margin-bottom:1.5rem;">Reports & Analytics</h2>
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:2rem;">
      <div><label>From</label><input id="rep-from" type="date" style="width:160px;" value="${new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0]}"></div>
      <div><label>To</label><input id="rep-to" type="date" style="width:160px;" value="${today()}"></div>
      <button onclick="runReports()">Generate</button>
      <button onclick="exportReportsXLSX()" style="background:#16a34a;">⬇ Excel</button>
      <button onclick="exportProfitLoss()" style="background:#8b5cf6;">📊 P&amp;L</button>
    </div>
    <div id="rep-kpis" class="stats-grid"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:1.5rem;">
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;"><h4>Sales by Payment Method</h4><canvas id="chart-payment" height="220"></canvas></div>
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;"><h4>Top Products by Revenue</h4><canvas id="chart-products" height="220"></canvas></div>
    </div>
    <div id="rep-tables" style="margin-top:2rem;"></div>
  </div>`;
  runReports();
}

function runReports(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const ps=STATE.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';});
  const rev=ps.reduce((a,s)=>a+s.total,0);
  const cogs=ps.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty*(i.costPrice||0),0),0);
  const gp=rev-cogs, gm=rev?(gp/rev*100):0;
  const disc=ps.reduce((a,s)=>a+(s.totalDiscountAmt||0),0);
  const exps=STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;});
  const totalExp=exps.reduce((a,e)=>a+e.amount,0);
  const np=gp-totalExp;

  const kpis=$('#rep-kpis');
  if(kpis) kpis.innerHTML=`
    <div class="stat-card" style="border-left:5px solid var(--primary);"><h3>Total Revenue</h3><div class="value" style="font-size:1.8rem;">${fmt(rev)}</div><div style="font-size:.8rem;color:#64748b;">${ps.length} transactions</div></div>
    <div class="stat-card" style="border-left:5px solid #10b981;"><h3>Gross Profit</h3><div class="value" style="font-size:1.8rem;">${fmt(gp)}</div><div style="font-size:.8rem;color:#64748b;">Margin: ${gm.toFixed(1)}%</div></div>
    <div class="stat-card" style="border-left:5px solid #f43f5e;"><h3>Net Profit</h3><div class="value" style="font-size:1.8rem;">${fmt(np)}</div><div style="font-size:.8rem;color:#64748b;">After ${fmt(totalExp)} expenses</div></div>
    <div class="stat-card" style="border-left:5px solid #f59e0b;"><h3>Discounts Given</h3><div class="value" style="font-size:1.8rem;">${fmt(disc)}</div></div>`;

  const payMap={};
  ps.forEach(s=>{const m=s.paymentMethod||'cash';payMap[m]=(payMap[m]||0)+s.total;});
  drawDonutChart('chart-payment',Object.keys(payMap),Object.values(payMap));

  const prodMap={};
  ps.forEach(s=>s.items.forEach(i=>{prodMap[i.name]=(prodMap[i.name]||0)+i.qty*(i.unitPrice||0);}));
  const topProds=Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  drawBarChart('chart-products',topProds.map(x=>x[0]),topProds.map(x=>x[1]));

  const expCats={};
  exps.forEach(e=>{expCats[e.category||'Other']=(expCats[e.category||'Other']||0)+e.amount;});

  const tables=$('#rep-tables');
  if(tables) tables.innerHTML=`
    ${Object.keys(expCats).length?`
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4>💸 Expense Breakdown</h4>
        <table><thead><tr><th>Category</th><th>Amount</th><th>%</th></tr></thead>
        <tbody>${Object.entries(expCats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${k}</td><td>${fmt(v)}</td><td>${totalExp>0?((v/totalExp)*100).toFixed(1):0}%</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td>${fmt(totalExp)}</td><td>100%</td></tr></tfoot>
        </table></div>`:''
    }
    <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
      <h4>Sales Transactions</h4>
      ${ps.length?`<table>
        <thead><tr><th>Date</th><th>Ref</th><th>Customer</th><th>Total</th><th>Method</th><th>Status</th></tr></thead>
        <tbody>${ps.slice().reverse().map(s=>`<tr>
          <td>${fmtDate(s.date)}</td>
          <td style="font-family:monospace;">${s.invoiceNo||s.receiptNo||'—'}</td>
          <td>${s.customerName||'Walk-in'}</td><td>${fmt(s.total)}</td>
          <td>${s.paymentMethod||'—'}</td>
          <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus||'—'}</span></td>
        </tr>`).join('')}</tbody></table>`
        :'<p style="color:#9ca3af;text-align:center;padding:1rem;">No sales in this period.</p>'}
    </div>`;
}

let _charts={};
function drawDonutChart(id,labels,data){
  if(_charts[id]){_charts[id].destroy();delete _charts[id];}
  const c=document.getElementById(id); if(!c)return;
  _charts[id]=new Chart(c,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:['#2563eb','#16a34a','#f59e0b','#dc2626','#8b5cf6','#06b6d4']}]},options:{plugins:{legend:{position:'bottom'}},responsive:true}});
}
function drawBarChart(id,labels,data){
  if(_charts[id]){_charts[id].destroy();delete _charts[id];}
  const c=document.getElementById(id); if(!c)return;
  _charts[id]=new Chart(c,{type:'bar',data:{labels:labels.map(l=>l.length>18?l.slice(0,18)+'…':l),datasets:[{label:'Revenue (₦)',data,backgroundColor:'#2563eb'}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{callback:v=>'₦'+v.toLocaleString()}}},responsive:true}});
}

function exportReportsXLSX(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const ps=STATE.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(ps.map(s=>({
    Date:fmtDate(s.date),Ref:s.invoiceNo||s.receiptNo||'',Customer:s.customerName||'Walk-in',
    Discounts:s.totalDiscountAmt||0,Tax:s.taxAmt||0,Total:s.total,Method:s.paymentMethod,Status:s.paymentStatus,
  }))),'Sales');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;}).map(e=>({
    Date:fmtDate(e.date),Category:e.category||'',Description:e.description||e.title||'',Amount:e.amount,PaidBy:e.paidBy||'',
  }))),'Expenses');
  XLSX.writeFile(wb,`cnjohnson_report_${today()}.xlsx`);
  toast('Report exported.','success');
}

function exportProfitLoss(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const ps=STATE.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';});
  const rev=ps.reduce((a,s)=>a+s.total,0);
  const cogs=ps.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty*(i.costPrice||0),0),0);
  const exps=STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;});
  const totalExp=exps.reduce((a,e)=>a+e.amount,0);
  const rows=[
    {Item:'REVENUE','Amount (₦)':rev},{Item:'Cost of Goods Sold','Amount (₦)':-cogs},
    {Item:'GROSS PROFIT','Amount (₦)':rev-cogs},{Item:'---','Amount (₦)':''},
    {Item:'EXPENSES','Amount (₦)':''},
    ...exps.map(e=>({Item:`  ${e.category||''}: ${e.description||e.title||''}`,'Amount (₦)':-e.amount})),
    {Item:'Total Expenses','Amount (₦)':-totalExp},{Item:'---','Amount (₦)':''},
    {Item:'NET PROFIT / (LOSS)','Amount (₦)':rev-cogs-totalExp},
  ];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Profit & Loss');
  XLSX.writeFile(wb,`cnjohnson_PL_${today()}.xlsx`);
  toast('P&L exported.','success');
}

/* ════════════════════════════════════════════════════════════════
   19. SETTINGS
   ════════════════════════════════════════════════════════════════ */
function renderSettings(){
  const s=STATE.settings;
  $('#settings').innerHTML=`<div class="card">
    <h2 style="margin-bottom:1.5rem;">System Settings</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:2rem;">
      <div>
        <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Company</h3>
        <div class="form-grid" style="grid-template-columns:1fr;">
          <div><label>Company Name</label><input id="set-cname" style="width:100%;" value="${s.companyName||''}"></div>
          <div><label>Address</label><input id="set-addr" style="width:100%;" value="${s.address||''}"></div>
          <div><label>Phone</label><input id="set-phone" style="width:100%;" value="${s.phone||''}"></div>
          <div><label>Email</label><input id="set-email" style="width:100%;" value="${s.email||''}"></div>
        </div>
      </div>
      <div>
        <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Financial</h3>
        <div class="form-grid" style="grid-template-columns:1fr;">
          <div><label>Currency Symbol</label><input id="set-currency" style="width:100%;" value="${s.currency||'₦'}" maxlength="3"></div>
          <div><label>VAT / Tax Rate (%)</label><input id="set-tax" type="number" min="0" style="width:100%;" value="${s.taxRate||0}"></div>
          <div><label>Low Stock Threshold</label><input id="set-lowstock" type="number" min="1" style="width:100%;" value="${s.lowStockThreshold||10}"></div>
        </div>
      </div>
      <div>
        <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Loyalty</h3>
        <div class="form-grid" style="grid-template-columns:1fr;">
          <div><label>Points per ₦1,000 spent</label><input id="set-lrate" type="number" min="0" style="width:100%;" value="${s.loyaltyPointsRate||1}"></div>
          <div><label>₦ value per point</label><input id="set-lredeem" type="number" min="0" style="width:100%;" value="${s.loyaltyRedemptionRate||100}"></div>
        </div>
      </div>
      <div>
        <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Numbering</h3>
        <div class="form-grid" style="grid-template-columns:1fr;">
          <div><label>Invoice Prefix</label><input id="set-invpfx" style="width:100%;" value="${s.invoicePrefix||'INV'}"></div>
          <div><label>Receipt Prefix</label><input id="set-rcppfx" style="width:100%;" value="${s.receiptPrefix||'RCP'}"></div>
          <div><label>Quote Prefix</label><input id="set-qtepfx" style="width:100%;" value="${s.quotePrefix||'QTE'}"></div>
          <div><label>Credit Note Prefix</label><input id="set-cnpfx" style="width:100%;" value="${s.creditNotePrefix||'CN'}"></div>
          <div><label>Next Invoice No.</label><input id="set-nextinv" type="number" style="width:100%;" value="${s.nextInvoiceNo||1001}"></div>
          <div><label>Next Receipt No.</label><input id="set-nextrcp" type="number" style="width:100%;" value="${s.nextReceiptNo||5001}"></div>
          <div><label>Next Quote No.</label><input id="set-nextqte" type="number" style="width:100%;" value="${s.nextQuoteNo||2001}"></div>
          <div><label>Next Purchase No.</label><input id="set-nextpur" type="number" style="width:100%;" value="${s.nextPurchaseNo||3001}"></div>
        </div>
      </div>
    </div>
    <div style="margin-top:2rem;">
      <button onclick="saveSettings()">💾 Save Settings</button>
    </div>
  </div>`;
}

async function saveSettings(){
  const payload={
    companyName:$('#set-cname').value.trim()||null,
    address:$('#set-addr').value.trim()||null,
    phone:$('#set-phone').value.trim()||null,
    email:$('#set-email').value.trim()||null,
    currency:$('#set-currency').value.trim()||'₦',
    taxRate:parseFloat($('#set-tax').value)||0,
    lowStockThreshold:parseInt($('#set-lowstock').value)||10,
    loyaltyPointsRate:parseFloat($('#set-lrate').value)||1,
    loyaltyRedemptionRate:parseFloat($('#set-lredeem').value)||100,
    invoicePrefix:$('#set-invpfx').value.trim()||'INV',
    receiptPrefix:$('#set-rcppfx').value.trim()||'RCP',
    quotePrefix:$('#set-qtepfx').value.trim()||'QTE',
    creditNotePrefix:$('#set-cnpfx').value.trim()||'CN',
    nextInvoiceNo:parseInt($('#set-nextinv').value)||STATE.settings.nextInvoiceNo,
    nextReceiptNo:parseInt($('#set-nextrcp').value)||STATE.settings.nextReceiptNo,
    nextQuoteNo:parseInt($('#set-nextqte').value)||STATE.settings.nextQuoteNo,
    nextPurchaseNo:parseInt($('#set-nextpur').value)||STATE.settings.nextPurchaseNo,
  };
  await API.updateSettings(payload);
  Object.assign(STATE.settings, payload);
  toast('Settings saved.','success');
}

/* ════════════════════════════════════════════════════════════════
   20. REP ACTIVITY
   ════════════════════════════════════════════════════════════════ */
function renderRepActivity(){
  const sec=document.getElementById('rep-activity'); if(!sec)return;
  const repOpts=`<option value="">All Reps</option>`+STATE.salesReps.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  sec.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
      <h2 style="margin:0;">Sales Rep Activity</h2>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
        <select id="ra-rep" style="width:180px;" onchange="renderRepStats()">${repOpts}</select>
        <input id="ra-from" type="date" style="width:150px;" value="${new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0]}" onchange="renderRepStats()">
        <input id="ra-to" type="date" style="width:150px;" value="${today()}" onchange="renderRepStats()">
      </div>
    </div>
    <div id="ra-kpis" class="stats-grid" style="margin-bottom:1.5rem;"></div>
    <div id="ra-scorecards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;"></div>
  </div>`;
  renderRepStats();
}

function renderRepStats(){
  const repFilter=$('#ra-rep')?.value||'';
  const from=new Date($('#ra-from')?.value||'1970-01-01');
  const to=new Date(($('#ra-to')?.value||today())+'T23:59:59');
  const sales=STATE.sales.filter(s=>{
    const d=new Date(s.date);
    return d>=from&&d<=to&&s.type!=='payment'&&(!repFilter||s.repId===repFilter);
  });
  const rev=sales.reduce((a,s)=>a+s.total,0);
  const disc=sales.reduce((a,s)=>a+(s.totalDiscountAmt||0),0);
  const kpis=$('#ra-kpis');
  if(kpis) kpis.innerHTML=`
    <div class="stat-card" style="border-left:5px solid #2563eb;"><h3>Total Revenue</h3><div class="value">${fmt(rev)}</div><div style="font-size:.8rem;color:#64748b;">${sales.length} transactions</div></div>
    <div class="stat-card" style="border-left:5px solid #10b981;"><h3>Avg. Ticket</h3><div class="value">${fmt(sales.length?rev/sales.length:0)}</div></div>
    <div class="stat-card" style="border-left:5px solid #f59e0b;"><h3>Total Discounts</h3><div class="value">${fmt(disc)}</div></div>`;

  const sc=$('#ra-scorecards');
  if(!sc)return;
  const target=STATE.settings.repDailyTarget||200000;
  const tStr=today();
  sc.innerHTML=STATE.salesReps.map(r=>{
    const rS=sales.filter(s=>s.repId===r.id);
    const rRev=rS.reduce((a,s)=>a+s.total,0);
    const todayRev=STATE.sales.filter(s=>s.repId===r.id&&(s.date||'').startsWith(tStr)&&s.type!=='payment').reduce((a,s)=>a+s.total,0);
    const pct=Math.min(todayRev/target*100,100).toFixed(0);
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:1.25rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:1rem;">
        <div><div style="font-weight:700;">${r.name}</div><div style="font-size:.78rem;color:#64748b;">${getWarehouseName(r.warehouseId)}</div></div>
        <div style="text-align:right;"><div style="font-size:.78rem;color:#64748b;">Commission</div><div style="font-weight:700;color:#7c3aed;">${fmt(rRev*r.commission/100)}</div></div>
      </div>
      <div style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;color:#64748b;margin-bottom:.3rem;"><span>Today: ${fmt(todayRev)}</span><span>Target: ${fmt(target)}</span></div>
        <div style="background:#e5e7eb;border-radius:4px;height:10px;overflow:hidden;">
          <div style="background:${parseInt(pct)>=100?'#16a34a':parseInt(pct)>=70?'#f59e0b':'#2563eb'};height:100%;width:${pct}%;border-radius:4px;"></div>
        </div>
        <div style="font-size:.75rem;color:#64748b;margin-top:.2rem;">${pct}% of daily target</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.82rem;">
        <div style="background:#f8fafc;border-radius:6px;padding:.5rem;"><div style="color:#64748b;">Period Revenue</div><div style="font-weight:700;color:#2563eb;">${fmt(rRev)}</div></div>
        <div style="background:#f8fafc;border-radius:6px;padding:.5rem;"><div style="color:#64748b;">Transactions</div><div style="font-weight:700;">${rS.length}</div></div>
      </div>
    </div>`;
  }).join('')||'<p style="color:#9ca3af;">No sales reps.</p>';
}

/* ════════════════════════════════════════════════════════════════
   21. CSS
   ════════════════════════════════════════════════════════════════ */
(function injectCSS(){
  const s=document.createElement('style');
  s.textContent=`
    @keyframes modalIn{from{opacity:0;transform:scale(.95) translateY(-12px);}to{opacity:1;transform:none;}}
    @keyframes spin{to{transform:rotate(360deg);}}
    label{display:block;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:.35rem;}
    .badge{display:inline-block;padding:.2rem .65rem;border-radius:20px;font-size:.75rem;font-weight:700;}
    .badge-green{background:#d1fae5;color:#065f46;}
    .badge-yellow{background:#fef9c3;color:#92400e;}
    .badge-blue{background:#dbeafe;color:#1e40af;}
    .badge-red{background:#fee2e2;color:#991b1b;}
    tfoot td{background:#f8fafc;font-weight:600;}
    @media(max-width:768px){.form-grid{grid-template-columns:1fr!important;}main{padding:1rem;}}
  `;
  document.head.append(s);
})();

/* ════════════════════════════════════════════════════════════════
   22. INIT
   ════════════════════════════════════════════════════════════════ */
Object.assign(RENDERS, {
  dashboard:       renderDashboard,
  warehouse:       renderWarehouses,
  products:        renderProducts,
  pos:             renderPOS,
  customers:       renderCustomers,
  suppliers:       renderSuppliers,
  'sales-reps':    renderSalesReps,
  purchases:       renderPurchases,
  invoices:        renderInvoices,
  quotes:          renderQuotes,
  'bulk-discounts':renderBulkDiscounts,
  'credit-notes':  renderCreditNotes,
  expenses:        renderExpenses,
  reports:         renderReports,
  settings:        renderSettings,
  'rep-activity':  renderRepActivity,
});

document.addEventListener('DOMContentLoaded', async () => {
  const sections=['dashboard','warehouse','products','pos','customers','suppliers',
    'sales-reps','purchases','invoices','quotes','bulk-discounts',
    'credit-notes','expenses','reports','settings','rep-activity'];

  sections.forEach(id=>{
    if(!document.getElementById(id)){
      const s=document.createElement('section');
      s.id=id;
      $('main')?.append(s);
    }
  });

  const dash=document.getElementById('dashboard');
  if(dash&&!document.getElementById('dashboard-extended')){
    const ext=document.createElement('div');
    ext.id='dashboard-extended';
    dash.append(ext);
  }

  const navLinks=[
    {href:'#quotes',          text:'📄 Quotes',          after:'#invoices'},
    {href:'#bulk-discounts',  text:'🏷 Bulk Discounts',  after:'#pos'},
    {href:'#credit-notes',    text:'📝 Credit Notes',    after:'#invoices'},
    {href:'#expenses',        text:'💸 Expenses',        after:'#purchases'},
    {href:'#rep-activity',    text:'📊 Rep Activity',    after:'#sales-reps'},
  ];
  navLinks.forEach(({href,text,after})=>{
    if(!$(`.sidebar a[href="${href}"]`)){
      const afterLink=$(`.sidebar a[href="${after}"]`);
      if(afterLink){
        const a=document.createElement('a');
        a.href=href; a.innerHTML=text;
        a.onclick=e=>{e.preventDefault();showSection(href.slice(1));};
        afterLink.after(a);
      }
    }
  });

  // STATE is module-scoped only — not exposed on window.
  // For debugging only: window._debug_STATE = STATE;
  await showSection('dashboard');
});