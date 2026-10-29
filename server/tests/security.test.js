import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { makeApp, resetDb, signup, client, inDays, inHours, PASSWORD } from './helpers.js';

let built; let app; let db;
before(() => { built = makeApp(); app = built.app; db = built.ctx.db; });
after(() => built.close());
beforeEach(() => resetDb(db));

const ZERO = '00000000-0000-4000-8000-000000000000';

describe('unauthenticated access', () => {
  const routes = [
    ['get', '/me'], ['patch', '/me', { name: 'x' }], ['patch', '/me/preferences', { theme: 'dark' }], ['get', '/me/export'], ['delete', '/me', { password: 'x', confirm: 'DELETE' }],
    ['get', '/dashboard'], ['get', '/calendar/events?from=2026-01-01&to=2026-01-02'],
    ['get', '/assignments'], ['post', '/assignments', { title: 'x', dueAt: inDays(1) }], ['get', `/assignments/${ZERO}`], ['patch', `/assignments/${ZERO}`, { title: 'x' }], ['post', `/assignments/${ZERO}/complete`], ['delete', `/assignments/${ZERO}`],
    ['get', '/classes'], ['get', '/classes/today'], ['post', '/classes', {}], ['get', `/classes/${ZERO}`], ['patch', `/classes/${ZERO}`, { color: '#000000' }], ['delete', `/classes/${ZERO}`],
    ['get', '/notes'], ['get', '/notes/meta'], ['post', '/notes', { title: 'x' }], ['get', `/notes/${ZERO}`], ['patch', `/notes/${ZERO}`, { title: 'x' }], ['delete', `/notes/${ZERO}`],
    ['get', '/exams'], ['post', '/exams', {}], ['get', `/exams/${ZERO}`], ['patch', `/exams/${ZERO}`, { title: 'x' }], ['delete', `/exams/${ZERO}`],
    ['get', '/study-sessions'], ['get', '/study-sessions/active'], ['get', '/study-sessions/stats'], ['post', '/study-sessions/plan', {}], ['post', '/study-sessions/start', {}],
    ['get', `/study-sessions/${ZERO}`], ['post', `/study-sessions/${ZERO}/pause`], ['post', `/study-sessions/${ZERO}/resume`], ['post', `/study-sessions/${ZERO}/complete`], ['post', `/study-sessions/${ZERO}/cancel`], ['delete', `/study-sessions/${ZERO}`],
    ['get', '/notifications'], ['get', '/notifications/unread-count'], ['post', '/notifications/read-all'], ['post', `/notifications/${ZERO}/read`], ['delete', `/notifications/${ZERO}`],
    ['get', '/dictionary/lookup?word=test'], ['get', '/dictionary/daily'], ['get', '/dictionary/audio?url=https%3A%2F%2Fapi.dictionaryapi.dev%2Ftest.mp3'],
    ['get', '/dictionary/vocabulary'], ['post', '/dictionary/vocabulary', { word: 'test' }], ['get', `/dictionary/vocabulary/${ZERO}`], ['delete', `/dictionary/vocabulary/${ZERO}`],
    ['get', '/dictionary/recent'], ['delete', '/dictionary/recent'],
    ['post', '/auth/logout'], ['post', '/auth/change-password', {}],
  ];
  for (const [method, path, body] of routes) {
    it(`${method.toUpperCase()} ${path.split('?')[0]} -> 401`, async () => {
      const res = await client(app)[method](path, body);
      assert.equal(res.status, 401, `${method} ${path} returned ${res.status}`);
    });
  }
  it('unknown API routes are 404, not 401 or 500', async () => {
    assert.equal((await client(app).get('/definitely-not-a-route')).status, 404);
  });
});

describe('cross-user isolation (User A vs User B)', () => {
  it("B can never read, modify, complete, link to, or delete A's records", async () => {
    const a = await signup(app, { email: 'a@example.test' });
    const b = await signup(app, { email: 'b@example.test' });

    const asg = (await a.post('/assignments', { title: 'A secret', dueAt: inHours(10) })).body.data;
    const cls = (await a.post('/classes', { subject: 'A class', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' })).body.data;
    const note = (await a.post('/notes', { title: 'A diary', content: 'private' })).body.data;
    const exam = (await a.post('/exams', { subject: 'A', title: 'A exam', examAt: inDays(2) })).body.data;
    const ses = (await a.post('/study-sessions/start', { subject: 'A study' })).body.data;
    const planned = (await a.post('/study-sessions/plan', { plannedStart: inHours(1), plannedMinutes: 30 })).body.data;
    const notif = (await a.get('/notifications')).body.data[0];
    assert.ok(notif, 'A should have a notification');
    const vocab = (await a.post('/dictionary/vocabulary', { word: 'serendipity', phonetic: '/ˌsɛr.ənˈdɪp.ə.ti/' })).body.data;
    assert.ok(vocab, 'A should have saved vocabulary');

    const attempts = [
      ['get', `/assignments/${asg.id}`], ['patch', `/assignments/${asg.id}`, { title: 'hacked' }], ['post', `/assignments/${asg.id}/complete`], ['delete', `/assignments/${asg.id}`],
      ['get', `/classes/${cls.id}`], ['patch', `/classes/${cls.id}`, { subject: 'hacked' }], ['delete', `/classes/${cls.id}`],
      ['get', `/notes/${note.id}`], ['patch', `/notes/${note.id}`, { content: 'hacked' }], ['delete', `/notes/${note.id}`],
      ['get', `/exams/${exam.id}`], ['patch', `/exams/${exam.id}`, { title: 'hacked' }], ['delete', `/exams/${exam.id}`],
      ['get', `/study-sessions/${ses.id}`], ['post', `/study-sessions/${ses.id}/pause`], ['post', `/study-sessions/${ses.id}/complete`], ['post', `/study-sessions/${ses.id}/cancel`], ['delete', `/study-sessions/${ses.id}`],
      ['patch', `/study-sessions/${planned.id}`, { plannedMinutes: 5 }],
      ['post', `/notifications/${notif.id}/read`], ['delete', `/notifications/${notif.id}`],
      ['get', `/dictionary/vocabulary/${vocab.id}`], ['delete', `/dictionary/vocabulary/${vocab.id}`],
    ];
    for (const [m, p, body] of attempts) {
      const res = await b[m](p, body);
      assert.equal(res.status, 404, `${m.toUpperCase()} ${p} => ${res.status} (expected 404, existence must not leak)`);
    }
    // B starting A's *planned* session must fail too.
    assert.equal((await b.post('/study-sessions/start', { fromPlannedId: planned.id })).status, 404);

    // B's lists and aggregates contain nothing of A's.
    for (const p of ['/assignments', '/classes', '/notes', '/exams', '/study-sessions', '/notifications']) {
      assert.equal((await b.get(p)).body.data.length, 0, p);
    }
    assert.equal((await b.get('/study-sessions/active')).body.data, null);
    const dash = (await b.get('/dashboard')).body.data;
    assert.equal(dash.pendingAssignments, 0); assert.equal(dash.upcomingExams, 0); assert.deepEqual(dash.recentActivity, []);
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    assert.equal((await b.get(`/calendar/events?from=${day(-1)}&to=${day(14)}`)).body.data.length, 0);
    assert.equal((await b.get('/me/export')).body.assignments.length, 0);
    assert.deepEqual((await b.get('/notes/meta')).body.data, { subjects: [], tags: [] });

    // B cannot attach a study session to A's assignment/exam (foreign-key IDOR).
    assert.equal((await b.post('/study-sessions/start', { assignmentId: asg.id })).status, 400);
    assert.equal((await b.post('/study-sessions/plan', { plannedStart: inDays(1), plannedMinutes: 20, examId: exam.id })).status, 400);

    // Everything of A is intact and unmodified.
    assert.equal((await a.get(`/assignments/${asg.id}`)).body.data.title, 'A secret');
    assert.equal((await a.get(`/notes/${note.id}`)).body.data.content, 'private');
    assert.equal((await a.get(`/study-sessions/${ses.id}`)).body.data.status, 'running');
    assert.equal((await a.get(`/exams/${exam.id}`)).body.data.studyPlan.length, 0);
  });

  it('ignores/rejects attempts to choose the owner from the browser', async () => {
    const a = await signup(app, { email: 'own-a@example.test' });
    const b = await signup(app, { email: 'own-b@example.test' });
    for (const [path, body] of [
      ['/assignments', { title: 'x', dueAt: inDays(1), userId: a.user.id }],
      ['/notes', { title: 'x', user_id: a.user.id }],
      ['/exams', { subject: 's', title: 'x', examAt: inDays(1), userId: a.user.id }],
      ['/classes', { subject: 's', dayOfWeek: 1, startTime: '09:00', endTime: '10:00', userId: a.user.id }],
    ]) assert.equal((await b.post(path, body)).status, 400, path);
    assert.equal((await b.patch('/me', { name: 'x', id: a.user.id })).status, 400);
    assert.equal((await a.get('/assignments')).body.meta.total, 0);
  });

  it("a request carrying B's session can never act as A, even with A's CSRF token", async () => {
    const a = await signup(app, { email: 'csrf-a@example.test' });
    const b = await signup(app, { email: 'csrf-b@example.test' });
    const res = await b.agent.post('/api/v1/assignments').set('X-CSRF-Token', a.csrf).send({ title: 'x', dueAt: inDays(1) });
    assert.equal(res.status, 403);
  });
});

describe('injection and data exposure', () => {
  it('treats SQL metacharacters in filters as plain data and rejects bad enums', async () => {
    const u = await signup(app);
    await u.post('/assignments', { title: "Robert'); DROP TABLE assignments;--", subject: "O'Brien", dueAt: inDays(1) });
    const q = await u.get(`/assignments?q=${encodeURIComponent("'; DROP TABLE users;--")}`);
    assert.equal(q.status, 200); assert.equal(q.body.meta.total, 0);
    assert.equal((await u.get(`/assignments?q=${encodeURIComponent("Robert'")}`)).body.meta.total, 1);
    assert.equal((await u.get(`/assignments?subject=${encodeURIComponent("o'brien")}`)).body.meta.total, 1);
    assert.equal((await u.get('/assignments?sort=due;DROP TABLE users')).status, 400);
    assert.equal((await u.get('/assignments?order=asc;--')).status, 400);
    assert.equal((await u.get(`/notes?tag=${encodeURIComponent("x' OR '1'='1")}`)).body.meta.total, 0);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM users`);
    assert.equal(rows[0].n, 1);
  });

  it('never exposes password hashes, session tokens or CSRF tokens in API payloads', async () => {
    const u = await signup(app);
    await u.post('/assignments', { title: 'x', dueAt: inDays(1) });
    for (const p of ['/me', '/dashboard', '/assignments', '/notifications']) {
      const text = JSON.stringify((await u.get(p)).body);
      assert.ok(!/argon2|password_hash|passwordHash|token_hash/i.test(text), p);
    }
    const { rows } = await db.query('SELECT token_hash FROM sessions');
    const raw = (await client(app).post('/auth/login', { email: u.email, password: PASSWORD })).headers['set-cookie'][0].split(';')[0].split('=')[1];
    assert.ok(rows.every((r) => r.token_hash !== raw), 'session tokens are stored hashed');
  });

  it('keeps passwords, cookies and emails out of the logs', async () => {
    const lines = [];
    const logger = pino({ level: 'trace' }, { write: (l) => lines.push(l) });
    const l = makeApp({ deps: { logger } });
    try {
      await resetDb(l.ctx.db);
      const email = 'secret-log-check@example.test';
      const c = client(l.app);
      const reg = await c.post('/auth/register', { email, name: 'Log Check', password: 'super-secret-password-123', acceptTerms: true });
      c.csrf = reg.body.data.csrfToken;
      await c.post('/auth/login', { email, password: 'wrong-secret-password-456' });
      await c.get('/assignments?q=private-search-term');
      const cookie = reg.headers['set-cookie'][0].split(';')[0].split('=')[1];
      const all = lines.join('\n');
      assert.ok(all.length > 0, 'expected some log output');
      for (const secret of ['super-secret-password-123', 'wrong-secret-password-456', cookie, reg.body.data.csrfToken, email, 'private-search-term']) {
        assert.ok(!all.includes(secret), `log leaked: ${secret.slice(0, 12)}…`);
      }
    } finally { await l.close(); }
  });
});
