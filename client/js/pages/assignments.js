import { h, mount, icon } from '../dom.js';
import { get, post, del, qs } from '../api.js';
import { loading, errorState, emptyState, priorityBadge, statusBadge, badge, pager, debounce, confirmDialog, toast, toastError, input, select } from '../ui.js';
import { fmtDateTime, relativeDue } from '../time.js';
import { openAssignmentForm } from '../forms.js';
import { calendarView } from '../calendar-view.js';

export function assignmentsPage(container) {
  const st = { view: 'list', page: 1, q: '', status: '', priority: '', subject: '', sort: 'due', order: 'asc', overdue: false };
  const listBox = h('div', {});
  const search = input({ type: 'search', placeholder: 'Search assignments…', 'aria-label': 'Search assignments', value: '' });
  search.addEventListener('input', debounce(() => { st.q = search.value.trim(); st.page = 1; load(); }));
  const sel = (key, options, label) => { const s = select(options, st[key], { 'aria-label': label }); s.addEventListener('change', () => { st[key] = s.value; st.page = 1; load(); }); return s; };
  const sortSel = select([['due:asc', 'Deadline (soonest)'], ['due:desc', 'Deadline (latest)'], ['priority:desc', 'Priority (high first)'], ['priority:asc', 'Priority (low first)'], ['created:desc', 'Newest']], 'due:asc', { 'aria-label': 'Sort by' });
  sortSel.addEventListener('change', () => { [st.sort, st.order] = sortSel.value.split(':'); load(); });
  const overdueBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => { st.overdue = !st.overdue; overdueBtn.setAttribute('aria-pressed', String(st.overdue)); overdueBtn.classList.toggle('btn-primary', st.overdue); st.page = 1; load(); } }, 'Overdue only');
  const viewBtns = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' },
    ['list', 'calendar'].map((v) => h('button', { type: 'button', 'aria-pressed': String(v === st.view), onclick: (e) => { st.view = v; viewBtns.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); toolbar.classList.toggle('hidden', v === 'calendar'); load(); } }, v[0].toUpperCase() + v.slice(1))));
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search),
    sel('status', [['', 'All statuses'], ['todo', 'To do'], ['in_progress', 'In progress'], ['completed', 'Completed']], 'Filter by status'),
    sel('priority', [['', 'All priorities'], ['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], 'Filter by priority'),
    sortSel, overdueBtn);
  const subjectInput = input({ type: 'text', placeholder: 'Subject', 'aria-label': 'Filter by subject', value: '' });
  subjectInput.addEventListener('input', debounce(() => { st.subject = subjectInput.value.trim(); st.page = 1; load(); }));
  toolbar.insertBefore(subjectInput, sortSel);

  async function complete(a) { try { await post(`/assignments/${a.id}/complete`); toast('Marked complete'); load(); } catch (e) { toastError(e); } }
  async function remove(a) {
    if (!(await confirmDialog({ title: 'Delete assignment?', message: `\u201C${a.title}\u201D will be permanently deleted.`, confirmText: 'Delete', danger: true }))) return;
    try { await del(`/assignments/${a.id}`); toast('Assignment deleted'); load(); } catch (e) { toastError(e); }
  }

  function row(a) {
    const done = a.status === 'completed';
    return h('tr', { class: `${done ? 'row-done' : ''} ${a.isOverdue ? 'row-overdue' : ''}` },
      h('td', { 'data-label': 'Title' }, h('div', { class: 't-title', }, h('strong', {}, a.title)), a.description ? h('div', { class: 'muted small' }, a.description.slice(0, 90)) : null),
      h('td', { 'data-label': 'Subject' }, a.subject || '—'),
      h('td', { 'data-label': 'Due' }, h('div', {}, fmtDateTime(a.dueAt)), h('div', { class: 'small ' + (a.isOverdue ? 'muted' : 'muted') }, done ? '' : relativeDue(a.dueAt)), a.isOverdue ? badge('Overdue', 'danger') : null),
      h('td', { 'data-label': 'Priority' }, priorityBadge(a.priority)), h('td', { 'data-label': 'Status' }, statusBadge(a.status)),
      h('td', { class: 't-actions', 'data-label': '' },
        done ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => complete(a), 'aria-label': `Mark ${a.title} complete`, title: 'Mark complete' }, icon('check')),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openAssignmentForm({ item: a, onSaved: load }), 'aria-label': `Edit ${a.title}`, title: 'Edit' }, icon('edit')),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => remove(a), 'aria-label': `Delete ${a.title}`, title: 'Delete' }, icon('trash'))));
  }

  async function load() {
    if (st.view === 'calendar') { mount(listBox, calendarView({ types: ['assignment'], showFilters: false })); return; }
    mount(listBox, loading());
    try {
      const res = await get(`/assignments${qs({ page: st.page, pageSize: 15, q: st.q, status: st.status, priority: st.priority, subject: st.subject, sort: st.sort, order: st.order, overdue: st.overdue ? 'true' : '' })}`);
      const filtered = st.q || st.status || st.priority || st.subject || st.overdue;
      if (!res.data.length) { mount(listBox, filtered ? emptyState('No matches', 'Try changing or clearing your filters.') : emptyState('No assignments yet', 'Add your first assignment to start tracking deadlines.', h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAssignmentForm({ onSaved: load }) }, 'Add assignment'))); return; }
      mount(listBox, h('div', { class: 'card table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Title', 'Subject', 'Due', 'Priority', 'Status', ''].map((c) => h('th', { scope: 'col' }, c)))), h('tbody', {}, res.data.map(row)))),
        pager(res.meta, (p) => { st.page = p; load(); }));
    } catch (err) { mount(listBox, errorState(err, load)); }
  }

  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Assignments'),
    h('div', { class: 'actions' }, viewBtns, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAssignmentForm({ onSaved: load }) }, icon('plus'), 'New assignment'))), toolbar, listBox);
  load();
}
