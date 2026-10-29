// Month/week/day calendar used by the Calendar page and the Assignments calendar view.
import { h, icon, mount } from './dom.js';
import { get, qs } from './api.js';
import { state } from './store.js';
import { loading, errorState, openModal, badge } from './ui.js';
import { todayKey, dayKey, addDays, dowOf, fmtTime, fmtDateTime, DAYS_SHORT } from './time.js';
import { navigate } from './router.js';

const TYPE_LABEL = { assignment: 'Assignments', class: 'Classes', exam: 'Exams', study: 'Study Sessions' };
const TYPE_PAGE = { assignment: '/assignments', class: '/classes', exam: '/exams', study: '/study' };
const TYPE_ICON = { assignment: 'tasks', class: 'clock', exam: 'exam', study: 'timer' };
const TYPES = ['class', 'assignment', 'exam', 'study'];

export function calendarView({ types = ['assignment', 'class', 'exam', 'study'], showFilters = true, initialView = 'month', pageLayout = false } = {}) {
  const root = h('div', { class: `calendar-view${pageLayout ? ' calendar-page-view' : ''}` });
  const body = h('div', { class: 'calendar-main-body' });
  const upcoming = h('div', { class: 'calendar-upcoming-list' });
  const st = { view: initialView, anchor: todayKey(), enabled: new Set(types), token: 0 };
  const weekStart = () => state.user?.weekStart ?? 1;
  const startOfWeek = (key) => addDays(key, -((dowOf(key) - weekStart() + 7) % 7));

  function range() {
    if (st.view === 'day') return { from: st.anchor, to: st.anchor };
    if (st.view === 'week') { const s = startOfWeek(st.anchor); return { from: s, to: addDays(s, 6) }; }
    const first = `${st.anchor.slice(0, 7)}-01`; const s = startOfWeek(first);
    return { from: s, to: addDays(s, 41) };
  }
  const monthTitle = () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${st.anchor.slice(0, 7)}-01T12:00:00Z`));
  const dateTitle = (key, options = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
  const title = () => st.view === 'month' ? monthTitle()
    : st.view === 'day' ? dateTitle(st.anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : `${dateTitle(range().from)} – ${dateTitle(range().to)}`;

  function shift(dir) {
    if (st.view === 'month') {
      const year = Number(st.anchor.slice(0, 4)); const month = Number(st.anchor.slice(5, 7)) - 1 + dir;
      const day = Number(st.anchor.slice(8)); const target = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(day, lastDay));
      st.anchor = target.toISOString().slice(0, 10);
    } else st.anchor = addDays(st.anchor, st.view === 'week' ? 7 * dir : dir);
    load();
  }

  function showEvent(ev) {
    const typeName = { assignment: 'Assignment', class: 'Class', exam: 'Exam', study: 'Study Session' };
    const rows = [h('p', {}, h('strong', {}, ev.title)), h('p', { class: 'muted' }, badge(typeName[ev.type], ''), ' ',
      ev.end ? `${fmtDateTime(ev.start)} – ${fmtTime(ev.end)}` : fmtDateTime(ev.start))];
    const m = ev.meta ?? {};
    if (m.subject) rows.push(h('p', {}, `Subject: ${m.subject}`)); if (m.priority) rows.push(h('p', {}, `Priority: ${m.priority}`));
    if (m.status) rows.push(h('p', {}, `Status: ${m.status.replace('_', ' ')}`)); if (m.lecturer) rows.push(h('p', {}, `Lecturer: ${m.lecturer}`));
    if (m.location) rows.push(h('p', {}, `Location: ${m.location}`)); if (m.venue) rows.push(h('p', {}, `Venue: ${m.venue}`));
    const dlg = openModal({ title: 'Event details', body: h('div', {}, ...rows,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { dlg.close(); navigate(TYPE_PAGE[ev.type]); } }, 'Open'))) });
  }
  const chip = (ev) => h('button', { class: `ev ${ev.type} ${ev.meta?.overdue ? 'overdue' : ''}`, type: 'button', title: ev.title, onclick: () => showEvent(ev) },
    h('span', { class: 'ev-title' }, icon(TYPE_ICON[ev.type]), ev.title),
    h('span', { class: 'ev-time' }, ev.end ? `${fmtTime(ev.start)} – ${fmtTime(ev.end)}` : fmtTime(ev.start)));

  function eventDay(events, key, className = '') {
    const list = events.get(key) ?? [];
    return h('div', { class: `day ${className} ${key === todayKey() ? 'today' : ''}` },
      h('span', { class: 'num' }, Number(key.slice(8))),
      ...list.slice(0, 3).map(chip),
      list.length > 3 ? h('button', { class: 'more', type: 'button', onclick: () => { st.view = 'day'; st.anchor = key; load(); } }, `+${list.length - 3} more`) : null);
  }

  function draw(events) {
    const by = new Map();
    for (const event of events) {
      const key = dayKey(event.start);
      (by.get(key) ?? by.set(key, []).get(key)).push(event);
    }
    const { from, to } = range();
    const names = Array.from({ length: 7 }, (_, i) => DAYS_SHORT[(weekStart() + i) % 7]);
    if (st.view === 'month') {
      const cells = names.map((name) => h('div', { class: 'dow' }, name));
      for (let key = from; key <= to; key = addDays(key, 1)) {
        cells.push(eventDay(by, key, key.slice(0, 7) !== st.anchor.slice(0, 7) ? 'other' : ''));
      }
      mount(body, h('div', { class: 'month', role: 'group', 'aria-label': `${monthTitle()} calendar` }, ...cells));
    } else if (st.view === 'day') {
      const dayEvents = by.get(st.anchor) ?? [];
      mount(body, h('section', { class: `calendar-day-view ${st.anchor === todayKey() ? 'today' : ''}`, 'aria-label': st.anchor },
        dayEvents.length ? dayEvents.map(chip) : h('div', { class: 'calendar-no-events' },
          h('span', { class: 'calendar-empty-icon' }, icon('calendar')),
          h('strong', {}, 'Nothing scheduled'),
          h('span', { class: 'muted small' }, 'Enjoy the open time or add something to your schedule.'))));
    } else {
      const cols = [];
      for (let i = 0; i < 7; i++) {
        const key = addDays(from, i); const list = by.get(key) ?? [];
        cols.push(h('section', { class: `col ${key === todayKey() ? 'today' : ''}`, 'aria-label': key },
          h('h4', {}, dateTitle(key, { weekday: 'long', day: 'numeric', month: 'short' })),
          list.length ? list.map(chip) : h('span', { class: 'muted small' }, 'Nothing scheduled')));
      }
      mount(body, h('div', { class: 'week' }, ...cols));
    }
  }

  function renderUpcoming(events) {
    const today = todayKey();
    const next = events.filter((event) => dayKey(event.start) >= today).slice(0, 5);
    mount(upcoming, next.length ? h('ul', { class: 'calendar-upcoming' }, next.map((event) => {
      const key = dayKey(event.start);
      return h('li', {},
        h('span', { class: 'upcoming-date' }, h('strong', {}, key.slice(8)), h('span', {}, dateTitle(key, { month: 'short' }))),
        h('button', { class: `upcoming-event ${event.type}`, type: 'button', onclick: () => showEvent(event) },
          h('span', { class: 'upcoming-event-title' }, event.title),
          h('span', { class: 'muted small' }, event.end ? `${fmtTime(event.start)} – ${fmtTime(event.end)}` : fmtTime(event.start))));
    })) : h('div', { class: 'calendar-upcoming-empty' }, 'No upcoming events.'));
  }

  const head = h('div', { class: 'cal-head' });
  const mainPanel = h('section', { class: 'card calendar-panel', 'aria-label': 'Calendar events' });
  const upcomingPanel = h('section', { class: 'card calendar-side-card', 'aria-labelledby': 'calendar-upcoming-heading' },
    h('div', { class: 'calendar-side-heading' }, icon('calendar'), h('h3', { id: 'calendar-upcoming-heading' }, 'Upcoming Events'),
      h('button', { class: 'calendar-view-all', type: 'button', onclick: () => { st.anchor = todayKey(); st.view = 'month'; load(); } }, 'View all', icon('right'))), upcoming);
  const legendPanel = h('section', { class: 'card calendar-side-card', 'aria-labelledby': 'calendar-legend-heading' },
    h('div', { class: 'calendar-side-heading' }, icon('palette'), h('h3', { id: 'calendar-legend-heading' }, 'Event Legend')),
    h('ul', { class: 'calendar-legend' }, TYPES.map((type) =>
      h('li', {}, h('span', { class: `dot ${type}` }), TYPE_LABEL[type]))));

  function renderHead() {
    mount(head,
      pageLayout ? h('div', { class: 'calendar-page-title' },
        h('span', { class: 'calendar-page-icon' }, icon('calendar')),
        h('div', {}, h('h2', {}, 'Calendar'), h('p', { class: 'muted small' }, 'Manage your schedule, classes and important dates'))) : null,
      h('div', { class: 'cal-controls' },
        h('div', { class: 'cal-navigation' },
          h('button', { class: 'btn btn-sm btn-icon', type: 'button', 'aria-label': 'Previous', onclick: () => shift(-1) }, icon('left')),
          h('button', { class: 'btn btn-sm cal-today', type: 'button', onclick: () => { st.anchor = todayKey(); load(); } }, 'Today'),
          h('button', { class: 'btn btn-sm btn-icon', type: 'button', 'aria-label': 'Next', onclick: () => shift(1) }, icon('right'))),
        h('div', { class: 'segmented cal-view-toggle', role: 'group', 'aria-label': 'Calendar view' },
          ['month', 'week', 'day'].map((view) => h('button', { type: 'button', 'aria-pressed': String(st.view === view), onclick: () => { st.view = view; load(); } }, view[0].toUpperCase() + view.slice(1)))),
      ),
    );
    mount(mainPanel, h('div', { class: 'calendar-panel-heading' }, icon('calendar'), h('h3', { class: 'cal-title', 'aria-live': 'polite' }, title())),
      showFilters ? h('div', { class: 'calendar-filters', role: 'group', 'aria-label': 'Show event types' }, types.map((type) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.enabled.has(type)),
          onclick: () => { if (st.enabled.has(type) && st.enabled.size > 1) st.enabled.delete(type); else st.enabled.add(type); load(); } },
          h('span', { class: `dot ${type}` }), TYPE_LABEL[type]))) : null,
      body);
  }

  let myToken = 0;
  async function load() {
    myToken = ++st.token;
    renderHead();
    mount(body, loading());
    mount(upcoming, loading());
    const { from, to } = range();
    const params = qs({ from, to, types: [...st.enabled].join(',') });
    const upcomingParams = qs({ from: todayKey(), to: addDays(todayKey(), 30), types: [...st.enabled].join(',') });
    const calendarRequest = get(`/calendar/events${params}`);
    const upcomingRequest = pageLayout ? get(`/calendar/events${upcomingParams}`) : null;
    try {
      const response = await calendarRequest;
      if (myToken === st.token) draw(response.data);
    } catch (err) {
      if (myToken === st.token) mount(body, errorState(err, load));
    }
    if (upcomingRequest) {
      try {
        const response = await upcomingRequest;
        if (myToken === st.token) renderUpcoming(response.data);
      } catch (err) {
        if (myToken === st.token) mount(upcoming, errorState(err, load));
      }
    }
  }

  root.append(head, pageLayout
    ? h('div', { class: 'calendar-layout' }, mainPanel, h('aside', { class: 'calendar-sidebar' }, upcomingPanel, legendPanel))
    : h('div', { class: 'calendar-embedded' }, mainPanel));
  load();
  return root;
}
