'use strict';

const BASE = 'http://localhost:5000/api';

function authHeaders() {
  const token = sessionStorage.getItem('cnjohnson_access_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

window.API = {
  // Auth
  login:    (data) => request('POST', '/auth/login', data),
  logout:   ()     => request('POST', '/auth/logout'),

  // Products
  getProducts:   ()       => request('GET',    '/products'),
  createProduct: (data)   => request('POST',   '/products', data),
  updateProduct: (id, data) => request('PUT',  `/products/${id}`, data),
  deleteProduct: (id)     => request('DELETE', `/products/${id}`),

  // Customers
  getCustomers:   ()        => request('GET',    '/customers'),
  createCustomer: (data)    => request('POST',   '/customers', data),
  updateCustomer: (id, data) => request('PUT',   `/customers/${id}`, data),
  deleteCustomer: (id)      => request('DELETE', `/customers/${id}`),

  // Suppliers
  getSuppliers:   ()        => request('GET',    '/suppliers'),
  createSupplier: (data)    => request('POST',   '/suppliers', data),
  updateSupplier: (id, data) => request('PUT',   `/suppliers/${id}`, data),
  deleteSupplier: (id)      => request('DELETE', `/suppliers/${id}`),

  // Sales
  completeSale: (data) => request('POST', '/sales', data),

  // Settings
  getSettings:    ()     => request('GET',  '/settings'),
  updateSettings: (data) => request('PUT',  '/settings', data),
};

function authHeaders() {
  const token = localStorage.getItem('cnjohnson_access_token'); // ← was sessionStorage
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}