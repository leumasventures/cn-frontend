/* ================================================================
   C.N. Johnson Ventures Ltd — Sales, Invoice & Inventory System
   script.js · Full Application Logic — Enhanced Edition
   ================================================================ */

'use strict';

/* ════════════════════════════════════════════════════════════════
   1.  STATE & PERSISTENCE
   ════════════════════════════════════════════════════════════════ */
const DB_KEY = 'cnjohnson_db_v1';

const defaultState = () => ({
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
    loyaltyPointsRate: 1,      // points per ₦1000 spent
    loyaltyRedemptionRate: 100, // ₦ value per point
  },
  // ── BULK DISCOUNT TIERS ─────────────────────────────────────
  // Each tier: { id, name, minQty, maxQty, discountPct, productIds ([] = all), active }
  products: [],
  warehouses: [],
  customers: [],
  suppliers: [],
  salesReps: [],
  bulkDiscountTiers: [],
  sales: [],
  invoices: [],
  purchases: [],
  expenses: [],
  stockTransfers: [],
  quotes: [],           // NEW: price quotations
  debitNotes: [],       // NEW: debit notes
  creditNotes: [],      // NEW: credit notes
  loyaltyTransactions: [], // NEW: loyalty log
  priceHistory: [],     // NEW: price change audit log
});

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const def   = defaultState();
    const merged = { ...def, ...saved, settings: { ...def.settings, ...saved.settings } };
    // ensure new arrays exist
    merged.quotes             = merged.quotes || [];
    merged.debitNotes         = merged.debitNotes || [];
    merged.creditNotes        = merged.creditNotes || [];
    merged.loyaltyTransactions= merged.loyaltyTransactions || [];
    merged.priceHistory       = merged.priceHistory || [];
    merged.bulkDiscountTiers  = merged.bulkDiscountTiers || def.bulkDiscountTiers;
    // patch customers for new fields
    merged.customers = merged.customers.map(c=>({
      loyaltyPoints:0, customerType:'retail', notes:'', ...c
    }));
    merged.products = merged.products.map(p=>({ barcode:'', ...p }));
    return merged;
  } catch {
    return defaultState();
  }
}
function saveState() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(STATE)); } catch (e) { console.warn('Save failed', e); }
}

let STATE = loadState();
setInterval(saveState, 30000);

/* ════════════════════════════════════════════════════════════════
   2.  UTILITIES
   ════════════════════════════════════════════════════════════════ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const sym = () => STATE.settings.currency;
const fmt = n => sym() + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = n => Number(n || 0).toLocaleString('en-NG');
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().split('T')[0];
const nowISO = () => new Date().toISOString();
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-NG', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtPct = n => Number(n||0).toFixed(1) + '%';

function totalStock(product) {
  return Object.values(product.stock || {}).reduce((a, b) => a + b, 0);
}
function getWarehouseName(id) {
  const w = STATE.warehouses.find(x => x.id === id);
  return w ? w.name : id;
}

/* ── BULK DISCOUNT ENGINE ─────────────────────────────────────── */
/**
 * Given a productId and a quantity, returns the applicable bulk discount %.
 * Checks active tiers; tiers with productIds [] apply to all products.
 */
function getBulkDiscount(productId, qty) {
  if (!STATE.settings.enableBulkDiscount) return 0;
  const applicable = STATE.bulkDiscountTiers
    .filter(t => t.active &&
      qty >= t.minQty && qty <= t.maxQty &&
      (t.productIds.length === 0 || t.productIds.includes(productId))
    )
    .sort((a, b) => b.discountPct - a.discountPct);
  return applicable.length ? applicable[0].discountPct : 0;
}

/**
 * Returns the NEXT tier above current qty (for upsell prompt).
 */
function getNextBulkTier(productId, qty) {
  if (!STATE.settings.enableBulkDiscount) return null;
  const next = STATE.bulkDiscountTiers
    .filter(t => t.active &&
      t.minQty > qty &&
      (t.productIds.length === 0 || t.productIds.includes(productId))
    )
    .sort((a, b) => a.minQty - b.minQty);
  return next.length ? next[0] : null;
}

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
    background:${colors[type]||colors.info};box-shadow:0 4px 20px rgba(0,0,0,.2);
    opacity:0;transform:translateX(1rem);transition:all .3s;max-width:340px;`;
  t.textContent = msg;
  wrap.append(t);
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='none'; });
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(1rem)'; setTimeout(()=>t.remove(),320); }, 4200);
}

function confirm2(msg) { return window.confirm(msg); }

/* ── Modal ── */
function modal(title, bodyHTML, onSave, saveLabel='Save', width='580px') {
  const existing = $('#app-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'app-modal';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;
    display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);`;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:2rem;width:min(${width},95vw);
      max-height:90vh;overflow-y:auto;box-shadow:0 25px 80px rgba(0,0,0,.3);animation:modalIn .25s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h3 style="margin:0;font-size:1.25rem;color:#1f2937;">${title}</h3>
        <button id="modal-x" style="background:none;border:none;font-size:1.5rem;cursor:pointer;
          color:#6b7280;line-height:1;padding:.2rem .5rem;border-radius:6px;">×</button>
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
  overlay.onclick = e => { if(e.target===overlay) close(); };
  if (onSave) $('#modal-save', overlay).onclick = () => onSave(overlay, close);
}

/* ── Number Generators ── */
function nextInvoiceNo()   { const n=STATE.settings.nextInvoiceNo++;   saveState(); return `${STATE.settings.invoicePrefix}-${String(n).padStart(5,'0')}`; }
function nextReceiptNo()   { const n=STATE.settings.nextReceiptNo++;   saveState(); return `${STATE.settings.receiptPrefix}-${String(n).padStart(5,'0')}`; }
function nextQuoteNo()     { const n=STATE.settings.nextQuoteNo++;     saveState(); return `${STATE.settings.quotePrefix}-${String(n).padStart(5,'0')}`; }
function nextDebitNoteNo() { const n=STATE.settings.nextDebitNoteNo++; saveState(); return `${STATE.settings.debitNotePrefix}-${String(n).padStart(5,'0')}`; }
function nextCreditNoteNo(){ const n=STATE.settings.nextCreditNoteNo++;saveState(); return `${STATE.settings.creditNotePrefix}-${String(n).padStart(5,'0')}`; }

/* ════════════════════════════════════════════════════════════════
   3.  NAVIGATION
   ════════════════════════════════════════════════════════════════ */
function showSection(id) {
  $$('section').forEach(s => s.classList.remove('active'));
  $$('.sidebar a').forEach(a => a.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  const link = $(`.sidebar a[href="#${id}"]`);
  if (link) link.classList.add('active');
  const renders = {
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
  };
  if (renders[id]) renders[id]();
}

/* ════════════════════════════════════════════════════════════════
   4.  DASHBOARD
   ════════════════════════════════════════════════════════════════ */
function renderDashboard() {
  if (!el('todaySales')) return; // guard: DOM not ready yet

  const todayStr = today();
  const todaySales = STATE.sales.filter(s=>s.date&&s.date.startsWith(todayStr))
    .reduce((sum,s)=>sum+(s.total||0),0);
  const lowStock = STATE.products.filter(p=>totalStock(p)<=(p.reorderLevel||STATE.settings.lowStockThreshold));
  const receivables = STATE.customers.reduce((sum,c)=>sum+(c.balance||0),0);
  const thisMonth = new Date().toISOString().slice(0,7);
  const monthRevenue = STATE.sales.filter(s=>s.date&&s.date.startsWith(thisMonth))
    .reduce((sum,s)=>sum+(s.total||0),0);
  const inventoryValue = STATE.products.reduce((sum,p)=>sum+totalStock(p)*(p.costPrice||0),0);
  const payables = STATE.suppliers.reduce((sum,s)=>sum+(s.balance||0),0);
  const todayExpenses = STATE.expenses.filter(e=>e.date&&e.date.startsWith(todayStr))
    .reduce((sum,e)=>sum+(e.amount||0),0);
  const pendingQuotes = STATE.quotes.filter(q=>q.status==='pending').length;

  el('todaySales').textContent    = fmtNum(todaySales.toFixed(2));
  el('lowStockCount').textContent = lowStock.length;
  el('customerCount').textContent = STATE.customers.length;
  el('totalDebt').textContent     = fmtNum(receivables.toFixed(2));

  const ext = $('#dashboard-extended');
  if (ext) {
    ext.innerHTML = `
      <div class="stats-grid" style="margin-top:1.5rem;">
        <div class="stat-card" style="border-left:5px solid #8b5cf6;">
          <h3>Monthly Revenue</h3>
          <div class="value">${fmt(monthRevenue)}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">${new Date().toLocaleString('en-NG',{month:'long',year:'numeric'})}</div>
        </div>
        <div class="stat-card" style="border-left:5px solid #06b6d4;">
          <h3>Inventory Value</h3>
          <div class="value">${fmt(inventoryValue)}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">${STATE.products.length} products</div>
        </div>
        <div class="stat-card" style="border-left:5px solid #f43f5e;">
          <h3>Supplier Payables</h3>
          <div class="value">${fmt(payables)}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">${STATE.suppliers.filter(s=>s.balance>0).length} outstanding</div>
        </div>
        <div class="stat-card" style="border-left:5px solid #10b981;">
          <h3>All-Time Sales</h3>
          <div class="value">${fmt(STATE.sales.reduce((a,s)=>a+(s.total||0),0))}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">${STATE.sales.length} transactions</div>
        </div>
        <div class="stat-card" style="border-left:5px solid #f59e0b;">
          <h3>Today's Expenses</h3>
          <div class="value">${fmt(todayExpenses)}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">Net: ${fmt(todaySales - todayExpenses)}</div>
        </div>
        <div class="stat-card" style="border-left:5px solid #0891b2;">
          <h3>Pending Quotes</h3>
          <div class="value">${pendingQuotes}</div>
          <div style="font-size:.8rem;color:#64748b;margin-top:.5rem;">
            <a href="#quotes" onclick="showSection('quotes')" style="color:#0891b2;">View all quotes →</a>
          </div>
        </div>
      </div>

      ${lowStock.length ? `
        <div class="card" style="margin-top:1.5rem;border-left:4px solid #f59e0b;">
          <h3 style="color:#92400e;margin-bottom:1rem;">⚠ Low Stock Alerts (${lowStock.length})</h3>
          <table>
            <thead><tr><th>Product</th><th>Total Stock</th><th>Reorder Level</th><th>Est. Days Left</th><th>Action</th></tr></thead>
            <tbody>${lowStock.map(p=>{
              const avgDaily = calcAvgDailySales(p.id);
              const daysLeft = avgDaily > 0 ? Math.floor(totalStock(p)/avgDaily) : '—';
              return `<tr>
                <td>${p.name}</td>
                <td style="color:#dc2626;font-weight:700;">${totalStock(p)} ${p.unit}</td>
                <td>${p.reorderLevel||STATE.settings.lowStockThreshold}</td>
                <td>${typeof daysLeft==='number' ? daysLeft+' days' : daysLeft}</td>
                <td><button onclick="showSection('purchases')" style="font-size:.8rem;padding:.3rem .7rem;">Reorder</button></td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>` : ''}

      <div class="card" style="margin-top:1.5rem;">
        <h3 style="margin-bottom:1rem;">Active Bulk Discount Tiers</h3>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          ${STATE.bulkDiscountTiers.filter(t=>t.active).map(t=>`
            <div style="background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;border-radius:10px;
              padding:.75rem 1.25rem;font-size:.875rem;min-width:140px;">
              <div style="font-weight:700;font-size:1rem;">${t.discountPct}% OFF</div>
              <div style="opacity:.85;margin-top:.25rem;">${t.name}</div>
              <div style="opacity:.7;font-size:.78rem;margin-top:.2rem;">
                ${t.minQty}${t.maxQty<99999?'–'+t.maxQty:'+'} units
              </div>
            </div>`).join('')}
        </div>
        <p style="font-size:.8rem;color:#64748b;margin-top:.75rem;">
          These are applied automatically at POS when item quantities meet the threshold.
          <a href="#bulk-discounts" onclick="showSection('bulk-discounts')" style="color:#2563eb;">Manage tiers →</a>
        </p>
      </div>

      <div class="card" style="margin-top:1.5rem;">
        <h3 style="margin-bottom:1rem;">Recent Sales</h3>
        ${STATE.sales.length ? `
          <table>
            <thead><tr><th>Receipt/Invoice</th><th>Customer</th><th>Date</th><th>Total</th><th>Discount</th><th>Status</th></tr></thead>
            <tbody>${STATE.sales.slice(-10).reverse().map(s=>`
              <tr>
                <td style="font-family:monospace;">${s.receiptNo||s.invoiceNo||'—'}</td>
                <td>${s.customerName||'Walk-in'}</td>
                <td>${fmtDate(s.date)}</td>
                <td>${fmt(s.total)}</td>
                <td>${(s.totalDiscountAmt||0)>0?fmt(s.totalDiscountAmt):'—'}</td>
                <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus||'paid'}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p style="color:#9ca3af;text-align:center;padding:2rem;">No sales yet.</p>'}
      </div>`;
  }
}

function el(id) { return document.getElementById(id); }

function calcAvgDailySales(productId) {
  const last30 = new Date(); last30.setDate(last30.getDate()-30);
  let total = 0;
  STATE.sales.forEach(s=>{
    if(new Date(s.date)>=last30) {
      s.items.forEach(i=>{ if(i.productId===productId) total+=i.qty; });
    }
  });
  return total/30;
}

/* ════════════════════════════════════════════════════════════════
   5.  WAREHOUSES
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
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">Transfer History</h3>
      <div id="transfer-history"></div>
    </div>`;
  renderWarehouseGrid();
  renderTransferHistory();
}

function renderWarehouseGrid() {
  const grid = $('#wh-grid');
  if (!grid) return;
  grid.innerHTML = STATE.warehouses.map(w => {
    const whProducts = STATE.products.map(p=>({...p, whStock:p.stock[w.id]||0})).filter(p=>p.whStock>0);
    const whValue = whProducts.reduce((sum,p)=>sum+p.whStock*p.costPrice,0);
    return `
      <div class="stat-card" style="border-left:5px solid var(--primary);">
        <div style="display:flex;justify-content:space-between;">
          <h3 style="font-size:1.1rem;color:#1f2937;">${w.name}</h3>
          <div>
            <button onclick="editWarehouse('${w.id}')" style="font-size:.75rem;padding:.2rem .6rem;margin-right:.3rem;background:#6b7280;">Edit</button>
            <button onclick="deleteWarehouse('${w.id}')" style="font-size:.75rem;padding:.2rem .6rem;background:#dc2626;">Del</button>
          </div>
        </div>
        <p style="color:#64748b;font-size:.85rem;margin:.3rem 0;">📍 ${w.location} &nbsp;|&nbsp; 👤 ${w.manager}</p>
        <div class="value" style="font-size:1.5rem;">${fmt(whValue)}</div>
        <p style="font-size:.8rem;color:#64748b;">${whProducts.length} product lines in stock</p>
      </div>`;
  }).join('') || '<p style="color:#9ca3af;">No warehouses. Add one above.</p>';
}

function transferFormHTML() {
  const prodOpts = STATE.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
  const whOpts = STATE.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  return `
    <div class="form-grid">
      <div><label>Product</label><select id="tf-product" style="width:100%;">${prodOpts}</select></div>
      <div><label>From Warehouse</label><select id="tf-from" style="width:100%;">${whOpts}</select></div>
      <div><label>To Warehouse</label><select id="tf-to" style="width:100%;">${whOpts}</select></div>
      <div><label>Quantity</label><input id="tf-qty" type="number" min="1" placeholder="Qty" style="width:100%;"></div>
      <div><label>Note (optional)</label><input id="tf-note" type="text" placeholder="Reason…" style="width:100%;"></div>
    </div>
    <button onclick="doTransfer()">Transfer Stock</button>`;
}

function doTransfer() {
  const pid=($('#tf-product').value), from=($('#tf-from').value), to=($('#tf-to').value);
  const qty=parseInt($('#tf-qty').value), note=($('#tf-note').value.trim());
  if (!pid||!from||!to||!qty) return toast('Fill all transfer fields.','warn');
  if (from===to) return toast('Source and destination must differ.','warn');
  const product=STATE.products.find(p=>p.id===pid);
  if (!product) return;
  const available=product.stock[from]||0;
  if (qty>available) return toast(`Only ${available} ${product.unit}(s) available.`,'error');
  product.stock[from]=available-qty;
  product.stock[to]=(product.stock[to]||0)+qty;
  STATE.stockTransfers.push({ id:uid(), productId:pid, productName:product.name,
    fromId:from, toId:to, fromName:getWarehouseName(from), toName:getWarehouseName(to),
    qty, note, date:nowISO() });
  saveState();
  toast(`Transferred ${qty} ${product.unit}(s) successfully.`,'success');
  renderWarehouseGrid(); renderTransferHistory();
}

function renderTransferHistory() {
  const div = $('#transfer-history');
  if (!div) return;
  if (!STATE.stockTransfers.length) { div.innerHTML='<p style="color:#9ca3af;">No transfers yet.</p>'; return; }
  div.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Product</th><th>From</th><th>To</th><th>Qty</th><th>Note</th></tr></thead>
      <tbody>${STATE.stockTransfers.slice(-20).reverse().map(t=>`
        <tr><td>${fmtDate(t.date)}</td><td>${t.productName}</td><td>${t.fromName}</td>
        <td>${t.toName}</td><td>${fmtNum(t.qty)}</td><td>${t.note||'—'}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

function openAddWarehouse() {
  modal('Add Warehouse',`
    <div class="form-grid">
      <div><label>Warehouse Name</label><input id="wh-name" style="width:100%;" placeholder="e.g. Branch – Umuahia"></div>
      <div><label>Location</label><input id="wh-location" style="width:100%;" placeholder="City"></div>
      <div><label>Manager</label><input id="wh-manager" style="width:100%;" placeholder="Manager name"></div>
    </div>`,(overlay,close)=>{
    const name=$('#wh-name',overlay).value.trim();
    if(!name) return toast('Name required.','warn');
    STATE.warehouses.push({id:'wh'+uid(),name,location:$('#wh-location',overlay).value.trim(),manager:$('#wh-manager',overlay).value.trim()});
    saveState();close();renderWarehouses();toast('Warehouse added.','success');
  });
}
function editWarehouse(id){
  const w=STATE.warehouses.find(x=>x.id===id);if(!w)return;
  modal('Edit Warehouse',`
    <div class="form-grid">
      <div><label>Name</label><input id="wh-name" style="width:100%;" value="${w.name}"></div>
      <div><label>Location</label><input id="wh-location" style="width:100%;" value="${w.location}"></div>
      <div><label>Manager</label><input id="wh-manager" style="width:100%;" value="${w.manager}"></div>
    </div>`,(overlay,close)=>{
    w.name=$('#wh-name',overlay).value.trim()||w.name;
    w.location=$('#wh-location',overlay).value.trim();
    w.manager=$('#wh-manager',overlay).value.trim();
    saveState();close();renderWarehouses();toast('Updated.','success');
  });
}
function deleteWarehouse(id){
  if(!confirm2('Delete this warehouse? Stock data will remain on products.'))return;
  STATE.warehouses=STATE.warehouses.filter(w=>w.id!==id);
  saveState();renderWarehouses();toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   6.  PRODUCTS / INVENTORY
   ════════════════════════════════════════════════════════════════ */
function renderProducts() {
  const sec=$('#products');
  const categories=[...new Set(STATE.products.map(p=>p.category))];
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Products & Inventory</h2>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          <input id="prod-search" type="search" placeholder="Search products…" style="width:200px;">
          <select id="prod-cat-filter" style="width:160px;">
            <option value="">All Categories</option>
            ${categories.map(c=>`<option>${c}</option>`).join('')}
          </select>
          <button onclick="openAddProduct()">+ Add Product</button>
          <button onclick="openPriceUpdateModal()" style="background:#8b5cf6;">✏ Bulk Price Update</button>
          <button onclick="exportProductsXLSX()" style="background:#16a34a;">⬇ Export</button>
        </div>
      </div>
      <div id="products-table-wrap"></div>
    </div>
    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">Price Change History</h3>
      <div id="price-history-wrap"></div>
    </div>`;
  $('#prod-search').oninput=renderProductsTable;
  $('#prod-cat-filter').onchange=renderProductsTable;
  renderProductsTable();
  renderPriceHistory();
}

function renderProductsTable(){
  const search=($('#prod-search')?.value||'').toLowerCase();
  const cat=$('#prod-cat-filter')?.value||'';
  const low=STATE.settings.lowStockThreshold;
  const filtered=STATE.products.filter(p=>
    (!cat||p.category===cat)&&(!search||p.name.toLowerCase().includes(search)||p.sku.toLowerCase().includes(search))
  );
  const wrap=$('#products-table-wrap');
  if(!wrap)return;
  if(!filtered.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No products found.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr>
        <th>SKU</th><th>Product</th><th>Category</th><th>Unit</th>
        <th>Cost Price</th><th>Selling Price</th><th>Margin</th><th>Total Stock</th><th>Value</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${filtered.map(p=>{
          const stock=totalStock(p);
          const val=stock*p.costPrice;
          const isLow=stock<=(p.reorderLevel||low);
          const margin=p.sellingPrice>0?((p.sellingPrice-p.costPrice)/p.sellingPrice*100):0;
          return `<tr style="${isLow?'background:#fef9c3;':''}">
            <td style="font-family:monospace;">${p.sku}</td>
            <td><strong>${p.name}</strong>${p.barcode?`<br><small style="color:#9ca3af;">🔢 ${p.barcode}</small>`:''}</td>
            <td><span class="badge badge-blue">${p.category}</span></td>
            <td>${p.unit}</td>
            <td>${fmt(p.costPrice)}</td>
            <td>${fmt(p.sellingPrice)}</td>
            <td style="color:${margin>=20?'#16a34a':margin>=10?'#d97706':'#dc2626'};font-weight:600;">${fmtPct(margin)}</td>
            <td style="font-weight:700;color:${isLow?'#dc2626':'#16a34a'};">
              ${fmtNum(stock)} ${isLow?'⚠':''}
              <div style="font-size:.75rem;color:#64748b;margin-top:.2rem;">
                ${STATE.warehouses.map(w=>`${w.name.split('–')[0].trim()}: ${p.stock[w.id]||0}`).join(' | ')}
              </div>
            </td>
            <td>${fmt(val)}</td>
            <td style="white-space:nowrap;">
              <button onclick="editProduct('${p.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
              <button onclick="adjustStock('${p.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Stock</button>
              <button onclick="viewPriceHistory('${p.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#8b5cf6;margin-right:.3rem;">History</button>
              <button onclick="deleteProduct('${p.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="8" style="font-weight:700;text-align:right;">Total Inventory Value:</td>
          <td style="font-weight:700;">${fmt(filtered.reduce((s,p)=>s+totalStock(p)*p.costPrice,0))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;
}

function renderPriceHistory(){
  const wrap=$('#price-history-wrap');
  if(!wrap)return;
  if(!STATE.priceHistory.length){wrap.innerHTML='<p style="color:#9ca3af;">No price changes recorded yet.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Date</th><th>Product</th><th>Old Cost</th><th>New Cost</th><th>Old Sell</th><th>New Sell</th><th>Changed By</th></tr></thead>
      <tbody>${STATE.priceHistory.slice(-30).reverse().map(h=>`
        <tr>
          <td>${fmtDate(h.date)}</td><td>${h.productName}</td>
          <td>${fmt(h.oldCost)}</td><td>${fmt(h.newCost)}</td>
          <td>${fmt(h.oldSell)}</td><td>${fmt(h.newSell)}</td>
          <td>${h.changedBy||'System'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function productFormHTML(p={}){
  const catList=[...new Set(STATE.products.map(x=>x.category))];
  const whFields=STATE.warehouses.map(w=>
    `<div><label>Stock in ${w.name}</label>
     <input type="number" id="ps-${w.id}" style="width:100%;" min="0" value="${p.stock?.[w.id]??0}"></div>`
  ).join('');
  const supOpts=STATE.suppliers.map(s=>`<option value="${s.id}" ${p.supplierId===s.id?'selected':''}>${s.name}</option>`).join('');
  return `
    <div class="form-grid">
      <div><label>Product Name *</label><input id="pf-name" style="width:100%;" value="${p.name||''}"></div>
      <div><label>SKU / Code *</label><input id="pf-sku" style="width:100%;" value="${p.sku||''}"></div>
      <div><label>Barcode (optional)</label><input id="pf-barcode" style="width:100%;" value="${p.barcode||''}"></div>
      <div><label>Category</label>
        <input id="pf-cat" style="width:100%;" list="cat-list" value="${p.category||''}">
        <datalist id="cat-list">${catList.map(c=>`<option>${c}</option>`).join('')}</datalist>
      </div>
      <div><label>Unit (Bag, Keg, Ctn…)</label><input id="pf-unit" style="width:100%;" value="${p.unit||''}"></div>
      <div><label>Cost Price (₦)</label><input id="pf-cost" type="number" style="width:100%;" value="${p.costPrice||''}"></div>
      <div><label>Selling Price (₦)</label><input id="pf-sell" type="number" style="width:100%;" value="${p.sellingPrice||''}"></div>
      <div><label>Reorder Level</label><input id="pf-reorder" type="number" style="width:100%;" value="${p.reorderLevel||10}"></div>
      <div><label>Supplier</label><select id="pf-sup" style="width:100%;"><option value="">None</option>${supOpts}</select></div>
      <div style="grid-column:1/-1;"><label>Description</label><input id="pf-desc" style="width:100%;" value="${p.description||''}"></div>
      <div style="grid-column:1/-1;"><strong>Stock by Warehouse</strong></div>
      ${whFields}
    </div>`;
}

function openAddProduct(){
  modal('Add Product',productFormHTML(),(overlay,close)=>{
    const name=$('#pf-name',overlay).value.trim();
    const sku=$('#pf-sku',overlay).value.trim();
    if(!name||!sku)return toast('Name and SKU required.','warn');
    if(STATE.products.find(p=>p.sku===sku))return toast('SKU already exists.','error');
    const stock={};
    STATE.warehouses.forEach(w=>{stock[w.id]=parseInt($(`#ps-${w.id}`,overlay).value)||0;});
    STATE.products.push({
      id:'P'+uid(),name,sku,barcode:$('#pf-barcode',overlay).value.trim(),
      category:$('#pf-cat',overlay).value.trim(),unit:$('#pf-unit',overlay).value.trim(),
      costPrice:parseFloat($('#pf-cost',overlay).value)||0,
      sellingPrice:parseFloat($('#pf-sell',overlay).value)||0,
      reorderLevel:parseInt($('#pf-reorder',overlay).value)||10,
      supplierId:$('#pf-sup',overlay).value,
      description:$('#pf-desc',overlay).value.trim(),stock,
    });
    saveState();close();renderProductsTable();toast('Product added.','success');
  });
}

function editProduct(id){
  const p=STATE.products.find(x=>x.id===id);if(!p)return;
  modal(`Edit – ${p.name}`,productFormHTML(p),(overlay,close)=>{
    const oldCost=p.costPrice, oldSell=p.sellingPrice;
    p.name=$('#pf-name',overlay).value.trim()||p.name;
    p.sku=$('#pf-sku',overlay).value.trim()||p.sku;
    p.barcode=$('#pf-barcode',overlay).value.trim();
    p.category=$('#pf-cat',overlay).value.trim();
    p.unit=$('#pf-unit',overlay).value.trim();
    p.costPrice=parseFloat($('#pf-cost',overlay).value)||p.costPrice;
    p.sellingPrice=parseFloat($('#pf-sell',overlay).value)||p.sellingPrice;
    p.reorderLevel=parseInt($('#pf-reorder',overlay).value)||p.reorderLevel;
    p.supplierId=$('#pf-sup',overlay).value;
    p.description=$('#pf-desc',overlay).value.trim();
    STATE.warehouses.forEach(w=>{p.stock[w.id]=parseInt($(`#ps-${w.id}`,overlay).value)||0;});
    if(oldCost!==p.costPrice||oldSell!==p.sellingPrice){
      STATE.priceHistory.push({date:nowISO(),productId:p.id,productName:p.name,
        oldCost,newCost:p.costPrice,oldSell,newSell:p.sellingPrice,changedBy:'User'});
    }
    saveState();close();renderProductsTable();renderPriceHistory();toast('Product updated.','success');
  });
}

function viewPriceHistory(productId){
  const p=STATE.products.find(x=>x.id===productId);
  const hist=STATE.priceHistory.filter(h=>h.productId===productId).reverse();
  modal(`Price History – ${p?.name}`,`
    ${hist.length?`
      <table>
        <thead><tr><th>Date</th><th>Old Cost</th><th>New Cost</th><th>Old Sell</th><th>New Sell</th></tr></thead>
        <tbody>${hist.map(h=>`
          <tr><td>${fmtDate(h.date)}</td><td>${fmt(h.oldCost)}</td><td>${fmt(h.newCost)}</td>
          <td>${fmt(h.oldSell)}</td><td>${fmt(h.newSell)}</td></tr>`).join('')}
        </tbody>
      </table>`:
    '<p style="color:#9ca3af;">No price changes for this product.</p>'}`,null,'Close');
}

function openPriceUpdateModal(){
  const prodOpts=STATE.products.map(p=>`
    <tr>
      <td><input type="checkbox" class="bulk-price-chk" value="${p.id}"> ${p.name}</td>
      <td style="font-family:monospace;">${p.sku}</td>
      <td>${fmt(p.costPrice)}</td><td>${fmt(p.sellingPrice)}</td>
    </tr>`).join('');
  modal('Bulk Price Update',`
    <div style="margin-bottom:1rem;display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div><label>Adjustment Type</label>
        <select id="bpu-type" style="width:160px;">
          <option value="pct-up">% Increase</option>
          <option value="pct-dn">% Decrease</option>
          <option value="fixed-up">Fixed Increase</option>
          <option value="fixed-dn">Fixed Decrease</option>
          <option value="set-margin">Set Margin %</option>
        </select>
      </div>
      <div><label>Value</label><input id="bpu-val" type="number" min="0" style="width:120px;" placeholder="e.g. 10"></div>
      <div><label>Apply To</label>
        <select id="bpu-apply" style="width:140px;">
          <option value="sell">Selling Price Only</option>
          <option value="cost">Cost Price Only</option>
          <option value="both">Both Prices</option>
        </select>
      </div>
    </div>
    <div style="max-height:300px;overflow-y:auto;">
      <table>
        <thead><tr><th style="width:40px;"><input type="checkbox" id="bpu-all" onchange="$$('.bulk-price-chk').forEach(c=>c.checked=this.checked)"></th>
          <th>Product</th><th>Current Cost</th><th>Current Sell</th></tr></thead>
        <tbody>${prodOpts}</tbody>
      </table>
    </div>
    <p style="color:#64748b;font-size:.8rem;margin-top:.75rem;">Select products above and apply price change.</p>`,
  (overlay,close)=>{
    const type=$('#bpu-type',overlay).value;
    const val=parseFloat($('#bpu-val',overlay).value);
    const applyTo=$('#bpu-apply',overlay).value;
    if(isNaN(val)||val<0)return toast('Enter a valid value.','warn');
    const selected=[...$$('.bulk-price-chk',overlay)].filter(c=>c.checked).map(c=>c.value);
    if(!selected.length)return toast('Select at least one product.','warn');
    selected.forEach(pid=>{
      const p=STATE.products.find(x=>x.id===pid);if(!p)return;
      const oldCost=p.costPrice,oldSell=p.sellingPrice;
      function adjust(price){
        if(type==='pct-up')  return price*(1+val/100);
        if(type==='pct-dn')  return price*(1-val/100);
        if(type==='fixed-up')return price+val;
        if(type==='fixed-dn')return Math.max(0,price-val);
        if(type==='set-margin')return p.costPrice/(1-val/100);
        return price;
      }
      if(applyTo==='sell'||applyTo==='both') p.sellingPrice=Math.round(adjust(p.sellingPrice));
      if(applyTo==='cost'||applyTo==='both') p.costPrice=Math.round(adjust(p.costPrice));
      if(oldCost!==p.costPrice||oldSell!==p.sellingPrice){
        STATE.priceHistory.push({date:nowISO(),productId:p.id,productName:p.name,
          oldCost,newCost:p.costPrice,oldSell,newSell:p.sellingPrice,changedBy:'Bulk Update'});
      }
    });
    saveState();close();renderProductsTable();renderPriceHistory();
    toast(`Updated prices for ${selected.length} product(s).`,'success');
  },'Apply Changes','700px');
}

function adjustStock(id){
  const p=STATE.products.find(x=>x.id===id);if(!p)return;
  const whOpts=STATE.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  modal(`Adjust Stock – ${p.name}`,`
    <div class="form-grid">
      <div><label>Warehouse</label><select id="adj-wh" style="width:100%;">${whOpts}</select></div>
      <div><label>Adjustment Type</label>
        <select id="adj-type" style="width:100%;">
          <option value="add">Add (Purchase/Return)</option>
          <option value="sub">Subtract (Damage/Loss)</option>
          <option value="set">Set Exact Value</option>
        </select></div>
      <div><label>Quantity</label><input id="adj-qty" type="number" min="0" style="width:100%;"></div>
      <div><label>Reason</label><input id="adj-reason" style="width:100%;" placeholder="Optional note"></div>
    </div>
    <p style="margin-top:.5rem;color:#64748b;font-size:.875rem;">
      Current: ${STATE.warehouses.map(w=>`${w.name}: <strong>${p.stock[w.id]||0}</strong>`).join(' | ')}
    </p>`,(overlay,close)=>{
    const whId=$('#adj-wh',overlay).value,type=$('#adj-type',overlay).value;
    const qty=parseFloat($('#adj-qty',overlay).value);
    if(isNaN(qty)||qty<0)return toast('Enter valid quantity.','warn');
    if(type==='add')p.stock[whId]=(p.stock[whId]||0)+qty;
    else if(type==='sub')p.stock[whId]=Math.max(0,(p.stock[whId]||0)-qty);
    else p.stock[whId]=qty;
    saveState();close();renderProductsTable();toast('Stock adjusted.','success');
  });
}
function deleteProduct(id){
  if(!confirm2('Delete this product permanently?'))return;
  STATE.products=STATE.products.filter(p=>p.id!==id);
  saveState();renderProductsTable();toast('Product deleted.','warn');
}
function exportProductsXLSX(){
  const rows=STATE.products.map(p=>({
    SKU:p.sku,Name:p.name,Category:p.category,Unit:p.unit,
    'Cost Price':p.costPrice,'Selling Price':p.sellingPrice,
    'Margin %':((p.sellingPrice-p.costPrice)/p.sellingPrice*100).toFixed(1),
    'Total Stock':totalStock(p),'Inventory Value':totalStock(p)*p.costPrice,
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Products');
  XLSX.writeFile(wb,'cnjohnson_products.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   7.  BULK DISCOUNT MANAGEMENT
   ════════════════════════════════════════════════════════════════ */
function renderBulkDiscounts(){
  const sec=$('#bulk-discounts');
  if(!sec)return;
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0;">Bulk Quantity Discount Tiers</h2>
          <p style="color:#64748b;font-size:.875rem;margin:.3rem 0 0;">
            Automatic discounts applied at POS based on item quantity. Higher quantity = bigger discount.
          </p>
        </div>
        <div style="display:flex;gap:.75rem;">
          <label style="display:flex;align-items:center;gap:.5rem;font-size:.9rem;cursor:pointer;">
            <input type="checkbox" ${STATE.settings.enableBulkDiscount?'checked':''} onchange="STATE.settings.enableBulkDiscount=this.checked;saveState();toast('Bulk discounts '+(this.checked?'enabled':'disabled')+'.','info');">
            Enable Bulk Discounts
          </label>
          <button onclick="openAddDiscountTier()">+ Add Tier</button>
        </div>
      </div>

      <!-- Visual tier display -->
      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem;padding:1.25rem;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;">
        ${STATE.bulkDiscountTiers.filter(t=>t.active).sort((a,b)=>a.minQty-b.minQty).map((t,i)=>`
          <div style="display:flex;align-items:center;gap:.75rem;">
            <div style="text-align:center;background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;
              border-radius:10px;padding:1rem 1.25rem;min-width:120px;">
              <div style="font-size:1.5rem;font-weight:800;">${t.discountPct}%</div>
              <div style="font-size:.8rem;opacity:.85;margin-top:.2rem;">${t.name}</div>
              <div style="font-size:.75rem;opacity:.7;margin-top:.2rem;">
                ${t.minQty}${t.maxQty<99999?'–'+t.maxQty:'+'} units
              </div>
            </div>
            ${i<STATE.bulkDiscountTiers.filter(t=>t.active).length-1?
              '<div style="color:#94a3b8;font-size:1.25rem;">→</div>':''
            }
          </div>`).join('')}
        ${!STATE.bulkDiscountTiers.filter(t=>t.active).length?
          '<p style="color:#9ca3af;">No active tiers. Add one to get started.</p>':''}
      </div>

      <table>
        <thead><tr>
          <th>Tier Name</th><th>Min Qty</th><th>Max Qty</th><th>Discount %</th>
          <th>Applies To</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${STATE.bulkDiscountTiers.map(t=>`
            <tr>
              <td><strong>${t.name}</strong></td>
              <td>${fmtNum(t.minQty)}</td>
              <td>${t.maxQty>=99999?'Unlimited':fmtNum(t.maxQty)}</td>
              <td><span style="font-size:1.1rem;font-weight:700;color:#2563eb;">${t.discountPct}%</span></td>
              <td>${t.productIds&&t.productIds.length?`${t.productIds.length} specific product(s)`:'All products'}</td>
              <td>
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
                  <input type="checkbox" ${t.active?'checked':''} 
                    onchange="toggleDiscountTier('${t.id}',this.checked)"> Active
                </label>
              </td>
              <td style="white-space:nowrap;">
                <button onclick="editDiscountTier('${t.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
                <button onclick="deleteDiscountTier('${t.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-top:1.5rem;">
      <h3 style="margin-bottom:1rem;">How Bulk Discounts Work at POS</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;">
        <div style="background:#eff6ff;border-radius:8px;padding:1rem;border-left:4px solid #2563eb;">
          <h4 style="color:#1e40af;margin:0 0 .5rem;">🔢 Per-Item Calculation</h4>
          <p style="color:#374151;font-size:.875rem;margin:0;">Each cart item's quantity is checked independently against discount tiers.</p>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:1rem;border-left:4px solid #16a34a;">
          <h4 style="color:#15803d;margin:0 0 .5rem;">🏆 Best Tier Wins</h4>
          <p style="color:#374151;font-size:.875rem;margin:0;">If multiple tiers match, the highest discount percentage is applied automatically.</p>
        </div>
        <div style="background:#fff7ed;border-radius:8px;padding:1rem;border-left:4px solid #f59e0b;">
          <h4 style="color:#b45309;margin:0 0 .5rem;">💡 Upsell Prompts</h4>
          <p style="color:#374151;font-size:.875rem;margin:0;">POS shows "Add X more to get Y% discount" nudges to help close bigger deals.</p>
        </div>
        <div style="background:#fdf4ff;border-radius:8px;padding:1rem;border-left:4px solid #8b5cf6;">
          <h4 style="color:#7c3aed;margin:0 0 .5rem;">🎯 Product-Specific</h4>
          <p style="color:#374151;font-size:.875rem;margin:0;">Tiers can be restricted to specific products or apply globally to all items.</p>
        </div>
      </div>
    </div>`;
}

function toggleDiscountTier(id, active){
  const t=STATE.bulkDiscountTiers.find(x=>x.id===id);
  if(t){ t.active=active; saveState(); toast(`Tier "${t.name}" ${active?'activated':'deactivated'}.`,'info'); }
}

function discountTierFormHTML(t={}){
  const prodOptions=STATE.products.map(p=>`
    <label style="display:flex;align-items:center;gap:.4rem;font-size:.85rem;cursor:pointer;">
      <input type="checkbox" class="dt-prod" value="${p.id}" 
        ${(t.productIds||[]).includes(p.id)?'checked':''}> ${p.name}
    </label>`).join('');
  return `
    <div class="form-grid">
      <div><label>Tier Name *</label><input id="dt-name" style="width:100%;" value="${t.name||''}"></div>
      <div><label>Discount % *</label><input id="dt-pct" type="number" min="0.1" max="99" step="0.5" style="width:100%;" value="${t.discountPct||''}"></div>
      <div><label>Minimum Quantity *</label><input id="dt-min" type="number" min="1" style="width:100%;" value="${t.minQty||''}"></div>
      <div><label>Maximum Quantity (leave 0 for unlimited)</label><input id="dt-max" type="number" min="0" style="width:100%;" value="${t.maxQty>=99999?0:(t.maxQty||0)}"></div>
    </div>
    <div style="margin-top:1rem;">
      <label>Applies To (leave all unchecked = all products)</label>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.4rem;
        max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;padding:.75rem;margin-top:.4rem;">
        ${prodOptions}
      </div>
    </div>`;
}

function openAddDiscountTier(){
  modal('Add Bulk Discount Tier',discountTierFormHTML(),(overlay,close)=>{
    const name=$('#dt-name',overlay).value.trim();
    const pct=parseFloat($('#dt-pct',overlay).value);
    const min=parseInt($('#dt-min',overlay).value);
    const maxRaw=parseInt($('#dt-max',overlay).value)||0;
    const max=maxRaw===0?99999:maxRaw;
    if(!name||isNaN(pct)||isNaN(min))return toast('Fill required fields.','warn');
    if(min>=max&&max!==99999)return toast('Max qty must be greater than min.','warn');
    const productIds=[...$$('.dt-prod',overlay)].filter(c=>c.checked).map(c=>c.value);
    STATE.bulkDiscountTiers.push({id:'BD'+uid(),name,discountPct:pct,minQty:min,maxQty:max,productIds,active:true});
    saveState();close();renderBulkDiscounts();toast('Discount tier added.','success');
  });
}
function editDiscountTier(id){
  const t=STATE.bulkDiscountTiers.find(x=>x.id===id);if(!t)return;
  modal(`Edit Tier – ${t.name}`,discountTierFormHTML(t),(overlay,close)=>{
    t.name=$('#dt-name',overlay).value.trim()||t.name;
    t.discountPct=parseFloat($('#dt-pct',overlay).value)||t.discountPct;
    t.minQty=parseInt($('#dt-min',overlay).value)||t.minQty;
    const maxRaw=parseInt($('#dt-max',overlay).value)||0;
    t.maxQty=maxRaw===0?99999:maxRaw;
    t.productIds=[...$$('.dt-prod',overlay)].filter(c=>c.checked).map(c=>c.value);
    saveState();close();renderBulkDiscounts();toast('Tier updated.','success');
  });
}
function deleteDiscountTier(id){
  if(!confirm2('Delete this discount tier?'))return;
  STATE.bulkDiscountTiers=STATE.bulkDiscountTiers.filter(t=>t.id!==id);
  saveState();renderBulkDiscounts();toast('Tier deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   8.  POINT OF SALE (POS)  ← ENHANCED with bulk discounts
   ════════════════════════════════════════════════════════════════ */
let posCart=[];
let posWarehouse=STATE.warehouses[0]?.id||'';

function renderPOS(){
  const sec=$('#pos');
  const custOpts=`<option value="">Walk-in Customer</option>`+
    STATE.customers.map(c=>`<option value="${c.id}">${c.name}${c.balance>0?' ⚠('+fmt(c.balance)+' owed)':''}</option>`).join('');
  const repOpts=`<option value="">No Rep</option>`+
    STATE.salesReps.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  const whOpts=STATE.warehouses.map(w=>`<option value="${w.id}" ${w.id===posWarehouse?'selected':''}>${w.name}</option>`).join('');
  const prodOpts=STATE.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');

  sec.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 420px;gap:1.5rem;align-items:start;">

      <div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h2 style="margin:0;">Point of Sale</h2>
            ${STATE.settings.enableBulkDiscount?
              `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:.4rem .75rem;
                font-size:.8rem;color:#1e40af;font-weight:600;">✓ Bulk Discounts Active</div>`:''}
          </div>
          <div class="form-grid" style="margin-bottom:1rem;">
            <div>
              <label>Selling From Warehouse</label>
              <select id="pos-wh" style="width:100%;" onchange="posWarehouse=this.value;renderProductPalette();">${whOpts}</select>
            </div>
            <div>
              <label>Customer</label>
              <select id="pos-customer" style="width:100%;" onchange="onPOSCustomerChange()">${custOpts}</select>
            </div>
            <div>
              <label>Sales Rep</label>
              <select id="pos-rep" style="width:100%;">${repOpts}</select>
            </div>
            <div>
              <label>Payment Method</label>
              <select id="pos-payment" style="width:100%;">
                <option value="cash">Cash</option>
                <option value="transfer">Bank Transfer</option>
                <option value="pos-machine">POS Machine</option>
                <option value="credit">Credit (Invoice)</option>
                <option value="cheque">Cheque</option>
                <option value="split">Split Payment</option>
              </select>
            </div>
          </div>

          <div id="pos-loyalty-banner" style="display:none;background:#fdf4ff;border:1px solid #e9d5ff;
            border-radius:8px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.875rem;">
          </div>

          <div style="display:flex;gap:.75rem;margin-bottom:1rem;">
            <input id="pos-prod-search" type="search" placeholder="Search or scan barcode…" style="flex:1;"
              oninput="renderProductPalette();">
          </div>
          <div id="pos-product-palette" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem;max-height:360px;overflow-y:auto;"></div>
        </div>
      </div>

      <!-- Cart Panel -->
      <div class="card" style="position:sticky;top:1rem;">
        <h3 style="margin-bottom:1rem;">🛒 Cart</h3>
        <div id="pos-cart-items" style="max-height:340px;overflow-y:auto;"></div>

        <div id="pos-bulk-savings" style="display:none;background:#f0fdf4;border-radius:8px;
          padding:.6rem 1rem;margin-top:.75rem;font-size:.8rem;color:#15803d;font-weight:600;"></div>

        <div style="border-top:1px solid #e5e7eb;margin-top:1rem;padding-top:1rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#64748b;">
            <span>Subtotal:</span><strong id="pos-subtotal">₦0.00</strong>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#16a34a;font-weight:600;"
            id="pos-bulk-line" style="display:none;">
            <span>🏷 Bulk Discount:</span><strong id="pos-bulk-discount">₦0.00</strong>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
            <label>Extra Discount (%):</label>
            <input id="pos-discount" type="number" min="0" max="100" value="0"
              style="width:80px;text-align:right;" oninput="updatePOSTotals()">
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:.5rem;color:#64748b;">
            <span>Tax (${STATE.settings.taxRate}%):</span><strong id="pos-tax">₦0.00</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:1.4rem;font-weight:700;
            border-top:2px solid #e5e7eb;padding-top:.75rem;">
            <span>TOTAL:</span><span id="pos-total">₦0.00</span>
          </div>
        </div>

        <div style="margin-top:.5rem;">
          <label>Amount Tendered (₦):</label>
          <input id="pos-tendered" type="number" min="0" style="width:100%;margin-top:.25rem;" oninput="updateChange()">
          <div id="pos-change-display" style="margin-top:.4rem;font-weight:600;color:#16a34a;"></div>
        </div>

        <!-- Loyalty points redemption -->
        <div id="pos-loyalty-redeem" style="display:none;background:#fdf4ff;border-radius:8px;
          padding:.6rem 1rem;margin-top:.75rem;">
          <label style="color:#7c3aed;">🌟 Redeem Loyalty Points</label>
          <div style="display:flex;gap:.5rem;margin-top:.4rem;">
            <input id="pos-redeem-pts" type="number" min="0" placeholder="Points to redeem"
              style="flex:1;" oninput="updatePOSTotals()">
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

function onPOSCustomerChange(){
  const custId=$('#pos-customer')?.value;
  const customer=STATE.customers.find(c=>c.id===custId);
  const banner=$('#pos-loyalty-banner');
  const redeemDiv=$('#pos-loyalty-redeem');
  if(customer&&(customer.loyaltyPoints||0)>0){
    const pts=customer.loyaltyPoints||0;
    const val=pts*(STATE.settings.loyaltyRedemptionRate||100);
    if(banner){banner.style.display='block';banner.innerHTML=`🌟 <strong>${customer.name}</strong> has <strong>${pts} loyalty points</strong> (worth ${fmt(val)}). Redeem below.`;}
    if(redeemDiv){redeemDiv.style.display='block';}
  } else {
    if(banner)banner.style.display='none';
    if(redeemDiv)redeemDiv.style.display='none';
  }
}

function renderProductPalette(){
  const search=($('#pos-prod-search')?.value||'').toLowerCase();
  const wh=$('#pos-wh')?.value||posWarehouse;
  posWarehouse=wh;
  const filtered=STATE.products.filter(p=>
    (p.stock[wh]||0)>0&&
    (!search||p.name.toLowerCase().includes(search)||p.sku.toLowerCase().includes(search)||(p.barcode||'').includes(search))
  );
  const pal=$('#pos-product-palette');
  if(!pal)return;
  pal.innerHTML=filtered.map(p=>{
    const bulkLabel=getBulkDiscountLabel(p.id);
    return `
      <div onclick="addToCart('${p.id}')" style="
        background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
        padding:1rem;cursor:pointer;transition:all .15s;user-select:none;position:relative;"
        onmouseover="this.style.background='#eff6ff';this.style.borderColor='#2563eb';"
        onmouseout="this.style.background='#f8fafc';this.style.borderColor='#e2e8f0';">
        ${bulkLabel?`<div style="position:absolute;top:-8px;right:-8px;background:#16a34a;color:#fff;
          border-radius:20px;font-size:.65rem;padding:.15rem .5rem;font-weight:700;">BULK ${bulkLabel}</div>`:''}
        <div style="font-weight:600;font-size:.875rem;margin-bottom:.3rem;">${p.name}</div>
        <div style="color:#2563eb;font-weight:700;">${fmt(p.sellingPrice)}</div>
        <div style="font-size:.75rem;color:#64748b;margin-top:.3rem;">
          Stock: ${fmtNum(p.stock[wh]||0)} ${p.unit}
        </div>
      </div>`;
  }).join('')||
    `<p style="color:#9ca3af;grid-column:1/-1;text-align:center;padding:2rem;">No products found in this warehouse.</p>`;
}

function getBulkDiscountLabel(productId){
  const activeTiers=STATE.bulkDiscountTiers.filter(t=>t.active&&(t.productIds.length===0||t.productIds.includes(productId)));
  if(!activeTiers.length)return null;
  const best=activeTiers.sort((a,b)=>a.minQty-b.minQty)[0];
  return `${best.discountPct}%@${best.minQty}+`;
}

function addToCart(productId){
  const product=STATE.products.find(p=>p.id===productId);if(!product)return;
  const existing=posCart.find(item=>item.productId===productId);
  const wh=posWarehouse;
  if(existing){
    if(existing.qty>=(product.stock[wh]||0))return toast('Not enough stock.','warn');
    existing.qty++;
  } else {
    if((product.stock[wh]||0)===0)return toast('Out of stock in this warehouse.','warn');
    posCart.push({
      productId,name:product.name,unit:product.unit,
      unitPrice:product.sellingPrice,costPrice:product.costPrice,qty:1,
      manualDiscountPct:0,
    });
  }
  renderCartItems();
  updatePOSTotals();
}

function renderCartItems(){
  const wrap=$('#pos-cart-items');
  if(!wrap)return;
  if(!posCart.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:1rem;">Cart is empty.</p>';return;}
  wrap.innerHTML=posCart.map((item,i)=>{
    const bulkPct=getBulkDiscount(item.productId,item.qty);
    const effectiveDisc=Math.max(bulkPct,item.manualDiscountPct||0);
    const lineTotal=item.qty*item.unitPrice*(1-effectiveDisc/100);
    const nextTier=getNextBulkTier(item.productId,item.qty);
    return `
      <div style="padding:.6rem 0;border-bottom:1px solid #f3f4f6;">
        <div style="display:flex;align-items:center;gap:.5rem;">
          <div style="flex:1;font-size:.875rem;">
            <div style="font-weight:600;">${item.name}</div>
            <div style="color:#64748b;font-size:.8rem;">${fmt(item.unitPrice)} / ${item.unit}</div>
          </div>
          <div style="display:flex;align-items:center;gap:.25rem;">
            <button onclick="changeQty(${i},-1)" style="width:26px;height:26px;padding:0;text-align:center;font-size:.9rem;">−</button>
            <input type="number" value="${item.qty}" min="1" style="width:52px;text-align:center;padding:.2rem;font-size:.875rem;"
              onchange="setQty(${i},this.value)">
            <button onclick="changeQty(${i},1)" style="width:26px;height:26px;padding:0;text-align:center;font-size:.9rem;">+</button>
          </div>
          <div style="min-width:85px;text-align:right;font-weight:700;">${fmt(lineTotal)}</div>
          <button onclick="removeCartItem(${i})" style="background:#fee2e2;color:#dc2626;border:none;
            width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:.85rem;padding:0;">×</button>
        </div>

        <!-- Discount row -->
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.4rem;flex-wrap:wrap;">
          ${bulkPct>0?`
            <span style="background:#d1fae5;color:#065f46;border-radius:20px;font-size:.72rem;
              padding:.15rem .6rem;font-weight:700;">🏷 ${bulkPct}% bulk discount</span>`:''
          }
          <div style="display:flex;align-items:center;gap:.3rem;margin-left:auto;">
            <span style="font-size:.75rem;color:#64748b;">Extra %:</span>
            <input type="number" min="0" max="100" value="${item.manualDiscountPct||0}"
              style="width:50px;font-size:.78rem;padding:.15rem .3rem;text-align:center;"
              onchange="setItemDiscount(${i},this.value)" placeholder="0">
          </div>
        </div>

        <!-- Upsell nudge -->
        ${nextTier&&STATE.settings.enableBulkDiscount?`
          <div style="margin-top:.35rem;font-size:.75rem;color:#b45309;background:#fef9c3;
            border-radius:6px;padding:.25rem .6rem;">
            💡 Add ${nextTier.minQty-item.qty} more → get <strong>${nextTier.discountPct}% off</strong> (${nextTier.name})
          </div>`:''}
      </div>`;
  }).join('');
}

function setItemDiscount(i, val){
  posCart[i].manualDiscountPct=Math.max(0,Math.min(100,parseFloat(val)||0));
  renderCartItems(); updatePOSTotals();
}

function changeQty(i,delta){
  posCart[i].qty=Math.max(1,posCart[i].qty+delta);
  const product=STATE.products.find(p=>p.id===posCart[i].productId);
  if(product&&posCart[i].qty>(product.stock[posWarehouse]||0)){
    posCart[i].qty--; return toast('Not enough stock.','warn');
  }
  renderCartItems(); updatePOSTotals();
}
function setQty(i,val){
  posCart[i].qty=Math.max(1,parseInt(val)||1);
  renderCartItems(); updatePOSTotals();
}
function removeCartItem(i){posCart.splice(i,1);renderCartItems();updatePOSTotals();}
function clearCart(){posCart=[];renderCartItems();updatePOSTotals();}

function updatePOSTotals(){
  let subtotal=0, totalBulkSaving=0, totalManualDisc=0;
  posCart.forEach(item=>{
    const base=item.qty*item.unitPrice;
    const bulkPct=getBulkDiscount(item.productId,item.qty);
    const manualPct=item.manualDiscountPct||0;
    const effectivePct=Math.max(bulkPct,manualPct);
    const discAmt=base*(effectivePct/100);
    if(bulkPct>0) totalBulkSaving+=base*(bulkPct/100);
    if(manualPct>0&&manualPct>bulkPct) totalManualDisc+=discAmt;
    subtotal+=(base-discAmt);
  });

  // Extra manual discount on total
  const extraDiscPct=parseFloat($('#pos-discount')?.value)||0;
  const extraDiscAmt=subtotal*(extraDiscPct/100);
  const afterDisc=subtotal-extraDiscAmt;

  // Loyalty point redemption
  const custId=$('#pos-customer')?.value;
  const customer=STATE.customers.find(c=>c.id===custId);
  let redeemVal=0;
  const redeemPtsEl=$('#pos-redeem-pts');
  if(redeemPtsEl&&customer){
    const pts=Math.min(parseFloat(redeemPtsEl.value)||0,customer.loyaltyPoints||0);
    redeemVal=pts*(STATE.settings.loyaltyRedemptionRate||100);
    const pvEl=$('#pos-points-value');
    if(pvEl) pvEl.textContent=pts>0?`= ${fmt(redeemVal)}`:'';
  }

  const tax=afterDisc*STATE.settings.taxRate/100;
  const total=Math.max(0,afterDisc+tax-redeemVal);

  if($('#pos-subtotal')) $('#pos-subtotal').textContent=fmt(subtotal);
  if($('#pos-tax'))      $('#pos-tax').textContent=fmt(tax);
  if($('#pos-total'))    $('#pos-total').textContent=fmt(total);

  // Bulk savings banner
  const savingsDiv=$('#pos-bulk-savings');
  const bulkLine=$('#pos-bulk-line');
  const bulkDiscEl=$('#pos-bulk-discount');
  if(savingsDiv){
    if(totalBulkSaving>0){
      savingsDiv.style.display='block';
      savingsDiv.textContent=`🏷 Bulk discounts saving customer ${fmt(totalBulkSaving)} on this order!`;
    } else { savingsDiv.style.display='none'; }
  }
  if(bulkLine) bulkLine.style.display=totalBulkSaving>0?'flex':'none';
  if(bulkDiscEl) bulkDiscEl.textContent='-'+fmt(totalBulkSaving);

  updateChange();
}

function updateChange(){
  const tendered=parseFloat($('#pos-tendered')?.value)||0;
  const totalEl=$('#pos-total');
  if(!totalEl)return;
  const total=parseFloat(totalEl.textContent.replace(/[^0-9.]/g,''))||0;
  const changeDiv=$('#pos-change-display');
  if(!changeDiv)return;
  if(tendered>0){
    const change=tendered-total;
    changeDiv.style.color=change>=0?'#16a34a':'#dc2626';
    changeDiv.textContent=change>=0?`Change: ${fmt(change)}`:`Balance Due: ${fmt(Math.abs(change))}`;
  } else { changeDiv.textContent=''; }
}

function completeSale(){
  if(!posCart.length)return toast('Cart is empty.','warn');

  let subtotal=0,totalBulkDisc=0,totalManualDisc=0;
  const items=posCart.map(item=>{
    const base=item.qty*item.unitPrice;
    const bulkPct=getBulkDiscount(item.productId,item.qty);
    const manualPct=item.manualDiscountPct||0;
    const effectivePct=Math.max(bulkPct,manualPct);
    const discAmt=base*(effectivePct/100);
    if(bulkPct>0) totalBulkDisc+=base*(bulkPct/100);
    if(manualPct>0) totalManualDisc+=base*(manualPct/100);
    subtotal+=(base-discAmt);
    return {...item, bulkDiscountPct:bulkPct, effectiveDiscountPct:effectivePct, lineDiscount:discAmt };
  });

  const extraDiscPct=parseFloat($('#pos-discount')?.value)||0;
  const extraDiscAmt=subtotal*(extraDiscPct/100);
  const afterDisc=subtotal-extraDiscAmt;
  const tax=afterDisc*STATE.settings.taxRate/100;

  const custId=$('#pos-customer')?.value||'';
  const customer=STATE.customers.find(c=>c.id===custId);
  let redeemVal=0, redeemPts=0;
  if(customer){
    const redeemPtsEl=$('#pos-redeem-pts');
    redeemPts=Math.min(parseFloat(redeemPtsEl?.value)||0,customer.loyaltyPoints||0);
    redeemVal=redeemPts*(STATE.settings.loyaltyRedemptionRate||100);
  }

  const total=Math.max(0,afterDisc+tax-redeemVal);
  const payment=$('#pos-payment')?.value||'cash';
  const repId=$('#pos-rep')?.value||'';
  const rep=STATE.salesReps.find(r=>r.id===repId);

  if(payment==='credit'&&customer){
    const newBalance=(customer.balance||0)+total;
    if(newBalance>customer.creditLimit)
      return toast(`Credit limit of ${fmt(customer.creditLimit)} would be exceeded.`,'error');
  }

  const isCredit=payment==='credit';
  const receiptNo=isCredit?nextInvoiceNo():nextReceiptNo();
  const totalDiscountAmt=totalBulkDisc+totalManualDisc+extraDiscAmt;

  const sale={
    id:uid(),
    receiptNo:isCredit?null:receiptNo,
    invoiceNo:isCredit?receiptNo:null,
    customerId:custId,
    customerName:customer?customer.name:'Walk-in',
    repId, repName:rep?.name||'',
    warehouseId:posWarehouse,
    items,
    subtotal:posCart.reduce((s,i)=>s+i.qty*i.unitPrice,0),
    totalBulkDisc, totalManualDisc, extraDiscPct, extraDiscAmt,
    totalDiscountAmt,
    taxAmt:tax, total,
    redeemPts, redeemVal,
    paymentMethod:payment,
    paymentStatus:isCredit?'unpaid':'paid',
    date:nowISO(), notes:'',
  };

  // Deduct stock
  items.forEach(item=>{
    const product=STATE.products.find(p=>p.id===item.productId);
    if(product) product.stock[posWarehouse]=Math.max(0,(product.stock[posWarehouse]||0)-item.qty);
  });

  // Update customer
  if(customer){
    customer.totalPurchases=(customer.totalPurchases||0)+total;
    if(isCredit) customer.balance=(customer.balance||0)+total;
    // Award loyalty points
    const newPts=Math.floor(total/1000*(STATE.settings.loyaltyPointsRate||1));
    customer.loyaltyPoints=(customer.loyaltyPoints||0)+newPts-redeemPts;
    if(redeemPts>0||newPts>0){
      STATE.loyaltyTransactions.push({
        date:nowISO(), customerId:custId, customerName:customer.name,
        earned:newPts, redeemed:redeemPts, balance:customer.loyaltyPoints,
        saleRef:receiptNo
      });
    }
  }
  if(rep) rep.totalSales=(rep.totalSales||0)+total;

  STATE.sales.push(sale);
  saveState();
  const discMsg=totalDiscountAmt>0?` (saved ${fmt(totalDiscountAmt)})`:'';
  toast(`Sale ${receiptNo} recorded. Total: ${fmt(total)}${discMsg}`,'success');
  printReceipt(sale);
  clearCart();
  renderDashboard();
}

function saveAsQuote(){
  if(!posCart.length)return toast('Cart is empty.','warn');
  const custId=$('#pos-customer')?.value||'';
  const customer=STATE.customers.find(c=>c.id===custId);
  const items=posCart.map(item=>{
    const bulkPct=getBulkDiscount(item.productId,item.qty);
    const manualPct=item.manualDiscountPct||0;
    const effectivePct=Math.max(bulkPct,manualPct);
    return {...item,bulkDiscountPct:bulkPct,effectiveDiscountPct:effectivePct};
  });
  const subtotal=items.reduce((s,i)=>s+i.qty*i.unitPrice*(1-i.effectiveDiscountPct/100),0);
  const tax=subtotal*STATE.settings.taxRate/100;
  const extraDiscPct=parseFloat($('#pos-discount')?.value)||0;
  const total=subtotal*(1-extraDiscPct/100)+tax;
  const qNo=nextQuoteNo();
  STATE.quotes.push({
    id:uid(), quoteNo:qNo, customerId:custId,
    customerName:customer?customer.name:'Walk-in',
    warehouseId:posWarehouse, items, subtotal, extraDiscPct, taxAmt:tax, total,
    status:'pending', validDays:7, date:nowISO(), notes:'',
  });
  saveState();
  toast(`Quote ${qNo} saved.`,'success');
}

function printReceipt(sale){
  const win=window.open('','_blank','width=420,height=700');
  if(!win)return;
  const s=STATE.settings;
  const itemsHTML=sale.items.map(i=>{
    const lineBase=i.qty*i.unitPrice;
    const discLine=i.effectiveDiscountPct>0?`
      <tr><td colspan="3" style="font-size:10px;color:#555;">
        Discount ${i.effectiveDiscountPct}%${i.bulkDiscountPct>0?' (bulk)':''}:
      </td><td style="text-align:right;font-size:10px;color:#555;">-${fmt(i.lineDiscount||0)}</td></tr>`:'';
    return `
      <tr>
        <td>${i.name}</td>
        <td style="text-align:center;">${i.qty} ${i.unit}</td>
        <td style="text-align:right;">${fmt(i.unitPrice)}</td>
        <td style="text-align:right;">${fmt(lineBase-(i.lineDiscount||0))}</td>
      </tr>${discLine}`;
  }).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
    <style>
      body { font-family:'Courier New',monospace;font-size:12px;max-width:340px;margin:0 auto;padding:1rem; }
      h2{text-align:center;font-size:14px;}.center{text-align:center;}
      table{width:100%;border-collapse:collapse;}td{padding:2px 0;}
      .sep{border-top:1px dashed #000;margin:6px 0;}.total{font-size:15px;font-weight:bold;}
      @media print{button{display:none;}}
    </style></head><body>
    <h2>${s.companyName}</h2>
    <p class="center">${s.address}</p>
    <p class="center">${s.phone}</p>
    <div class="sep"></div>
    <p><strong>${sale.invoiceNo?'INVOICE':'RECEIPT'}:</strong> ${sale.invoiceNo||sale.receiptNo}</p>
    <p><strong>Date:</strong> ${fmtDate(sale.date)}</p>
    <p><strong>Customer:</strong> ${sale.customerName}</p>
    <p><strong>Payment:</strong> ${sale.paymentMethod.toUpperCase()}</p>
    ${sale.repName?`<p><strong>Rep:</strong> ${sale.repName}</p>`:''}
    <div class="sep"></div>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
    <div class="sep"></div>
    <table>
      <tr><td>Gross Total:</td><td style="text-align:right;">${fmt(sale.subtotal)}</td></tr>
      ${(sale.totalDiscountAmt||0)>0?`<tr><td>Total Discount:</td><td style="text-align:right;color:#16a34a;">-${fmt(sale.totalDiscountAmt)}</td></tr>`:''}
      ${(sale.extraDiscPct||0)>0?`<tr><td>Extra Discount (${sale.extraDiscPct}%):</td><td style="text-align:right;">-${fmt(sale.extraDiscAmt)}</td></tr>`:''}
      <tr><td>Tax (${s.taxRate}%):</td><td style="text-align:right;">${fmt(sale.taxAmt)}</td></tr>
      ${(sale.redeemVal||0)>0?`<tr><td>Loyalty Points Redeemed (${sale.redeemPts} pts):</td><td style="text-align:right;color:#7c3aed;">-${fmt(sale.redeemVal)}</td></tr>`:''}
      <tr class="total"><td>TOTAL:</td><td style="text-align:right;">${fmt(sale.total)}</td></tr>
    </table>
    ${(sale.totalDiscountAmt||0)>0?`<p style="text-align:center;font-size:11px;">You saved ${fmt(sale.totalDiscountAmt)} on this purchase!</p>`:''}
    <div class="sep"></div>
    <p class="center">Thank you for your business!</p>
    <p class="center" style="font-size:10px;">${s.email}</p>
    <button onclick="window.print()" style="width:100%;margin-top:1rem;padding:.5rem;cursor:pointer;">Print</button>
    </body></html>`);
  win.document.close();
}

/* ════════════════════════════════════════════════════════════════
   9.  CUSTOMERS  (enhanced with loyalty)
   ════════════════════════════════════════════════════════════════ */
function renderCustomers(){
  const sec=$('#customers');
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Customers</h2>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          <input id="cust-search" type="search" placeholder="Search…" style="width:200px;" oninput="renderCustomersTable()">
          <select id="cust-type-filter" style="width:140px;" onchange="renderCustomersTable()">
            <option value="">All Types</option>
            <option value="retail">Retail</option>
            <option value="wholesale">Wholesale</option>
          </select>
          <button onclick="openAddCustomer()">+ Add Customer</button>
          <button onclick="exportCustomersXLSX()" style="background:#16a34a;">⬇ Export</button>
        </div>
      </div>
      <div id="customers-table-wrap"></div>
    </div>`;
  renderCustomersTable();
}

function renderCustomersTable(){
  const search=($('#cust-search')?.value||'').toLowerCase();
  const typeFilter=$('#cust-type-filter')?.value||'';
  const filtered=STATE.customers.filter(c=>
    (!typeFilter||c.customerType===typeFilter)&&
    (c.name.toLowerCase().includes(search)||c.phone.includes(search)||(c.email||'').toLowerCase().includes(search))
  );
  const wrap=$('#customers-table-wrap');
  if(!wrap)return;
  if(!filtered.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No customers.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr>
        <th>Name</th><th>Type</th><th>Phone</th><th>Credit Limit</th><th>Balance</th>
        <th>Loyalty Pts</th><th>Total Purchases</th><th>Actions</th>
      </tr></thead>
      <tbody>${filtered.map(c=>`
        <tr>
          <td><strong>${c.name}</strong><br><small style="color:#9ca3af;">${c.address||''}</small></td>
          <td><span class="badge badge-${c.customerType==='wholesale'?'blue':'green'}">${c.customerType||'retail'}</span></td>
          <td>${c.phone}</td>
          <td>${fmt(c.creditLimit)}</td>
          <td style="color:${(c.balance||0)>0?'#dc2626':'#16a34a'};font-weight:700;">${fmt(c.balance||0)}</td>
          <td><span style="color:#7c3aed;font-weight:600;">🌟 ${fmtNum(c.loyaltyPoints||0)}</span></td>
          <td>${fmt(c.totalPurchases||0)}</td>
          <td style="white-space:nowrap;">
            <button onclick="editCustomer('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
            <button onclick="recordPayment('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Pay</button>
            <button onclick="viewCustomerHistory('${c.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">History</button>
            <button onclick="deleteCustomer('${c.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function customerFormHTML(c={}){
  return `
    <div class="form-grid">
      <div><label>Full Name / Business Name *</label><input id="cf-name" style="width:100%;" value="${c.name||''}"></div>
      <div><label>Customer Type</label>
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

function openAddCustomer(){
  modal('Add Customer',customerFormHTML(),(overlay,close)=>{
    const name=$('#cf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    STATE.customers.push({
      id:'C'+uid(),name,
      customerType:$('#cf-type',overlay).value,
      phone:$('#cf-phone',overlay).value.trim(),
      email:$('#cf-email',overlay).value.trim(),
      address:$('#cf-address',overlay).value.trim(),
      creditLimit:parseFloat($('#cf-credit',overlay).value)||0,
      loyaltyPoints:parseInt($('#cf-loyalty',overlay).value)||0,
      notes:$('#cf-notes',overlay).value.trim(),
      balance:0,totalPurchases:0,
    });
    saveState();close();renderCustomersTable();toast('Customer added.','success');
  });
}

function editCustomer(id){
  const c=STATE.customers.find(x=>x.id===id);if(!c)return;
  modal(`Edit – ${c.name}`,customerFormHTML(c),(overlay,close)=>{
    c.name=$('#cf-name',overlay).value.trim()||c.name;
    c.customerType=$('#cf-type',overlay).value;
    c.phone=$('#cf-phone',overlay).value.trim();
    c.email=$('#cf-email',overlay).value.trim();
    c.address=$('#cf-address',overlay).value.trim();
    c.creditLimit=parseFloat($('#cf-credit',overlay).value)||c.creditLimit;
    c.loyaltyPoints=parseInt($('#cf-loyalty',overlay).value)||0;
    c.notes=$('#cf-notes',overlay).value.trim();
    saveState();close();renderCustomersTable();toast('Customer updated.','success');
  });
}

function recordPayment(id){
  const c=STATE.customers.find(x=>x.id===id);if(!c)return;
  modal(`Record Payment – ${c.name}`,`
    <p style="margin-bottom:1rem;">Outstanding Balance: <strong style="color:#dc2626;">${fmt(c.balance||0)}</strong></p>
    <div class="form-grid">
      <div><label>Amount Paid (₦)</label><input id="pay-amt" type="number" style="width:100%;" value="${c.balance||0}"></div>
      <div><label>Payment Method</label>
        <select id="pay-method" style="width:100%;">
          <option value="cash">Cash</option><option value="transfer">Bank Transfer</option>
          <option value="pos-machine">POS Machine</option><option value="cheque">Cheque</option>
        </select></div>
      <div><label>Date</label><input id="pay-date" type="date" style="width:100%;" value="${today()}"></div>
      <div><label>Reference / Note</label><input id="pay-note" style="width:100%;" placeholder="Cheque no., txn ref…"></div>
    </div>`,(overlay,close)=>{
    const amt=parseFloat($('#pay-amt',overlay).value)||0;
    if(amt<=0)return toast('Enter a valid amount.','warn');
    if(amt>c.balance)return toast(`Amount exceeds balance of ${fmt(c.balance)}.`,'warn');
    c.balance-=amt;
    STATE.sales.push({
      id:uid(),receiptNo:nextReceiptNo(),
      customerId:id,customerName:c.name,
      items:[],subtotal:amt,discountPct:0,discountAmt:0,
      taxAmt:0,total:amt,
      paymentMethod:$('#pay-method',overlay).value,
      paymentStatus:'paid',type:'payment',
      date:$('#pay-date',overlay).value+'T00:00:00.000Z',
      notes:$('#pay-note',overlay).value,
    });
    let remaining=amt;
    STATE.sales.filter(s=>s.customerId===id&&s.paymentStatus==='unpaid').forEach(s=>{
      if(remaining<=0)return;
      if(remaining>=s.total){s.paymentStatus='paid';remaining-=s.total;}
      else{s.total-=remaining;remaining=0;}
    });
    saveState();close();renderCustomersTable();toast(`Payment of ${fmt(amt)} recorded.`,'success');
  });
}

function viewCustomerHistory(id){
  const c=STATE.customers.find(x=>x.id===id);if(!c)return;
  const txns=STATE.sales.filter(s=>s.customerId===id).slice(-30).reverse();
  const loyaltyTxns=STATE.loyaltyTransactions.filter(t=>t.customerId===id).slice(-10).reverse();
  modal(`History – ${c.name}`,`
    <p style="margin-bottom:1rem;">
      Total: <strong>${fmt(c.totalPurchases||0)}</strong> &nbsp;|&nbsp;
      Outstanding: <strong style="color:#dc2626;">${fmt(c.balance||0)}</strong> &nbsp;|&nbsp;
      Points: <strong style="color:#7c3aed;">🌟 ${fmtNum(c.loyaltyPoints||0)}</strong>
    </p>
    ${txns.length?`
      <table>
        <thead><tr><th>Date</th><th>Ref No.</th><th>Amount</th><th>Discount</th><th>Method</th><th>Status</th></tr></thead>
        <tbody>${txns.map(s=>`
          <tr>
            <td>${fmtDate(s.date)}</td>
            <td style="font-family:monospace;">${s.invoiceNo||s.receiptNo||'—'}</td>
            <td>${fmt(s.total)}</td>
            <td>${(s.totalDiscountAmt||0)>0?fmt(s.totalDiscountAmt):'—'}</td>
            <td>${s.paymentMethod||'—'}</td>
            <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus||'paid'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`:
    '<p style="color:#9ca3af;">No transactions yet.</p>'}
    ${loyaltyTxns.length?`
      <h4 style="margin-top:1.25rem;">Loyalty Points Log</h4>
      <table>
        <thead><tr><th>Date</th><th>Sale Ref</th><th>Earned</th><th>Redeemed</th><th>Balance</th></tr></thead>
        <tbody>${loyaltyTxns.map(t=>`
          <tr>
            <td>${fmtDate(t.date)}</td><td>${t.saleRef}</td>
            <td style="color:#16a34a;">+${t.earned}</td>
            <td style="color:#dc2626;">${t.redeemed?'-'+t.redeemed:'—'}</td>
            <td style="color:#7c3aed;font-weight:600;">${t.balance}</td>
          </tr>`).join('')}
        </tbody>
      </table>`:''}`,
  null,'Close');
}

function deleteCustomer(id){
  if(!confirm2('Delete customer?'))return;
  STATE.customers=STATE.customers.filter(c=>c.id!==id);
  saveState();renderCustomersTable();toast('Deleted.','warn');
}

function exportCustomersXLSX(){
  const rows=STATE.customers.map(c=>({
    Name:c.name,Type:c.customerType||'retail',Phone:c.phone,Email:c.email||'',
    Address:c.address||'',
    'Credit Limit':c.creditLimit,'Balance Owed':c.balance||0,
    'Loyalty Points':c.loyaltyPoints||0,'Total Purchases':c.totalPurchases||0,
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Customers');
  XLSX.writeFile(wb,'cnjohnson_customers.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   10. SUPPLIERS
   ════════════════════════════════════════════════════════════════ */
function renderSuppliers(){
  const sec=$('#suppliers');
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Suppliers</h2>
        <button onclick="openAddSupplier()">+ Add Supplier</button>
      </div>
      <div id="suppliers-table-wrap"></div>
    </div>`;
  renderSuppliersTable();
}

function renderSuppliersTable(){
  const wrap=$('#suppliers-table-wrap');if(!wrap)return;
  if(!STATE.suppliers.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No suppliers.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Contact</th><th>Phone</th><th>Category</th><th>Rating</th><th>Balance Owed</th><th>Actions</th></tr></thead>
      <tbody>${STATE.suppliers.map(s=>`
        <tr>
          <td style="font-family:monospace;">${s.id}</td>
          <td><strong>${s.name}</strong></td>
          <td>${s.contact||'—'}</td>
          <td>${s.phone||'—'}</td>
          <td>${s.category||'—'}</td>
          <td>${'★'.repeat(s.rating||0)}${'☆'.repeat(5-(s.rating||0))}</td>
          <td style="color:${(s.balance||0)>0?'#dc2626':'#16a34a'};font-weight:700;">${fmt(s.balance||0)}</td>
          <td style="white-space:nowrap;">
            <button onclick="editSupplier('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
            <button onclick="paySupplier('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Pay</button>
            <button onclick="deleteSupplier('${s.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function supplierFormHTML(s={}){
  return `
    <div class="form-grid">
      <div><label>Company Name *</label><input id="sf-name" style="width:100%;" value="${s.name||''}"></div>
      <div><label>Contact Person</label><input id="sf-contact" style="width:100%;" value="${s.contact||''}"></div>
      <div><label>Phone</label><input id="sf-phone" style="width:100%;" value="${s.phone||''}"></div>
      <div><label>Email</label><input id="sf-email" style="width:100%;" value="${s.email||''}"></div>
      <div><label>Address</label><input id="sf-address" style="width:100%;" value="${s.address||''}"></div>
      <div><label>Product Category</label><input id="sf-cat" style="width:100%;" value="${s.category||''}"></div>
      <div><label>Rating (1-5)</label>
        <select id="sf-rating" style="width:100%;">
          ${[1,2,3,4,5].map(n=>`<option value="${n}" ${(s.rating||0)===n?'selected':''}>${'★'.repeat(n)} ${n}/5</option>`).join('')}
        </select></div>
    </div>`;
}

function openAddSupplier(){
  modal('Add Supplier',supplierFormHTML(),(overlay,close)=>{
    const name=$('#sf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    STATE.suppliers.push({
      id:'S'+uid(),name,
      contact:$('#sf-contact',overlay).value.trim(),
      phone:$('#sf-phone',overlay).value.trim(),
      email:$('#sf-email',overlay).value.trim(),
      address:$('#sf-address',overlay).value.trim(),
      category:$('#sf-cat',overlay).value.trim(),
      rating:parseInt($('#sf-rating',overlay).value)||3,
      balance:0,
    });
    saveState();close();renderSuppliersTable();toast('Supplier added.','success');
  });
}

function editSupplier(id){
  const s=STATE.suppliers.find(x=>x.id===id);if(!s)return;
  modal(`Edit – ${s.name}`,supplierFormHTML(s),(overlay,close)=>{
    s.name=$('#sf-name',overlay).value.trim()||s.name;
    s.contact=$('#sf-contact',overlay).value.trim();
    s.phone=$('#sf-phone',overlay).value.trim();
    s.email=$('#sf-email',overlay).value.trim();
    s.address=$('#sf-address',overlay).value.trim();
    s.category=$('#sf-cat',overlay).value.trim();
    s.rating=parseInt($('#sf-rating',overlay).value)||s.rating;
    saveState();close();renderSuppliersTable();toast('Updated.','success');
  });
}

function paySupplier(id){
  const s=STATE.suppliers.find(x=>x.id===id);if(!s)return;
  modal(`Pay Supplier – ${s.name}`,`
    <p>Balance owed: <strong style="color:#dc2626;">${fmt(s.balance||0)}</strong></p>
    <div class="form-grid">
      <div><label>Amount (₦)</label><input id="sp-amt" type="number" style="width:100%;" value="${s.balance||0}"></div>
      <div><label>Method</label>
        <select id="sp-method" style="width:100%;">
          <option>Cash</option><option>Transfer</option><option>Cheque</option>
        </select></div>
      <div><label>Reference</label><input id="sp-ref" style="width:100%;" placeholder="Txn ref…"></div>
    </div>`,(overlay,close)=>{
    const amt=parseFloat($('#sp-amt',overlay).value)||0;
    if(amt>s.balance)return toast('Amount exceeds balance.','warn');
    s.balance=Math.max(0,s.balance-amt);
    saveState();close();renderSuppliersTable();toast(`Payment of ${fmt(amt)} to ${s.name} recorded.`,'success');
  });
}

function deleteSupplier(id){
  if(!confirm2('Delete supplier?'))return;
  STATE.suppliers=STATE.suppliers.filter(s=>s.id!==id);
  saveState();renderSuppliersTable();toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   11. SALES REPS
   ════════════════════════════════════════════════════════════════ */
function renderSalesReps(){
  const sec=$('#sales-reps');
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Sales Representatives</h2>
        <button onclick="openAddRep()">+ Add Rep</button>
      </div>
      <div id="reps-table-wrap"></div>
    </div>`;
  renderRepsTable();
}

function renderRepsTable(){
  const wrap=$('#reps-table-wrap');if(!wrap)return;
  if(!STATE.salesReps.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No reps yet.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Warehouse</th><th>Commission %</th><th>Total Sales</th><th>Commission Earned</th><th>Actions</th></tr></thead>
      <tbody>${STATE.salesReps.map(r=>`
        <tr>
          <td style="font-family:monospace;">${r.id}</td>
          <td><strong>${r.name}</strong></td>
          <td>${r.phone||'—'}</td>
          <td>${getWarehouseName(r.warehouseId)}</td>
          <td>${r.commission}%</td>
          <td>${fmt(r.totalSales||0)}</td>
          <td>${fmt((r.totalSales||0)*r.commission/100)}</td>
          <td style="white-space:nowrap;">
            <button onclick="editRep('${r.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#6b7280;margin-right:.3rem;">Edit</button>
            <button onclick="deleteRep('${r.id}')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Del</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function repFormHTML(r={}){
  const whOpts=STATE.warehouses.map(w=>`<option value="${w.id}" ${r.warehouseId===w.id?'selected':''}>${w.name}</option>`).join('');
  return `
    <div class="form-grid">
      <div><label>Full Name *</label><input id="rf-name" style="width:100%;" value="${r.name||''}"></div>
      <div><label>Phone</label><input id="rf-phone" style="width:100%;" value="${r.phone||''}"></div>
      <div><label>Email</label><input id="rf-email" style="width:100%;" value="${r.email||''}"></div>
      <div><label>Assigned Warehouse</label><select id="rf-wh" style="width:100%;">${whOpts}</select></div>
      <div><label>Commission Rate (%)</label><input id="rf-comm" type="number" min="0" max="50" style="width:100%;" value="${r.commission||2}"></div>
    </div>`;
}

function openAddRep(){
  modal('Add Sales Rep',repFormHTML(),(overlay,close)=>{
    const name=$('#rf-name',overlay).value.trim();
    if(!name)return toast('Name required.','warn');
    STATE.salesReps.push({
      id:'R'+uid(),name,
      phone:$('#rf-phone',overlay).value.trim(),
      email:$('#rf-email',overlay).value.trim(),
      warehouseId:$('#rf-wh',overlay).value,
      commission:parseFloat($('#rf-comm',overlay).value)||2,
      totalSales:0,
    });
    saveState();close();renderRepsTable();toast('Rep added.','success');
  });
}
function editRep(id){
  const r=STATE.salesReps.find(x=>x.id===id);if(!r)return;
  modal(`Edit Rep – ${r.name}`,repFormHTML(r),(overlay,close)=>{
    r.name=$('#rf-name',overlay).value.trim()||r.name;
    r.phone=$('#rf-phone',overlay).value.trim();
    r.email=$('#rf-email',overlay).value.trim();
    r.warehouseId=$('#rf-wh',overlay).value;
    r.commission=parseFloat($('#rf-comm',overlay).value)||r.commission;
    saveState();close();renderRepsTable();toast('Updated.','success');
  });
}
function deleteRep(id){
  if(!confirm2('Delete this rep?'))return;
  STATE.salesReps=STATE.salesReps.filter(r=>r.id!==id);
  saveState();renderRepsTable();toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   12. PURCHASES (Stock In)
   ════════════════════════════════════════════════════════════════ */
let purchaseItems=[];

function renderPurchases(){
  const sec=$('#purchases');
  const supOpts=STATE.suppliers.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  const whOpts=STATE.warehouses.map(w=>`<option value="${w.id}">${w.name}</option>`).join('');
  const prodOpts=STATE.products.map(p=>`<option value="${p.id}">${p.name} (${p.sku})</option>`).join('');
  sec.innerHTML=`
    <div class="card">
      <h2 style="margin-bottom:1.5rem;">Record Purchase / Stock Receiving</h2>
      <div class="form-grid">
        <div><label>Supplier *</label><select id="pu-supplier" style="width:100%;"><option value="">-- Select --</option>${supOpts}</select></div>
        <div><label>Receiving Warehouse</label><select id="pu-wh" style="width:100%;">${whOpts}</select></div>
        <div><label>Invoice / LPO No.</label><input id="pu-invoiceno" style="width:100%;" placeholder="Supplier's invoice number"></div>
        <div><label>Date</label><input id="pu-date" type="date" style="width:100%;" value="${today()}"></div>
      </div>
      <h3 style="margin:1.5rem 0 .75rem;">Add Items</h3>
      <div class="form-grid" style="align-items:end;">
        <div><label>Product</label><select id="pu-prod" style="width:100%;"><option value="">-- Select --</option>${prodOpts}</select></div>
        <div><label>Quantity</label><input id="pu-qty" type="number" min="1" style="width:100%;" placeholder="Qty"></div>
        <div><label>Unit Cost (₦)</label><input id="pu-cost" type="number" min="0" style="width:100%;" placeholder="Cost per unit"></div>
        <div style="padding-bottom:.1rem;"><button onclick="addPurchaseItem()">+ Add Item</button></div>
      </div>
      <div id="purchase-items-wrap" style="margin-top:1rem;"></div>
      <div id="purchase-total" style="text-align:right;font-size:1.2rem;font-weight:700;margin-top:1rem;"></div>
      <div class="form-grid" style="margin-top:1rem;">
        <div><label>Payment Status</label>
          <select id="pu-pay-status" style="width:100%;">
            <option value="paid">Paid (Cash / Transfer)</option>
            <option value="credit">On Credit (Owed to Supplier)</option>
            <option value="partial">Partial Payment</option>
          </select></div>
        <div><label>Amount Paid (₦)</label><input id="pu-paid-amt" type="number" min="0" style="width:100%;" placeholder="For partial payments"></div>
        <div style="grid-column:1/-1;"><label>Notes</label><input id="pu-notes" style="width:100%;" placeholder="Optional remarks…"></div>
      </div>
      <button onclick="savePurchase()" style="margin-top:1.5rem;font-size:1rem;padding:.9rem 2rem;">✔ Save Purchase & Update Stock</button>
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
  const pid=$('#pu-prod').value,qty=parseInt($('#pu-qty').value)||0,cost=parseFloat($('#pu-cost').value)||0;
  if(!pid||qty<=0||cost<=0)return toast('Select product, qty and cost.','warn');
  const product=STATE.products.find(p=>p.id===pid);if(!product)return;
  const existing=purchaseItems.find(i=>i.productId===pid);
  if(existing){existing.qty+=qty;existing.cost=cost;}
  else{purchaseItems.push({productId:pid,name:product.name,unit:product.unit,qty,cost});}
  renderPurchaseItemsWrap();
  $('#pu-qty').value='';$('#pu-cost').value='';
}

function renderPurchaseItemsWrap(){
  const wrap=$('#purchase-items-wrap');if(!wrap)return;
  if(!purchaseItems.length){wrap.innerHTML='';$('#purchase-total').textContent='';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th><th></th></tr></thead>
      <tbody>${purchaseItems.map((i,idx)=>`
        <tr>
          <td>${i.name}</td><td>${i.qty} ${i.unit}</td>
          <td>${fmt(i.cost)}</td><td>${fmt(i.qty*i.cost)}</td>
          <td><button onclick="removePurchaseItem(${idx})" class="danger" style="font-size:.8rem;padding:.2rem .5rem;">✕</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  const grandTotal=purchaseItems.reduce((s,i)=>s+i.qty*i.cost,0);
  $('#purchase-total').textContent=`Grand Total: ${fmt(grandTotal)}`;
}
function removePurchaseItem(idx){purchaseItems.splice(idx,1);renderPurchaseItemsWrap();}

function savePurchase(){
  if(!purchaseItems.length)return toast('Add at least one item.','warn');
  const supplierId=$('#pu-supplier').value;
  if(!supplierId)return toast('Select a supplier.','warn');
  const whId=$('#pu-wh').value;
  const supplier=STATE.suppliers.find(s=>s.id===supplierId);
  const grandTotal=purchaseItems.reduce((s,i)=>s+i.qty*i.cost,0);
  const payStatus=$('#pu-pay-status').value;
  const paidAmt=parseFloat($('#pu-paid-amt').value)||0;
  const owed=payStatus==='credit'?grandTotal:payStatus==='partial'?grandTotal-paidAmt:0;
  purchaseItems.forEach(item=>{
    const product=STATE.products.find(p=>p.id===item.productId);
    if(product){product.stock[whId]=(product.stock[whId]||0)+item.qty;product.costPrice=item.cost;}
  });
  if(supplier)supplier.balance=(supplier.balance||0)+owed;
  STATE.purchases.push({
    id:uid(),invoiceNo:$('#pu-invoiceno').value.trim(),
    supplierId,supplierName:supplier?.name||'Unknown',
    warehouseId:whId,warehouseName:getWarehouseName(whId),
    items:[...purchaseItems],grandTotal,paymentStatus:payStatus,paidAmt,owed,
    notes:$('#pu-notes').value.trim(),
    date:$('#pu-date').value+'T00:00:00.000Z',
  });
  saveState();
  toast(`Purchase of ${fmt(grandTotal)} saved. Stock updated.`,'success');
  purchaseItems=[];
  renderPurchases();
}

function renderPurchaseHistory(){
  const wrap=$('#purchase-history-wrap');if(!wrap)return;
  if(!STATE.purchases.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No purchases yet.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Date</th><th>Invoice No.</th><th>Supplier</th><th>Warehouse</th><th>Total</th><th>Owed</th><th>Status</th></tr></thead>
      <tbody>${STATE.purchases.slice(-30).reverse().map(p=>`
        <tr>
          <td>${fmtDate(p.date)}</td><td style="font-family:monospace;">${p.invoiceNo||'—'}</td>
          <td>${p.supplierName}</td><td>${p.warehouseName}</td>
          <td>${fmt(p.grandTotal)}</td><td style="color:#dc2626;">${(p.owed||0)>0?fmt(p.owed):'—'}</td>
          <td><span class="badge badge-${p.paymentStatus==='paid'?'green':p.paymentStatus==='partial'?'blue':'yellow'}">${p.paymentStatus}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ════════════════════════════════════════════════════════════════
   13. INVOICES
   ════════════════════════════════════════════════════════════════ */
function renderInvoices(){
  const sec=$('#invoices');
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Invoices (Credit Sales)</h2>
        <div style="display:flex;gap:.75rem;">
          <select id="inv-filter" style="width:160px;" onchange="renderInvoicesTable()">
            <option value="">All Statuses</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
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
  const wrap=$('#invoices-table-wrap');if(!wrap)return;
  const creditSales=STATE.sales.filter(s=>s.invoiceNo&&(!filter||s.paymentStatus===filter)).reverse();
  if(!creditSales.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No invoices found.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr>
        <th>Invoice No.</th><th>Date</th><th>Customer</th><th>Total</th>
        <th>Discounts</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>${creditSales.map(s=>`
        <tr>
          <td style="font-family:monospace;"><strong>${s.invoiceNo}</strong></td>
          <td>${fmtDate(s.date)}</td>
          <td>${s.customerName}</td>
          <td>${fmt(s.total)}</td>
          <td>${(s.totalDiscountAmt||0)>0?`<span style="color:#16a34a;">-${fmt(s.totalDiscountAmt)}</span>`:'—'}</td>
          <td><span class="badge badge-${s.paymentStatus==='paid'?'green':'yellow'}">${s.paymentStatus}</span></td>
          <td style="white-space:nowrap;">
            <button onclick="printInvoice('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Print</button>
            <button onclick="issueCreditNote('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#8b5cf6;margin-right:.3rem;">Credit Note</button>
            ${s.paymentStatus!=='paid'?`<button onclick="markInvoicePaid('${s.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;">Mark Paid</button>`:''}
          </td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="font-weight:700;text-align:right;">Total Outstanding:</td>
          <td style="font-weight:700;color:#dc2626;">${fmt(creditSales.filter(s=>s.paymentStatus!=='paid').reduce((a,s)=>a+s.total,0))}</td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table>`;
}

function printInvoice(saleId){
  const sale=STATE.sales.find(s=>s.id===saleId);if(!sale)return;
  printReceipt(sale);
}

function markInvoicePaid(saleId){
  const sale=STATE.sales.find(s=>s.id===saleId);if(!sale)return;
  if(!confirm2(`Mark invoice ${sale.invoiceNo} as paid?`))return;
  sale.paymentStatus='paid';
  const customer=STATE.customers.find(c=>c.id===sale.customerId);
  if(customer)customer.balance=Math.max(0,(customer.balance||0)-sale.total);
  saveState();renderInvoicesTable();toast('Invoice marked as paid.','success');
}

function issueCreditNote(saleId){
  const sale=STATE.sales.find(s=>s.id===saleId);if(!sale)return;
  modal(`Issue Credit Note for ${sale.invoiceNo}`,`
    <p style="margin-bottom:1rem;">Original Invoice: <strong>${sale.invoiceNo}</strong> | Amount: <strong>${fmt(sale.total)}</strong></p>
    <div class="form-grid">
      <div><label>Credit Amount (₦)</label><input id="cn-amt" type="number" style="width:100%;" max="${sale.total}" value="${sale.total}"></div>
      <div><label>Reason</label>
        <select id="cn-reason" style="width:100%;">
          <option value="return">Goods Returned</option>
          <option value="overcharge">Overcharge Correction</option>
          <option value="damage">Damaged Goods</option>
          <option value="other">Other</option>
        </select></div>
      <div style="grid-column:1/-1;"><label>Notes</label><textarea id="cn-notes" style="width:100%;height:60px;"></textarea></div>
    </div>`,(overlay,close)=>{
    const amt=parseFloat($('#cn-amt',overlay).value)||0;
    if(amt<=0||amt>sale.total)return toast('Invalid amount.','warn');
    const cnNo=nextCreditNoteNo();
    const customer=STATE.customers.find(c=>c.id===sale.customerId);
    STATE.creditNotes.push({
      id:uid(), creditNoteNo:cnNo, originalInvoiceNo:sale.invoiceNo,
      customerId:sale.customerId, customerName:sale.customerName,
      amount:amt, reason:$('#cn-reason',overlay).value,
      notes:$('#cn-notes',overlay).value.trim(),
      date:nowISO(), status:'issued',
    });
    if(customer) customer.balance=Math.max(0,(customer.balance||0)-amt);
    saveState();close();renderInvoicesTable();
    toast(`Credit Note ${cnNo} issued for ${fmt(amt)}.`,'success');
  });
}

function exportInvoicesXLSX(){
  const rows=STATE.sales.filter(s=>s.invoiceNo).map(s=>({
    'Invoice No.':s.invoiceNo,Date:fmtDate(s.date),Customer:s.customerName,
    Total:s.total,'Total Discount':s.totalDiscountAmt||0,Status:s.paymentStatus,
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Invoices');
  XLSX.writeFile(wb,'cnjohnson_invoices.xlsx');
}

/* ════════════════════════════════════════════════════════════════
   14. QUOTES
   ════════════════════════════════════════════════════════════════ */
function renderQuotes(){
  const sec=$('#quotes');if(!sec)return;
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Price Quotations</h2>
        <select id="qt-filter" style="width:140px;" onchange="renderQuotesTable()">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div id="quotes-table-wrap"></div>
    </div>`;
  renderQuotesTable();
}

function renderQuotesTable(){
  const filter=$('#qt-filter')?.value||'';
  const wrap=$('#quotes-table-wrap');if(!wrap)return;
  const quotes=STATE.quotes.filter(q=>!filter||q.status===filter).reverse();
  if(!quotes.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No quotes. Create one from POS.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Quote No.</th><th>Date</th><th>Customer</th><th>Total</th><th>Valid Until</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${quotes.map(q=>{
        const validUntil=new Date(new Date(q.date).getTime()+(q.validDays||7)*86400000);
        const expired=validUntil<new Date()&&q.status==='pending';
        return `
          <tr>
            <td style="font-family:monospace;"><strong>${q.quoteNo}</strong></td>
            <td>${fmtDate(q.date)}</td>
            <td>${q.customerName}</td>
            <td>${fmt(q.total)}</td>
            <td>${fmtDate(validUntil.toISOString())}${expired?' ⚠':''}</td>
            <td><span class="badge badge-${q.status==='accepted'?'green':q.status==='rejected'||expired?'red':'yellow'}">${expired?'expired':q.status}</span></td>
            <td style="white-space:nowrap;">
              <button onclick="printQuote('${q.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#0891b2;margin-right:.3rem;">Print</button>
              ${q.status==='pending'?`
                <button onclick="convertQuoteToSale('${q.id}')" style="font-size:.8rem;padding:.3rem .6rem;background:#16a34a;margin-right:.3rem;">Convert</button>
                <button onclick="updateQuoteStatus('${q.id}','rejected')" class="danger" style="font-size:.8rem;padding:.3rem .6rem;">Reject</button>`:''
              }
            </td>
          </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

function printQuote(quoteId){
  const q=STATE.quotes.find(x=>x.id===quoteId);if(!q)return;
  const s=STATE.settings;
  const validUntil=new Date(new Date(q.date).getTime()+(q.validDays||7)*86400000);
  const win=window.open('','_blank','width=420,height=700');if(!win)return;
  const itemsHTML=q.items.map(i=>`
    <tr>
      <td>${i.name}</td>
      <td style="text-align:center;">${i.qty} ${i.unit}</td>
      <td style="text-align:right;">${fmt(i.unitPrice)}</td>
      ${i.effectiveDiscountPct>0?`<td style="text-align:center;">${i.effectiveDiscountPct}%</td>`:'<td>—</td>'}
      <td style="text-align:right;">${fmt(i.qty*i.unitPrice*(1-i.effectiveDiscountPct/100))}</td>
    </tr>`).join('');
  win.document.write(`<!DOCTYPE html><html><head><title>Quote ${q.quoteNo}</title>
    <style>body{font-family:Georgia,serif;max-width:600px;margin:2rem auto;padding:1rem;}
    h1{color:#1e40af;}table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #e5e7eb;padding:.5rem;font-size:.875rem;}
    th{background:#f8fafc;}.footer{margin-top:2rem;color:#64748b;font-size:.8rem;}
    @media print{button{display:none;}}</style>
    </head><body>
    <h1>PRICE QUOTATION</h1>
    <div style="display:flex;justify-content:space-between;margin-bottom:1.5rem;">
      <div><h3>${s.companyName}</h3><p>${s.address}</p><p>${s.phone}</p></div>
      <div style="text-align:right;"><p><strong>Quote No.:</strong> ${q.quoteNo}</p>
      <p><strong>Date:</strong> ${fmtDate(q.date)}</p>
      <p><strong>Valid Until:</strong> ${fmtDate(validUntil.toISOString())}</p></div>
    </div>
    <p><strong>To:</strong> ${q.customerName}</p>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Discount</th><th>Total</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
    <table style="margin-top:1rem;width:300px;margin-left:auto;">
      <tr><td>Subtotal:</td><td style="text-align:right;">${fmt(q.subtotal)}</td></tr>
      ${(q.extraDiscPct||0)>0?`<tr><td>Extra Discount (${q.extraDiscPct}%):</td><td style="text-align:right;">${fmt(q.subtotal*q.extraDiscPct/100)}</td></tr>`:''}
      <tr><td>Tax (${s.taxRate}%):</td><td style="text-align:right;">${fmt(q.taxAmt)}</td></tr>
      <tr style="font-weight:bold;font-size:1.1rem;"><td>TOTAL:</td><td style="text-align:right;">${fmt(q.total)}</td></tr>
    </table>
    <div class="footer">
      <p>This quotation is valid for ${q.validDays||7} days from issue date.</p>
      <p>Prices are subject to change after the validity period.</p>
    </div>
    <button onclick="window.print()" style="margin-top:1rem;padding:.5rem 1.5rem;cursor:pointer;">Print Quote</button>
    </body></html>`);
  win.document.close();
}

function convertQuoteToSale(quoteId){
  const q=STATE.quotes.find(x=>x.id===quoteId);if(!q)return;
  if(!confirm2(`Convert Quote ${q.quoteNo} to a sale?`))return;
  // Load cart from quote
  posCart=q.items.map(i=>({...i}));
  posWarehouse=q.warehouseId;
  q.status='accepted';
  saveState();
  showSection('pos');
  // Pre-select customer
  setTimeout(()=>{
    const sel=$('#pos-customer');
    if(sel&&q.customerId){sel.value=q.customerId;onPOSCustomerChange();}
    renderCartItems();updatePOSTotals();
  },200);
  toast(`Quote ${q.quoteNo} loaded into POS.`,'success');
}

function updateQuoteStatus(quoteId,status){
  const q=STATE.quotes.find(x=>x.id===quoteId);if(!q)return;
  q.status=status;saveState();renderQuotesTable();
  toast(`Quote ${q.quoteNo} marked as ${status}.`,'info');
}

/* ════════════════════════════════════════════════════════════════
   15. CREDIT NOTES
   ════════════════════════════════════════════════════════════════ */
function renderCreditNotes(){
  const sec=$('#credit-notes');if(!sec)return;
  sec.innerHTML=`
    <div class="card">
      <h2 style="margin-bottom:1.5rem;">Credit Notes & Returns</h2>
      <div id="cn-table-wrap"></div>
    </div>`;
  const wrap=$('#cn-table-wrap');
  if(!STATE.creditNotes.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No credit notes issued yet.</p>';return;}
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Credit Note No.</th><th>Date</th><th>Customer</th><th>Original Invoice</th><th>Amount</th><th>Reason</th><th>Notes</th></tr></thead>
      <tbody>${STATE.creditNotes.slice().reverse().map(cn=>`
        <tr>
          <td style="font-family:monospace;"><strong>${cn.creditNoteNo}</strong></td>
          <td>${fmtDate(cn.date)}</td>
          <td>${cn.customerName}</td>
          <td style="font-family:monospace;">${cn.originalInvoiceNo}</td>
          <td style="color:#dc2626;font-weight:700;">-${fmt(cn.amount)}</td>
          <td>${cn.reason}</td>
          <td>${cn.notes||'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ════════════════════════════════════════════════════════════════
   16. EXPENSES
   ════════════════════════════════════════════════════════════════ */
function renderExpenses(){
  const sec=$('#expenses');if(!sec)return;
  sec.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
        <h2 style="margin:0;">Operational Expenses</h2>
        <button onclick="openAddExpense()">+ Record Expense</button>
      </div>
      <div id="expenses-table-wrap"></div>
    </div>`;
  renderExpensesTable();
}

function renderExpensesTable(){
  const wrap=$('#expenses-table-wrap');if(!wrap)return;
  if(!STATE.expenses.length){wrap.innerHTML='<p style="color:#9ca3af;text-align:center;padding:2rem;">No expenses recorded.</p>';return;}
  const total=STATE.expenses.reduce((s,e)=>s+(e.amount||0),0);
  wrap.innerHTML=`
    <table>
      <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Paid By</th><th>Actions</th></tr></thead>
      <tbody>${STATE.expenses.slice(-50).reverse().map(e=>`
        <tr>
          <td>${fmtDate(e.date)}</td>
          <td><span class="badge badge-blue">${e.category}</span></td>
          <td>${e.description}</td>
          <td style="font-weight:700;">${fmt(e.amount)}</td>
          <td>${e.paidBy||'—'}</td>
          <td>
            <button onclick="deleteExpense('${e.id}')" class="danger" style="font-size:.8rem;padding:.2rem .5rem;">Del</button>
          </td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;">Total:</td>
        <td style="font-weight:700;">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
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
      <div><label>Amount (₦)</label><input id="ex-amt" type="number" min="0" style="width:100%;"></div>
      <div><label>Date</label><input id="ex-date" type="date" style="width:100%;" value="${today()}"></div>
      <div><label>Paid By</label><input id="ex-by" style="width:100%;" placeholder="Name or method"></div>
      <div style="grid-column:1/-1;"><label>Description</label><textarea id="ex-desc" style="width:100%;height:60px;" placeholder="Details…"></textarea></div>
    </div>`,(overlay,close)=>{
    const cat=$('#ex-cat',overlay).value.trim();
    const amt=parseFloat($('#ex-amt',overlay).value);
    if(!cat||isNaN(amt)||amt<=0)return toast('Category and amount required.','warn');
    STATE.expenses.push({
      id:uid(),category:cat,amount:amt,
      date:$('#ex-date',overlay).value+'T00:00:00.000Z',
      paidBy:$('#ex-by',overlay).value.trim(),
      description:$('#ex-desc',overlay).value.trim(),
    });
    saveState();close();renderExpensesTable();toast('Expense recorded.','success');
  });
}
function deleteExpense(id){
  if(!confirm2('Delete this expense?'))return;
  STATE.expenses=STATE.expenses.filter(e=>e.id!==id);
  saveState();renderExpensesTable();toast('Deleted.','warn');
}

/* ════════════════════════════════════════════════════════════════
   17. REPORTS & ANALYTICS
   ════════════════════════════════════════════════════════════════ */
function renderReports(){
  const sec=$('#reports');
  sec.innerHTML=`
    <div class="card">
      <h2 style="margin-bottom:1.5rem;">Reports & Analytics</h2>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:2rem;">
        <div><label>From</label><input id="rep-from" type="date" style="width:160px;"
          value="${new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split('T')[0]}"></div>
        <div><label>To</label><input id="rep-to" type="date" style="width:160px;" value="${today()}"></div>
        <button onclick="runReports()">Generate Reports</button>
        <button onclick="exportReportsXLSX()" style="background:#16a34a;">⬇ Export to Excel</button>
        <button onclick="exportProfitLoss()" style="background:#8b5cf6;">📊 P&L Statement</button>
      </div>
      <div id="rep-kpis" class="stats-grid"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-top:1.5rem;">
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
          <h4>Sales by Payment Method</h4>
          <canvas id="chart-payment" height="220"></canvas>
        </div>
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
          <h4>Top Products by Revenue</h4>
          <canvas id="chart-products" height="220"></canvas>
        </div>
      </div>
      <div id="rep-tables" style="margin-top:2rem;"></div>
    </div>`;
  runReports();
}

function runReports(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const periodSales=STATE.sales.filter(s=>{
    const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';
  });
  const totalRevenue=periodSales.reduce((a,s)=>a+(s.total||0),0);
  const totalCOGS=periodSales.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty*(i.costPrice||0),0),0);
  const grossProfit=totalRevenue-totalCOGS;
  const grossMargin=totalRevenue?(grossProfit/totalRevenue*100):0;
  const totalDiscounts=periodSales.reduce((a,s)=>a+(s.totalDiscountAmt||0),0);
  const bulkDiscSavings=periodSales.reduce((a,s)=>a+(s.totalBulkDisc||0),0);
  const totalExpenses=STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;})
    .reduce((a,e)=>a+(e.amount||0),0);
  const netProfit=grossProfit-totalExpenses;

  const kpis=$('#rep-kpis');
  if(kpis) kpis.innerHTML=`
    <div class="stat-card" style="border-left:5px solid var(--primary);">
      <h3>Total Revenue</h3><div class="value" style="font-size:1.8rem;">${fmt(totalRevenue)}</div>
      <div style="font-size:.8rem;color:#64748b;">${periodSales.length} transactions</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #10b981;">
      <h3>Gross Profit</h3><div class="value" style="font-size:1.8rem;">${fmt(grossProfit)}</div>
      <div style="font-size:.8rem;color:#64748b;">Margin: ${grossMargin.toFixed(1)}%</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #f43f5e;">
      <h3>Net Profit</h3><div class="value" style="font-size:1.8rem;">${fmt(netProfit)}</div>
      <div style="font-size:.8rem;color:#64748b;">After ${fmt(totalExpenses)} expenses</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #f59e0b;">
      <h3>Total Discounts Given</h3><div class="value" style="font-size:1.8rem;">${fmt(totalDiscounts)}</div>
      <div style="font-size:.8rem;color:#64748b;">Bulk: ${fmt(bulkDiscSavings)}</div>
    </div>`;

  const payMap={};
  periodSales.forEach(s=>{const m=s.paymentMethod||'cash';payMap[m]=(payMap[m]||0)+(s.total||0);});
  drawDonutChart('chart-payment',Object.keys(payMap),Object.values(payMap));

  const prodMap={};
  periodSales.forEach(s=>s.items.forEach(i=>{prodMap[i.name]=(prodMap[i.name]||0)+i.qty*(i.unitPrice||0);}));
  const sortedProds=Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  drawBarChart('chart-products',sortedProds.map(x=>x[0]),sortedProds.map(x=>x[1]));

  const repPerf=STATE.salesReps.map(r=>{
    const repSales=periodSales.filter(s=>s.repId===r.id);
    const rev=repSales.reduce((a,s)=>a+(s.total||0),0);
    return{...r,periodSales:repSales.length,periodRevenue:rev,commission:rev*r.commission/100};
  });

  const custPerf=STATE.customers.map(c=>{
    const custSales=periodSales.filter(s=>s.customerId===c.id);
    const rev=custSales.reduce((a,s)=>a+(s.total||0),0);
    return{...c,periodRevenue:rev,txns:custSales.length};
  }).filter(c=>c.periodRevenue>0).sort((a,b)=>b.periodRevenue-a.periodRevenue).slice(0,10);

  // Bulk discount usage stats
  const bulkStats={};
  periodSales.forEach(s=>s.items.forEach(i=>{
    if((i.bulkDiscountPct||0)>0){
      const key=`${i.bulkDiscountPct}%`;
      bulkStats[key]=(bulkStats[key]||0)+(i.lineDiscount||0);
    }
  }));

  // Expense breakdown
  const expCats={};
  STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;})
    .forEach(e=>{expCats[e.category]=(expCats[e.category]||0)+e.amount;});

  const tables=$('#rep-tables');
  if(tables) tables.innerHTML=`
    ${Object.keys(bulkStats).length?`
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4 style="margin-bottom:1rem;">🏷 Bulk Discount Usage</h4>
        <table>
          <thead><tr><th>Discount Tier</th><th>Total Saved for Customers</th></tr></thead>
          <tbody>${Object.entries(bulkStats).map(([k,v])=>`
            <tr><td>${k}</td><td style="color:#16a34a;font-weight:600;">${fmt(v)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`:''
    }
    ${Object.keys(expCats).length?`
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4 style="margin-bottom:1rem;">💸 Expense Breakdown</h4>
        <table>
          <thead><tr><th>Category</th><th>Amount</th><th>% of Total</th></tr></thead>
          <tbody>${Object.entries(expCats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
            <tr>
              <td>${k}</td><td>${fmt(v)}</td>
              <td>${totalExpenses>0?((v/totalExpenses)*100).toFixed(1):'0'}%</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td>${fmt(totalExpenses)}</td><td>100%</td></tr></tfoot>
        </table>
      </div>`:''
    }
    ${repPerf.length?`
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4 style="margin-bottom:1rem;">Sales Rep Performance</h4>
        <table>
          <thead><tr><th>Rep</th><th>Transactions</th><th>Revenue</th><th>Commission</th></tr></thead>
          <tbody>${repPerf.map(r=>`
            <tr><td>${r.name}</td><td>${r.periodSales}</td><td>${fmt(r.periodRevenue)}</td><td>${fmt(r.commission)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`:''
    }
    ${custPerf.length?`
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4 style="margin-bottom:1rem;">Top Customers</h4>
        <table>
          <thead><tr><th>Customer</th><th>Type</th><th>Transactions</th><th>Revenue</th><th>Loyalty Pts</th></tr></thead>
          <tbody>${custPerf.map(c=>`
            <tr><td>${c.name}</td>
            <td><span class="badge badge-${c.customerType==='wholesale'?'blue':'green'}">${c.customerType||'retail'}</span></td>
            <td>${c.txns}</td><td>${fmt(c.periodRevenue)}</td>
            <td style="color:#7c3aed;">🌟 ${fmtNum(c.loyaltyPoints||0)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`:''
    }
    <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
      <h4 style="margin-bottom:1rem;">Sales Transactions</h4>
      ${periodSales.length?`
        <table>
          <thead><tr><th>Date</th><th>Ref No.</th><th>Customer</th><th>Rep</th><th>Total</th><th>Discounts</th><th>Method</th></tr></thead>
          <tbody>${periodSales.slice().reverse().map(s=>`
            <tr>
              <td>${fmtDate(s.date)}</td>
              <td style="font-family:monospace;">${s.invoiceNo||s.receiptNo||'—'}</td>
              <td>${s.customerName||'Walk-in'}</td>
              <td>${s.repName||'—'}</td>
              <td>${fmt(s.total)}</td>
              <td>${(s.totalDiscountAmt||0)>0?`<span style="color:#16a34a;">-${fmt(s.totalDiscountAmt)}</span>`:'—'}</td>
              <td>${s.paymentMethod||'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`:
      '<p style="color:#9ca3af;text-align:center;padding:1rem;">No sales in this period.</p>'}
    </div>`;
}

let charts={};
function drawDonutChart(canvasId,labels,data){
  if(charts[canvasId]){charts[canvasId].destroy();delete charts[canvasId];}
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  charts[canvasId]=new Chart(canvas,{type:'doughnut',data:{labels,datasets:[{data,
    backgroundColor:['#2563eb','#16a34a','#f59e0b','#dc2626','#8b5cf6','#06b6d4']}]},
    options:{plugins:{legend:{position:'bottom'}},responsive:true}});
}
function drawBarChart(canvasId,labels,data){
  if(charts[canvasId]){charts[canvasId].destroy();delete charts[canvasId];}
  const canvas=document.getElementById(canvasId);if(!canvas)return;
  charts[canvasId]=new Chart(canvas,{type:'bar',data:{
    labels:labels.map(l=>l.length>18?l.slice(0,18)+'…':l),
    datasets:[{label:'Revenue (₦)',data,backgroundColor:'#2563eb'}]},
    options:{plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,ticks:{callback:v=>'₦'+v.toLocaleString()}}},responsive:true}});
}

function exportReportsXLSX(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const periodSales=STATE.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';});
  const salesRows=periodSales.map(s=>({
    Date:fmtDate(s.date),'Ref No.':s.invoiceNo||s.receiptNo||'',
    Customer:s.customerName||'Walk-in',Rep:s.repName||'',
    'Gross Total':s.subtotal||s.total,
    'Bulk Discount':s.totalBulkDisc||0,'Other Discount':s.totalManualDisc||0,
    'Total Discounts':s.totalDiscountAmt||0,Tax:s.taxAmt,Total:s.total,
    Method:s.paymentMethod,Status:s.paymentStatus,
  }));
  const expRows=STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;})
    .map(e=>({Date:fmtDate(e.date),Category:e.category,Description:e.description,Amount:e.amount,PaidBy:e.paidBy||''}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(salesRows),'Sales');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(expRows),'Expenses');
  XLSX.writeFile(wb,`cnjohnson_report_${today()}.xlsx`);
  toast('Report exported.','success');
}

function exportProfitLoss(){
  const from=new Date($('#rep-from')?.value||'1970-01-01');
  const to=new Date(($('#rep-to')?.value||today())+'T23:59:59');
  const periodSales=STATE.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to&&s.type!=='payment';});
  const revenue=periodSales.reduce((a,s)=>a+(s.total||0),0);
  const cogs=periodSales.reduce((a,s)=>a+s.items.reduce((b,i)=>b+i.qty*(i.costPrice||0),0),0);
  const grossProfit=revenue-cogs;
  const expenses=STATE.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;});
  const totalExp=expenses.reduce((a,e)=>a+(e.amount||0),0);
  const netProfit=grossProfit-totalExp;
  const rows=[
    {Item:'REVENUE','Amount (₦)':revenue},
    {Item:'Cost of Goods Sold','Amount (₦)':-cogs},
    {Item:'GROSS PROFIT','Amount (₦)':grossProfit},
    {Item:'---','Amount (₦)':''},
    {Item:'EXPENSES','Amount (₦)':''},
    ...expenses.map(e=>({Item:`  ${e.category}: ${e.description}`,'Amount (₦)':-e.amount})),
    {Item:'Total Expenses','Amount (₦)':-totalExp},
    {Item:'---','Amount (₦)':''},
    {Item:'NET PROFIT / (LOSS)','Amount (₦)':netProfit},
  ];
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Profit & Loss');
  XLSX.writeFile(wb,`cnjohnson_PL_${today()}.xlsx`);
  toast('P&L Statement exported.','success');
}

/* ════════════════════════════════════════════════════════════════
   18. SETTINGS
   ════════════════════════════════════════════════════════════════ */
function renderSettings(){
  const sec=$('#settings');
  const s=STATE.settings;
  sec.innerHTML=`
    <div class="card">
      <h2 style="margin-bottom:1.5rem;">System Settings</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:2rem;">
        <div>
          <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Company Information</h3>
          <div class="form-grid" style="grid-template-columns:1fr;">
            <div><label>Company Name</label><input id="set-cname" style="width:100%;" value="${s.companyName}"></div>
            <div><label>Address</label><input id="set-addr" style="width:100%;" value="${s.address}"></div>
            <div><label>Phone</label><input id="set-phone" style="width:100%;" value="${s.phone}"></div>
            <div><label>Email</label><input id="set-email" style="width:100%;" value="${s.email}"></div>
          </div>
        </div>
        <div>
          <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Financial Settings</h3>
          <div class="form-grid" style="grid-template-columns:1fr;">
            <div><label>Currency Symbol</label><input id="set-currency" style="width:100%;" value="${s.currency}" maxlength="3"></div>
            <div><label>VAT / Tax Rate (%)</label><input id="set-tax" type="number" min="0" max="100" style="width:100%;" value="${s.taxRate}"></div>
            <div><label>Low Stock Alert Threshold</label><input id="set-lowstock" type="number" min="1" style="width:100%;" value="${s.lowStockThreshold}"></div>
          </div>
        </div>
        <div>
          <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Loyalty Programme</h3>
          <div class="form-grid" style="grid-template-columns:1fr;">
            <div><label>Points per ₦1,000 spent</label><input id="set-loyalty-rate" type="number" min="0" style="width:100%;" value="${s.loyaltyPointsRate||1}"></div>
            <div><label>₦ value per point (redemption)</label><input id="set-loyalty-redeem" type="number" min="0" style="width:100%;" value="${s.loyaltyRedemptionRate||100}"></div>
          </div>
        </div>
        <div>
          <h3 style="margin-bottom:1rem;border-bottom:1px solid #e5e7eb;padding-bottom:.75rem;">Numbering Sequences</h3>
          <div class="form-grid" style="grid-template-columns:1fr;">
            <div><label>Invoice Prefix</label><input id="set-invpfx" style="width:100%;" value="${s.invoicePrefix}"></div>
            <div><label>Receipt Prefix</label><input id="set-rcppfx" style="width:100%;" value="${s.receiptPrefix}"></div>
            <div><label>Quote Prefix</label><input id="set-qtepfx" style="width:100%;" value="${s.quotePrefix}"></div>
            <div><label>Next Invoice No.</label><input id="set-nextinv" type="number" style="width:100%;" value="${s.nextInvoiceNo}"></div>
            <div><label>Next Receipt No.</label><input id="set-nextrcp" type="number" style="width:100%;" value="${s.nextReceiptNo}"></div>
            <div><label>Next Quote No.</label><input id="set-nextqte" type="number" style="width:100%;" value="${s.nextQuoteNo}"></div>
          </div>
        </div>
      </div>
      <div style="margin-top:2rem;display:flex;gap:1rem;flex-wrap:wrap;">
        <button onclick="saveSettings()">💾 Save Settings</button>
        <button onclick="backupData()" style="background:#6b7280;">⬇ Backup Data (JSON)</button>
        <button onclick="document.getElementById('restore-file').click()" style="background:#0891b2;">⬆ Restore Backup</button>
        <input type="file" id="restore-file" accept=".json" style="display:none;" onchange="restoreData(this)">
        <button onclick="resetAllData()" class="danger">⚠ Reset All Data</button>
      </div>
    </div>`;
}

function saveSettings(){
  const s=STATE.settings;
  s.companyName=$('#set-cname').value.trim()||s.companyName;
  s.address=$('#set-addr').value.trim();
  s.phone=$('#set-phone').value.trim();
  s.email=$('#set-email').value.trim();
  s.currency=$('#set-currency').value.trim()||s.currency;
  s.taxRate=parseFloat($('#set-tax').value)||s.taxRate;
  s.lowStockThreshold=parseInt($('#set-lowstock').value)||s.lowStockThreshold;
  s.loyaltyPointsRate=parseInt($('#set-loyalty-rate').value)||1;
  s.loyaltyRedemptionRate=parseInt($('#set-loyalty-redeem').value)||100;
  s.invoicePrefix=$('#set-invpfx').value.trim()||s.invoicePrefix;
  s.receiptPrefix=$('#set-rcppfx').value.trim()||s.receiptPrefix;
  s.quotePrefix=$('#set-qtepfx').value.trim()||s.quotePrefix;
  s.nextInvoiceNo=parseInt($('#set-nextinv').value)||s.nextInvoiceNo;
  s.nextReceiptNo=parseInt($('#set-nextrcp').value)||s.nextReceiptNo;
  s.nextQuoteNo=parseInt($('#set-nextqte').value)||s.nextQuoteNo;
  saveState();toast('Settings saved.','success');
}

function backupData(){
  const blob=new Blob([JSON.stringify(STATE,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:`cnjohnson_backup_${today()}.json`});
  a.click();URL.revokeObjectURL(url);toast('Backup downloaded.','success');
}
function restoreData(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.settings||!data.products)throw new Error('Invalid backup file.');
      if(!confirm2('This will overwrite ALL current data. Continue?'))return;
      STATE=data;saveState();toast('Data restored successfully.','success');showSection('dashboard');
    }catch(err){toast('Restore failed: '+err.message,'error');}
  };
  reader.readAsText(file);input.value='';
}
function resetAllData(){
  if(!confirm2('⚠ This will permanently delete ALL data. Type RESET to confirm.'))return;
  const ans=prompt('Type RESET to confirm:');
  if(ans!=='RESET')return toast('Reset cancelled.','warn');
  STATE=defaultState();saveState();toast('All data has been reset.','warn');showSection('dashboard');
}

/* ════════════════════════════════════════════════════════════════
   19. GLOBAL CSS INJECTION
   ════════════════════════════════════════════════════════════════ */
(function injectGlobalStyles(){
  const style=document.createElement('style');
  style.textContent=`
    @keyframes modalIn{from{opacity:0;transform:scale(.95) translateY(-12px);}to{opacity:1;transform:none;}}
    label{display:block;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:.35rem;}
    .badge{display:inline-block;padding:.2rem .65rem;border-radius:20px;font-size:.75rem;font-weight:700;}
    .badge-green{background:#d1fae5;color:#065f46;}
    .badge-yellow{background:#fef9c3;color:#92400e;}
    .badge-blue{background:#dbeafe;color:#1e40af;}
    .badge-red{background:#fee2e2;color:#991b1b;}
    tfoot td{background:#f8fafc;font-weight:600;}
    @media(max-width:768px){.form-grid{grid-template-columns:1fr!important;}main{padding:1rem;}}
    #dashboard-extended .stats-grid{margin-bottom:0;}
  `;
  document.head.append(style);
})();

/* ════════════════════════════════════════════════════════════════
   20. INITIALIZATION
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  const sections=['dashboard','warehouse','products','pos','customers','suppliers','sales-reps',
    'purchases','invoices','quotes','bulk-discounts','credit-notes','expenses','reports','settings'];
  sections.forEach(id=>{
    if(!document.getElementById(id)){
      const sec=document.createElement('section');sec.id=id;$('main').append(sec);
    }
  });

  const dash=document.getElementById('dashboard');
  if(dash&&!$('#dashboard-extended',dash)){
    const ext=document.createElement('div');ext.id='dashboard-extended';dash.append(ext);
  }

  // Add new nav links if HTML doesn't have them
  const navLinks=[
    {href:'#quotes',text:'📄 Quotes',after:'#invoices'},
    {href:'#bulk-discounts',text:'🏷 Bulk Discounts',after:'#pos'},
    {href:'#credit-notes',text:'📝 Credit Notes',after:'#invoices'},
    {href:'#expenses',text:'💸 Expenses',after:'#purchases'},
  ];
  navLinks.forEach(({href,text,after})=>{
    if(!$(`.sidebar a[href="${href}"]`)){
      const afterLink=$(`.sidebar a[href="${after}"]`);
      if(afterLink){
        const a=document.createElement('a');
        a.href=href;a.innerHTML=text;
        a.onclick=()=>showSection(href.slice(1));
        afterLink.after(a);
      }
    }
  });

  showSection('dashboard');
});

//salesrep monitor
/* ================================================================
   SALES REP ACTIVITY MONITOR — Add-on for C.N. Johnson Ventures
   salesrep_monitor.js
   
   HOW TO INTEGRATE:
   1. Paste the entire contents of this file at the END of script.js,
      just before the closing line of Section 20 (DOMContentLoaded).
   2. In the DOMContentLoaded sections array, add 'rep-activity' :
        const sections = ['dashboard','warehouse',...,'settings','rep-activity'];
   3. In the navLinks array inside DOMContentLoaded, add:
        { href:'#rep-activity', text:'📊 Rep Activity', after:'#sales-reps' },
   ================================================================ */

/* ════════════════════════════════════════════════════════════════
   A.  ACTIVITY LOGGING — Called automatically on every sale action
   ════════════════════════════════════════════════════════════════ */

/**
 * Log a sales rep activity event.
 * @param {string} repId       — Rep's ID (e.g. 'R001')
 * @param {string} type        — Event type (see ACTIVITY_TYPES below)
 * @param {object} payload     — Context data for the event
 */
function logRepActivity(repId, type, payload = {}) {
  if (!repId) return;                         // Walk-in / no rep assigned
  if (!STATE.repActivityLog) STATE.repActivityLog = [];

  const rep = STATE.salesReps.find(r => r.id === repId);
  STATE.repActivityLog.push({
    id: uid(),
    repId,
    repName: rep ? rep.name : repId,
    type,
    date: nowISO(),
    ...payload,
  });

  // Keep the log bounded (last 5000 events)
  if (STATE.repActivityLog.length > 5000) {
    STATE.repActivityLog = STATE.repActivityLog.slice(-5000);
  }
  saveState();
}

/* Activity type constants */
const ACTIVITY_TYPES = {
  SALE_COMPLETED:   'sale_completed',
  SALE_CREDIT:      'sale_credit',
  QUOTE_CREATED:    'quote_created',
  QUOTE_CONVERTED:  'quote_converted',
  DISCOUNT_APPLIED: 'discount_applied',
  LARGE_SALE:       'large_sale',       // > ₦100,000
  DAILY_TARGET_HIT: 'daily_target_hit',
};

/* ── PATCH completeSale() to emit activity events ────────────── */
/* We wrap the original completeSale so the monitor fires without
   modifying any existing code. */
(function patchCompleteSale() {
  const _original = window.completeSale || completeSale;

  function patchedCompleteSale() {
    // Capture pre-sale state so we can diff afterwards
    const repId      = $('#pos-rep')  ? $('#pos-rep').value  : '';
    const custId     = $('#pos-customer') ? $('#pos-customer').value : '';
    const customer   = STATE.customers.find(c => c.id === custId);
    const payment    = $('#pos-payment') ? $('#pos-payment').value : 'cash';
    const cartSnapshot = posCart.map(i => ({ ...i }));   // shallow copy
    const discountPct  = parseFloat($('#pos-discount')?.value) || 0;
    const prevSaleCount = STATE.sales.length;

    // Run the original function
    _original();

    // If a new sale was actually recorded (original fn may bail early)
    if (STATE.sales.length <= prevSaleCount) return;

    const newSale = STATE.sales[STATE.sales.length - 1];
    if (!newSale || !repId) return;

    const isCredit = payment === 'credit';
    const hasBulkDisc = (newSale.totalBulkDisc || 0) > 0;
    const hasManDisc  = discountPct > 0 || cartSnapshot.some(i => (i.manualDiscountPct || 0) > 0);

    // Core sale activity
    logRepActivity(repId, isCredit ? ACTIVITY_TYPES.SALE_CREDIT : ACTIVITY_TYPES.SALE_COMPLETED, {
      saleId:       newSale.id,
      ref:          newSale.invoiceNo || newSale.receiptNo,
      customerId:   custId,
      customerName: customer ? customer.name : 'Walk-in',
      total:        newSale.total,
      itemCount:    cartSnapshot.reduce((s, i) => s + i.qty, 0),
      lineCount:    cartSnapshot.length,
      paymentMethod: payment,
      warehouseId:  posWarehouse,
    });

    // Discount event
    if (hasBulkDisc || hasManDisc) {
      logRepActivity(repId, ACTIVITY_TYPES.DISCOUNT_APPLIED, {
        saleRef:       newSale.invoiceNo || newSale.receiptNo,
        bulkDiscAmt:   newSale.totalBulkDisc || 0,
        manualDiscAmt: newSale.totalManualDisc || 0,
        extraDiscPct:  discountPct,
        totalDiscAmt:  newSale.totalDiscountAmt || 0,
      });
    }

    // Large sale flag
    if (newSale.total >= 100000) {
      logRepActivity(repId, ACTIVITY_TYPES.LARGE_SALE, {
        saleRef: newSale.invoiceNo || newSale.receiptNo,
        total:   newSale.total,
      });
    }

    // Check daily target (configurable via settings, defaults to ₦200,000)
    const dailyTarget = STATE.settings.repDailyTarget || 200000;
    const todayStr    = today();
    const todayTotal  = STATE.sales
      .filter(s => s.repId === repId && s.date && s.date.startsWith(todayStr) && s.type !== 'payment')
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const alreadyLogged = STATE.repActivityLog.some(
      e => e.repId === repId && e.type === ACTIVITY_TYPES.DAILY_TARGET_HIT && e.date && e.date.startsWith(todayStr)
    );
    if (todayTotal >= dailyTarget && !alreadyLogged) {
      logRepActivity(repId, ACTIVITY_TYPES.DAILY_TARGET_HIT, {
        target:     dailyTarget,
        achieved:   todayTotal,
        achievedAt: nowISO(),
      });
    }
  }

  // Overwrite the global reference
  window.completeSale = patchedCompleteSale;
})();

/* ── PATCH saveAsQuote() to log quote creation ───────────────── */
(function patchSaveAsQuote() {
  const _orig = window.saveAsQuote || saveAsQuote;
  window.saveAsQuote = function () {
    const repId   = $('#pos-rep') ? $('#pos-rep').value : '';
    const custId  = $('#pos-customer') ? $('#pos-customer').value : '';
    const prevLen = STATE.quotes.length;
    _orig();
    if (STATE.quotes.length > prevLen && repId) {
      const q = STATE.quotes[STATE.quotes.length - 1];
      logRepActivity(repId, ACTIVITY_TYPES.QUOTE_CREATED, {
        quoteNo:      q.quoteNo,
        customerId:   custId,
        customerName: q.customerName,
        total:        q.total,
      });
    }
  };
})();

/* ── PATCH convertQuoteToSale() to log conversion ───────────── */
(function patchConvertQuote() {
  const _orig = window.convertQuoteToSale || convertQuoteToSale;
  window.convertQuoteToSale = function (quoteId) {
    const q = STATE.quotes.find(x => x.id === quoteId);
    _orig(quoteId);
    if (q) {
      const repId = $('#pos-rep') ? $('#pos-rep').value : '';
      if (repId) {
        logRepActivity(repId, ACTIVITY_TYPES.QUOTE_CONVERTED, {
          quoteNo:      q.quoteNo,
          customerName: q.customerName,
          total:        q.total,
        });
      }
    }
  };
})();

/* ════════════════════════════════════════════════════════════════
   B.  REP ACTIVITY DASHBOARD — Section renderer
   ════════════════════════════════════════════════════════════════ */
function renderRepActivity() {
  // Ensure log array exists (backward compat)
  if (!STATE.repActivityLog) STATE.repActivityLog = [];

  const sec = document.getElementById('rep-activity');
  if (!sec) return;

  const repOpts = `<option value="">All Reps</option>` +
    STATE.salesReps.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

  sec.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.5rem;">
        <div>
          <h2 style="margin:0;">Sales Rep Activity Monitor</h2>
          <p style="color:#64748b;font-size:.875rem;margin:.3rem 0 0;">
            Real-time tracking of every rep's sales actions, discounts, quotes &amp; achievements.
          </p>
        </div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
          <select id="ra-rep" style="width:180px;" onchange="refreshRepActivityPage()">
            ${repOpts}
          </select>
          <input id="ra-from" type="date" style="width:150px;"
            value="${new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]}"
            onchange="refreshRepActivityPage()">
          <input id="ra-to" type="date" style="width:150px;" value="${today()}"
            onchange="refreshRepActivityPage()">
          <button onclick="exportRepActivityXLSX()" style="background:#16a34a;">⬇ Export</button>
          <button onclick="printRepActivityReport()" style="background:#0891b2;">🖨 Print Report</button>
        </div>
      </div>

      <!-- KPI Strip -->
      <div id="ra-kpis" class="stats-grid" style="margin-bottom:1.5rem;"></div>

      <!-- Leaderboard + Daily Trend side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
          <h4 style="margin-bottom:1rem;">🏆 Rep Leaderboard (Period)</h4>
          <div id="ra-leaderboard"></div>
        </div>
        <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
          <h4 style="margin-bottom:1rem;">📈 Daily Revenue Trend</h4>
          <canvas id="ra-chart-daily" height="220"></canvas>
        </div>
      </div>

      <!-- Performance by rep chart -->
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-bottom:1.5rem;">
        <h4 style="margin-bottom:1rem;">📊 Revenue by Rep (Period)</h4>
        <canvas id="ra-chart-reps" height="160"></canvas>
      </div>

      <!-- Activity log table -->
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h4 style="margin:0;">Activity Log</h4>
          <div style="display:flex;gap:.75rem;">
            <select id="ra-type-filter" style="width:180px;" onchange="refreshRepActivityPage()">
              <option value="">All Activity Types</option>
              <option value="sale_completed">Cash/Transfer Sales</option>
              <option value="sale_credit">Credit Sales</option>
              <option value="quote_created">Quotes Created</option>
              <option value="quote_converted">Quotes Converted</option>
              <option value="discount_applied">Discounts Applied</option>
              <option value="large_sale">Large Sales (₦100k+)</option>
              <option value="daily_target_hit">Daily Target Achieved</option>
            </select>
          </div>
        </div>
        <div id="ra-log-table"></div>
      </div>

      <!-- Per-rep scorecards -->
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-top:1.5rem;">
        <h4 style="margin-bottom:1rem;">📋 Individual Rep Scorecards</h4>
        <div id="ra-scorecards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;"></div>
      </div>

      <!-- Daily target settings -->
      <div class="card" style="box-shadow:none;border:1px solid #e5e7eb;margin-top:1.5rem;background:#f8fafc;">
        <h4 style="margin-bottom:.75rem;">⚙ Monitor Settings</h4>
        <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
          <div>
            <label>Daily Revenue Target per Rep (₦)</label>
            <input id="ra-daily-target" type="number" min="0"
              value="${STATE.settings.repDailyTarget || 200000}"
              style="width:180px;margin-top:.3rem;">
          </div>
          <div style="padding-top:1.3rem;">
            <button onclick="saveRepMonitorSettings()" style="background:#6b7280;">Save Target</button>
          </div>
          <div style="color:#64748b;font-size:.8rem;padding-top:1.3rem;">
            A "Daily Target Hit" event is logged automatically when a rep crosses this threshold.
          </div>
        </div>
      </div>
    </div>`;

  refreshRepActivityPage();
}

/* ── Refresh all widgets ─────────────────────────────────────── */
function refreshRepActivityPage() {
  const repFilter  = $('#ra-rep')?.value        || '';
  const fromStr    = $('#ra-from')?.value       || '';
  const toStr      = $('#ra-to')?.value         || '';
  const typeFilter = $('#ra-type-filter')?.value || '';

  const from = fromStr ? new Date(fromStr)                          : new Date('1970-01-01');
  const to   = toStr   ? new Date(toStr + 'T23:59:59')              : new Date();

  /* ── Filter log ── */
  const log = (STATE.repActivityLog || []).filter(e => {
    const d = new Date(e.date);
    return d >= from && d <= to &&
      (!repFilter  || e.repId === repFilter) &&
      (!typeFilter || e.type  === typeFilter);
  });

  /* ── Filter sales for KPIs / charts ── */
  const sales = STATE.sales.filter(s => {
    const d = new Date(s.date);
    return d >= from && d <= to && s.type !== 'payment' &&
      (!repFilter || s.repId === repFilter);
  });

  renderRepKPIs(sales, log, from, to, repFilter);
  renderRepLeaderboard(sales, from, to);
  renderRepDailyChart(sales, from, to, repFilter);
  renderRepBarChart(sales);
  renderRepLogTable(log);
  renderRepScorecards(from, to);
}

/* ── KPI strip ── */
function renderRepKPIs(sales, log, from, to, repFilter) {
  const totalRevenue  = sales.reduce((s, x) => s + (x.total || 0), 0);
  const totalTxns     = sales.filter(s => !s.type || s.type !== 'payment').length;
  const avgTicket     = totalTxns ? totalRevenue / totalTxns : 0;
  const discountEvents = log.filter(e => e.type === ACTIVITY_TYPES.DISCOUNT_APPLIED);
  const totalDiscGiven = discountEvents.reduce((s, e) => s + (e.totalDiscAmt || 0), 0);
  const quotesCreated  = log.filter(e => e.type === ACTIVITY_TYPES.QUOTE_CREATED).length;
  const quotesConverted = log.filter(e => e.type === ACTIVITY_TYPES.QUOTE_CONVERTED).length;
  const convRate = quotesCreated ? ((quotesConverted / quotesCreated) * 100).toFixed(0) + '%' : '—';
  const targetHits = log.filter(e => e.type === ACTIVITY_TYPES.DAILY_TARGET_HIT).length;

  const kpiEl = $('#ra-kpis');
  if (!kpiEl) return;
  kpiEl.innerHTML = `
    <div class="stat-card" style="border-left:5px solid #2563eb;">
      <h3>Total Revenue</h3>
      <div class="value">${fmt(totalRevenue)}</div>
      <div style="font-size:.8rem;color:#64748b;">${totalTxns} transactions</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #10b981;">
      <h3>Avg. Transaction</h3>
      <div class="value">${fmt(avgTicket)}</div>
      <div style="font-size:.8rem;color:#64748b;">per sale</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #f59e0b;">
      <h3>Total Discounts Given</h3>
      <div class="value">${fmt(totalDiscGiven)}</div>
      <div style="font-size:.8rem;color:#64748b;">${discountEvents.length} discount events</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #0891b2;">
      <h3>Quote Conversion</h3>
      <div class="value">${convRate}</div>
      <div style="font-size:.8rem;color:#64748b;">${quotesConverted} / ${quotesCreated} quotes</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #8b5cf6;">
      <h3>Daily Targets Hit</h3>
      <div class="value">${targetHits}</div>
      <div style="font-size:.8rem;color:#64748b;">days target was met</div>
    </div>
    <div class="stat-card" style="border-left:5px solid #f43f5e;">
      <h3>Large Sales (₦100k+)</h3>
      <div class="value">${(STATE.repActivityLog||[]).filter(e=>e.type===ACTIVITY_TYPES.LARGE_SALE&&(!$('#ra-rep')?.value||e.repId===$('#ra-rep')?.value)).length}</div>
      <div style="font-size:.8rem;color:#64748b;">in selected period</div>
    </div>`;
}

/* ── Leaderboard ── */
function renderRepLeaderboard(sales, from, to) {
  const el = $('#ra-leaderboard');
  if (!el) return;

  const ranked = STATE.salesReps.map(r => {
    const rSales = sales.filter(s => s.repId === r.id);
    const rev    = rSales.reduce((a, s) => a + (s.total || 0), 0);
    const txns   = rSales.length;
    const disc   = rSales.reduce((a, s) => a + (s.totalDiscountAmt || 0), 0);
    return { ...r, periodRevenue: rev, periodTxns: txns, periodDisc: disc };
  }).sort((a, b) => b.periodRevenue - a.periodRevenue);

  if (!ranked.length || ranked.every(r => r.periodRevenue === 0)) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:1rem;">No sales in this period.</p>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const maxRev = ranked[0].periodRevenue || 1;

  el.innerHTML = ranked.map((r, i) => `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
      <div style="font-size:1.5rem;width:2rem;text-align:center;">${medals[i] || (i + 1)}</div>
      <div style="flex:1;">
        <div style="display:flex;justify-content:space-between;margin-bottom:.2rem;">
          <span style="font-weight:600;">${r.name}</span>
          <span style="font-weight:700;color:#2563eb;">${fmt(r.periodRevenue)}</span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${i===0?'#f59e0b':i===1?'#6b7280':'#cd7c3c'};height:100%;
            width:${(r.periodRevenue/maxRev*100).toFixed(1)}%;border-radius:4px;transition:width .4s;"></div>
        </div>
        <div style="font-size:.75rem;color:#64748b;margin-top:.2rem;">
          ${r.periodTxns} sales &nbsp;|&nbsp; ${fmt(r.commission/100*r.periodRevenue)} commission
        </div>
      </div>
    </div>`).join('');
}

/* ── Daily trend line chart ── */
let raCharts = {};
function renderRepDailyChart(sales, from, to, repFilter) {
  if (raCharts['ra-chart-daily']) { raCharts['ra-chart-daily'].destroy(); delete raCharts['ra-chart-daily']; }
  const canvas = document.getElementById('ra-chart-daily');
  if (!canvas) return;

  // Build date → revenue map
  const dateMap = {};
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    dateMap[d.toISOString().split('T')[0]] = 0;
  }
  sales.forEach(s => {
    const k = (s.date || '').split('T')[0];
    if (k in dateMap) dateMap[k] += s.total || 0;
  });

  const labels = Object.keys(dateMap).sort();
  const data   = labels.map(k => dateMap[k]);

  const datasets = [];

  // If a specific rep is chosen, also show overall for context
  if (repFilter) {
    const allDateMap = {};
    labels.forEach(k => allDateMap[k] = 0);
    STATE.sales.filter(s => {
      const d = new Date(s.date);
      return d >= from && d <= to && s.type !== 'payment';
    }).forEach(s => {
      const k = (s.date || '').split('T')[0];
      if (k in allDateMap) allDateMap[k] += s.total || 0;
    });
    datasets.push({
      label: 'All Reps',
      data: labels.map(k => allDateMap[k]),
      borderColor: '#d1d5db', backgroundColor: 'transparent',
      borderDash: [4, 4], tension: .4, pointRadius: 0,
    });
  }

  const rep = STATE.salesReps.find(r => r.id === repFilter);
  datasets.push({
    label: rep ? rep.name : 'All Reps',
    data,
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37,99,235,.08)',
    fill: true, tension: .4, pointRadius: 3,
  });

  // Daily target line
  const target = STATE.settings.repDailyTarget || 200000;
  datasets.push({
    label: 'Daily Target',
    data: labels.map(() => target),
    borderColor: '#f59e0b',
    borderDash: [6, 3],
    pointRadius: 0,
    backgroundColor: 'transparent',
  });

  raCharts['ra-chart-daily'] = new Chart(canvas, {
    type: 'line',
    data: { labels: labels.map(l => l.slice(5)), datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => '₦' + (v/1000).toFixed(0) + 'k' } },
      },
    },
  });
}

/* ── Bar chart: revenue by rep ── */
function renderRepBarChart(sales) {
  if (raCharts['ra-chart-reps']) { raCharts['ra-chart-reps'].destroy(); delete raCharts['ra-chart-reps']; }
  const canvas = document.getElementById('ra-chart-reps');
  if (!canvas) return;

  const repRevs = STATE.salesReps.map(r => ({
    name: r.name,
    rev:  sales.filter(s => s.repId === r.id).reduce((a, s) => a + (s.total || 0), 0),
    disc: sales.filter(s => s.repId === r.id).reduce((a, s) => a + (s.totalDiscountAmt || 0), 0),
  })).filter(r => r.rev > 0);

  if (!repRevs.length) return;

  raCharts['ra-chart-reps'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: repRevs.map(r => r.name),
      datasets: [
        { label: 'Revenue',  data: repRevs.map(r => r.rev),  backgroundColor: '#2563eb' },
        { label: 'Discounts Given', data: repRevs.map(r => r.disc), backgroundColor: '#f59e0b' },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '₦' + v.toLocaleString() } } },
    },
  });
}

/* ── Activity log table ── */
const ACTIVITY_LABELS = {
  sale_completed:   { label: 'Sale (Cash)',      color: '#16a34a', icon: '✅' },
  sale_credit:      { label: 'Sale (Credit)',     color: '#2563eb', icon: '📄' },
  quote_created:    { label: 'Quote Created',     color: '#0891b2', icon: '📝' },
  quote_converted:  { label: 'Quote Converted',   color: '#7c3aed', icon: '🔄' },
  discount_applied: { label: 'Discount Applied',  color: '#f59e0b', icon: '🏷' },
  large_sale:       { label: 'Large Sale ₦100k+', color: '#dc2626', icon: '🔥' },
  daily_target_hit: { label: 'Daily Target Hit',  color: '#d97706', icon: '🏆' },
};

function renderRepLogTable(log) {
  const el = $('#ra-log-table');
  if (!el) return;

  if (!log.length) {
    el.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:2rem;">No activity in this period.</p>';
    return;
  }

  const sorted = [...log].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 200);

  el.innerHTML = `
    <div style="max-height:480px;overflow-y:auto;">
      <table>
        <thead><tr>
          <th>Date &amp; Time</th>
          <th>Rep</th>
          <th>Activity</th>
          <th>Reference</th>
          <th>Customer</th>
          <th>Amount</th>
          <th>Detail</th>
        </tr></thead>
        <tbody>
          ${sorted.map(e => {
            const meta = ACTIVITY_LABELS[e.type] || { label: e.type, color: '#6b7280', icon: '•' };
            let ref    = e.ref || e.quoteNo || '—';
            let cust   = e.customerName || '—';
            let amount = '';
            let detail = '';

            if (e.type === ACTIVITY_TYPES.SALE_COMPLETED || e.type === ACTIVITY_TYPES.SALE_CREDIT) {
              amount = fmt(e.total || 0);
              detail = `${e.lineCount || 0} line(s), ${e.itemCount || 0} unit(s) via ${e.paymentMethod || '—'}`;
            } else if (e.type === ACTIVITY_TYPES.DISCOUNT_APPLIED) {
              amount = `-${fmt(e.totalDiscAmt || 0)}`;
              detail = `Bulk: ${fmt(e.bulkDiscAmt || 0)} | Manual: ${fmt(e.manualDiscAmt || 0)} | Extra: ${e.extraDiscPct || 0}%`;
            } else if (e.type === ACTIVITY_TYPES.QUOTE_CREATED || e.type === ACTIVITY_TYPES.QUOTE_CONVERTED) {
              amount = fmt(e.total || 0);
              detail = e.type === ACTIVITY_TYPES.QUOTE_CONVERTED ? 'Loaded into POS' : 'Saved from POS';
            } else if (e.type === ACTIVITY_TYPES.LARGE_SALE) {
              amount = fmt(e.total || 0);
              detail = '₦100,000+ transaction';
            } else if (e.type === ACTIVITY_TYPES.DAILY_TARGET_HIT) {
              amount = fmt(e.achieved || 0);
              detail = `Target was ${fmt(e.target || 0)}`;
            }

            return `
              <tr>
                <td style="white-space:nowrap;font-size:.82rem;">${new Date(e.date).toLocaleString('en-NG')}</td>
                <td><strong>${e.repName}</strong></td>
                <td>
                  <span style="background:${meta.color}20;color:${meta.color};border-radius:20px;
                    font-size:.75rem;font-weight:700;padding:.2rem .65rem;white-space:nowrap;">
                    ${meta.icon} ${meta.label}
                  </span>
                </td>
                <td style="font-family:monospace;font-size:.82rem;">${ref}</td>
                <td style="font-size:.85rem;">${cust}</td>
                <td style="font-weight:700;${amount.startsWith('-')?'color:#dc2626;':'color:#16a34a;'}">${amount}</td>
                <td style="font-size:.8rem;color:#64748b;">${detail}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <p style="color:#9ca3af;font-size:.78rem;margin-top:.5rem;text-align:right;">
      Showing last ${Math.min(sorted.length, 200)} of ${log.length} events
    </p>`;
}

/* ── Individual scorecards ── */
function renderRepScorecards(from, to) {
  const el = $('#ra-scorecards');
  if (!el) return;

  const todayStr = today();
  const log      = STATE.repActivityLog || [];

  el.innerHTML = STATE.salesReps.map(r => {
    const rSales = STATE.sales.filter(s => {
      const d = new Date(s.date);
      return d >= from && d <= to && s.repId === r.id && s.type !== 'payment';
    });
    const rev          = rSales.reduce((a, s) => a + (s.total || 0), 0);
    const txns         = rSales.length;
    const avgTicket    = txns ? rev / txns : 0;
    const discTotal    = rSales.reduce((a, s) => a + (s.totalDiscountAmt || 0), 0);
    const creditSales  = rSales.filter(s => s.paymentStatus === 'unpaid').length;
    const largeSales   = rSales.filter(s => (s.total || 0) >= 100000).length;
    const quotesCreated = log.filter(e => e.repId === r.id && e.type === ACTIVITY_TYPES.QUOTE_CREATED &&
      new Date(e.date) >= from && new Date(e.date) <= to).length;
    const quotesConv   = log.filter(e => e.repId === r.id && e.type === ACTIVITY_TYPES.QUOTE_CONVERTED &&
      new Date(e.date) >= from && new Date(e.date) <= to).length;
    const targetHits   = log.filter(e => e.repId === r.id && e.type === ACTIVITY_TYPES.DAILY_TARGET_HIT &&
      new Date(e.date) >= from && new Date(e.date) <= to).length;
    const commission   = rev * r.commission / 100;

    // Today's stats
    const todaySales = rSales.filter(s => (s.date || '').startsWith(todayStr));
    const todayRev   = todaySales.reduce((a, s) => a + (s.total || 0), 0);
    const target     = STATE.settings.repDailyTarget || 200000;
    const pct        = Math.min((todayRev / target) * 100, 100).toFixed(0);

    const convRate = quotesCreated ? ((quotesConv / quotesCreated) * 100).toFixed(0) : 0;

    return `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:1.25rem;
        box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;">
          <div>
            <div style="font-weight:700;font-size:1rem;">${r.name}</div>
            <div style="font-size:.78rem;color:#64748b;">${getWarehouseName(r.warehouseId)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:.78rem;color:#64748b;">Commission</div>
            <div style="font-weight:700;color:#7c3aed;">${fmt(commission)}</div>
          </div>
        </div>

        <!-- Today's progress bar -->
        <div style="margin-bottom:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:.78rem;color:#64748b;margin-bottom:.3rem;">
            <span>Today: ${fmt(todayRev)}</span>
            <span>Target: ${fmt(target)}</span>
          </div>
          <div style="background:#e5e7eb;border-radius:4px;height:10px;overflow:hidden;">
            <div style="background:${pct >= 100 ? '#16a34a' : pct >= 70 ? '#f59e0b' : '#2563eb'};
              height:100%;width:${pct}%;border-radius:4px;transition:width .4s;"></div>
          </div>
          <div style="font-size:.75rem;color:#64748b;margin-top:.2rem;">${pct}% of daily target</div>
        </div>

        <!-- Stats grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;font-size:.82rem;">
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Period Revenue</div>
            <div style="font-weight:700;color:#2563eb;">${fmt(rev)}</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Transactions</div>
            <div style="font-weight:700;">${txns}</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Avg. Ticket</div>
            <div style="font-weight:700;">${fmt(avgTicket)}</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Discounts Given</div>
            <div style="font-weight:700;color:#f59e0b;">${fmt(discTotal)}</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Quote Conv. Rate</div>
            <div style="font-weight:700;color:#7c3aed;">${convRate}%</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Large Sales</div>
            <div style="font-weight:700;color:#dc2626;">${largeSales} 🔥</div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Credit Sales</div>
            <div style="font-weight:700;">${creditSales}</div>
          </div>
          <div style="background:${targetHits > 0 ? '#fef9c3' : '#f8fafc'};border-radius:6px;padding:.5rem;">
            <div style="color:#64748b;">Target Days Hit</div>
            <div style="font-weight:700;color:#d97706;">${targetHits} 🏆</div>
          </div>
        </div>
      </div>`;
  }).join('') || '<p style="color:#9ca3af;">No sales reps set up yet.</p>';
}

/* ── Print report ── */
function printRepActivityReport() {
  const repFilter = $('#ra-rep')?.value || '';
  const fromStr   = $('#ra-from')?.value || '';
  const toStr     = $('#ra-to')?.value   || '';
  const from      = fromStr ? new Date(fromStr) : new Date('1970-01-01');
  const to        = toStr   ? new Date(toStr + 'T23:59:59') : new Date();

  const sales = STATE.sales.filter(s => {
    const d = new Date(s.date);
    return d >= from && d <= to && s.type !== 'payment' && (!repFilter || s.repId === repFilter);
  });

  const repsToShow = repFilter
    ? STATE.salesReps.filter(r => r.id === repFilter)
    : STATE.salesReps;

  const s = STATE.settings;
  const win = window.open('', '_blank', 'width=820,height:900');
  if (!win) return;

  const repRows = repsToShow.map(r => {
    const rSales = sales.filter(x => x.repId === r.id);
    const rev    = rSales.reduce((a, x) => a + (x.total || 0), 0);
    const txns   = rSales.length;
    const disc   = rSales.reduce((a, x) => a + (x.totalDiscountAmt || 0), 0);
    const comm   = rev * r.commission / 100;
    const avgT   = txns ? rev / txns : 0;
    return `<tr>
      <td>${r.name}</td>
      <td style="text-align:center;">${txns}</td>
      <td style="text-align:right;">${fmt(rev)}</td>
      <td style="text-align:right;">${fmt(avgT)}</td>
      <td style="text-align:right;color:#f59e0b;">${fmt(disc)}</td>
      <td style="text-align:right;color:#7c3aed;">${fmt(comm)}</td>
    </tr>`;
  }).join('');

  const log = (STATE.repActivityLog || [])
    .filter(e => {
      const d = new Date(e.date);
      return d >= from && d <= to && (!repFilter || e.repId === repFilter);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  const logRows = log.map(e => {
    const meta = ACTIVITY_LABELS[e.type] || { label: e.type, icon: '' };
    let amount = '';
    if (e.total)       amount = fmt(e.total);
    if (e.totalDiscAmt) amount = `-${fmt(e.totalDiscAmt)}`;
    if (e.achieved)     amount = fmt(e.achieved);
    return `<tr>
      <td>${new Date(e.date).toLocaleString('en-NG')}</td>
      <td>${e.repName}</td>
      <td>${meta.icon} ${meta.label}</td>
      <td>${e.ref || e.quoteNo || '—'}</td>
      <td>${e.customerName || '—'}</td>
      <td style="text-align:right;">${amount}</td>
    </tr>`;
  }).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Rep Activity Report</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:12px;max-width:900px;margin:0 auto;padding:1rem;}
      h1{color:#1e40af;font-size:18px;}h2{font-size:14px;color:#374151;margin-top:1.5rem;}
      table{width:100%;border-collapse:collapse;margin-bottom:1rem;}
      th{background:#1e40af;color:#fff;padding:6px 8px;text-align:left;}
      td{border-bottom:1px solid #e5e7eb;padding:5px 8px;}
      tr:nth-child(even){background:#f8fafc;}
      .header{display:flex;justify-content:space-between;}
      @media print{button{display:none;}}
    </style></head><body>
    <div class="header">
      <div><h1>${s.companyName}</h1><p>${s.address} | ${s.phone}</p></div>
      <div style="text-align:right;">
        <h1>Sales Rep Activity Report</h1>
        <p>Period: ${fromStr||'All time'} to ${toStr||today()}</p>
        <p>Generated: ${new Date().toLocaleString('en-NG')}</p>
      </div>
    </div>
    <h2>Rep Performance Summary</h2>
    <table>
      <thead><tr>
        <th>Rep Name</th><th style="text-align:center;">Transactions</th>
        <th style="text-align:right;">Revenue</th><th style="text-align:right;">Avg. Ticket</th>
        <th style="text-align:right;">Discounts Given</th><th style="text-align:right;">Commission</th>
      </tr></thead>
      <tbody>${repRows}</tbody>
    </table>
    <h2>Activity Log (latest ${log.length} events)</h2>
    <table>
      <thead><tr><th>Date/Time</th><th>Rep</th><th>Activity</th><th>Reference</th><th>Customer</th><th style="text-align:right;">Amount</th></tr></thead>
      <tbody>${logRows}</tbody>
    </table>
    <button onclick="window.print()" style="padding:.5rem 1.5rem;cursor:pointer;margin-top:1rem;">🖨 Print</button>
    </body></html>`);
  win.document.close();
}

/* ── Export to XLSX ── */
function exportRepActivityXLSX() {
  const repFilter = $('#ra-rep')?.value || '';
  const fromStr   = $('#ra-from')?.value || '';
  const toStr     = $('#ra-to')?.value   || '';
  const from      = fromStr ? new Date(fromStr) : new Date('1970-01-01');
  const to        = toStr   ? new Date(toStr + 'T23:59:59') : new Date();

  const log = (STATE.repActivityLog || []).filter(e => {
    const d = new Date(e.date);
    return d >= from && d <= to && (!repFilter || e.repId === repFilter);
  }).sort((a, b) => new Date(b.date) - new Date(a.date));

  const sales = STATE.sales.filter(s => {
    const d = new Date(s.date);
    return d >= from && d <= to && s.type !== 'payment' && (!repFilter || s.repId === repFilter);
  });

  // Sheet 1: activity log
  const logRows = log.map(e => {
    const meta = ACTIVITY_LABELS[e.type] || { label: e.type };
    return {
      'Date/Time':    new Date(e.date).toLocaleString('en-NG'),
      'Rep Name':     e.repName,
      'Activity':     meta.label,
      'Reference':    e.ref || e.quoteNo || '',
      'Customer':     e.customerName || '',
      'Total (₦)':   e.total || e.achieved || '',
      'Discount (₦)':e.totalDiscAmt || '',
      'Detail':       e.paymentMethod || e.detail || '',
    };
  });

  // Sheet 2: rep summary
  const summaryRows = STATE.salesReps.map(r => {
    const rSales = sales.filter(s => s.repId === r.id);
    const rev  = rSales.reduce((a, s) => a + (s.total || 0), 0);
    const txns = rSales.length;
    const disc = rSales.reduce((a, s) => a + (s.totalDiscountAmt || 0), 0);
    return {
      'Rep Name':          r.name,
      'Warehouse':         getWarehouseName(r.warehouseId),
      'Transactions':      txns,
      'Revenue (₦)':       rev,
      'Avg. Ticket (₦)':   txns ? Math.round(rev / txns) : 0,
      'Discounts Given (₦)': disc,
      'Commission %':      r.commission,
      'Commission Earned (₦)': Math.round(rev * r.commission / 100),
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logRows),    'Activity Log');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows),'Rep Summary');
  XLSX.writeFile(wb, `cnjohnson_rep_activity_${today()}.xlsx`);
  toast('Rep activity exported.', 'success');
}

/* ── Settings save ── */
function saveRepMonitorSettings() {
  const t = parseInt($('#ra-daily-target')?.value) || 200000;
  STATE.settings.repDailyTarget = t;
  saveState();
  toast(`Daily target set to ${fmt(t)} per rep.`, 'success');
}

/* ════════════════════════════════════════════════════════════════
   C.  WIRE INTO MAIN APP  (runs after DOMContentLoaded patches)
   ════════════════════════════════════════════════════════════════ */
// ────────────────────────────────────────────────
// Initialize app + sync + rep-activity section
// ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Make sure core state properties exist and expose STATE globally
  if (!STATE.repActivityLog) STATE.repActivityLog = [];
  window.STATE = STATE;   // ← expose to sync.js BEFORE pullAll runs

  // 2. Try to pull real data from backend (if sync module is loaded)
  if (window.SYNC) {
    try {
      await window.SYNC.pullAll();     // ← loads warehouses, products, etc. from DB
      console.log('Backend data pulled successfully');
    } catch (err) {
      console.error('Failed to pull data from backend:', err);
    }

    // Optional: check connection / token validity
    if (typeof window.SYNC.ping === 'function') {
      window.SYNC.ping();
    }
  } else {
    console.warn('SYNC module not found — running in localStorage-only mode');
  }

  // 3. Add rep-activity section if missing
  if (!document.getElementById('rep-activity')) {
    const section = document.createElement('section');
    section.id = 'rep-activity';
    document.querySelector('main')?.appendChild(section);
  }

  // 4. Add sidebar navigation link (after Sales Reps)
  const salesRepLink = document.querySelector('.sidebar a[href="#sales-reps"]');
  if (salesRepLink && !document.querySelector('.sidebar a[href="#rep-activity"]')) {
    const repLink = document.createElement('a');
    repLink.href = '#rep-activity';
    repLink.innerHTML = '📊 Rep Activity';
    repLink.onclick = () => showSection('rep-activity');
    salesRepLink.after(repLink);
  }

  // 5. Extend / patch showSection to handle rep-activity
  if (typeof window.showSection === 'function') {
    const originalShowSection = window.showSection;
    window.showSection = function (sectionId) {
      originalShowSection(sectionId);

      if (sectionId === 'rep-activity') {
        if (typeof renderRepActivity === 'function') {
          renderRepActivity();
        } else {
          console.warn('renderRepActivity() function not defined yet');
        }
      }
    };
  } else {
    console.warn('showSection() not found — navigation patching skipped');
  }

  // 6. Show default section
  if (typeof showSection === 'function') {
    showSection('dashboard');
  }

}, { once: true });

// ────────────────────────────────────────────────
// Fallback: run immediately if DOM already loaded
// (important when this script is loaded defer/async or late)
// ────────────────────────────────────────────────
if (document.readyState !== 'loading') {
  // Re-run the most critical parts (state + section creation)
  if (!STATE.repActivityLog) {
    STATE.repActivityLog = [];
  }

  if (!document.getElementById('rep-activity')) {
    const section = document.createElement('section');
    section.id = 'rep-activity';
    document.querySelector('main')?.appendChild(section);
  }

  // You can optionally call the full init logic again here,
  // but usually just the above two are enough for fallback
}