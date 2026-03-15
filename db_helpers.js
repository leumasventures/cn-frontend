/* ================================================================
   db_helpers.js  —  C.N. Johnson Ventures
   
   Provides the global dbSave() helper used by script_db_patch.js.
   
   Load AFTER offline_queue.js, BEFORE script_db_patch.js.
================================================================ */

/**
 * Universal DB write helper.
 *
 * Tries the API call. If it succeeds, runs onSuccess(apiData).
 * If the DB is offline/unreachable, runs onSuccess(null) with a
 * locally-generated ID so the UI stays responsive, then queues
 * the write for replay when the server comes back.
 *
 * @param {string}   entityName  — Human label e.g. 'Product'
 * @param {string}   action      — 'add' | 'update' | 'delete'
 * @param {Function} apiFn       — () => Promise — the actual API call
 * @param {Function} onSuccess   — (apiData) => void — updates STATE & UI
 * @param {object}   queueItem   — { type, id?, data } for OfflineQueue
 */
async function dbSave(entityName, action, apiFn, onSuccess, queueItem) {
  try {
    const res = await apiFn();
    onSuccess(res?.data || null);
    if (typeof window.toast === 'function') {
      const msg = {
        add:    `${entityName} saved.`,
        update: `${entityName} updated.`,
        delete: `${entityName} deleted.`,
      }[action] || `${entityName} saved.`;
      const type = action === 'delete' ? 'warn' : 'success';
      window.toast(msg, type);
    }
  } catch (err) {
    const isOffline = !navigator.onLine || err.message?.includes('offline')
      || err.message?.includes('timed out') || err.message?.includes('Failed to fetch');

    // 404 on a delete = record doesn't exist on server, remove locally anyway
    const isNotFound = err.message?.includes('[404]');
    if (action === 'delete' && isNotFound) {
      onSuccess(null);
      if (typeof window.toast === 'function')
        window.toast(`${entityName} deleted.`, 'warn');
      return;
    }

    console.warn(`[DB] ${entityName} ${action} failed:`, err.message);

    if (isOffline || err.message?.includes('timed out') || err.message?.includes('fetch')) {
      onSuccess(null);
      if (window.OfflineQueue && queueItem) window.OfflineQueue.add(queueItem);
      if (typeof window.toast === 'function')
        window.toast(`Saved locally (DB offline). Will sync when reconnected.`, 'warn');
    } else {
      if (typeof window.toast === 'function')
        window.toast(`Save failed: ${err.message}`, 'error');
      throw err;
    }
  }
}

// Make globally available
window.dbSave = dbSave;

console.log('[DB Helpers] dbSave() ready');