import { h, icon, mount, clear } from './dom.js';
import { ApiError } from './api.js';

// ---------- toasts
export function toast(message, type = 'success', ms = 4500) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, h('span', {}, message));
  box.append(el);
  setTimeout(() => el.remove(), ms);
}
export const toastError = (err, fallback = 'Something went wrong.') => toast(err instanceof ApiError ? err.message : fallback, 'error', 6500);

// ---------- dialogs (native <dialog>: focus trap, Esc to close, restores focus)
export function openModal({ title, body, onClose }) {
  const dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
  const close = () => { dlg.close(); };
  dlg.append(
    h('div', { class: 'modal-head' }, h('h2', { id: 'modal-title' }, title),
      h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Close dialog', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body));
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, el: dlg };
}

export function confirmDialog({ title = 'Are you sure?', message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title, onClose: () => resolve(answer),
      body: h('div', {}, h('p', {}, message),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => { answer = true; m.close(); } }, confirmText))),
    });
    m.el.querySelector('.btn:not(.btn-icon)')?.focus();
  });
}

// ---------- form helpers
let uid = 0;
export function field(label, control, { hint, name } = {}) {
  const id = control.id || `f${++uid}`;
  control.id = id;
  if (name) control.name = name;
  const err = h('p', { class: 'field-error hidden', id: `${id}-err`, role: 'alert' });
  const hintEl = hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null;
  control.setAttribute('aria-describedby', [hintEl ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' '));
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hintEl, err);
}
export const input = (props = {}) => h('input', { class: 'input', ...props });
export const textarea = (props = {}) => h('textarea', { class: 'input', ...props });
export function select(options, value, props = {}) {
  const el = h('select', { class: 'input', ...props },
    options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return el;
}

export function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; e.classList.add('hidden'); });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  form.querySelector('.form-error')?.remove();
}
// Shows per-field errors from the API next to inputs; anything unmatched goes into a banner at the top.
export function showErrors(form, err) {
  clearErrors(form);
  const fe = err instanceof ApiError ? err.fieldErrors : {}; const unmatched = [];
  for (const [fieldName, msg] of Object.entries(fe)) {
    const inputEl = form.querySelector(`[name="${fieldName}"]`);
    if (inputEl) { inputEl.setAttribute('aria-invalid', 'true'); const e = form.querySelector(`#${inputEl.id}-err`); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }
    else unmatched.push(`${fieldName}: ${msg}`);
  }
  if (!Object.keys(fe).length || unmatched.length) {
    const text = Object.keys(fe).length ? unmatched.join(' · ') : (err?.message ?? 'Something went wrong.');
    form.prepend(h('div', { class: 'form-error', role: 'alert' }, text));
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
}
// Swaps a button's contents for a "busy" label and puts the ORIGINAL nodes back afterwards (so icons survive).
const idleContents = new WeakMap();
export function setBusy(button, busy, busyText = 'Saving…') {
  if (busy) {
    if (!idleContents.has(button)) idleContents.set(button, [...button.childNodes]);
    button.replaceChildren(document.createTextNode(busyText)); button.disabled = true;
  } else {
    const original = idleContents.get(button);
    if (original) { button.replaceChildren(...original); idleContents.delete(button); }
    button.disabled = false;
  }
}

// ---------- states
export const loading = () => h('div', { class: 'state', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'spinner' }), h('span', { class: 'sr-only' }, 'Loading…'));
export const skeleton = (n = 4) => h('div', { 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));
export const emptyState = (title, text, action) => h('div', { class: 'state' }, h('h3', {}, title), h('p', {}, text), action);
export const errorState = (err, retry) => h('div', { class: 'state', role: 'alert' }, h('h3', {}, 'Could not load this'),
  h('p', {}, err?.message ?? 'Please try again.'), retry ? h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again') : null);
export const badge = (text, tone = '') => h('span', { class: `badge ${tone ? `badge-${tone}` : ''}` }, text);
export const priorityBadge = (p) => badge(p[0].toUpperCase() + p.slice(1), { urgent: 'danger', high: 'warning', medium: 'info', low: '' }[p]);
export const statusBadge = (s) => badge({ todo: 'To do', in_progress: 'In progress', completed: 'Completed' }[s] ?? s, { completed: 'success', in_progress: 'primary', todo: '' }[s]);

export function pager(meta, onPage) {
  if (!meta || meta.totalPages <= 1) return null;
  return h('nav', { class: 'pager', 'aria-label': 'Pagination' },
    h('button', { class: 'btn btn-sm', type: 'button', disabled: meta.page <= 1, onclick: () => onPage(meta.page - 1) }, icon('left'), 'Previous'),
    h('span', { class: 'muted small' }, `Page ${meta.page} of ${meta.totalPages}`),
    h('button', { class: 'btn btn-sm', type: 'button', disabled: meta.page >= meta.totalPages, onclick: () => onPage(meta.page + 1) }, 'Next', icon('right')));
}
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export { h, icon, mount, clear };
