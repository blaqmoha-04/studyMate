import { h, mount, icon } from '../dom.js';
import { get, del, qs } from '../api.js';
import { loading, errorState, emptyState, badge, pager, confirmDialog, toast, toastError, openModal } from '../ui.js';
import { fmtDateTime, countdown, fmtDuration } from '../time.js';
import { openExamForm, openStudyPlanForm } from '../forms.js';

export function examsPage(container) {
  const st = { when: 'upcoming', page: 1 }; const box = h('div', {}); let timer;
  const tabs = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Show exams' },
    ['upcoming', 'past'].map((w) => h('button', { type: 'button', 'aria-pressed': String(w === st.when), onclick: (e) => { st.when = w; st.page = 1; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); load(); } }, w[0].toUpperCase() + w.slice(1))));

  async function remove(x) {
    if (!(await confirmDialog({ title: 'Delete examination?', message: `\u201C${x.subject}: ${x.title}\u201D will be deleted. Linked study sessions are kept.`, confirmText: 'Delete', danger: true }))) return;
    try { await del(`/exams/${x.id}`); toast('Exam deleted'); load(); } catch (e) { toastError(e); }
  }
  async function details(x) {
    let d; try { d = (await get(`/exams/${x.id}`)).data; } catch (e) { toastError(e); return; }
    const m = openModal({ title: `${d.subject}: ${d.title}`, body: h('div', {},
      h('p', {}, fmtDateTime(d.examAt), d.venue ? ` · ${d.venue}` : ''), d.notes ? h('p', { class: 'muted' }, d.notes) : null,
      h('h3', {}, 'Study plan'), h('p', { class: 'muted small' }, `Time studied for this exam: ${fmtDuration(d.studySecondsLogged)}`),
      d.studyPlan.length ? h('ul', { class: 'list' }, d.studyPlan.map((s) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, s.subject || 'Study session'),
        h('div', { class: 'muted small' }, s.plannedStart ? fmtDateTime(s.plannedStart) : fmtDateTime(s.startedAt))), badge(s.status, s.status === 'completed' ? 'success' : '')))) : h('p', { class: 'muted' }, 'No study sessions linked yet.'),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { m.close(); openStudyPlanForm({ defaults: { examId: d.id, subject: d.subject }, onSaved: load }); } }, 'Plan a study session'))) });
  }
  function tick() { box.querySelectorAll('[data-at]').forEach((el) => { el.textContent = `in ${countdown((new Date(el.dataset.at) - Date.now()) / 1000)}`; }); }

  async function load() {
    mount(box, loading());
    try {
      const res = await get(`/exams${qs({ when: st.when, page: st.page, pageSize: 12 })}`);
      if (!res.data.length) { mount(box, emptyState(st.when === 'upcoming' ? 'No upcoming exams' : 'No past exams', st.when === 'upcoming' ? 'Add an exam to get a countdown and reminders.' : 'Exams you have taken will appear here.', st.when === 'upcoming' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openExamForm({ onSaved: load }) }, 'Add an exam') : null)); return; }
      mount(box, h('div', { class: 'grid grid-2' }, res.data.map((x) => h('article', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, `${x.subject}: ${x.title}`),
          st.when === 'upcoming' ? h('span', { class: 'badge badge-warning countdown', 'data-at': new Date(x.examAt).toISOString() }, `in ${countdown(x.secondsUntil)}`) : badge('Done')),
        h('p', {}, fmtDateTime(x.examAt)), x.venue ? h('p', { class: 'muted' }, x.venue) : null, x.notes ? h('p', { class: 'muted small' }, x.notes.slice(0, 140)) : null,
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => details(x) }, 'Details & study plan'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => openExamForm({ item: x, onSaved: load }), 'aria-label': `Edit ${x.title}` }, icon('edit')),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => remove(x), 'aria-label': `Delete ${x.title}` }, icon('trash')))))), pager(res.meta, (p) => { st.page = p; load(); }));
    } catch (err) { mount(box, errorState(err, load)); }
  }
  timer = setInterval(tick, 30000);
  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Examinations'), h('div', { class: 'actions' }, tabs,
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openExamForm({ onSaved: load }) }, icon('plus'), 'New exam'))), box);
  load();
  return () => clearInterval(timer);
}
