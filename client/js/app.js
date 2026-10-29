import { h, mount, clear, icon } from './dom.js';
import { get, patch, post, setCsrf, bus } from './api.js';
import { state, setUser, applyTheme, onUserChange, onThemeChange } from './store.js';
import * as router from './router.js';
import { toast, loading, errorState } from './ui.js';
import { loginPage, registerPage, forgotPage, resetPage, startSession } from './pages/auth.js';
import { dashboardPage } from './pages/dashboard.js';
import { assignmentsPage } from './pages/assignments.js';
import { classesPage } from './pages/classes.js';
import { notesPage } from './pages/notes.js';
import { dictionaryPage } from './pages/dictionary.js';
import { examsPage } from './pages/exams.js';
import { studyPage } from './pages/study.js';
import { calendarPage } from './pages/calendar.js';
import { notificationsPage } from './pages/notifications.js';
import { settingsPage } from './pages/settings.js';
import { legalPage, LEGAL_TITLES, footerLinks } from './pages/legal.js';
import { showCookieNotice } from './notice.js';

const root = document.getElementById('root');
const NAV = [
  ['/', 'Dashboard', 'home'], ['/assignments', 'Assignments', 'tasks'], ['/classes', 'Timetable', 'clock'], ['/notes', 'Notes', 'note'],
  ['/dictionary', 'Dictionary', 'book'], ['/exams', 'Exams', 'exam'], ['/study', 'Study', 'timer'], ['/calendar', 'Calendar', 'calendar'], ['/notifications', 'Notifications', 'bell'], ['/settings', 'Settings', 'settings'],
];
const PRIVATE = {
  '/': ['Dashboard', dashboardPage], '/assignments': ['Assignments', assignmentsPage], '/classes': ['Timetable', classesPage], '/notes': ['Notes', notesPage],
  '/dictionary': ['Dictionary', dictionaryPage], '/exams': ['Exams', examsPage], '/study': ['Study planner', studyPage], '/calendar': ['Calendar', calendarPage], '/notifications': ['Notifications', notificationsPage], '/settings': ['Settings', settingsPage],
};
const PUBLIC = { '/login': ['Sign in', loginPage], '/register': ['Create account', registerPage], '/forgot-password': ['Reset password', forgotPage], '/reset-password': ['New password', resetPage] };

const LEGAL = { '/privacy': 'privacy', '/terms': 'terms', '/cookies': 'cookies', '/refunds': 'refunds' };

let shell = null; let destroyPage = null; let badgeTimer = null;

function buildShell() {
  const app = h('div', { class: 'app' });
  try { if (localStorage.getItem('sm-collapsed') === '1') app.classList.add('collapsed'); } catch { /* storage unavailable */ }
  const bell = h('span', { class: 'badge-dot hidden', id: 'nav-badge', 'aria-label': 'unread notifications' }, '0');
  const sidebarBadge = h('span', { class: 'badge-dot hidden', 'aria-label': 'unread notifications' }, '0');
  const nav = h('nav', { class: 'nav', 'aria-label': 'Primary' }, NAV.map(([path, label, ic]) =>
    h('a', { href: `#${path}`, dataset: { path }, onclick: () => app.classList.remove('menu-open') },
      icon(ic), h('span', { class: 'nav-label' }, label), path === '/notifications' ? sidebarBadge : null)));
  const collapseBtn = h('button', { class: 'btn btn-ghost collapse-btn', type: 'button', 'aria-label': 'Collapse sidebar', 'aria-pressed': String(app.classList.contains('collapsed')),
    onclick: () => { const c = app.classList.toggle('collapsed'); collapseBtn.setAttribute('aria-pressed', String(c)); try { localStorage.setItem('sm-collapsed', c ? '1' : '0'); } catch { /* ignore */ } } },
    icon('panel'), h('span', { class: 'collapse-label' }, 'Collapse'));
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('cap')), h('span', { class: 'brand-text' }, 'StudyMate')), nav, h('div', { class: 'sidebar-foot' }, collapseBtn));
  const title = h('h1', { id: 'page-title' }, 'StudyMate');
  const searchInput = h('input', { class: 'input topbar-search-input', type: 'search', placeholder: 'Search anything...', 'aria-label': 'Search dictionary words' });
  const searchForm = h('form', { class: 'topbar-search', role: 'search' }, icon('search'), searchInput);
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const word = searchInput.value.trim();
    if (word) router.navigate(`/dictionary?word=${encodeURIComponent(word)}`);
  });
  const updateThemeBtn = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.replaceChildren(icon(isDark ? 'sun' : 'moon'));
    themeBtn.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
  };
  const themeBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Toggle light or dark theme', onclick: async () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'; const next = dark ? 'light' : 'dark'; applyTheme(next);
    try { const r = await patch('/me/preferences', { theme: next }); setUser(r.data); } catch { /* theme still applied locally */ } } }, icon('moon'));
  updateThemeBtn();
  const unTheme = onThemeChange(updateThemeBtn);
  const menuBtn = h('button', { class: 'btn btn-ghost btn-icon menu-btn', type: 'button', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', onclick: () => app.classList.toggle('menu-open') }, icon('menu'));
  const userName = h('span', { class: 'user-name muted' }, state.user?.name ?? '');
  const avatar = h('span', { class: 'profile-avatar', 'aria-hidden': 'true' }, (state.user?.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?');
  const logoutBtn = h('button', { class: 'btn btn-sm topbar-logout', type: 'button', 'aria-label': 'Sign out', onclick: logout }, icon('logout'), 'Sign out');
  const main = h('main', { id: 'main', tabindex: '-1' });
  const footer = h('footer', { class: 'site-footer' }, footerLinks());
  const notificationLink = h('a', { class: 'btn btn-ghost btn-icon notification-link', href: '#/notifications', 'aria-label': 'Notifications' }, icon('bell'), bell);
  app.append(sidebar, h('div', { class: 'scrim', onclick: () => app.classList.remove('menu-open') }),
    h('div', { class: 'main-col' }, h('header', { class: 'topbar' }, menuBtn, title, searchForm, themeBtn, notificationLink, h('div', { class: 'profile' }, avatar, userName), logoutBtn), main, footer));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') app.classList.remove('menu-open'); });
  onUserChange((u) => {
    userName.textContent = u?.name ?? '';
    avatar.textContent = (u?.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
    updateThemeBtn();
  });
  return { app, main, title, bell, sidebarBadge };
}

async function refreshBadge() {
  if (!shell || !state.user) return;
  try {
    const { data } = await get('/notifications/unread-count');
    const count = data.unread > 99 ? '99+' : String(data.unread);
    for (const badge of [shell.bell, shell.sidebarBadge]) {
      badge.textContent = count;
      badge.classList.toggle('hidden', data.unread === 0);
      badge.setAttribute('aria-label', `${data.unread} unread notifications`);
    }
  } catch { /* badge is best-effort */ }
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* sign out locally regardless */ }
  endSession(); router.replace('/login');
}
function endSession() {
  destroyPage?.(); destroyPage = null; clearInterval(badgeTimer); setCsrf(null); setUser(null); shell = null; clear(root);
}

function handle({ route, path, params }) {
  destroyPage?.(); destroyPage = null; router.setLeaveGuard(null);
  const legalKind = LEGAL[path];
  if (legalKind) { shell = null; clear(root); document.title = `${LEGAL_TITLES[legalKind]} · StudyMate`; root.append(legalPage(legalKind)); window.scrollTo(0, 0); return; }
  const pub = PUBLIC[path]; const priv = PRIVATE[path];
  if (pub) {
    if (state.user) { router.replace('/'); return; }
    shell = null; clear(root); document.title = `${pub[0]} · StudyMate`; root.append(pub[1]()); return;
  }
  if (!priv) { if (state.user) { router.replace('/'); } else router.replace('/login'); return; }
  if (!state.user) { router.replace('/login'); return; }
  if (!shell || !root.contains(shell.app)) { clear(root); shell = buildShell(); root.append(shell.app); refreshBadge(); clearInterval(badgeTimer); badgeTimer = setInterval(refreshBadge, 60000); }
  const [title, page] = priv;
  shell.title.textContent = title; document.title = `${title} · StudyMate`;
  shell.app.querySelectorAll('.nav a').forEach((a) => { if (a.dataset.path === path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  shell.app.classList.remove('menu-open'); clear(shell.main);
  try { const cleanup = page(shell.main); if (typeof cleanup === 'function') destroyPage = cleanup; }
  catch (err) { console.error(err); mount(shell.main, errorState(err, () => router.refresh())); }
  if (!params?.keepFocus) shell.main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

bus.addEventListener('unauthorized', () => { if (state.user) { endSession(); toast('Your session has expired. Please sign in again.', 'warning'); router.replace('/login'); } });
bus.addEventListener('session-ended', () => { endSession(); });
bus.addEventListener('notifications-changed', refreshBadge);

async function boot() {
  // The skip link must not touch the URL hash (that is our router's state): move focus to <main> instead.
  document.querySelector('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('main')?.focus(); });
  showCookieNotice();
  mount(root, loading());
  try { const { data } = await get('/auth/session'); startSession(data); }
  catch (err) { if (err.status !== 401) { mount(root, errorState(err, () => location.reload())); return; } }
  const table = [...Object.keys(PUBLIC), ...Object.keys(PRIVATE), ...Object.keys(LEGAL)].map((p) => ({ pattern: new RegExp(`^${p.replace(/\//g, '\\/')}$`) , path: p }));
  router.configure([...table, { pattern: /.*/, notFound: true }], (resolved) => handle({ ...resolved, route: resolved.route, path: resolved.path }));
  if (!window.location.hash) window.location.hash = state.user ? '#/' : '#/login';
  router.start();
  // Revalidate session when the browser restores a bfcache entry (Back/Forward).
  // If the user logged out in another tab or the session expired, redirect to login.
  window.addEventListener('pageshow', async (e) => {
    if (!e.persisted) return; // normal load, already handled by boot()
    try { await get('/auth/session'); }
    catch (err) { if (err.status === 401 && state.user) { endSession(); router.replace('/login'); } }
  });
}
boot();
