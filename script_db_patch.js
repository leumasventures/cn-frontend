/* ================================================================
   script_db_patch.js
   
   Drop this file AFTER script.js (and after api_layer.js /
   offline_queue.js / db_helpers.js).  It overrides every
   local-only add / edit / delete function with a version that
   writes to the backend first, then updates STATE on success
   (or falls back to localStorage-only if offline).
   
   Nothing in the original script.js needs to change.
================================================================ */

// ── Flag so script.js dispatcher knows the patch is loaded ──────
window._dbPatchLoaded = true;

/* ════════════════════════════════════════════════════════════════
   WAREHOUSES
════════════════════════════════════════════════════════════════ */
window.openAddWarehouse = function () {
  modal('Add Warehouse', `
    <div class="form-grid">
      <div><label>Warehouse Name</label>
           <input id="wh-name" style="width:100%;" placeholder="e.g. Branch – Umuahia"></div>
      <div><label>Location</label>
           <input id="wh-location" style="width:100%;" placeholder="City"></div>
      <div><label>Manager</label>
           <input id="wh-manager" style="width:100%;" placeholder="Manager name"></div>
    </div>`,
    async (overlay, close) => {
      const name     = $('#wh-name',     overlay).value.trim();
      const location = $('#wh-location', overlay).value.trim();
      const manager  = $('#wh-manager',  overlay).value.trim();
      if (!name) return toast('Name required.', 'warn');

      const payload = { name, location, manager };

      await dbSave(
        'Warehouse', 'add',
        () => window.API.createWarehouse(payload),
        (apiData) => {
          STATE.warehouses.push({
            id:       apiData?.id       || 'wh' + uid(),
            name:     apiData?.name     || name,
            location: apiData?.location || location,
            manager:  apiData?.manager  || manager,
            _apiId:   apiData?.id       || null,
          });
          saveState();
          close();
          renderWarehouses();
        },
        { type: 'createWarehouse', data: payload }
      );
    }
  );
};

window.editWarehouse = function (id) {
  const w = STATE.warehouses.find(x => x.id === id);
  if (!w) return;

  modal('Edit Warehouse', `
    <div class="form-grid">
      <div><label>Name</label>
           <input id="wh-name"     style="width:100%;" value="${w.name}"></div>
      <div><label>Location</label>
           <input id="wh-location" style="width:100%;" value="${w.location || ''}"></div>
      <div><label>Manager</label>
           <input id="wh-manager"  style="width:100%;" value="${w.manager || ''}"></div>
    </div>`,
    async (overlay, close) => {
      const name     = $('#wh-name',     overlay).value.trim() || w.name;
      const location = $('#wh-location', overlay).value.trim();
      const manager  = $('#wh-manager',  overlay).value.trim();

      const payload = { name, location, manager };
      const apiId   = w._apiId || w.id;

      await dbSave(
        'Warehouse', 'update',
        () => window.API.updateWarehouse(apiId, payload),
        () => {
          w.name = name; w.location = location; w.manager = manager;
          saveState();
          close();
          renderWarehouses();
        },
        { type: 'updateWarehouse', id: apiId, data: payload }
      );
    }
  );
};

window.deleteWarehouse = async function (id) {
  if (!confirm2('Delete this warehouse? Stock data will remain on products.')) return;
  const w     = STATE.warehouses.find(x => x.id === id);
  const apiId = w?._apiId || id;

  await dbSave(
    'Warehouse', 'delete',
    () => window.API.deleteWarehouse(apiId),
    () => {
      STATE.warehouses = STATE.warehouses.filter(x => x.id !== id);
      saveState();
      renderWarehouses();
    },
    { type: 'deleteWarehouse', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   SALES REPS
════════════════════════════════════════════════════════════════ */
window.openAddRep = function () {
  modal('Add Sales Rep', repFormHTML(), async (overlay, close) => {
    const name = $('#rf-name', overlay).value.trim();
    if (!name) return toast('Name required.', 'warn');

    const whLocalId = $('#rf-wh', overlay).value;
    const wh        = STATE.warehouses.find(w => w.id === whLocalId);

    const payload = {
      name,
      phone:       $('#rf-phone', overlay).value.trim() || null,
      email:       $('#rf-email', overlay).value.trim() || null,
      warehouseId: wh?._apiId || null,
      commission:  parseFloat($('#rf-comm', overlay).value) || 2,
    };

    await dbSave(
      'Sales Rep', 'add',
      () => window.API.createSalesRep(payload),
      (apiData) => {
        STATE.salesReps.push({
          id:          apiData?.id || 'R' + uid(),
          name:        apiData?.name || name,
          phone:       payload.phone  || '',
          email:       payload.email  || '',
          warehouseId: whLocalId,
          commission:  payload.commission,
          totalSales:  0,
          _apiId:      apiData?.id || null,
        });
        saveState();
        close();
        renderRepsTable();
        toast('Rep added.', 'success');
      },
      { type: 'createSalesRep', data: payload }
    );
  });
};

window.editRep = function (id) {
  const r = STATE.salesReps.find(x => x.id === id);
  if (!r) return;

  modal(`Edit Rep – ${r.name}`, repFormHTML(r), async (overlay, close) => {
    const whLocalId = $('#rf-wh', overlay).value;
    const wh        = STATE.warehouses.find(w => w.id === whLocalId);

    const payload = {
      name:        $('#rf-name',  overlay).value.trim() || r.name,
      phone:       $('#rf-phone', overlay).value.trim() || null,
      email:       $('#rf-email', overlay).value.trim() || null,
      warehouseId: wh?._apiId || null,
      commission:  parseFloat($('#rf-comm', overlay).value) || r.commission,
    };

    const apiId = r._apiId || r.id;

    await dbSave(
      'Sales Rep', 'update',
      () => window.API.updateSalesRep(apiId, payload),
      () => {
        r.name        = payload.name;
        r.phone       = payload.phone  || '';
        r.email       = payload.email  || '';
        r.warehouseId = whLocalId;
        r.commission  = payload.commission;
        saveState();
        close();
        renderRepsTable();
        toast('Rep updated.', 'success');
      },
      { type: 'updateSalesRep', id: apiId, data: payload }
    );
  });
};

window.deleteRep = async function (id) {
  if (!confirm2('Delete this rep?')) return;
  const r     = STATE.salesReps.find(x => x.id === id);
  const apiId = r?._apiId || id;

  await dbSave(
    'Sales Rep', 'delete',
    () => window.API.deleteSalesRep(apiId),
    () => {
      STATE.salesReps = STATE.salesReps.filter(x => x.id !== id);
      saveState();
      renderRepsTable();
    },
    { type: 'deleteSalesRep', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   PRODUCTS

   The patched openAddProduct is stored under TWO names:
     window._openAddProductPatched  ← the actual implementation
     window.openAddProduct          ← same reference

   script.js's openAddProduct() checks window._dbPatchLoaded and
   calls window.openAddProduct() — which resolves to
   window._openAddProductPatched. Since script.js calls
   window.openAddProduct (the property), not the local function,
   there is zero recursion.
════════════════════════════════════════════════════════════════ */
window._openAddProductPatched = async function () {
  modal('Add Product', productFormHTML(), async (overlay, close) => {
    const name = $('#pf-name', overlay).value.trim();
    const sku  = $('#pf-sku',  overlay).value.trim();
    if (!name || !sku) return toast('Name and SKU required.', 'warn');
    if (STATE.products.find(p => p.sku === sku)) return toast('SKU already exists.', 'error');

    const stock = {};
    STATE.warehouses.forEach(wh => {
      stock[wh.id] = parseInt($(`#ps-${wh.id}`, overlay).value) || 0;
    });

    const totalStock   = Object.values(stock).reduce((a, b) => a + b, 0);
    const sellingPrice = parseFloat($('#pf-sell',    overlay).value) || 0;
    const costPrice    = parseFloat($('#pf-cost',    overlay).value) || 0;
    const reorderLevel = parseInt($('#pf-reorder',   overlay).value) || 10;

    const payload = {
      name,
      sku,
      barcode:           $('#pf-barcode', overlay).value.trim() || null,
      category:          $('#pf-cat',     overlay).value.trim() || null,
      unit:              $('#pf-unit',    overlay).value.trim() || null,
      costPrice,
      price:             sellingPrice,
      lowStockThreshold: reorderLevel,
      supplierId:        $('#pf-sup',  overlay).value || null,
      description:       $('#pf-desc', overlay).value.trim() || null,
      stock:             totalStock,
    };

    await dbSave(
      'Product', 'add',
      () => window.API.createProduct(payload),
      (apiData) => {
        STATE.products.push({
          id:           apiData?.id    || 'P' + uid(),
          name:         apiData?.name  || name,
          sku:          apiData?.sku   || sku,
          barcode:      payload.barcode     || '',
          category:     payload.category    || '',
          unit:         payload.unit        || '',
          costPrice,
          sellingPrice,
          reorderLevel,
          supplierId:   payload.supplierId  || '',
          description:  payload.description || '',
          stock,
          _apiId:       apiData?.id    || null,
        });
        saveState();
        close();
        renderProductsTable();
        toast('Product added.', 'success');
      },
      { type: 'createProduct', data: payload }
    );
  });
};

// Both names point to the same function — script.js calls
// window.openAddProduct() which is this, no recursion possible
window.openAddProduct = window._openAddProductPatched;

window.editProduct = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;

  modal(`Edit – ${p.name}`, productFormHTML(p), async (overlay, close) => {
    const oldCost = p.costPrice;
    const oldSell = p.sellingPrice;

    const newName         = $('#pf-name',    overlay).value.trim() || p.name;
    const newSku          = $('#pf-sku',     overlay).value.trim() || p.sku;
    const newBarcode      = $('#pf-barcode', overlay).value.trim();
    const newCategory     = $('#pf-cat',     overlay).value.trim();
    const newUnit         = $('#pf-unit',    overlay).value.trim();
    const newCostPrice    = parseFloat($('#pf-cost',    overlay).value) || p.costPrice;
    const newSellingPrice = parseFloat($('#pf-sell',    overlay).value) || p.sellingPrice;
    const newReorderLevel = parseInt($('#pf-reorder',   overlay).value) || p.reorderLevel;
    const newSupplierId   = $('#pf-sup',  overlay).value || null;
    const newDescription  = $('#pf-desc', overlay).value.trim();

    const newStock = {};
    STATE.warehouses.forEach(wh => {
      newStock[wh.id] = parseInt($(`#ps-${wh.id}`, overlay).value) || 0;
    });

    const totalStock = Object.values(newStock).reduce((a, b) => a + b, 0);

    const payload = {
      name:              newName,
      sku:               newSku,
      barcode:           newBarcode     || null,
      category:          newCategory    || null,
      unit:              newUnit        || null,
      costPrice:         newCostPrice,
      price:             newSellingPrice,
      lowStockThreshold: newReorderLevel,
      supplierId:        newSupplierId,
      description:       newDescription || null,
      stock:             totalStock,
    };

    const apiId = p._apiId || p.id;

    await dbSave(
      'Product', 'update',
      () => window.API.updateProduct(apiId, payload),
      () => {
        p.name         = newName;
        p.sku          = newSku;
        p.barcode      = newBarcode;
        p.category     = newCategory;
        p.unit         = newUnit;
        p.costPrice    = newCostPrice;
        p.sellingPrice = newSellingPrice;
        p.reorderLevel = newReorderLevel;
        p.supplierId   = newSupplierId;
        p.description  = newDescription;
        STATE.warehouses.forEach(wh => { p.stock[wh.id] = newStock[wh.id]; });

        if (oldCost !== p.costPrice || oldSell !== p.sellingPrice) {
          STATE.priceHistory.push({
            date: nowISO(), productId: p.id, productName: p.name,
            oldCost, newCost: p.costPrice, oldSell, newSell: p.sellingPrice,
            changedBy: 'User',
          });
        }
        saveState();
        close();
        renderProductsTable();
        renderPriceHistory();
        toast('Product updated.', 'success');
      },
      { type: 'updateProduct', id: apiId, data: payload }
    );
  });
};

window.deleteProduct = async function (id) {
  if (!confirm2('Delete this product permanently?')) return;
  const p     = STATE.products.find(x => x.id === id);
  const apiId = p?._apiId || id;

  await dbSave(
    'Product', 'delete',
    () => window.API.deleteProduct(apiId),
    () => {
      STATE.products = STATE.products.filter(x => x.id !== id);
      saveState();
      renderProductsTable();
    },
    { type: 'deleteProduct', id: apiId, data: {} }
  );
};

/* ── Stock adjustment ──────────────────────────────────────────── */
window.adjustStock = function (id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  const whOpts = STATE.warehouses.map(w =>
    `<option value="${w.id}">${w.name}</option>`).join('');

  modal(`Adjust Stock – ${p.name}`, `
    <div class="form-grid">
      <div><label>Warehouse</label>
           <select id="adj-wh" style="width:100%;">${whOpts}</select></div>
      <div><label>Adjustment Type</label>
        <select id="adj-type" style="width:100%;">
          <option value="add">Add (Purchase/Return)</option>
          <option value="sub">Subtract (Damage/Loss)</option>
          <option value="set">Set Exact Value</option>
        </select></div>
      <div><label>Quantity</label>
           <input id="adj-qty" type="number" min="0" style="width:100%;"></div>
      <div><label>Reason</label>
           <input id="adj-reason" style="width:100%;" placeholder="Optional note"></div>
    </div>
    <p style="margin-top:.5rem;color:#64748b;font-size:.875rem;">
      Current: ${STATE.warehouses.map(w =>
        `${w.name}: <strong>${p.stock[w.id] || 0}</strong>`).join(' | ')}
    </p>`,
    async (overlay, close) => {
      const whId   = $('#adj-wh',     overlay).value;
      const type   = $('#adj-type',   overlay).value;
      const qty    = parseFloat($('#adj-qty', overlay).value);
      const reason = $('#adj-reason', overlay).value.trim();

      if (isNaN(qty) || qty < 0) return toast('Enter valid quantity.', 'warn');

      const wh    = STATE.warehouses.find(w => w.id === whId);
      const apiId = p._apiId || p.id;

      const payload = {
        warehouseId: wh?._apiId || whId,
        type,
        quantity: qty,
        reason,
      };

      await dbSave(
        'Stock', 'update',
        () => window.API.adjustStock(apiId, payload),
        () => {
          if (type === 'add')      p.stock[whId] = (p.stock[whId] || 0) + qty;
          else if (type === 'sub') p.stock[whId] = Math.max(0, (p.stock[whId] || 0) - qty);
          else                     p.stock[whId] = qty;
          saveState();
          close();
          renderProductsTable();
        },
        { type: 'adjustStock', id: apiId, data: payload }
      );
    }
  );
};

/* ════════════════════════════════════════════════════════════════
   CUSTOMERS
════════════════════════════════════════════════════════════════ */
window.openAddCustomer = function () {
  modal('Add Customer', customerFormHTML(), async (overlay, close) => {
    const name = $('#cf-name', overlay).value.trim();
    if (!name) return toast('Name required.', 'warn');

    const payload = {
      name,
      customerType:  $('#cf-type',    overlay).value,
      phone:         $('#cf-phone',   overlay).value.trim(),
      email:         $('#cf-email',   overlay).value.trim(),
      address:       $('#cf-address', overlay).value.trim(),
      creditLimit:   parseFloat($('#cf-credit',  overlay).value) || 0,
      loyaltyPoints: parseInt($('#cf-loyalty', overlay).value)   || 0,
      notes:         $('#cf-notes',   overlay).value.trim(),
    };

    await dbSave(
      'Customer', 'add',
      () => window.API.createCustomer(payload),
      (apiData) => {
        STATE.customers.push({
          id:             apiData?.id || 'C' + uid(),
          balance:        0,
          totalPurchases: 0,
          _apiId:         apiData?.id || null,
          ...payload,
        });
        saveState();
        close();
        renderCustomersTable();
      },
      { type: 'createCustomer', data: payload }
    );
  });
};

window.editCustomer = function (id) {
  const c = STATE.customers.find(x => x.id === id);
  if (!c) return;

  modal(`Edit – ${c.name}`, customerFormHTML(c), async (overlay, close) => {
    const payload = {
      name:          $('#cf-name',    overlay).value.trim() || c.name,
      customerType:  $('#cf-type',    overlay).value,
      phone:         $('#cf-phone',   overlay).value.trim(),
      email:         $('#cf-email',   overlay).value.trim(),
      address:       $('#cf-address', overlay).value.trim(),
      creditLimit:   parseFloat($('#cf-credit',  overlay).value) || c.creditLimit,
      loyaltyPoints: parseInt($('#cf-loyalty', overlay).value)   || 0,
      notes:         $('#cf-notes',   overlay).value.trim(),
    };

    const apiId = c._apiId || c.id;

    await dbSave(
      'Customer', 'update',
      () => window.API.updateCustomer(apiId, payload),
      () => {
        Object.assign(c, payload);
        saveState();
        close();
        renderCustomersTable();
      },
      { type: 'updateCustomer', id: apiId, data: payload }
    );
  });
};

window.deleteCustomer = async function (id) {
  if (!confirm2('Delete customer?')) return;
  const c     = STATE.customers.find(x => x.id === id);
  const apiId = c?._apiId || id;

  await dbSave(
    'Customer', 'delete',
    () => window.API.deleteCustomer(apiId),
    () => {
      STATE.customers = STATE.customers.filter(x => x.id !== id);
      saveState();
      renderCustomersTable();
    },
    { type: 'deleteCustomer', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   SUPPLIERS
════════════════════════════════════════════════════════════════ */
window.openAddSupplier = function () {
  modal('Add Supplier', supplierFormHTML(), async (overlay, close) => {
    const name = $('#sf-name', overlay).value.trim();
    if (!name) return toast('Name required.', 'warn');

    const payload = {
      name,
      contact:  $('#sf-contact', overlay).value.trim(),
      phone:    $('#sf-phone',   overlay).value.trim(),
      email:    $('#sf-email',   overlay).value.trim(),
      address:  $('#sf-address', overlay).value.trim(),
      category: $('#sf-cat',     overlay).value.trim(),
      rating:   parseInt($('#sf-rating', overlay).value) || 3,
    };

    await dbSave(
      'Supplier', 'add',
      () => window.API.createSupplier(payload),
      (apiData) => {
        STATE.suppliers.push({
          id:      apiData?.id || 'S' + uid(),
          balance: 0,
          _apiId:  apiData?.id || null,
          ...payload,
        });
        saveState();
        close();
        renderSuppliersTable();
      },
      { type: 'createSupplier', data: payload }
    );
  });
};

window.editSupplier = function (id) {
  const s = STATE.suppliers.find(x => x.id === id);
  if (!s) return;

  modal(`Edit – ${s.name}`, supplierFormHTML(s), async (overlay, close) => {
    const payload = {
      name:     $('#sf-name',    overlay).value.trim() || s.name,
      contact:  $('#sf-contact', overlay).value.trim(),
      phone:    $('#sf-phone',   overlay).value.trim(),
      email:    $('#sf-email',   overlay).value.trim(),
      address:  $('#sf-address', overlay).value.trim(),
      category: $('#sf-cat',     overlay).value.trim(),
      rating:   parseInt($('#sf-rating', overlay).value) || s.rating,
    };

    const apiId = s._apiId || s.id;

    await dbSave(
      'Supplier', 'update',
      () => window.API.updateSupplier(apiId, payload),
      () => {
        Object.assign(s, payload);
        saveState();
        close();
        renderSuppliersTable();
      },
      { type: 'updateSupplier', id: apiId, data: payload }
    );
  });
};

window.deleteSupplier = async function (id) {
  if (!confirm2('Delete supplier?')) return;
  const s     = STATE.suppliers.find(x => x.id === id);
  const apiId = s?._apiId || id;

  await dbSave(
    'Supplier', 'delete',
    () => window.API.deleteSupplier(apiId),
    () => {
      STATE.suppliers = STATE.suppliers.filter(x => x.id !== id);
      saveState();
      renderSuppliersTable();
    },
    { type: 'deleteSupplier', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   EXPENSES
════════════════════════════════════════════════════════════════ */
window.openAddExpense = function () {
  modal('Record Expense', `
    <div class="form-grid">
      <div><label>Category</label>
        <input id="ex-cat" style="width:100%;" list="ex-cats" placeholder="e.g. Transport">
        <datalist id="ex-cats">
          ${['Transport','Fuel','Rent','Salary','Utilities','Maintenance',
             'Marketing','Office Supplies','Food','Other']
            .map(c => `<option>${c}</option>`).join('')}
        </datalist></div>
      <div><label>Amount (₦)</label>
           <input id="ex-amt" type="number" min="0" style="width:100%;"></div>
      <div><label>Date</label>
           <input id="ex-date" type="date" style="width:100%;" value="${today()}"></div>
      <div><label>Paid By</label>
           <input id="ex-by" style="width:100%;" placeholder="Name or method"></div>
      <div style="grid-column:1/-1;"><label>Description</label>
           <textarea id="ex-desc" style="width:100%;height:60px;"
                     placeholder="Details…"></textarea></div>
    </div>`,
    async (overlay, close) => {
      const cat = $('#ex-cat', overlay).value.trim();
      const amt = parseFloat($('#ex-amt', overlay).value);
      if (!cat || isNaN(amt) || amt <= 0) return toast('Category and amount required.', 'warn');

      const payload = {
        category:    cat,
        amount:      amt,
        date:        $('#ex-date', overlay).value,
        paidBy:      $('#ex-by',   overlay).value.trim(),
        description: $('#ex-desc', overlay).value.trim(),
      };

      await dbSave(
        'Expense', 'add',
        () => window.API.createExpense(payload),
        (apiData) => {
          STATE.expenses.push({
            id:     apiData?.id || uid(),
            _apiId: apiData?.id || null,
            ...payload,
            date:   payload.date + 'T00:00:00.000Z',
          });
          saveState();
          close();
          renderExpensesTable();
        },
        { type: 'createExpense', data: payload }
      );
    }
  );
};

window.deleteExpense = async function (id) {
  if (!confirm2('Delete this expense?')) return;
  const e     = STATE.expenses.find(x => x.id === id);
  const apiId = e?._apiId || id;

  await dbSave(
    'Expense', 'delete',
    () => window.API.deleteExpense(apiId),
    () => {
      STATE.expenses = STATE.expenses.filter(x => x.id !== id);
      saveState();
      renderExpensesTable();
    },
    { type: 'deleteExpense', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   BULK DISCOUNT TIERS
════════════════════════════════════════════════════════════════ */
window.openAddDiscountTier = function () {
  modal('Add Bulk Discount Tier', discountTierFormHTML(), async (overlay, close) => {
    const name   = $('#dt-name', overlay).value.trim();
    const pct    = parseFloat($('#dt-pct', overlay).value);
    const min    = parseInt($('#dt-min',   overlay).value);
    const maxRaw = parseInt($('#dt-max',   overlay).value) || 0;
    const max    = maxRaw === 0 ? 99999 : maxRaw;

    if (!name || isNaN(pct) || isNaN(min)) return toast('Fill required fields.', 'warn');
    if (min >= max && max !== 99999) return toast('Max qty must be greater than min.', 'warn');

    const productIds = [...$$('.dt-prod', overlay)].filter(c => c.checked).map(c => c.value);
    const payload    = { name, discountPct: pct, minQty: min, maxQty: max, productIds, active: true };

    await dbSave(
      'Discount Tier', 'add',
      () => window.API.createDiscountTier(payload),
      (apiData) => {
        STATE.bulkDiscountTiers.push({
          id:     apiData?.id || 'BD' + uid(),
          _apiId: apiData?.id || null,
          ...payload,
        });
        saveState();
        close();
        renderBulkDiscounts();
      },
      { type: 'createDiscountTier', data: payload }
    );
  });
};

window.editDiscountTier = function (id) {
  const t = STATE.bulkDiscountTiers.find(x => x.id === id);
  if (!t) return;

  modal(`Edit Tier – ${t.name}`, discountTierFormHTML(t), async (overlay, close) => {
    const maxRaw = parseInt($('#dt-max', overlay).value) || 0;

    const payload = {
      name:        $('#dt-name', overlay).value.trim() || t.name,
      discountPct: parseFloat($('#dt-pct', overlay).value) || t.discountPct,
      minQty:      parseInt($('#dt-min',  overlay).value)  || t.minQty,
      maxQty:      maxRaw === 0 ? 99999 : maxRaw,
      productIds:  [...$$('.dt-prod', overlay)].filter(c => c.checked).map(c => c.value),
      active:      t.active,
    };

    const apiId = t._apiId || t.id;

    await dbSave(
      'Discount Tier', 'update',
      () => window.API.updateDiscountTier(apiId, payload),
      () => {
        Object.assign(t, payload);
        saveState();
        close();
        renderBulkDiscounts();
      },
      { type: 'updateDiscountTier', id: apiId, data: payload }
    );
  });
};

window.deleteDiscountTier = async function (id) {
  if (!confirm2('Delete this discount tier?')) return;
  const t     = STATE.bulkDiscountTiers.find(x => x.id === id);
  const apiId = t?._apiId || id;

  await dbSave(
    'Discount Tier', 'delete',
    () => window.API.deleteDiscountTier(apiId),
    () => {
      STATE.bulkDiscountTiers = STATE.bulkDiscountTiers.filter(x => x.id !== id);
      saveState();
      renderBulkDiscounts();
    },
    { type: 'deleteDiscountTier', id: apiId, data: {} }
  );
};

/* ════════════════════════════════════════════════════════════════
   STOCK TRANSFER
════════════════════════════════════════════════════════════════ */
window.doTransfer = async function () {
  const pid  = $('#tf-product').value;
  const from = $('#tf-from').value;
  const to   = $('#tf-to').value;
  const qty  = parseInt($('#tf-qty').value);
  const note = $('#tf-note').value.trim();

  if (!pid || !from || !to || !qty) return toast('Fill all transfer fields.', 'warn');
  if (from === to) return toast('Source and destination must differ.', 'warn');

  const product = STATE.products.find(p => p.id === pid);
  if (!product) return;
  const available = product.stock[from] || 0;
  if (qty > available) return toast(`Only ${available} ${product.unit}(s) available.`, 'error');

  const fromWh = STATE.warehouses.find(w => w.id === from);
  const toWh   = STATE.warehouses.find(w => w.id === to);

  const payload = {
    productId:       product._apiId || pid,
    fromWarehouseId: fromWh?._apiId || from,
    toWarehouseId:   toWh?._apiId   || to,
    quantity:        qty,
    note,
  };

  await dbSave(
    'Stock Transfer', 'add',
    () => window.API.createTransfer(payload),
    (apiData) => {
      product.stock[from] = available - qty;
      product.stock[to]   = (product.stock[to] || 0) + qty;
      STATE.stockTransfers.push({
        id:          apiData?.id || uid(),
        productId:   pid,
        productName: product.name,
        fromId: from, toId: to,
        fromName: getWarehouseName(from),
        toName:   getWarehouseName(to),
        qty, note, date: nowISO(),
        _apiId: apiData?.id || null,
      });
      saveState();
      renderWarehouseGrid();
      renderTransferHistory();
    },
    { type: 'createTransfer', data: payload }
  );
};

/* ════════════════════════════════════════════════════════════════
   PURCHASES
════════════════════════════════════════════════════════════════ */
window.savePurchase = async function () {
  if (!purchaseItems.length) return toast('Add at least one item.', 'warn');
  const supplierId = $('#pu-supplier').value;
  if (!supplierId) return toast('Select a supplier.', 'warn');

  const whId       = $('#pu-wh').value;
  const supplier   = STATE.suppliers.find(s => s.id === supplierId);
  const wh         = STATE.warehouses.find(w => w.id === whId);
  const grandTotal = purchaseItems.reduce((s, i) => s + i.qty * i.cost, 0);
  const payStatus  = $('#pu-pay-status').value;
  const paidAmt    = parseFloat($('#pu-paid-amt').value) || 0;
  const owed       = payStatus === 'credit'  ? grandTotal
                   : payStatus === 'partial' ? grandTotal - paidAmt : 0;

  const items = purchaseItems.map(item => {
    const prod = STATE.products.find(p => p.id === item.productId);
    return {
      productId:   prod?._apiId || item.productId,
      productName: item.name,
      quantity:    item.qty,
      unitCost:    item.cost,
      unit:        item.unit,
    };
  });

  const payload = {
    supplierId:    supplier?._apiId || supplierId,
    warehouseId:   wh?._apiId || whId,
    invoiceNo:     $('#pu-invoiceno').value.trim(),
    date:          $('#pu-date').value,
    items,
    grandTotal,
    paymentStatus: payStatus,
    paidAmount:    paidAmt,
    amountOwed:    owed,
    notes:         $('#pu-notes').value.trim(),
  };

  await dbSave(
    'Purchase', 'add',
    () => window.API.createPurchase(payload),
    (apiData) => {
      purchaseItems.forEach(item => {
        const product = STATE.products.find(p => p.id === item.productId);
        if (product) {
          product.stock[whId] = (product.stock[whId] || 0) + item.qty;
          product.costPrice   = item.cost;
        }
      });
      if (supplier) supplier.balance = (supplier.balance || 0) + owed;

      STATE.purchases.push({
        id:            apiData?.id || uid(),
        invoiceNo:     payload.invoiceNo,
        supplierId,
        supplierName:  supplier?.name || 'Unknown',
        warehouseId:   whId,
        warehouseName: getWarehouseName(whId),
        items:         [...purchaseItems],
        grandTotal, paymentStatus: payStatus, paidAmt, owed,
        notes:         payload.notes,
        date:          payload.date + 'T00:00:00.000Z',
        _apiId:        apiData?.id || null,
      });
      saveState();
      purchaseItems = [];
      renderPurchases();
    },
    { type: 'createPurchase', data: payload }
  );
};

/* ════════════════════════════════════════════════════════════════
   POS — completeSale writes to API
════════════════════════════════════════════════════════════════ */
(function patchCompleteSaleForDB() {
  const _prev = window.completeSale;

  window.completeSale = async function () {
    const prevLen = STATE.sales.length;
    _prev();
    if (STATE.sales.length <= prevLen) return;

    const newSale = STATE.sales[STATE.sales.length - 1];
    if (!newSale) return;

    const itemsPayload = newSale.items.map(i => {
      const prod = STATE.products.find(p => p.id === i.productId);
      return {
        productId:            prod?._apiId || i.productId,
        productName:          i.name,
        quantity:             i.qty,
        unitPrice:            i.unitPrice,
        costPrice:            i.costPrice,
        bulkDiscountPct:      i.bulkDiscountPct      || 0,
        manualDiscountPct:    i.manualDiscountPct     || 0,
        effectiveDiscountPct: i.effectiveDiscountPct  || 0,
        lineDiscount:         i.lineDiscount          || 0,
      };
    });

    const custObj = STATE.customers.find(c => c.id === newSale.customerId);
    const repObj  = STATE.salesReps.find(r => r.id === newSale.repId);
    const whObj   = STATE.warehouses.find(w => w.id === newSale.warehouseId);

    const payload = {
      receiptNo:        newSale.receiptNo || null,
      invoiceNo:        newSale.invoiceNo || null,
      customerId:       custObj?._apiId   || newSale.customerId  || null,
      repId:            repObj?._apiId    || newSale.repId       || null,
      warehouseId:      whObj?._apiId     || newSale.warehouseId || null,
      items:            itemsPayload,
      subtotal:         newSale.subtotal,
      totalBulkDisc:    newSale.totalBulkDisc   || 0,
      totalManualDisc:  newSale.totalManualDisc  || 0,
      extraDiscPct:     newSale.extraDiscPct     || 0,
      extraDiscAmt:     newSale.extraDiscAmt     || 0,
      totalDiscountAmt: newSale.totalDiscountAmt || 0,
      taxAmt:           newSale.taxAmt,
      redeemPts:        newSale.redeemPts        || 0,
      redeemVal:        newSale.redeemVal        || 0,
      total:            newSale.total,
      paymentMethod:    newSale.paymentMethod,
      paymentStatus:    newSale.paymentStatus,
      date:             newSale.date,
    };

    try {
      const res      = await window.API.createSale(payload);
      const envelope = res?.data;
      const saleData = envelope?.id ? envelope
        : Object.values(envelope || {}).find(v => v && typeof v === 'object' && v.id)
        || envelope;
      if (saleData?.id) { newSale._apiId = saleData.id; saveState(); }
    } catch (err) {
      console.warn('[DB] Sale write failed — queued', err);
      if (window.OfflineQueue) window.OfflineQueue.add({ type: 'createSale', data: payload });
    }
  };
})();

/* ════════════════════════════════════════════════════════════════
   QUOTES — saveAsQuote writes to API
════════════════════════════════════════════════════════════════ */
(function patchSaveAsQuoteForDB() {
  const _prev = window.saveAsQuote;

  window.saveAsQuote = async function () {
    const prevLen = STATE.quotes.length;
    _prev();
    if (STATE.quotes.length <= prevLen) return;

    const q       = STATE.quotes[STATE.quotes.length - 1];
    const custObj = STATE.customers.find(c => c.id === q.customerId);
    const whObj   = STATE.warehouses.find(w => w.id === q.warehouseId);

    const payload = {
      quoteNo:      q.quoteNo,
      customerId:   custObj?._apiId || q.customerId  || null,
      warehouseId:  whObj?._apiId   || q.warehouseId || null,
      items:        q.items,
      subtotal:     q.subtotal,
      extraDiscPct: q.extraDiscPct || 0,
      taxAmt:       q.taxAmt,
      total:        q.total,
      validDays:    q.validDays || 7,
      date:         q.date,
    };

    try {
      const res       = await window.API.createQuote(payload);
      const envelope  = res?.data;
      const quoteData = envelope?.id ? envelope
        : Object.values(envelope || {}).find(v => v && typeof v === 'object' && v.id)
        || envelope;
      if (quoteData?.id) { q._apiId = quoteData.id; saveState(); }
    } catch (err) {
      console.warn('[DB] Quote write failed — queued', err);
      if (window.OfflineQueue) window.OfflineQueue.add({ type: 'createQuote', data: payload });
    }
  };
})();

/* ════════════════════════════════════════════════════════════════
   CREDIT NOTES — issueCreditNote writes to API
════════════════════════════════════════════════════════════════ */
(function patchIssueCreditNoteForDB() {
  const _prev = window.issueCreditNote;

  window.issueCreditNote = function (saleId) {
    const origPush = STATE.creditNotes.push.bind(STATE.creditNotes);
    STATE.creditNotes.push = async function (cn) {
      origPush(cn);
      STATE.creditNotes.push = origPush;

      const custObj = STATE.customers.find(c => c.id === cn.customerId);
      const payload = {
        creditNoteNo:      cn.creditNoteNo,
        originalInvoiceNo: cn.originalInvoiceNo,
        customerId:        custObj?._apiId || cn.customerId || null,
        amount:            cn.amount,
        reason:            cn.reason,
        notes:             cn.notes,
        date:              cn.date,
      };

      try {
        const res      = await window.API.createCreditNote(payload);
        const envelope = res?.data;
        const cnData   = envelope?.id ? envelope
          : Object.values(envelope || {}).find(v => v && typeof v === 'object' && v.id)
          || envelope;
        if (cnData?.id) { cn._apiId = cnData.id; saveState(); }
      } catch (err) {
        console.warn('[DB] Credit note write failed — queued', err);
        if (window.OfflineQueue) window.OfflineQueue.add({ type: 'createCreditNote', data: payload });
      }
    };

    _prev(saleId);
  };
})();

/* ════════════════════════════════════════════════════════════════
   QUOTE STATUS UPDATE
════════════════════════════════════════════════════════════════ */
(function patchUpdateQuoteStatus() {
  const _prev = window.updateQuoteStatus;

  window.updateQuoteStatus = async function (quoteId, status) {
    _prev(quoteId, status);

    const q     = STATE.quotes.find(x => x.id === quoteId);
    const apiId = q?._apiId || quoteId;

    try {
      await window.API.updateQuote(apiId, { status });
    } catch (err) {
      console.warn('[DB] Quote status update failed — queued', err);
      if (window.OfflineQueue)
        window.OfflineQueue.add({ type: 'updateQuote', id: apiId, data: { status } });
    }
  };
})();

/* ════════════════════════════════════════════════════════════════
   MARK INVOICE PAID
════════════════════════════════════════════════════════════════ */
(function patchMarkInvoicePaid() {
  const _prev = window.markInvoicePaid;

  window.markInvoicePaid = async function (saleId) {
    _prev(saleId);

    const sale  = STATE.sales.find(s => s.id === saleId);
    const apiId = sale?._apiId || saleId;

    try {
      await window.API.updateSale(apiId, { paymentStatus: 'paid' });
    } catch (err) {
      console.warn('[DB] Invoice paid status failed — queued', err);
      if (window.OfflineQueue)
        window.OfflineQueue.add({ type: 'markSalePaid', id: apiId, data: { paymentStatus: 'paid' } });
    }
  };
})();

console.log('[DB Patch] All save handlers wired to backend API ✅');