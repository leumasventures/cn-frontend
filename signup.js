// signup.js — cnjohnsonventures.com/signup.html
(() => {
'use strict';

const API_URL = 'https://cn-active-backend-1.onrender.com'; // 🔴 REPLACE with your actual Render URL

/* ─── DOM References ─────────────────────────────────────────────────────── */
const firstNameInput   = document.querySelector('#firstName, input[placeholder*="first" i]');
const lastNameInput    = document.querySelector('#lastName,  input[placeholder*="last"  i]');
const emailInput       = document.querySelector('input[type="email"], #email');
const passInput        = document.querySelector('input[type="password"]#password, input[name="password"]');
const confirmPassInput = document.querySelector('#confirmPassword, input[placeholder*="confirm" i]');
const roleBtns         = document.querySelectorAll('.role-btn, [data-role]');
const signUpBtn        = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                           .find(el => /sign\s*up|create|register/i.test(el.textContent || el.value));
const loginLink        = Array.from(document.querySelectorAll('button, a'))
                           .find(el => /sign\s*in|log\s*in/i.test(el.textContent || el.value));

/* ─── Inject banners ─────────────────────────────────────────────────────── */
function makeBanner(id, bg, borderColor, textColor) {
  const el = document.createElement('div');
  el.id = id;
  Object.assign(el.style, {
    display: 'none', background: bg, color: textColor,
    border: `1px solid ${borderColor}`, borderRadius: '6px',
    padding: '10px 14px', marginBottom: '12px',
    fontSize: '14px', lineHeight: '1.4', textAlign: 'left',
  });
  el.setAttribute('role', 'alert');
  return el;
}

const errorBox   = makeBanner('cnj-signup-error',   '#fee2e2', '#fca5a5', '#991b1b');
const successBox = makeBanner('cnj-signup-success',  '#dcfce7', '#86efac', '#166534');

const anchor = emailInput?.closest('div, form') || signUpBtn?.parentNode;
if (anchor?.parentNode) {
  anchor.parentNode.insertBefore(errorBox,   anchor);
  anchor.parentNode.insertBefore(successBox, anchor);
} else {
  document.body.prepend(successBox);
  document.body.prepend(errorBox);
}

/* ─── Password strength meter ────────────────────────────────────────────── */
const strengthWrap = document.createElement('div');
Object.assign(strengthWrap.style, { margin: '4px 0 8px', display: 'none' });
strengthWrap.innerHTML = `
  <div style="background:#e5e7eb;border-radius:4px;height:5px;overflow:hidden;">
    <div id="cnj-strength-bar" style="height:100%;width:0;border-radius:4px;transition:all .3s;"></div>
  </div>
  <small id="cnj-strength-label" style="font-size:12px;"></small>
`;
passInput?.parentNode?.insertBefore(strengthWrap, passInput.nextSibling);
const strengthBar   = document.getElementById('cnj-strength-bar');
const strengthLabel = document.getElementById('cnj-strength-label');

function getStrength(pw) {
  let s = 0;
  if (pw.length >= 8)           s++;
  if (pw.length >= 12)          s++;
  if (/[A-Z]/.test(pw))        s++;
  if (/[0-9]/.test(pw))        s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const levels = [
    null,
    { label: 'Weak',        color: '#ef4444' },
    { label: 'Fair',        color: '#f97316' },
    { label: 'Good',        color: '#eab308' },
    { label: 'Strong',      color: '#22c55e' },
    { label: 'Very Strong', color: '#16a34a' },
  ];
  return { score: s, ...(levels[Math.max(1, s)] ) };
}

passInput?.addEventListener('input', () => {
  if (!passInput.value) { strengthWrap.style.display = 'none'; return; }
  strengthWrap.style.display = 'block';
  const { score, label, color } = getStrength(passInput.value);
  strengthBar.style.width           = `${(score / 5) * 100}%`;
  strengthBar.style.backgroundColor = color;
  strengthLabel.textContent         = `Strength: ${label}`;
  strengthLabel.style.color         = color;
});

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function showError(msg) {
  successBox.style.display = 'none';
  errorBox.textContent     = msg;
  errorBox.style.display   = 'block';
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showSuccess(msg) {
  errorBox.style.display   = 'none';
  successBox.textContent   = msg;
  successBox.style.display = 'block';
  successBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearMessages() {
  errorBox.style.display = successBox.style.display = 'none';
}

function setLoading(on) {
  if (!signUpBtn) return;
  signUpBtn.disabled    = on;
  signUpBtn.textContent = on ? 'Creating account…' : 'Sign Up';
  signUpBtn.setAttribute('aria-busy', String(on));
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
  });
});

/* ─── Enter key submits ──────────────────────────────────────────────────── */
[firstNameInput, lastNameInput, emailInput, passInput, confirmPassInput].forEach(input => {
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') signUpBtn?.click(); });
});

/* ─── Sign Up ────────────────────────────────────────────────────────────── */
signUpBtn?.addEventListener('click', async () => {
  clearMessages();

  const firstName   = firstNameInput?.value.trim()   ?? '';
  const lastName    = lastNameInput?.value.trim()    ?? '';
  const email       = emailInput?.value.trim()       ?? '';
  const password    = passInput?.value.trim()        ?? '';
  const confirmPass = confirmPassInput?.value.trim() ?? '';

  if (!email || !password)        { showError('Email and password are required.'); return; }
  if (!isValidEmail(email))       { showError('Please enter a valid email address.'); emailInput?.focus(); return; }
  if (password.length < 6)        { showError('Password must be at least 6 characters.'); passInput?.focus(); return; }
  if (confirmPassInput && password !== confirmPass) { showError('Passwords do not match.'); confirmPassInput?.focus(); return; }

  const { score, label } = getStrength(password);
  if (score < 2) {
    showError(`Password is too weak (${label}). Add uppercase letters, numbers, or symbols.`);
    passInput?.focus();
    return;
  }

  setLoading(true);

  try {
    const payload = { email, password, role: selectedRole };
    if (firstName) payload.firstName = firstName;
    if (lastName)  payload.lastName  = lastName;

    const res  = await fetch(`${API_URL}/api/auth/signup`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.status === 409) { showError('An account with this email already exists. Try signing in instead.'); return; }
    if (!res.ok)            { showError(data.message || `Signup failed (${res.status}). Please try again.`); return; }

    if (data.accessToken) {
      localStorage.setItem('cnjohnson_access_token', data.accessToken);
      localStorage.setItem('cnjohnson_auth', JSON.stringify(data.user));
      if (data.expiresIn) {
        localStorage.setItem('cnjohnson_token_expiry', Date.now() + data.expiresIn * 1000);
      }
      showSuccess('Account created! Redirecting…');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } else {
      showSuccess(data.message || 'Account created! Please check your email to verify your account.');
      signUpBtn.disabled = true;
    }

  } catch (err) {
    showError(err.name === 'TypeError'
      ? 'Could not reach the server. Check your connection.'
      : 'An unexpected error occurred. Please try again.');
    console.error('[CNJ Signup]', err);
  } finally {
    setLoading(false);
  }
});

/* ─── Already have an account? → login ──────────────────────────────────── */
loginLink?.addEventListener('click', e => {
  e.preventDefault();
  window.location.href = 'login.html';
});

})(); // end IIFE