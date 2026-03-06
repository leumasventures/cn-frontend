// auth.js — place in cn-frontend/, include in every protected page
// Usage: <script src="auth.js"></script> at top of <body>
// Redirects unauthenticated users to login.html
// Redirects cashiers away from non-POS pages

(() => {
  'use strict';

  const ROLE_HOME = {
    ADMIN:   'dashboard.html',
    MANAGER: 'dashboard.html',
    CASHIER: 'pos.html',       // cashier lands on POS only
  };

  // Pages that don't require auth
  const PUBLIC_PAGES = ['login.html', 'signup.html', 'pending.html', 'index.html', ''];

  const currentPage = window.location.pathname.split('/').pop();

  // Skip guard on public pages
  if (PUBLIC_PAGES.some(p => currentPage === p || currentPage === '')) return;

  const token = localStorage.getItem('cnjohnson_access_token');
  const auth  = JSON.parse(localStorage.getItem('cnjohnson_auth') || 'null');

  // Not logged in → back to login
  if (!token || !auth) {
    window.location.href = 'login.html';
    return;
  }

  // Token expiry check
  const expiry = localStorage.getItem('cnjohnson_token_expiry');
  if (expiry && Date.now() > Number(expiry)) {
    localStorage.clear();
    window.location.href = 'login.html';
    return;
  }

  const role = auth.role; // 'ADMIN' | 'MANAGER' | 'CASHIER'

  // Cashier can ONLY access pos.html
  if (role === 'CASHIER' && currentPage !== 'pos.html') {
    window.location.href = 'pos.html';
    return;
  }

  // Manager cannot access admin pages
  const ADMIN_ONLY_PAGES = ['admin.html', 'users.html'];
  if (role === 'MANAGER' && ADMIN_ONLY_PAGES.includes(currentPage)) {
    window.location.href = 'dashboard.html';
    return;
  }

  // Expose auth info globally for pages that need it
  window.CNJ = {
    user: auth,
    role,
    token,
    isAdmin:   role === 'ADMIN',
    isManager: role === 'MANAGER',
    isCashier: role === 'CASHIER',
    logout() {
      localStorage.removeItem('cnjohnson_access_token');
      localStorage.removeItem('cnjohnson_auth');
      localStorage.removeItem('cnjohnson_token_expiry');
      window.location.href = 'login.html';
    },
  };
})();