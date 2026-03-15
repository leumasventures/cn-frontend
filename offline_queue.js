/* ================================================================
   offline_queue.js  —  C.N. Johnson Ventures
   
   Buffers any DB write that fails while offline.
   When the network comes back, replays the queue in order.
   
   Load AFTER api_layer.js, BEFORE script_db_patch.js.
================================================================ */

(function () {
  'use strict';

  const QUEUE_KEY    = 'cnjohnson_offline_queue';
  const RETRY_MS     = 15000;   // check every 15 s
  const MAX_ATTEMPTS = 10;      // give up after 10 retries per item

  /* ── Persist queue in localStorage ────────────────────────── */
  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
  }

  let _queue = loadQueue();
  let _flushing = false;
  let _online = navigator.onLine;

  /* ── UI badge ────────────────────────────────────────────── */
  function updateBadge() {
    let badge = document.getElementById('oq-badge');
    if (!_queue.length) { if (badge) badge.remove(); return; }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'oq-badge';
      badge.style.cssText = `
        position:fixed;bottom:1rem;right:1rem;z-index:99998;
        background:#f59e0b;color:#fff;border-radius:8px;
        padding:.5rem 1rem;font-size:.8rem;font-weight:700;
        box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer;
        display:flex;align-items:center;gap:.5rem;`;
      badge.title = 'Click to see offline queue status';
      badge.onclick = showQueueStatus;
      document.body.appendChild(badge);
    }
    badge.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
        background:#fff;animation:oqPulse 1.2s infinite;"></span>
      ${_queue.length} change${_queue.length !== 1 ? 's' : ''} pending sync`;
  }

  function showQueueStatus() {
    if (typeof window.toast === 'function') {
      const status = _online ? 'online — syncing…' : 'offline — will sync when connected';
      window.toast(`${_queue.length} item(s) in offline queue. Status: ${status}`, 'info');
    }
  }

  /* ── Inject keyframe animation ───────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `@keyframes oqPulse{0%,100%{opacity:1}50%{opacity:.4}}`;
  document.head.appendChild(style);

  /* ── Map queued operation type → API call ─────────────────── */
  async function executeItem(item) {
    const { type, id, data } = item;
    const A = window.API;

    switch (type) {
      /* Warehouses */
      case 'createWarehouse':    return A.createWarehouse(data);
      case 'updateWarehouse':    return A.updateWarehouse(id, data);
      case 'deleteWarehouse':    return A.deleteWarehouse(id);

      /* Products */
      case 'createProduct':      return A.createProduct(data);
      case 'updateProduct':      return A.updateProduct(id, data);
      case 'deleteProduct':      return A.deleteProduct(id);
      case 'adjustStock':        return A.adjustStock(id, data);

      /* Customers */
      case 'createCustomer':     return A.createCustomer(data);
      case 'updateCustomer':     return A.updateCustomer(id, data);
      case 'deleteCustomer':     return A.deleteCustomer(id);

      /* Suppliers */
      case 'createSupplier':     return A.createSupplier(data);
      case 'updateSupplier':     return A.updateSupplier(id, data);
      case 'deleteSupplier':     return A.deleteSupplier(id);

      /* Sales reps */
      case 'createSalesRep':     return A.createSalesRep(data);
      case 'updateSalesRep':     return A.updateSalesRep(id, data);
      case 'deleteSalesRep':     return A.deleteSalesRep(id);

      /* Sales */
      case 'createSale':         return A.createSale(data);
      case 'markSalePaid':       return A.updateSale(id, data);

      /* Purchases */
      case 'createPurchase':     return A.createPurchase(data);

      /* Expenses */
      case 'createExpense':      return A.createExpense(data);
      case 'deleteExpense':      return A.deleteExpense(id);

      /* Quotes */
      case 'createQuote':        return A.createQuote(data);
      case 'updateQuote':        return A.updateQuote(id, data);

      /* Credit notes */
      case 'createCreditNote':   return A.createCreditNote(data);

      /* Discount tiers */
      case 'createDiscountTier': return A.createDiscountTier(data);
      case 'updateDiscountTier': return A.updateDiscountTier(id, data);
      case 'deleteDiscountTier': return A.deleteDiscountTier(id);

      /* Stock transfers */
      case 'createTransfer':     return A.createTransfer(data);

      /* Settings */
      case 'updateSettings':     return A.updateSettings(data);

      default:
        console.warn('[OfflineQueue] Unknown operation type:', type);
        return { ok: true }; // skip unknown
    }
  }

  /* ── Flush queue ─────────────────────────────────────────── */
  async function flush() {
    if (_flushing || !_queue.length || !navigator.onLine) return;
    _flushing = true;

    let flushed = 0;
    const remaining = [];

    for (const item of _queue) {
      try {
        await executeItem(item);
        flushed++;
        console.log(`[OfflineQueue] ✅ Synced: ${item.type}`);
      } catch (err) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts >= MAX_ATTEMPTS) {
          console.error(`[OfflineQueue] ❌ Dropped after ${MAX_ATTEMPTS} attempts:`, item.type, err);
          // Optionally: persist to a "dead letter" log
        } else {
          remaining.push(item);
        }
      }
    }

    _queue = remaining;
    saveQueue(_queue);
    updateBadge();
    _flushing = false;

    if (flushed > 0 && typeof window.toast === 'function') {
      toast(`${flushed} offline change${flushed !== 1 ? 's' : ''} synced to database ✅`, 'success');
    }
  }

  /* ── Online / offline events ─────────────────────────────── */
  window.addEventListener('online',  () => { _online = true;  flush(); });
  window.addEventListener('offline', () => { _online = false; updateBadge(); });

  /* ── Periodic retry ──────────────────────────────────────── */
  setInterval(() => { if (navigator.onLine) flush(); }, RETRY_MS);

  /* ── Public API ──────────────────────────────────────────── */
  window.OfflineQueue = {
    /**
     * Add a failed operation to the queue.
     * @param {object} item  { type: string, id?: string, data: object }
     */
    add(item) {
      item.queuedAt = new Date().toISOString();
      item.attempts = 0;
      _queue.push(item);
      saveQueue(_queue);
      updateBadge();
      console.log('[OfflineQueue] Queued:', item.type, '— total:', _queue.length);
    },

    /** Manually trigger a flush attempt */
    flush,

    /** Current queue length */
    get length() { return _queue.length; },

    /** Full queue contents (read-only copy) */
    get items() { return [..._queue]; },

    /** Clear the queue (use with caution) */
    clear() {
      _queue = [];
      saveQueue(_queue);
      updateBadge();
    },
  };

  // Initial badge render (e.g. page reload with leftover queue)
  document.addEventListener('DOMContentLoaded', () => {
    updateBadge();
    if (navigator.onLine && _queue.length) {
      setTimeout(flush, 2000); // slight delay so API layer is ready
    }
  });

  console.log('[OfflineQueue] Ready — queued items on load:', _queue.length);
})();