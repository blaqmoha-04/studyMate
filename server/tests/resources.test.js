import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, resetDb, signup, inDays, inHours, client, PASSWORD } from './helpers.js';

let built; let app; let db;
before(() => { built = makeApp(); app = built.app; db = built.ctx.db; });
after(() => built.close());
beforeEach(() => resetDb(db));

describe('assignments', () => {
  it('supports full CRUD with consistent status/completedAt', async () => {
    const u = await signup(app);
    const created = await u.post('/assignments', { title: 'Essay', subject: 'History', priority: 'high', dueAt: inDays(3), estimatedMinutes: 90 });
    assert.equal(created.status, 201);
    const a = created.body.data;
    assert.equal(a.status, 'todo'); assert.equal(a.completedAt, null); assert.equal(a.isOverdue, false);
    assert.equal(a.userId, undefined);

    assert.equal((await u.get(`/assignments/${a.id}`)).body.data.title, 'Essay');
    const edited = await u.patch(`/assignments/${a.id}`, { title: 'Essay v2', priority: 'urgent', description: 'draft' });
    assert.equal(edited.body.data.priority, 'urgent');

    const done = await u.post(`/assignments/${a.id}/complete`);
    assert.equal(done.body.data.status, 'completed'); assert.ok(done.body.data.completedAt);
    const reopened = await u.patch(`/assignments/${a.id}`, { status: 'in_progress' });
    assert.equal(reopened.body.data.completedAt, null);

    assert.equal((await u.delete(`/assignments/${a.id}`)).status, 204);
    assert.equal((await u.get(`/assignments/${a.id}`)).status, 404);
  });

  it('validates input: bad dates, enums, unknown fields, ranges', async () => {
    const u = await signup(app);
    const cases = [
      { title: '', dueAt: inDays(1) },
      { title: 'x', dueAt: 'tomorrow' },
      { title: 'x', dueAt: '2026-13-45T00:00:00Z' },
      { title: 'x', dueAt: '1999-01-01T00:00:00Z' },
      { title: 'x', dueAt: inDays(1), priority: 'critical' },
      { title: 'x', dueAt: inDays(1), status: 'done' },
      { title: 'x', dueAt: inDays(1), estimatedMinutes: 0 },
      { title: 'x', dueAt: inDays(1), userId: '00000000-0000-0000-0000-000000000000' },
      { title: 'x'.repeat(201), dueAt: inDays(1) },
    ];
    for (const body of cases) {
      const res = await u.post('/assignments', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'validation_error');
    }
    assert.equal((await u.patch('/assignments/not-a-uuid', { title: 'x' })).status, 400);
    const ok = (await u.post('/assignments', { title: 'ok', dueAt: inDays(1) })).body.data;
    assert.equal((await u.patch(`/assignments/${ok.id}`, {})).status, 400);
  });

  it('filters, searches, sorts and paginates', async () => {
    const u = await signup(app);
    const mk = (b) => u.post('/assignments', b);
    await mk({ title: 'Physics lab', subject: 'Physics', priority: 'low', dueAt: inDays(5) });
    await mk({ title: 'Maths 100% set', subject: 'Maths', priority: 'urgent', dueAt: inDays(1) });
    await mk({ title: 'Late report', subject: 'Physics', priority: 'high', dueAt: inDays(-2) });
    await mk({ title: 'Finished', subject: 'Maths', priority: 'medium', dueAt: inDays(2), status: 'completed' });

    const byDue = (await u.get('/assignments?sort=due')).body.data.map((x) => x.title);
    assert.deepEqual(byDue, ['Late report', 'Maths 100% set', 'Finished', 'Physics lab']);
    const byPrio = (await u.get('/assignments?sort=priority&order=desc')).body.data.map((x) => x.priority);
    assert.deepEqual(byPrio, ['urgent', 'high', 'medium', 'low']);
    assert.equal((await u.get('/assignments?subject=physics')).body.meta.total, 2);
    assert.equal((await u.get('/assignments?status=completed')).body.meta.total, 1);
    assert.equal((await u.get('/assignments?priority=urgent')).body.meta.total, 1);
    const overdue = (await u.get('/assignments?overdue=true')).body.data;
    assert.deepEqual(overdue.map((x) => x.title), ['Late report']); assert.equal(overdue[0].isOverdue, true);
    assert.equal((await u.get('/assignments?q=100%25')).body.meta.total, 1);      // % is literal, not a wildcard
    assert.equal((await u.get('/assignments?q=%25')).body.meta.total, 1);
    assert.equal((await u.get('/assignments?q=zzz')).body.meta.total, 0);
    const page2 = await u.get('/assignments?pageSize=2&page=2');
    assert.equal(page2.body.data.length, 2); assert.equal(page2.body.meta.totalPages, 2);
    assert.equal((await u.get('/assignments?pageSize=1000')).status, 400);
    assert.equal((await u.get(`/assignments?dueFrom=${encodeURIComponent(inDays(0))}&dueTo=${encodeURIComponent(inDays(3))}`)).body.meta.total, 2);
  });
});

describe('class timetable', () => {
  it('CRUD, time validation, conflict warnings and today view', async () => {
    const u = await signup(app);
    const base = { subject: 'Calculus', lecturer: 'Dr A', location: 'Room 4', dayOfWeek: 1, startTime: '09:00', endTime: '10:30', color: '#ff0000' };
    const c1 = await u.post('/classes', base);
    assert.equal(c1.status, 201); assert.deepEqual(c1.body.meta.warnings, []);
    assert.equal(c1.body.data.startTime, '09:00');

    const overlap = await u.post('/classes', { ...base, subject: 'Clash', startTime: '10:00', endTime: '11:00' });
    assert.equal(overlap.status, 201); assert.equal(overlap.body.meta.warnings.length, 1);
    assert.equal(overlap.body.meta.warnings[0].subject, 'Calculus');
    const adjacent = await u.post('/classes', { ...base, subject: 'Next', startTime: '11:00', endTime: '12:00' });
    assert.deepEqual(adjacent.body.meta.warnings, []);          // touching is not overlapping
    const otherDay = await u.post('/classes', { ...base, dayOfWeek: 2 });
    assert.deepEqual(otherDay.body.meta.warnings, []);

    const list = await u.get('/classes');
    assert.equal(list.body.data.filter((c) => c.hasConflict).length, 2);
    assert.equal(list.body.meta.conflicts.length, 1);

    assert.equal((await u.post('/classes', { ...base, endTime: '08:00' })).status, 400);
    assert.equal((await u.post('/classes', { ...base, startTime: '9:00' })).status, 400);
    assert.equal((await u.post('/classes', { ...base, dayOfWeek: 7 })).status, 400);
    assert.equal((await u.post('/classes', { ...base, color: 'red' })).status, 400);
    const bad = await u.patch(`/classes/${c1.body.data.id}`, { endTime: '08:00' });
    assert.equal(bad.status, 400);

    const upd = await u.patch(`/classes/${c1.body.data.id}`, { location: 'Hall 2', endTime: '10:15' });
    assert.equal(upd.body.data.location, 'Hall 2'); assert.deepEqual(upd.body.meta.warnings.length, 1);

    // "today" uses the user's local weekday
    const dow = (await u.get('/dashboard')).body.data.today;
    const weekday = new Date(`${dow}T12:00:00Z`).getUTCDay();
    await u.post('/classes', { ...base, subject: 'Today class', dayOfWeek: weekday, startTime: '14:00', endTime: '15:00' });
    const today = (await u.get('/classes/today')).body.data;
    assert.ok(today.some((c) => c.subject === 'Today class'));
    assert.equal((await u.delete(`/classes/${c1.body.data.id}`)).status, 204);
    assert.equal((await u.get(`/classes/${c1.body.data.id}`)).status, 404);
  });
});

describe('notes', () => {
  it('CRUD, search, pinning, tags and safe storage of hostile content', async () => {
    const u = await signup(app);
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const n1 = (await u.post('/notes', { title: xss, subject: 'Bio', content: 'Cells & <b>membranes</b>', tags: ['Exam', 'exam', 'cells'] })).body.data;
    assert.deepEqual(n1.tags, ['exam', 'cells']);       // normalised + de-duplicated
    assert.equal(n1.title, xss);                         // stored verbatim; the client renders it as text only
    const n2 = (await u.post('/notes', { title: 'Chem', subject: 'Chem', content: 'moles', pinned: true })).body.data;

    const list = (await u.get('/notes')).body.data;
    assert.equal(list[0].id, n2.id);                     // pinned first
    assert.equal(list[0].content, undefined); assert.ok(list[0].preview !== undefined);
    assert.equal((await u.get('/notes?q=membranes')).body.meta.total, 1);
    assert.equal((await u.get('/notes?tag=CELLS')).body.meta.total, 1);
    assert.equal((await u.get('/notes?subject=chem&pinned=true')).body.meta.total, 1);
    const meta = (await u.get('/notes/meta')).body.data;
    assert.deepEqual(meta.subjects, ['Bio', 'Chem']);

    const full = (await u.get(`/notes/${n1.id}`)).body.data;
    assert.equal(full.content, 'Cells & <b>membranes</b>');

    assert.equal((await u.post('/notes', { title: '' })).status, 400);
    assert.equal((await u.post('/notes', { title: 't', content: 'x'.repeat(100001) })).status, 400);
    assert.equal((await u.post('/notes', { title: 't', tags: Array(21).fill('a').map((a, i) => a + i) })).status, 400);

    const saved = await u.patch(`/notes/${n1.id}`, { content: 'v2', baseUpdatedAt: full.updatedAt });
    assert.equal(saved.status, 200);
    // Stale autosave (another tab saved first) is rejected instead of silently overwriting.
    const stale = await u.patch(`/notes/${n1.id}`, { content: 'v3-from-stale-tab', baseUpdatedAt: full.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.details.current.content, 'v2');
    assert.equal((await u.patch(`/notes/${n1.id}`, { content: 'v3', baseUpdatedAt: saved.body.data.updatedAt })).status, 200);

    assert.equal((await u.delete(`/notes/${n1.id}`)).status, 204);
    assert.equal((await u.get(`/notes/${n1.id}`)).status, 404);
  });
});

describe('exams', () => {
  it('CRUD, upcoming/past lists, countdown and linked study plan', async () => {
    const u = await signup(app);
    const up = (await u.post('/exams', { subject: 'Maths', title: 'Final', examAt: inDays(10), venue: 'Hall A' })).body.data;
    await u.post('/exams', { subject: 'Maths', title: 'Midterm', examAt: inDays(-10) });
    assert.ok(up.secondsUntil > 9 * 86400 && up.secondsUntil < 11 * 86400);
    assert.deepEqual((await u.get('/exams')).body.data.map((e) => e.title), ['Final']);
    assert.deepEqual((await u.get('/exams?when=past')).body.data.map((e) => e.title), ['Midterm']);
    assert.equal((await u.get('/exams?when=all')).body.meta.total, 2);

    const plan = await u.post('/study-sessions/plan', { subject: 'Maths', plannedStart: inDays(2), plannedMinutes: 60, examId: up.id });
    assert.equal(plan.status, 201);
    const detail = (await u.get(`/exams/${up.id}`)).body.data;
    assert.equal(detail.studyPlan.length, 1); assert.equal(detail.studyPlan[0].examId, up.id);

    assert.equal((await u.patch(`/exams/${up.id}`, { venue: 'Hall B', notes: 'bring calculator' })).body.data.venue, 'Hall B');
    assert.equal((await u.post('/exams', { subject: '', title: 'x', examAt: inDays(1) })).status, 400);
    assert.equal((await u.delete(`/exams/${up.id}`)).status, 204);
    // Deleting the exam keeps the study session but unlinks it.
    const { rows } = await db.query('SELECT exam_id FROM study_sessions');
    assert.equal(rows[0].exam_id, null);
  });
});

describe('study sessions and focus timer', () => {
  it('records time from SERVER timestamps across start/pause/resume/complete', async () => {
    const u = await signup(app);
    const started = await u.post('/study-sessions/start', { subject: 'Physics', focusMinutes: 50, breakMinutes: 10 });
    assert.equal(started.status, 201);
    const id = started.body.data.id;
    assert.equal(started.body.data.status, 'running'); assert.ok(started.body.data.elapsedSeconds <= 2);

    // Only one active timer per user.
    assert.equal((await u.post('/study-sessions/start', {})).status, 409);
    assert.equal((await u.get('/study-sessions/active')).body.data.id, id);

    // Simulate 10 minutes of focus having passed on the server clock.
    await db.query(`UPDATE study_sessions SET last_resumed_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
    const paused = (await u.post(`/study-sessions/${id}/pause`)).body.data;
    assert.equal(paused.status, 'paused');
    assert.ok(paused.accumulatedSeconds >= 600 && paused.accumulatedSeconds <= 602, paused.accumulatedSeconds);
    assert.equal((await u.post(`/study-sessions/${id}/pause`)).status, 409);   // can't pause twice

    // Time spent paused is NOT counted.
    await db.query(`UPDATE study_sessions SET updated_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    assert.ok((await u.get(`/study-sessions/${id}`)).body.data.elapsedSeconds <= 602);

    assert.equal((await u.post(`/study-sessions/${id}/resume`)).body.data.status, 'running');
    await db.query(`UPDATE study_sessions SET last_resumed_at = now() - interval '5 minutes' WHERE id = $1`, [id]);
    const done = (await u.post(`/study-sessions/${id}/complete`)).body.data;
    assert.equal(done.status, 'completed');
    assert.ok(done.actualSeconds >= 900 && done.actualSeconds <= 903, done.actualSeconds);
    assert.ok(done.endedAt);
    assert.equal((await u.post(`/study-sessions/${id}/complete`)).status, 409);
    assert.equal((await u.get('/study-sessions/active')).body.data, null);

    const stats = (await u.get('/study-sessions/stats')).body.data;
    assert.ok(stats.week >= 900 && stats.today >= 900);
    assert.equal(stats.days.length, 7);
    assert.equal(stats.bySubject[0].subject, 'Physics');
    assert.equal(stats.allTime.sessions, 1);
    const hist = (await u.get('/study-sessions?status=completed')).body;
    assert.equal(hist.meta.total, 1);
  });

  it('caps a forgotten timer at 12 hours and supports plan -> start -> cancel flows', async () => {
    const u = await signup(app);
    const id = (await u.post('/study-sessions/start', { subject: 'Left running' })).body.data.id;
    await db.query(`UPDATE study_sessions SET last_resumed_at = now() - interval '30 hours' WHERE id = $1`, [id]);
    assert.equal((await u.post(`/study-sessions/${id}/complete`)).body.data.actualSeconds, 12 * 3600);

    const planned = (await u.post('/study-sessions/plan', { subject: 'Chem', plannedStart: inHours(5), plannedMinutes: 45 })).body.data;
    assert.equal((await u.patch(`/study-sessions/${planned.id}`, { plannedMinutes: 30 })).body.data.plannedMinutes, 30);
    const run = (await u.post('/study-sessions/start', { fromPlannedId: planned.id })).body.data;
    assert.equal(run.id, planned.id); assert.equal(run.status, 'running');
    assert.equal((await u.patch(`/study-sessions/${planned.id}`, { plannedMinutes: 20 })).status, 409); // no longer planned
    assert.equal((await u.delete(`/study-sessions/${planned.id}`)).status, 409);                          // active
    assert.equal((await u.post(`/study-sessions/${planned.id}/cancel`)).body.data.status, 'cancelled');
    assert.equal((await u.delete(`/study-sessions/${planned.id}`)).status, 204);
    assert.equal((await u.post('/study-sessions/plan', { plannedStart: inHours(1), plannedMinutes: 0 })).status, 400);
    assert.equal((await u.post('/study-sessions/start', { focusMinutes: 500 })).status, 400);
  });

  it('links to assignments the user owns', async () => {
    const u = await signup(app);
    const a = (await u.post('/assignments', { title: 'HW', dueAt: inDays(2) })).body.data;
    const s = await u.post('/study-sessions/start', { assignmentId: a.id });
    assert.equal(s.body.data.assignmentId, a.id);
    assert.equal((await u.post('/study-sessions/start', { assignmentId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  });
});

describe('calendar', () => {
  it('returns assignments, exams, planned study and expanded weekly classes with filters', async () => {
    const u = await signup(app);
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    await u.post('/assignments', { title: 'HW', dueAt: inDays(1) });
    await u.post('/exams', { subject: 'Maths', title: 'Final', examAt: inDays(2) });
    await u.post('/study-sessions/plan', { subject: 'Maths', plannedStart: inDays(1), plannedMinutes: 60 });
    await u.post('/classes', { subject: 'Weekly', dayOfWeek: 3, startTime: '09:00', endTime: '10:00' });

    const res = await u.get(`/calendar/events?from=${day(-1)}&to=${day(14)}`);
    assert.equal(res.status, 200);
    const types = res.body.data.map((e) => e.type);
    for (const t of ['assignment', 'exam', 'study']) assert.ok(types.includes(t), t);
    assert.ok(types.filter((t) => t === 'class').length >= 2);   // recurring: 2 Wednesdays in 16 days
    const only = await u.get(`/calendar/events?from=${day(-1)}&to=${day(14)}&types=exam,class`);
    assert.ok(only.body.data.every((e) => ['exam', 'class'].includes(e.type)));
    const sorted = res.body.data.map((e) => +new Date(e.start)); assert.deepEqual(sorted, [...sorted].sort((a, b) => a - b));
    assert.equal((await u.get(`/calendar/events?from=${day(5)}&to=${day(1)}`)).status, 400);
    assert.equal((await u.get(`/calendar/events?from=${day(0)}&to=${day(200)}`)).status, 400);
    assert.equal((await u.get('/calendar/events?from=x&to=y')).status, 400);
    assert.equal((await u.get(`/calendar/events?from=${day(0)}&to=${day(1)}&types=bogus`)).status, 400);
  });
});

describe('notifications', () => {
  it('creates reminders from real records without duplicates, with read/dismiss states', async () => {
    const u = await signup(app);
    const due = (await u.post('/assignments', { title: 'Due tomorrow', dueAt: inHours(20) })).body.data;
    await u.post('/assignments', { title: 'Way later', dueAt: inDays(30) });
    await u.post('/assignments', { title: 'Already late', dueAt: inDays(-1) });
    await u.post('/exams', { subject: 'Bio', title: 'Quiz', examAt: inDays(3) });
    await u.post('/study-sessions/plan', { subject: 'Bio', plannedStart: inHours(0.5), plannedMinutes: 30 });

    const first = await u.get('/notifications');
    const types = first.body.data.map((n) => n.type).sort();
    assert.deepEqual(types, ['assignment_due', 'assignment_overdue', 'exam_upcoming', 'study_reminder']);
    assert.equal(first.body.meta.unread, 4);
    await u.get('/notifications'); await u.get('/notifications/unread-count');
    assert.equal((await u.get('/notifications')).body.meta.total, 4);               // no duplicates

    const n = first.body.data[0];
    assert.ok((await u.post(`/notifications/${n.id}/read`)).body.data.readAt);
    assert.equal((await u.get('/notifications/unread-count')).body.data.unread, 3);
    assert.equal((await u.get('/notifications?unread=true')).body.meta.total, 3);
    assert.equal((await u.post('/notifications/read-all')).body.data.updated, 3);
    assert.equal((await u.delete(`/notifications/${n.id}`)).status, 204);
    assert.equal((await u.get('/notifications')).body.meta.total, 3);
    await u.get('/notifications');
    assert.equal((await u.get('/notifications')).body.meta.total, 3);               // dismissed one is not regenerated

    // Completing an assignment dismisses its reminder.
    await u.post(`/assignments/${due.id}/complete`);
    assert.ok(!(await u.get('/notifications')).body.data.some((x) => x.entityId === due.id));
  });

  it('respects notification preferences', async () => {
    const u = await signup(app);
    await u.patch('/me/preferences', { notifications: { deadlines: false, exams: false, study: false } });
    await u.post('/assignments', { title: 'Due soon', dueAt: inHours(5) });
    await u.post('/exams', { subject: 'X', title: 'Y', examAt: inDays(2) });
    assert.equal((await u.get('/notifications')).body.meta.total, 0);
  });
});

describe('dashboard', () => {
  it('is empty for a new user and reflects only real records afterwards', async () => {
    const u = await signup(app);
    const empty = (await u.get('/dashboard')).body.data;
    assert.equal(empty.pendingAssignments, 0); assert.equal(empty.studySecondsThisWeek, 0);
    assert.deepEqual(empty.upcomingDeadlines, []); assert.deepEqual(empty.recentActivity, []);

    await u.post('/assignments', { title: 'A', dueAt: inDays(2) });
    await u.post('/assignments', { title: 'B', dueAt: inDays(-1) });
    await u.post('/assignments', { title: 'C', dueAt: inDays(1), status: 'completed' });
    await u.post('/exams', { subject: 'S', title: 'E', examAt: inDays(4) });
    await u.post('/notes', { title: 'N' });
    await u.post('/classes', { subject: 'Class activity', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
    const sid = (await u.post('/study-sessions/start', { subject: 'S' })).body.data.id;
    await db.query(`UPDATE study_sessions SET last_resumed_at = now() - interval '1 hour' WHERE id = $1`, [sid]);
    await u.post(`/study-sessions/${sid}/complete`);

    const d = (await u.get('/dashboard')).body.data;
    assert.equal(d.pendingAssignments, 2); assert.equal(d.overdueAssignments, 1);
    assert.equal(d.completedAssignments, 1); assert.equal(d.upcomingExams, 1);
    assert.ok(d.studySecondsThisWeek >= 3600);
    assert.equal(d.upcomingDeadlines.length, 1); assert.equal(d.upcomingDeadlines[0].title, 'A');
    assert.ok(d.recentActivity.length >= 4);
    assert.ok(d.recentActivity.some((activity) => activity.kind === 'class' && activity.action === 'scheduled'));
    assert.ok(d.recentActivity.some((activity) => activity.kind === 'assignment' && activity.action === 'added'));
    assert.ok(d.recentActivity.some((activity) => activity.kind === 'note' && activity.action === 'added'));
  });

  it("uses the user's own time zone for 'today'", async () => {
    const u = await signup(app);
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      await u.patch('/me/preferences', { timezone: tz });
      const expected = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      assert.equal((await u.get('/dashboard')).body.data.today, expected, tz);
    }
    assert.equal((await u.patch('/me/preferences', { timezone: 'Mars/Olympus' })).status, 400);
    assert.equal((await u.patch('/me/preferences', { weekStart: 9 })).status, 400);
  });
});

describe('account: preferences, export and deletion', () => {
  it('updates profile (email change needs password) and preferences', async () => {
    const u = await signup(app, { email: 'p1@example.test' });
    assert.equal((await u.patch('/me/preferences', { theme: 'dark', weekStart: 0 })).body.data.theme, 'dark');
    assert.equal((await u.get('/me')).body.data.weekStart, 0);
    assert.equal((await u.patch('/me', { name: 'New Name' })).body.data.name, 'New Name');
    assert.equal((await u.patch('/me', { email: 'p2@example.test' })).status, 400);
    assert.equal((await u.patch('/me', { email: 'p2@example.test', currentPassword: 'bad-password-1' })).status, 400);
    assert.equal((await u.patch('/me', { email: 'p2@example.test', currentPassword: PASSWORD })).body.data.email, 'p2@example.test');
    await signup(app, { email: 'taken@example.test' });
    assert.equal((await u.patch('/me', { email: 'taken@example.test', currentPassword: PASSWORD })).status, 409);
  });

  it('stores an optional learning goal that can be edited and cleared', async () => {
    const u = await signup(app);
    assert.equal((await u.get('/me')).body.data.learningGoal, '');
    assert.equal((await u.patch('/me', { learningGoal: 'Pass my finals with distinction' })).body.data.learningGoal, 'Pass my finals with distinction');
    assert.equal((await u.get('/me')).body.data.learningGoal, 'Pass my finals with distinction');
    assert.equal((await u.patch('/me', { learningGoal: '' })).body.data.learningGoal, '');
    assert.equal((await u.patch('/me', { learningGoal: 'x'.repeat(501) })).status, 400);
  });

  it('"reset progress" needs password + RESET, clears only finished work and history, and never touches other users', async () => {
    const a = await signup(app, { email: 'rp-a@example.test' }); const b = await signup(app, { email: 'rp-b@example.test' });
    for (const u of [a, b]) {
      await u.post('/assignments', { title: 'done', dueAt: inDays(1), status: 'completed' }); await u.post('/assignments', { title: 'open', dueAt: inDays(2) });
      await u.post('/notes', { title: 'keep me' }); await u.post('/exams', { subject: 's', title: 'e', examAt: inDays(3) });
      await u.post('/classes', { subject: 'c', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
      const sid = (await u.post('/study-sessions/start', {})).body.data.id; await u.post(`/study-sessions/${sid}/complete`);
      await u.post('/study-sessions/plan', { plannedStart: inDays(1), plannedMinutes: 30 }); await u.get('/notifications');
    }
    assert.equal((await a.post('/me/reset-progress', { password: PASSWORD })).status, 400);
    assert.equal((await a.post('/me/reset-progress', { password: 'wrong-password-1', confirm: 'RESET' })).status, 400);
    assert.equal((await a.get('/assignments')).body.meta.total, 2);                      // nothing happened yet
    const res = await a.post('/me/reset-progress', { password: PASSWORD, confirm: 'RESET' });
    assert.equal(res.status, 200); assert.equal(res.body.data.completedAssignmentsDeleted, 1); assert.equal(res.body.data.studySessionsDeleted, 1);
    assert.deepEqual((await a.get('/assignments')).body.data.map((x) => x.title), ['open']);
    assert.equal((await a.get('/study-sessions?status=completed')).body.meta.total, 0);
    assert.equal((await a.get('/study-sessions?status=planned')).body.meta.total, 1);    // plans are kept
    assert.equal((await a.get('/notes')).body.meta.total, 1); assert.equal((await a.get('/exams')).body.meta.total, 1); assert.equal((await a.get('/classes')).body.data.length, 1);
    assert.equal((await a.get('/me')).status, 200);                                       // still signed in, account intact
    assert.equal((await b.get('/assignments')).body.meta.total, 2);                      // other user untouched
    assert.equal((await b.get('/study-sessions?status=completed')).body.meta.total, 1);
  });

  it('exports all personal data as JSON without secrets', async () => {
    const u = await signup(app);
    await u.post('/assignments', { title: 'Mine', dueAt: inDays(1) });
    await u.post('/notes', { title: 'My note' });
    const res = await u.get('/me/export');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], /attachment/);
    assert.equal(res.body.assignments.length, 1); assert.equal(res.body.notes.length, 1);
    const text = JSON.stringify(res.body);
    assert.ok(!/password|argon2|token_hash|tokenHash|csrf/i.test(text));
  });

  it('deletes the account and ALL its data only after confirmation + password; other users untouched', async () => {
    const a = await signup(app, { email: 'del@example.test' });
    const b = await signup(app, { email: 'keep@example.test' });
    for (const u of [a, b]) {
      await u.post('/assignments', { title: 'x', dueAt: inDays(1) });
      await u.post('/notes', { title: 'x' });
      await u.post('/exams', { subject: 's', title: 'x', examAt: inDays(1) });
      await u.post('/classes', { subject: 's', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
      await u.post('/study-sessions/start', {});
      await u.get('/notifications');
    }
    assert.equal((await a.delete('/me', { password: PASSWORD })).status, 400);                    // no confirm
    assert.equal((await a.delete('/me', { password: 'wrong-password-1', confirm: 'DELETE' })).status, 400);
    assert.equal((await a.get('/me')).status, 200);                                                  // still exists
    assert.equal((await a.delete('/me', { password: PASSWORD, confirm: 'DELETE' })).status, 204);
    assert.equal((await a.get('/me')).status, 401);
    assert.equal((await client(app).post('/auth/login', { email: 'del@example.test', password: PASSWORD })).status, 401);

    for (const t of ['assignments', 'study_notes', 'exams', 'class_schedules', 'study_sessions', 'notifications', 'sessions']) {
      const { rows } = await db.query(`SELECT user_id FROM ${t}`);
      assert.ok(rows.length >= 1 || t === 'notifications', t);
      assert.ok(rows.every((r) => r.user_id === b.user.id), `${t} still has rows for the deleted user`);
    }
    assert.equal((await b.get('/assignments')).body.meta.total, 1);
  });
});

describe('dictionary and vocabulary', () => {
  it('manages saved vocabulary, recent searches, and audio validation', async () => {
    const u = await signup(app);

    // 1. Vocabulary saving and listing
    const saveRes = await u.post('/dictionary/vocabulary', {
      word: 'Resilient',
      phonetic: '/rɪˈzɪl.jənt/',
      partOfSpeech: 'adjective',
      meanings: [{ definition: 'Able to recover quickly' }],
      audioUrl: 'https://api.dictionaryapi.dev/media/pronunciations/en/resilient-us.mp3',
    });
    assert.equal(saveRes.status, 201);
    assert.equal(saveRes.body.data.word, 'Resilient');
    assert.equal(saveRes.body.data.normalizedWord, 'resilient');
    const vocabId = saveRes.body.data.id;

    // List vocabulary
    const listRes = await u.get('/dictionary/vocabulary');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.length, 1);
    assert.equal(listRes.body.data[0].id, vocabId);

    // Filter vocabulary
    const filterRes = await u.get('/dictionary/vocabulary?q=resil');
    assert.equal(filterRes.body.data.length, 1);
    const emptyFilter = await u.get('/dictionary/vocabulary?q=nonexistent');
    assert.equal(emptyFilter.body.data.length, 0);

    // Get single vocabulary entry
    const getRes = await u.get(`/dictionary/vocabulary/${vocabId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.word, 'Resilient');

    // 2. Lookup and search history
    const lookupRes = await u.get('/dictionary/lookup?word=hello');
    assert.equal(lookupRes.status, 200);
    assert.equal(lookupRes.body.data.word.toLowerCase(), 'hello');

    // Recent searches
    const recentRes = await u.get('/dictionary/recent');
    assert.equal(recentRes.status, 200);
    assert.ok(recentRes.body.data.some((s) => s.word.toLowerCase() === 'hello'));

    // Clear searches
    assert.equal((await u.delete('/dictionary/recent')).status, 204);
    assert.equal((await u.get('/dictionary/recent')).body.data.length, 0);

    // 3. Audio endpoint validation
    assert.equal((await u.get('/dictionary/audio?url=invalid-url')).status, 400);
    assert.equal((await u.get('/dictionary/audio?url=https://evil.com/malicious.mp3')).status, 400);

    // 4. Daily word
    const dailyRes = await u.get('/dictionary/daily');
    assert.equal(dailyRes.status, 200);
    assert.ok(dailyRes.body.data.word);

    // 5. Delete vocabulary
    assert.equal((await u.delete(`/dictionary/vocabulary/${vocabId}`)).status, 204);
    assert.equal((await u.get(`/dictionary/vocabulary/${vocabId}`)).status, 404);
  });
});
