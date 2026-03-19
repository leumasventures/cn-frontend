// login.js — cnjohnsonventures.com/login.html
//
// Default admin credentials:
//   Email:    admin@cnjohnsonventures.com
//   Password: Admin@CNJ2026!
//
// KEY FIX: `role` is NOT sent in the login payload.
//   The old code sent role: selectedRole (e.g. "admin") but the DB stores
//   it as "ADMIN" (uppercase). This caused silent auth failures on many
//   backends. The server should derive role from the DB, not the client.
//
// localStorage stores auth tokens ONLY — no business/app data.

(() => {
'use strict';

const API_URL = 'https://cn-active-backend-1.onrender.com';

// ── DOM elements ───────────────────────────────────────────────────
const emailInput = document.querySelector(
  'input[type="email"], input#email, input[name="email"], input[placeholder*="mail" i]'
);
const passInput = document.querySelector('input[type="password"]');
const signInBtn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
  .find(el => /sign\s*in|log\s*in/i.test(el.textContent || el.value));
const signUpLink = Array.from(document.querySelectorAll('button, a'))
  .find(el => /sign\s*up|register/i.test(el.textContent || el.value));

// ── Error display ──────────────────────────────────────────────────
const errorBox = (() => {
  const existing = document.getElementById('cnj-error');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'cnj-error';
  Object.assign(el.style, {
    display: 'none',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    padding: '10px 14px',
    marginBottom: '12px',
    fontSize: '14px',
    lineHeight: '1.4',
  });
  el.setAttribute('role', 'alert');
  const anchor =
    emailInput?.closest('form, .form, .card, .login-box, .auth-box, div') ||
    signInBtn?.parentNode;
  anchor?.parentNode
    ? anchor.parentNode.insertBefore(el, anchor)
    : document.body.prepend(el);
  return el;
})();

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearError() {
  errorBox.textContent = '';
  errorBox.style.display = 'none';
}

const origBtnText = signInBtn?.textContent?.trim() || 'Sign In';
function setLoading(on) {
  if (!signInBtn) return;
  signInBtn.disabled = on;
  signInBtn.textContent = on ? 'Signing in…' : origBtnText;
  signInBtn.setAttribute('aria-busy', String(on));
}

// Enter key submits
[emailInput, passInput].forEach(inp =>
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') signInBtn?.click(); })
);

// ── Main login handler ─────────────────────────────────────────────
signInBtn?.addEventListener('click', async () => {
  clearError();
  const email    = (emailInput?.value || '').trim();
  const password = (passInput?.value  || '').trim();

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('Please enter a valid email address.');
    emailInput?.focus();
    return;
  }
  if (password.length < 6) {
    showError('Password must be at least 6 characters.');
    passInput?.focus();
    return;
  }

  setLoading(true);
  try {
    // ── Send ONLY email + password. Role comes from the DB. ──────
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // Always try to parse JSON even on error (backend sends error messages as JSON)
    let data;
    try {
      data = await res.json();
    } catch {
      showError(`Server error (${res.status}). Please try again.`);
      return;
    }

    if (!res.ok) {
      const msg =
        data?.message || data?.error || data?.msg ||
        `Login failed (${res.status}). Check your credentials and try again.`;
      showError(msg);
      console.error('[CNJ Login] ❌', res.status, data);
      return;
    }

    // Validate response shape
    if (!data.accessToken) {
      showError('No access token returned. Please contact support.');
      console.error('[CNJ Login] Response missing accessToken:', data);
      return;
    }
    if (!data.user) {
      showError('No user data returned. Please contact support.');
      console.error('[CNJ Login] Response missing user:', data);
      return;
    }

    // ── Persist auth tokens ONLY ─────────────────────────────────
    localStorage.setItem('cnj_access_token',      data.accessToken);
    localStorage.setItem('cnjohnson_auth',         JSON.stringify(data.user));
    if (data.refreshToken) {
      localStorage.setItem('cnj_refresh_token',    data.refreshToken);
    }
    const expiryMs = data.expiresIn ? data.expiresIn * 1000 : 3600_000;
    localStorage.setItem('cnjohnson_token_expiry', String(Date.now() + expiryMs));

    console.log('[CNJ Login] ✅', data.user.email, '| role:', data.user.role);

    // Role-based redirect
    const role = (data.user.role || '').toUpperCase();
    window.location.href = role === 'CASHIER' ? 'pos.html' : 'dashboard.html';

  } catch (err) {
    const isNetwork = err.name === 'TypeError' || err.message?.includes('fetch');
    showError(
      isNetwork
        ? 'Cannot reach the server. Check your internet connection.'
        : 'An unexpected error occurred. Please try again.'
    );
    console.error('[CNJ Login] Exception:', err);
  } finally {
    setLoading(false);
  }
});

// ── Sign-up link ───────────────────────────────────────────────────
signUpLink?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = 'signup.html';
});

})();