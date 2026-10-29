import { h, mount, icon } from '../dom.js';
import { get, post, del, qs, bus } from '../api.js';
import { loading, errorState, emptyState, badge, pager, toastError } from '../ui.js';
import { fmtDateTime } from '../time.js';
import { navigate } from '../router.js';

const TARGET = { assignment: '/assignments', exam: '/exams', study_session: '/study' };
const TONE = { assignment_due: 'warning', assignment_overdue: 'danger', exam_upcoming: 'info', study_reminder: 'success' };

export function notificationsPage(container) {
  const st = { page: 1, unread: false }; const box = h('div', {});
  const changed = () => bus.dispatchEvent(new Event('notifications-changed'));
  async function act(fn) { try { await fn(); changed(); load(); } catch (e) { toastError(e); } }
  const filter = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter notifications' },
    [['All', false], ['Unread', true]].map(([l, v]) => h('button', { type: 'button', 'aria-pressed': String(v === st.unread), onclick: (e) => { st.unread = v; st.page = 1; filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); load(); } }, l)));
  async function load() {
    mount(box, loading());
    try {
      const res = await get(`/notifications${qs({ page: st.page, pageSize: 20, unread: st.unread ? 'true' : '' })}`);
      if (!res.data.length) { mount(box, emptyState('You\u2019re all caught up', 'Reminders for deadlines, overdue work and exams appear here.')); return; }
      mount(box, h('ul', { class: 'card list' }, res.data.map((n) => h('li', {},
        h('div', { class: 'grow' }, h('div', { class: 'title' }, n.readAt ? null : h('span', { class: 'sr-only' }, 'Unread: '), n.title, ' ', n.readAt ? null : badge('New', 'primary')),
          h('div', { class: 'muted small' }, n.body), h('div', { class: 'muted small' }, fmtDateTime(n.createdAt))),
        h('div', { class: 'actions' }, badge(n.type.replace('_', ' '), TONE[n.type]),
          TARGET[n.entityType] ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => act(async () => { await post(`/notifications/${n.id}/read`); navigate(TARGET[n.entityType]); }) }, 'View') : null,
          n.readAt ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Mark "${n.title}" as read`, title: 'Mark read', onclick: () => act(() => post(`/notifications/${n.id}/read`)) }, icon('check')),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Dismiss "${n.title}"`, title: 'Dismiss', onclick: () => act(() => del(`/notifications/${n.id}`)) }, icon('x')))))),
        pager(res.meta, (p) => { st.page = p; load(); }));
    } catch (err) { mount(box, errorState(err, load)); }
  }
  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Notifications'), h('div', { class: 'actions' }, filter,
    h('button', { class: 'btn', type: 'button', onclick: () => act(() => post('/notifications/read-all')) }, 'Mark all read'))),
    h('p', { class: 'muted small' }, 'Reminders are created while the server is running and appear here when you open StudyMate. There are no browser push notifications.'), box);
  load();
}
