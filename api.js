const BASE = 'https://cn-active-backend-1.onrender.com/api';

const getToken = () => localStorage.getItem('cnj_access_token') || localStorage.getItem('cnjohnson_access_token');

window.API = {
  async request(endpoint, options = {}) {
    const token = getToken();
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` })
      },
      ...options
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // Warehouses
  getWarehouses: () => window.API.request('/warehouses'),
  createWarehouse: (data) => window.API.request('/warehouses', { method: 'POST', body: JSON.stringify(data) }),
  updateWarehouse: (id, data) => window.API.request(`/warehouses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWarehouse: (id) => window.API.request(`/warehouses/${id}`, { method: 'DELETE' }),

  // Products / Goods
  getProducts: () => window.API.request('/products'),
  createProduct: (data) => window.API.request('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id, data) => window.API.request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id) => window.API.request(`/products/${id}`, { method: 'DELETE' }),

  // Add the rest the same way (customers, suppliers, purchases, etc.) – just copy the pattern
};