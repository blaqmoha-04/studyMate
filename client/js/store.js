export const state = { user: null };
const listeners = new Set();
const themeListeners = new Set();
export const onUserChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onThemeChange = (fn) => { themeListeners.add(fn); return () => themeListeners.delete(fn); };
export function setUser(user) { state.user = user; for (const fn of listeners) fn(user); }
export const tz = () => state.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function applyTheme(pref) {
  const valid = ['light', 'dark', 'system'].includes(pref) ? pref : (localStorage.getItem('sm-theme') || 'system');
  const dark = valid === 'dark' || (valid === 'system' && (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false));
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('sm-theme', valid); } catch { /* storage unavailable */ }
  for (const fn of themeListeners) fn(valid, dark);
}

if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const stored = localStorage.getItem('sm-theme') || 'system';
      if (stored === 'system') applyTheme('system');
    });
  } catch { /* unsupported in older test environments */ }
}

const ACCENTS = ['blue', 'purple', 'green', 'cyan', 'orange'];
export function applyAccent(accent) {
  const selected = ACCENTS.includes(accent) ? accent : 'blue';
  document.documentElement.setAttribute('data-accent', selected);
  try { localStorage.setItem('sm-accent', selected); } catch { /* storage unavailable */ }
}
