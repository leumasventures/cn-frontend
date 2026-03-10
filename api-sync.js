/* ================================================================
   C.N. Johnson Ventures — Backend Sync Layer
   api-sync.js

   HOW TO USE:
   1. Add <script src="api-sync.js"></script> BEFORE script.js in your HTML
   2. This file patches loadState() and saveState() to sync with the backend
   3. Replaces the localStorage-only approach
   ================================================================ */

'use strict';

const API_BASE = 'https://cn-active-backend-1.onrender.com';

/* ════════════════════════════════════════════════════════════════
   AUTH HELPERS
   ════════════════════════════════════════════════════════════════ */
function getToken() {
  return localStorage.getItem('cnj_access_token');
}

function setTokens(access, refresh) {
  localStorage.setItem('cnj_access_token', access);
  if (refresh) localStorage.setItem('cnj_refresh_token', refresh);
}

function clearTokens() {
  localStorage.removeItem('cnj_access_token');
  localStorage.removeItem('cnj_refresh_token');
  localStorage.removeItem('cnjohnson_db_v1'); // clear old state too
}

async function refreshAccessToken() {
  const refresh = localStorage.getItem('cnj_refresh_token');
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.accessToken) {
      setTokens(data.accessToken, data.refreshToken || refresh);
      return data.accessToken;
    }
  } catch { }
  return null;
}

async function apiFetch(path, options = {}) {
  let token = getToken();
  const makeReq = (t) => fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(options.headers || {}),
    },
  });

  let res = await makeReq(token);

  // Try token refresh once on 401
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      res = await makeReq(token);
    } else {
      // Token fully expired — redirect to login
      clearTokens();
      window.location.href = '/login.html';
      return null;
    }
  }
  return res;
}

/* ════════════════════════════════════════════════════════════════
   LOGIN / LOGOUT
   ════════════════════════════════════════════════════════════════ */
window.apiLogin = async function (email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  setTokens(data.accessToken, data.refreshToken);
  return data.user;
};

window.apiLogout = async function () {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch { }
  clearTokens();
  window.location.href = '/login.html';
};

/* ════════════════════════════════════════════════════════════════
   STATE SYNC — replaces localStorage save/load
   ════════════════════════════════════════════════════════════════ */

/* Debounce helper — avoids hammering the API on rapid state changes */
let _saveTimer = null;
let _pendingSave = false;

window._syncSaveState = async function (state) {
  try {
    const res = await apiFetch('/api/state', {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
    if (!res || !res.ok) {
      // Fallback: keep in localStorage so no data is lost
      localStorage.setItem('cnjohnson_db_v1', JSON.stringify(state));
      console.warn('[Sync] Backend save failed, stored locally as fallback');
    }
  } catch (err) {
    localStorage.setItem('cnjohnson_db_v1', JSON.stringify(state));
    console.warn('[Sync] Network error, stored locally:', err.message);
  }
};

window._syncLoadState = async function () {
  try {
    const res = await apiFetch('/api/state');
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.state) return data.state;
    }
  } catch (err) {
    console.warn('[Sync] Could not load from backend:', err.message);
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem('cnjohnson_db_v1');
    if (raw) return JSON.parse(raw);
  } catch { }

  return null;
};

/* ════════════════════════════════════════════════════════════════
   CLEAN DEFAULT STATE  (Option 2 — no placeholder data)
   ════════════════════════════════════════════════════════════════ */
window._cleanDefaultState = function () {
  return {
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
      loyaltyPointsRate: 1,
      loyaltyRedemptionRate: 100,
      repDailyTarget: 200000,
    },
    // ── All collections start EMPTY (no placeholder rows) ──
    bulkDiscountTiers:    [],
    warehouses:           [],
    products:             [],
    customers:            [],
    suppliers:            [],
    salesReps:            [],
    sales:                [],
    invoices:             [],
    purchases:            [],
    expenses:             [],
    stockTransfers:       [],
    quotes:               [],
    debitNotes:           [],
    creditNotes:          [],
    loyaltyTransactions:  [],
    priceHistory:         [],
    repActivityLog:       [],
  };
};

/* ════════════════════════════════════════════════════════════════
   PATCH script.js FUNCTIONS
   These overrides run AFTER script.js loads
   ════════════════════════════════════════════════════════════════ */
window.addEventListener('load', () => {

  /* -- Patch defaultState() to return clean empty state -- */
  if (typeof defaultState === 'function') {
    window.defaultState = window._cleanDefaultState;
  }

  /* -- Patch saveState() to also sync to backend -- */
  if (typeof saveState === 'function') {
    const _origSave = window.saveState;
    window.saveState = function () {
      // Still save to localStorage immediately (fast, offline-safe)
      try {
        localStorage.setItem('cnjohnson_db_v1', JSON.stringify(STATE));
      } catch (e) {
        console.warn('localStorage save failed', e);
      }

      // Debounce backend sync (300ms) to avoid hammering API
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => {
        window._syncSaveState(STATE);
      }, 300);
    };
  }

  /* -- Show sync status indicator -- */
  const indicator = document.createElement('div');
  indicator.id = 'sync-indicator';
  indicator.style.cssText = `
    position: fixed; bottom: 1rem; right: 1rem; z-index: 99999;
    background: #1e293b; color: #94a3b8; font-size: .75rem;
    padding: .35rem .75rem; border-radius: 20px;
    font-family: monospace; opacity: 0; transition: opacity .3s;
    pointer-events: none;
  `;
  document.body.appendChild(indicator);

  window._showSyncStatus = function (msg, color = '#94a3b8') {
    indicator.textContent = msg;
    indicator.style.color = color;
    indicator.style.opacity = '1';
    clearTimeout(window._syncHideTimer);
    window._syncHideTimer = setTimeout(() => { indicator.style.opacity = '0'; }, 2500);
  };

});

/* ════════════════════════════════════════════════════════════════
   BACKEND STATE ENDPOINT  (add this to your Express server)
   ================================================================
   You need to add these routes to your backend. Here is the code
   to add to your routes/index.js or a new routes/state.js file:

   import express from 'express';
   import prisma from '../config/db.js';
   import { authenticate } from '../middleware/auth.js';

   const router = express.Router();

   // GET /api/state — load user's app state
   router.get('/state', authenticate, async (req, res) => {
     try {
       const user = await prisma.user.findUnique({
         where: { id: req.user.id },
         select: { appState: true },
       });
       res.json({ state: user?.appState ? JSON.parse(user.appState) : null });
     } catch (err) {
       res.status(500).json({ message: err.message });
     }
   });

   // PUT /api/state — save user's app state
   router.put('/state', authenticate, async (req, res) => {
     try {
       const { state } = req.body;
       await prisma.user.update({
         where: { id: req.user.id },
         data: { appState: JSON.stringify(state) },
       });
       res.json({ success: true });
     } catch (err) {
       res.status(500).json({ message: err.message });
     }
   });

   export default router;
   ================================================================ */