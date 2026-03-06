// login.js — cnjohnsonventures.com/login.html
(() => {
'use strict';

const API_URL = 'https://cn-active-backend-1.onrender.com'; // replace this

/* ─── DOM References ─────────────────────────────────────────────────────── */
const emailInput = document.querySelector('input[type="email"], input#email, input[placeholder*="mail" i]');
const passInput  = document.querySelector('input[type="password"]');
const roleBtns   = document.querySelectorAll('.role-btn, [data-role]');
const signInBtn  = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                     .find(el => /sign\s*in/i.test(el.textContent || el.value));
const signUpLink = Array.from(document.querySelectorAll('button, a'))
                     .find(el => /sign\s*up/i.test(el.textContent || el.value));

/* ─── Inject inline error banner ────────────────────────────────────────── */
const errorBox = (() => {
  const el = document.createElement('div');
  el.id = 'cnj-error';
  Object.assign(el.style, {
    display: 'none', background: '#fee2e2', color: '#991b1b',
    border: '1px solid #fca5a5', borderRadius: '6px',
    padding: '10px 14px', marginBottom: '12px',
    fontSize: '14px', lineHeight: '1.4', textAlign: 'left',
  });
  el.setAttribute('role', 'alert');
  const anchor = emailInput?.closest('div, form') || signInBtn?.parentNode;
  anchor?.parentNode?.insertBefore(el, anchor) ?? document.body.prepend(el);
  return el;
})();

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearError() {
  errorBox.textContent = '';
  errorBox.style.display = 'none';
}

function setLoading(on) {
  if (!signInBtn) return;
  signInBtn.disabled    = on;
  signInBtn.textContent = on ? 'Signing in…' : 'Sign In';
  signInBtn.setAttribute('aria-busy', String(on));
}

/* ─── Role Selector ──────────────────────────────────────────────────────── */
let selectedRole = '';

roleBtns.forEach((btn, i) => {
  if (!btn.dataset.role) {
    btn.dataset.role = btn.textContent.trim().toLowerCase().replace(/\s+/g, '_');
  }
  if (i === 0) {
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    selectedRole = btn.dataset.role;
  }
  btn.addEventListener('click', () => {
    roleBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    selectedRole = btn.dataset.role;
    clearError();
  });
});

/* ─── Enter key submits ──────────────────────────────────────────────────── */
[emailInput, passInput].forEach(input => {
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') signInBtn?.click(); });
});

/* ─── Sign In ────────────────────────────────────────────────────────────── */
signInBtn?.addEventListener('click', async () => {
  clearError();

  const email    = emailInput?.value.trim() ?? '';
  const password = passInput?.value.trim()  ?? '';

  if (!email || !password) { showError('Please enter your email and password.'); return; }
  if (!isValidEmail(email)) { showError('Please enter a valid email address.'); emailInput?.focus(); return; }
  if (password.length < 6)  { showError('Password must be at least 6 characters.'); passInput?.focus(); return; }

  setLoading(true);

  try {
    const res  = await fetch(`${API_URL}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, role: selectedRole }),
    });
    const data = await res.json();

    if (!res.ok) { showError(data.message || `Login failed (${res.status}). Please try again.`); return; }

    localStorage.setItem('cnjohnson_access_token', data.accessToken);
    localStorage.setItem('cnjohnson_auth', JSON.stringify(data.user));
    if (data.expiresIn) {
      localStorage.setItem('cnjohnson_token_expiry', Date.now() + data.expiresIn * 1000);
    }

    window.location.href = 'dashboard.html';

  } catch (err) {
    showError(err.name === 'TypeError'
      ? 'Could not reach the server. Check your connection.'
      : 'An unexpected error occurred. Please try again.');
    console.error('[CNJ Login]', err);
  } finally {
    setLoading(false);
  }
});

/* ─── Sign Up button → navigate to signup page ───────────────────────────── */
signUpLink?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = 'signup.html';
});

})(); // end IIFE