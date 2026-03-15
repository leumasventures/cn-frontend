# C.N. Johnson Ventures — Database Integration Guide

## Files Delivered

| File | Purpose |
|------|---------|
| `api_layer.js` | `window.API` — thin fetch wrapper for all REST endpoints |
| `offline_queue.js` | `window.OfflineQueue` — persists failed calls; replays on reconnect |
| `db_helpers.js` | `dbSave()` — shared try/catch pattern used by every save handler |
| `script_db_patch.js` | Overrides every local-only function with a DB-writing version |

---

## How to add to your HTML

Load the files **in this exact order**, after Chart.js / XLSX but **before** your
closing `</body>` tag:

```html
<!-- Existing scripts -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>

<!-- ① Set your backend base URL (before any of the new files) -->
<script>window.API_BASE_URL = 'https://your-backend.com/api';</script>

<!-- ② New DB layer (order matters) -->
<script src="api_layer.js"></script>
<script src="offline_queue.js"></script>
<script src="db_helpers.js"></script>

<!-- ③ Your original app -->
<script src="script.js"></script>

<!-- ④ The patch — must come AFTER script.js -->
<script src="script_db_patch.js"></script>
```

---

## What each override does

### Warehouses
- `openAddWarehouse()` → `POST /warehouses`  
- `editWarehouse(id)`  → `PUT  /warehouses/:id`  
- `deleteWarehouse(id)`→ `DELETE /warehouses/:id`

### Products
- `openAddProduct()`   → `POST /products`  
  Sends `warehouseStock[]` array so the API can set opening stock per warehouse.  
- `editProduct(id)`    → `PUT  /products/:id`  
- `deleteProduct(id)`  → `DELETE /products/:id`  
- `adjustStock(id)`    → `POST /products/:id/stock` with `{ warehouseId, type, quantity, reason }`

### Customers / Suppliers / Sales Reps
Same pattern: POST on add, PUT on edit, DELETE on delete.

### Purchases
- `savePurchase()`     → `POST /purchases`  
  Includes full `items[]` array and payment status.

### POS — Sales
- `completeSale()`     → `POST /sales`  
  Local STATE is updated first (instant feedback), then the API call fires async.  
  If it fails, the payload is queued for retry.

### Quotes
- `saveAsQuote()`      → `POST /quotes`  
- `updateQuoteStatus()`→ `PUT  /quotes/:id`

### Credit Notes
- `issueCreditNote()`  → `POST /credit-notes`

### Stock Transfers
- `doTransfer()`       → `POST /stock-transfers`

### Expenses
- `openAddExpense()`   → `POST /expenses`  
- `deleteExpense(id)`  → `DELETE /expenses/:id`

### Bulk Discount Tiers
- `openAddDiscountTier()`  → `POST /discount-tiers`  
- `editDiscountTier(id)`   → `PUT  /discount-tiers/:id`  
- `deleteDiscountTier(id)` → `DELETE /discount-tiers/:id`

---

## Backend contract

Every `POST` and `PUT` endpoint must return:

```json
{ "data": { "id": "server-generated-id", ...otherFields } }
```

The patch stores the server's `id` as `_apiId` on each local record so future
`PUT`/`DELETE` calls use the real database ID, not the local `uid()`.

---

## Offline behaviour

If **any** API call throws (network down, 5xx, auth failure):

1. The call is added to `OfflineQueue` in `localStorage`.
2. STATE is updated locally — the user sees no interruption.
3. When the browser fires an `online` event, `OfflineQueue.flush()` replays
   every pending call automatically.
4. A toast shows how many items were synced.

You can also manually trigger a flush:
```js
await window.OfflineQueue.flush();
```

---

## Authentication

If your API requires a Bearer token, store it before any API call:
```js
localStorage.setItem('auth_token', 'your-jwt-here');
```
`api_layer.js` picks it up automatically on every request.

---

## Extending

To add a new entity (e.g. Debit Notes):

1. Add the method to `api_layer.js`:
   ```js
   createDebitNote: (d) => req('POST', '/debit-notes', d),
   ```
2. In `script_db_patch.js`, patch the relevant function:
   ```js
   window.openAddDebitNote = function() {
     modal('...', formHTML(), async (overlay, close) => {
       const payload = { ... };
       await dbSave('Debit Note', 'add',
         () => window.API.createDebitNote(payload),
         (apiData) => { STATE.debitNotes.push({...}); saveState(); close(); renderDebitNotes(); },
         { type: 'createDebitNote', data: payload }
       );
     });
   };
   ```

That's it — the offline queue and toast feedback come for free.