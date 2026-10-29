import { h, mount, icon } from '../dom.js';
import { get, post, del, qs, bus } from '../api.js';
import { loading, errorState, emptyState, badge, pager, confirmDialog, toast, toastError } from '../ui.js';
import { fmtDateTime, fmtDuration, fmtClock, todayKey, DAYS_SHORT } from '../time.js';
import { openStudyStartForm, openStudyPlanForm } from '../forms.js';

// The server owns the recorded time. The browser only *displays* a ticking clock anchored to the
// server-reported elapsed seconds, and re-syncs regularly, so closing the tab never loses or invents time.
export function studyPage(container) {
  let active = null; let anchorAt = 0; let tickTimer; let syncTimer; let breakEnd = null; let histPage = 1;
  const timerBox = h('div', {}); const statsBox = h('div', {}); const planBox = h('div', {}); const histBox = h('div', {});

  const elapsedNow = () => (!active ? 0 : active.status === 'running' ? active.elapsedSeconds + (performance.now() - anchorAt) / 1000 : active.elapsedSeconds);
  const setActive = (s) => { active = s; anchorAt = performance.now(); };
  async function act(path) { try { const r = await post(path); return r.data; } catch (e) { toastError(e); return null; } }

  function renderTimer() {
    if (!active) {
      mount(timerBox, h('div', { class: 'card timer-card' }, h('h3', {}, 'Focus timer'),
        breakEnd ? h('div', {}, h('div', { class: 'timer-time', id: 'break-clock', role: 'timer' }, '00:00'), h('p', { class: 'timer-sub' }, 'Break time — step away for a moment.'),
          h('button', { class: 'btn', type: 'button', onclick: () => { breakEnd = null; renderTimer(); } }, 'Skip break'))
        : h('div', {}, h('div', { class: 'timer-time' }, '25:00'), h('p', { class: 'timer-sub' }, 'No active session. Time is recorded on the server when you complete a session.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openStudyStartForm({ onStarted: (s) => { setActive(s); renderTimer(); } }) }, icon('play'), 'Start a session'))));
      if (breakEnd) tick(); return;
    }
    const running = active.status === 'running';
    mount(timerBox, h('div', { class: 'card timer-card' },
      h('h3', {}, active.subject || 'Focus session', ' ', badge(running ? 'Running' : 'Paused', running ? 'success' : 'warning')),
      h('div', { class: 'timer-time', id: 'clock', role: 'timer', 'aria-live': 'off' }, '00:00'),
      h('p', { class: 'timer-sub', id: 'clock-sub' }, ''), h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Focus progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { id: 'bar' })),
      h('div', { class: 'timer-actions' },
        running ? h('button', { class: 'btn', type: 'button', onclick: async () => { const s = await act(`/study-sessions/${active.id}/pause`); if (s) { setActive(s); renderTimer(); } } }, icon('pause'), 'Pause')
          : h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { const s = await act(`/study-sessions/${active.id}/resume`); if (s) { setActive(s); renderTimer(); } } }, icon('play'), 'Resume'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: complete }, icon('check'), 'Complete'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, 'Cancel session'))));
    tick();
  }
  async function complete() {
    const s = await act(`/study-sessions/${active.id}/complete`); if (!s) return;
    toast(`Great work! ${fmtDuration(s.actualSeconds)} recorded.`); const brk = s.breakMinutes; active = null; breakEnd = Date.now() + brk * 60000; renderTimer(); loadStats(); loadHistory(); loadPlans();
  }
  async function cancel() {
    if (!(await confirmDialog({ title: 'Cancel this session?', message: 'The time in this session will not be recorded.', confirmText: 'Cancel session', danger: true }))) return;
    if (await act(`/study-sessions/${active.id}/cancel`)) { active = null; renderTimer(); loadHistory(); }
  }
  function tick() {
    const clock = document.getElementById('clock'); const brk = document.getElementById('break-clock');
    if (brk && breakEnd) { const left = (breakEnd - Date.now()) / 1000; if (left <= 0) { breakEnd = null; toast('Break over — ready for the next session?', 'success'); renderTimer(); } else brk.textContent = fmtClock(left); return; }
    if (!clock || !active) return;
    const goal = active.focusMinutes * 60; const el = elapsedNow(); const left = goal - el;
    clock.textContent = left >= 0 ? fmtClock(left) : `+${fmtClock(-left)}`;
    document.getElementById('clock-sub').textContent = left >= 0 ? `${fmtClock(el)} studied of ${active.focusMinutes} min` : 'Focus goal reached — complete the session or keep going.';
    const pct = Math.min(100, Math.round((el / goal) * 100)); const bar = document.getElementById('bar'); bar.style.width = `${pct}%`; bar.parentElement.setAttribute('aria-valuenow', String(pct));
    document.title = `${clock.textContent} · StudyMate`;
  }
  async function sync() { try { const { data } = await get('/study-sessions/active'); if (!data && !active) return; if (!data || data.id !== active?.id || data.status !== active?.status) { setActive(data); renderTimer(); } else setActive(data); } catch { /* keep ticking locally */ } }

  async function loadStats() {
    try {
      const s = (await get('/study-sessions/stats')).data; const max = Math.max(60, ...s.days.map((d) => d.seconds));
      mount(statsBox, h('section', { class: 'card', 'aria-labelledby': 'st-h' }, h('h3', { id: 'st-h' }, 'Study time'),
        h('div', { class: 'grid grid-stats' }, h('div', { class: 'stat' }, h('span', { class: 'value' }, fmtDuration(s.today)), h('span', { class: 'label' }, 'Today')), h('div', { class: 'stat' }, h('span', { class: 'value' }, fmtDuration(s.week)), h('span', { class: 'label' }, 'This week')), h('div', { class: 'stat' }, h('span', { class: 'value' }, String(s.allTime.sessions)), h('span', { class: 'label' }, 'Sessions completed'))),
        h('div', { class: 'bars', role: 'img', 'aria-label': `Study time per day this week: ${s.days.map((d) => `${DAYS_SHORT[new Date(`${d.date}T12:00:00Z`).getUTCDay()]} ${fmtDuration(d.seconds)}`).join(', ')}` },
          s.days.map((d) => { const bar = h('div', { class: 'bar' }); bar.style.height = `${Math.round((d.seconds / max) * 100)}%`;
            return h('div', { class: `bar-col ${d.date === todayKey() ? 'today' : ''}` }, h('span', { class: 'bar-val' }, d.seconds ? fmtDuration(d.seconds) : ''), bar, h('span', { class: 'bar-label' }, DAYS_SHORT[new Date(`${d.date}T12:00:00Z`).getUTCDay()])); })),
        s.bySubject.length ? h('ul', { class: 'list' }, s.bySubject.map((x) => h('li', {}, h('span', {}, x.subject), h('strong', {}, fmtDuration(x.seconds))))) : h('p', { class: 'muted' }, 'Complete a session to see your stats.')));
    } catch (err) { mount(statsBox, errorState(err, loadStats)); }
  }
  async function loadPlans() {
    try {
      const res = await get('/study-sessions?status=planned&pageSize=50');
      const items = res.data.sort((a, b) => new Date(a.plannedStart) - new Date(b.plannedStart));
      mount(planBox, h('section', { class: 'card', 'aria-labelledby': 'pl-h' }, h('div', { class: 'card-head' }, h('h3', { id: 'pl-h' }, 'Study plan'),
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => openStudyPlanForm({ onSaved: loadPlans }) }, icon('plus'), 'Plan session')),
        items.length ? h('ul', { class: 'list' }, items.map((p) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, p.subject || 'Study session'), h('div', { class: 'muted small' }, `${fmtDateTime(p.plannedStart)} · ${p.plannedMinutes} min`)),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', disabled: Boolean(active), title: active ? 'Finish your active session first' : '', onclick: async () => { try { const r = await post('/study-sessions/start', { fromPlannedId: p.id, focusMinutes: Math.min(240, p.plannedMinutes) }); setActive(r.data); renderTimer(); loadPlans(); } catch (e) { toastError(e); } } }, 'Start'),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': 'Edit plan', onclick: () => openStudyPlanForm({ item: p, onSaved: loadPlans }) }, icon('edit')),
            h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': 'Delete plan', onclick: async () => { try { await del(`/study-sessions/${p.id}`); loadPlans(); } catch (e) { toastError(e); } } }, icon('trash')))))) : h('p', { class: 'muted' }, 'No sessions planned. Plan study blocks to see them on your calendar.')));
    } catch (err) { mount(planBox, errorState(err, loadPlans)); }
  }
  async function loadHistory() {
    try {
      const res = await get(`/study-sessions${qs({ status: 'completed', page: histPage, pageSize: 8 })}`);
      mount(histBox, h('section', { class: 'card', 'aria-labelledby': 'hi-h' }, h('h3', { id: 'hi-h' }, 'History'),
        res.data.length ? h('ul', { class: 'list' }, res.data.map((s) => h('li', {}, h('div', { class: 'grow' }, h('div', { class: 'title' }, s.subject || 'Study session'), h('div', { class: 'muted small' }, fmtDateTime(s.endedAt))), badge(fmtDuration(s.actualSeconds), 'success')))) : emptyState('No completed sessions yet', 'Your recorded study time will show up here.'),
        pager(res.meta, (p) => { histPage = p; loadHistory(); })));
    } catch (err) { mount(histBox, errorState(err, loadHistory)); }
  }

  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Study planner')), h('div', { class: 'grid grid-2' }, h('div', { class: 'grid' }, timerBox, planBox), h('div', { class: 'grid' }, statsBox, histBox)));
  mount(timerBox, loading()); loadStats(); loadPlans(); loadHistory();
  get('/study-sessions/active').then(({ data }) => { if (data) setActive(data); renderTimer(); }).catch((err) => mount(timerBox, errorState(err, () => location.reload())));
  tickTimer = setInterval(tick, 1000); syncTimer = setInterval(sync, 30000);
  const onVis = () => { if (document.visibilityState === 'visible') sync(); }; document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(tickTimer); clearInterval(syncTimer); document.removeEventListener('visibilitychange', onVis); document.title = 'StudyMate'; };
}
