import { h, mount, icon } from '../dom.js';
import { field, input, clearErrors, showErrors, setBusy, toast, loading, errorState } from '../ui.js';
import { footerLinks } from './legal.js';
import { get, patch, post, setCsrf } from '../api.js';
import { setUser, applyTheme } from '../store.js';
import { navigate, parseHash } from '../router.js';

const shell = (title, subtitle, ...children) => h('main', { class: 'auth-wrap', id: 'main', tabindex: '-1' },
  h('div', { class: 'auth-layout' },
    h('section', { class: 'auth-promo', 'aria-label': 'StudyMate' },
      h('span', { class: 'auth-promo-icon' }, icon('cap')),
      h('p', { class: 'auth-eyebrow' }, 'WELCOME TO STUDYMATE'),
      h('h2', {}, 'Make space for what matters.'),
      h('p', { class: 'auth-promo-copy' }, 'Keep your assignments, classes, notes and study sessions organized in one place.'),
      h('div', { class: 'auth-promo-rule' }),
      h('p', { class: 'auth-promo-note' }, 'A little progress each day adds up.')),
    h('div', { class: 'auth-col' },
      h('div', { class: 'card auth-card' },
        h('a', { class: 'brand auth-brand', href: '#/login' }, h('span', { class: 'brand-mark' }, icon('cap')), h('span', {}, 'Study', h('strong', {}, 'Mate'))),
        h('h1', {}, title), subtitle ? h('p', { class: 'muted auth-subtitle' }, subtitle) : null,
        ...children, footerLinks()))));

export function startSession(data) {
  setCsrf(data.csrfToken);
  setUser(data.user);
  const storedTheme = (() => {
    try { return localStorage.getItem('sm-theme'); } catch { return null; }
  })();
  const userTheme = data.user?.theme;
  const themeToApply = userTheme || storedTheme || 'system';
  applyTheme(themeToApply);
}

function submitHandler(form, btn, run, busyText) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); clearErrors(form); setBusy(btn, true, busyText);
    try { await run(); } catch (err) { showErrors(form, err); } finally { setBusy(btn, false); }
  });
}

export function loginPage() {
  const form = h('form', { novalidate: true });
  const email = input({ type: 'email', autocomplete: 'email', placeholder: 'Enter your email address', required: true });
  const pw = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Enter your password', required: true });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in', icon('right'));
  form.append(field('Email', email, { name: 'email' }), field('Password', pw, { name: 'password' }), btn);
  submitHandler(form, btn, async () => {
    const res = await post('/auth/login', { email: email.value, password: pw.value });
    startSession(res.data); navigate('/');
  }, 'Signing in…');
  const root = shell('Welcome back', 'Sign in to see what\u2019s next.', form,
    h('div', { class: 'auth-links' }, h('a', { href: '#/forgot-password' }, 'Forgot password?'), h('a', { href: '#/register' }, 'Create an account')));
  root.classList.add('auth-login');
  queueMicrotask(() => email.focus());
  return root;
}

// A required, never pre-ticked checkbox. Errors are shown beside it, exactly like text inputs.
function checkField(name, ...label) {
  const id = `c-${name}`; const cb = h('input', { type: 'checkbox', id, name, 'aria-describedby': `${id}-err` });
  return { cb, el: h('div', { class: 'field' }, h('label', { class: 'check', for: id }, cb, h('span', {}, ...label)), h('p', { class: 'field-error hidden', id: `${id}-err`, role: 'alert' })) };
}
const newTabLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

export function registerPage() {
  const box = h('div', {}, loading());
  const root = shell('Create your account', 'Your account and study data are stored on this StudyMate server.', box,
    h('div', { class: 'auth-links' }, h('span', {}, 'Already registered?'), h('a', { href: '#/login' }, 'Sign in')));
  root.classList.add('auth-register');
  const build = () => {
    const form = h('form', { novalidate: true });
    const name = input({ type: 'text', autocomplete: 'name', maxlength: 100, placeholder: 'Enter your full name' });
    const email = input({ type: 'email', autocomplete: 'email', placeholder: 'Enter your email address' });
    const pw = input({ type: 'password', autocomplete: 'new-password', minlength: 10, placeholder: 'Create a password' });
    const terms = checkField('acceptTerms', 'I agree to the ', newTabLink('#/terms', 'Terms of Service'), ' and have read the ', newTabLink('#/privacy', 'Privacy Policy'), '.');
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account', icon('right'));
    form.append(field('Name', name, { name: 'name' }), field('Email', email, { name: 'email' }),
      field('Password', pw, { name: 'password', hint: 'At least 10 characters.' }), terms.el, btn);
    submitHandler(form, btn, async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const storedTheme = (() => { try { return localStorage.getItem('sm-theme'); } catch { return null; } })();
      const res = await post('/auth/register', { name: name.value, email: email.value, password: pw.value,
        acceptTerms: terms.cb.checked, ...(timezone ? { timezone } : {}) });
      startSession(res.data);
      if (storedTheme && ['light', 'dark'].includes(storedTheme)) {
        patch('/me/preferences', { theme: storedTheme }).then((r) => setUser(r.data)).catch(() => {});
      }
      toast('Welcome to StudyMate!'); navigate('/');
    }, 'Creating…');
    mount(box, form); name.focus();
  };
  const load = () => get('/legal').then(build).catch((err) => mount(box, errorState(err, () => { mount(box, loading()); load(); })));
  load();
  return root;
}

export function forgotPage() {
  const form = h('form', { novalidate: true });
  const email = input({ type: 'email', autocomplete: 'email' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send reset link');
  const note = h('div', { class: 'hidden' });
  form.append(note, field('Email', email, { name: 'email' }), btn);
  // Be upfront when this server can't send email, instead of pretending.
  get('/auth/capabilities').then(({ data }) => {
    if (!data.passwordResetEmail) {
      note.className = 'form-note';
      note.textContent = data.devResetLogging
        ? 'Email isn\u2019t configured on this server. In development the reset link is printed in the server log.'
        : 'This server isn\u2019t set up to send email, so reset links can\u2019t be emailed. Ask the administrator to generate a reset link for you.';
    }
  }).catch(() => {});
  submitHandler(form, btn, async () => {
    const res = await post('/auth/forgot-password', { email: email.value });
    clearErrors(form);
    form.replaceChildren(h('div', { class: 'form-note', role: 'status' }, res.data.message));
  }, 'Sending…');
  return shell('Reset your password', 'Enter your account email.', form, h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, 'Back to sign in')));
}

export function resetPage() {
  const token = parseHash().query.token ?? '';
  const form = h('form', { novalidate: true });
  const pw = input({ type: 'password', autocomplete: 'new-password', minlength: 10 });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Set new password');
  form.append(field('New password', pw, { name: 'password', hint: 'At least 10 characters.' }), btn);
  submitHandler(form, btn, async () => {
    await post('/auth/reset-password', { token, password: pw.value });
    toast('Password updated. Please sign in.'); navigate('/login');
  }, 'Saving…');
  if (!token) return shell('Reset link problem', null, h('div', { class: 'form-error' }, 'This reset link is incomplete. Request a new one.'), h('a', { href: '#/forgot-password' }, 'Request a new link'));
  return shell('Choose a new password', null, form);
}
