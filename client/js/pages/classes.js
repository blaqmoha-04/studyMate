import { h, mount, icon } from '../dom.js';
import { get, del } from '../api.js';
import { state } from '../store.js';
import { loading, errorState, emptyState, badge, confirmDialog, toast, toastError, openModal } from '../ui.js';
import { DAYS } from '../time.js';
import { openClassForm } from '../forms.js';

export function classesPage(container) {
  const box = h('div', {});
  async function remove(c, modal) {
    if (!(await confirmDialog({ title: 'Delete class?', message: `\u201C${c.subject}\u201D will be removed from your timetable.`, confirmText: 'Delete', danger: true }))) return;
    try { await del(`/classes/${c.id}`); modal?.close(); toast('Class deleted'); load(); } catch (e) { toastError(e); }
  }
  function details(c) {
    const m = openModal({ title: c.subject, body: h('div', {},
      h('p', {}, `${DAYS[c.dayOfWeek]}, ${c.startTime}–${c.endTime}`), c.lecturer ? h('p', {}, `Lecturer: ${c.lecturer}`) : null, c.location ? h('p', {}, `Location: ${c.location}`) : null,
      c.hasConflict ? h('p', {}, badge('Overlaps another class', 'warning')) : null,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-danger', type: 'button', onclick: () => remove(c, m) }, 'Delete'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { m.close(); openClassForm({ item: c, onSaved: load }); } }, 'Edit'))) });
  }
  async function load() {
    mount(box, loading());
    try {
      const [res, todayRes] = await Promise.all([get('/classes'), get('/classes/today')]);
      if (!res.data.length) { mount(box, emptyState('Your timetable is empty', 'Add your weekly classes to see them here and on your dashboard.', h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openClassForm({ onSaved: load }) }, 'Add a class'))); return; }
      const ws = state.user.weekStart; const order = Array.from({ length: 7 }, (_, i) => (ws + i) % 7);
      const todayDow = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: state.user.timezone }).format(new Date()) + 'T12:00:00Z').getUTCDay();
      const cols = order.map((d) => h('section', { class: `tt-col ${d === todayDow ? 'today' : ''}`, 'aria-label': DAYS[d] },
        h('h3', {}, DAYS[d], d === todayDow ? ' · today' : ''),
        ...res.data.filter((c) => c.dayOfWeek === d).map((c) => {
          const card = h('button', { class: 'class-card', type: 'button', onclick: () => details(c), 'aria-label': `${c.subject}, ${DAYS[d]} ${c.startTime} to ${c.endTime}${c.hasConflict ? ', overlaps another class' : ''}` },
            h('div', { class: 't' }, c.subject), h('div', { class: 'm' }, `${c.startTime}–${c.endTime}`), c.location ? h('div', { class: 'm' }, c.location) : null, c.hasConflict ? badge('Overlap', 'warning') : null);
          card.style.borderLeftColor = c.color; return card;
        })));
      mount(box,
        res.meta.conflicts.length ? h('div', { class: 'form-note', role: 'status' }, `${res.meta.conflicts.length} pair(s) of classes overlap. They are marked on the timetable.`) : null,
        h('section', { class: 'card', 'aria-labelledby': 'tt-today' }, h('h3', { id: 'tt-today' }, 'Today\u2019s schedule'),
          todayRes.data.length ? h('ul', { class: 'list' }, todayRes.data.map((c) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, c.subject), h('div', { class: 'muted small' }, [c.location, c.lecturer].filter(Boolean).join(' · '))), h('span', { class: 'nowrap' }, `${c.startTime}–${c.endTime}`)))) : h('p', { class: 'muted' }, 'No classes today.')),
        h('div', { class: 'timetable' }, ...cols));
    } catch (err) { mount(box, errorState(err, load)); }
  }
  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Class timetable'),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openClassForm({ onSaved: load }) }, icon('plus'), 'New class')), box);
  load();
}
