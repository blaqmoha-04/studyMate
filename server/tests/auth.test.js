import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, resetDb, client, signup, uniqueEmail, PASSWORD, CONSENT, captureLogger } from './helpers.js';
import { loadConfig } from '../src/config/env.js';

describe('authentication', () => {
  let built; let app;
  before(() => { built = makeApp(); app = built.app; });
  after(() => built.close());
  beforeEach(() => resetDb(built.ctx.db));

  it('registers a user, sets a hardened session cookie and never leaks the password hash', async () => {
    const c = client(app);
    const res = await c.post('/auth/register', { email: 'Ama@Example.Test ', name: 'Ama', password: PASSWORD, ...CONSENT });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, 'ama@example.test');
    assert.ok(res.body.data.csrfToken);
    assert.ok(!JSON.stringify(res.body).includes('password'));
    const cookie = res.headers['set-cookie'].find((x) => x.startsWith('sm_sid='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const { rows } = await built.ctx.db.query('SELECT password_hash FROM users');
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
  });

  it('rejects duplicate emails (case-insensitive) and weak passwords with field errors', async () => {
    await signup(app, { email: 'dup@example.test' });
    const c = client(app);
    const dup = await c.post('/auth/register', { email: 'DUP@example.test', name: 'X', password: PASSWORD, ...CONSENT });
    assert.equal(dup.status, 409);
    const weak = await c.post('/auth/register', { email: uniqueEmail(), name: 'X', password: 'short', ...CONSENT });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, 'validation_error');
    assert.equal(weak.body.error.details[0].field, 'password');
    const bad = await c.post('/auth/register', { email: 'not-an-email', name: '', password: PASSWORD, admin: true });
    assert.equal(bad.status, 400);
  });

  it('logs in, and gives the same generic error for wrong password and unknown email', async () => {
    const u = await signup(app, { email: 'login@example.test' });
    const c = client(app);
    const wrong = await c.post('/auth/login', { email: u.email, password: 'wrong-password-123' });
    const unknown = await c.post('/auth/login', { email: 'nobody@example.test', password: 'wrong-password-123' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body.error.message, unknown.body.error.message);
    assert.equal(wrong.body.error.code, 'invalid_credentials');
    const ok = await c.post('/auth/login', { email: 'LOGIN@example.test', password: PASSWORD });
    assert.equal(ok.status, 200);
    c.csrf = ok.body.data.csrfToken;
    assert.equal((await c.get('/auth/session')).status, 200);
  });

  it('requires authentication for the session endpoint', async () => {
    assert.equal((await client(app).get('/auth/session')).status, 401);
  });

  it('logout invalidates the session server-side (old cookie stops working)', async () => {
    const u = await signup(app);
    const cookie = (await u.get('/auth/session')).request.header.Cookie ?? null; // agent-managed
    assert.equal((await u.get('/auth/session')).status, 200);
    // Capture the raw cookie, log out, then replay it with a fresh client.
    const loginRes = await client(app).post('/auth/login', { email: u.email, password: PASSWORD });
    const raw = loginRes.headers['set-cookie'][0].split(';')[0];
    const replay = (await import('supertest')).default(app);
    assert.equal((await replay.get('/api/v1/auth/session').set('Cookie', raw)).status, 200);
    const out = await replay.post('/api/v1/auth/logout').set('Cookie', raw)
      .set('X-CSRF-Token', loginRes.body.data.csrfToken).send();
    assert.equal(out.status, 204);
    assert.equal((await replay.get('/api/v1/auth/session').set('Cookie', raw)).status, 401);
    void cookie;
  });

  it('expired sessions are rejected', async () => {
    const u = await signup(app);
    await built.ctx.db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`);
    assert.equal((await u.get('/auth/session')).status, 401);
  });

  describe('CSRF and request hygiene', () => {
    it('blocks state-changing requests without the CSRF token', async () => {
      const u = await signup(app);
      const res = await u.post('/auth/logout', undefined, { csrf: false });
      assert.equal(res.status, 403);
      const wrong = await u.post('/auth/logout', undefined, { headers: { 'X-CSRF-Token': 'nope' } });
      assert.equal(wrong.status, 403);
      assert.equal((await u.get('/auth/session')).status, 200); // still signed in
    });
    it('blocks cross-origin requests even with a valid token', async () => {
      const u = await signup(app);
      const res = await u.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another-long-pass-1' },
        { headers: { Origin: 'https://evil.example' } });
      assert.equal(res.status, 403);
    });
    it('blocks non-JSON bodies on state-changing requests (form-post CSRF)', async () => {
      const u = await signup(app);
      const res = await u.agent.post('/api/v1/auth/change-password').type('form')
        .set('X-CSRF-Token', u.csrf).send('currentPassword=a&newPassword=b');
      assert.equal(res.status, 403);
    });
    it('answers malformed JSON and oversized bodies with clean errors', async () => {
      const c = client(app);
      const bad = await c.agent.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{oops');
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'invalid_json');
      const big = await c.agent.post('/api/v1/auth/login').set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(400_000) }));
      assert.equal(big.status, 413);
    });
    it('sets security headers and hides stack traces / framework info', async () => {
      const res = await client(app).get('/auth/session');
      assert.match(res.headers['content-security-policy'], /default-src 'self'/);
      assert.equal(res.headers['x-powered-by'], undefined);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['cache-control'], 'no-store');
      const missing = await client(app).get('/nope');
      assert.equal(missing.status, 404);
      assert.ok(!JSON.stringify(missing.body).includes('stack'));
    });
  });

  describe('change password', () => {
    it('rejects a wrong current password, then changes it and signs out other devices', async () => {
      const a = await signup(app, { email: 'pw@example.test' });
      const bLogin = client(app);
      const r = await bLogin.post('/auth/login', { email: 'pw@example.test', password: PASSWORD });
      bLogin.csrf = r.body.data.csrfToken;

      const wrong = await a.post('/auth/change-password', { currentPassword: 'not-it-not-it', newPassword: 'brand-new-password-9' });
      assert.equal(wrong.status, 400);
      const ok = await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'brand-new-password-9' });
      assert.equal(ok.status, 200);

      assert.equal((await a.get('/auth/session')).status, 200);       // this device stays signed in
      assert.equal((await bLogin.get('/auth/session')).status, 401);  // other device is signed out
      const oldPw = await client(app).post('/auth/login', { email: 'pw@example.test', password: PASSWORD });
      assert.equal(oldPw.status, 401);
      const newPw = await client(app).post('/auth/login', { email: 'pw@example.test', password: 'brand-new-password-9' });
      assert.equal(newPw.status, 200);
    });
  });

  describe('password reset', () => {
    it('does NOT pretend to work when email is not configured (production-like)', async () => {
      const res = await client(app).post('/auth/forgot-password', { email: 'x@example.test' });
      assert.equal(res.status, 501);
      assert.equal(res.body.error.code, 'email_not_configured');
      const caps = await client(app).get('/auth/capabilities');
      assert.equal(caps.body.data.passwordResetEmail, false);
    });

    it('dev mode: logs a one-time link; token works once, expires, and revokes sessions', async () => {
      const { logger, lines } = captureLogger();
      const dev = makeApp({ env: { DEV_LOG_RESET_LINKS: 'true' }, deps: { logger } });
      try {
        await resetDb(dev.ctx.db);
        const u = await signup(dev.app, { email: 'reset@example.test' });
        const unknown = await client(dev.app).post('/auth/forgot-password', { email: 'ghost@example.test' });
        const known = await client(dev.app).post('/auth/forgot-password', { email: 'reset@example.test' });
        assert.equal(unknown.status, 202);
        assert.deepEqual(unknown.body, known.body); // no account enumeration
        const entry = lines.find((l) => l.link);
        assert.ok(entry, 'reset link should be logged in dev mode');
        const token = new URL(entry.link.replace('/#/', '/')).searchParams.get('token');

        const weak = await client(dev.app).post('/auth/reset-password', { token, password: 'short' });
        assert.equal(weak.status, 400);
        const bogus = await client(dev.app).post('/auth/reset-password', { token: 'x'.repeat(43), password: 'a-new-long-password-1' });
        assert.equal(bogus.status, 400);

        const ok = await client(dev.app).post('/auth/reset-password', { token, password: 'a-new-long-password-1' });
        assert.equal(ok.status, 200);
        assert.equal((await u.get('/auth/session')).status, 401); // old sessions revoked
        const reuse = await client(dev.app).post('/auth/reset-password', { token, password: 'yet-another-password-2' });
        assert.equal(reuse.status, 400); // single use
        const login = await client(dev.app).post('/auth/login', { email: 'reset@example.test', password: 'a-new-long-password-1' });
        assert.equal(login.status, 200);

        // Expiry
        await client(dev.app).post('/auth/forgot-password', { email: 'reset@example.test' });
        const t2 = new URL(lines.filter((l) => l.link).at(-1).link.replace('/#/', '/')).searchParams.get('token');
        await dev.ctx.db.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'`);
        const expired = await client(dev.app).post('/auth/reset-password', { token: t2, password: 'expired-attempt-pass-3' });
        assert.equal(expired.status, 400);
        // Token is stored hashed, never raw.
        const { rows } = await dev.ctx.db.query('SELECT token_hash FROM password_reset_tokens');
        assert.ok(rows.every((r) => r.token_hash !== token && r.token_hash !== t2));
      } finally { await dev.close(); }
    });

    it('dev reset logging is ignored in production config', () => {
      const cfg = loadConfig({ ...process.env, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://study.example.org',
        DEV_LOG_RESET_LINKS: 'true', SESSION_SECRET: 'a'.repeat(40) + 'Zq9' });
      assert.equal(cfg.devLogResetLinks, false);
      assert.equal(cfg.cookieSecure, true);
    });
  });

  describe('rate limiting', () => {
    it('limits repeated login attempts for the same account', async () => {
      const strict = makeApp({ env: { RATE_LIMIT_MULTIPLIER: '1' } });
      try {
        const c = client(strict.app);
        const statuses = [];
        for (let i = 0; i < 10; i++) statuses.push((await c.post('/auth/login', { email: 'victim@example.test', password: 'guess-number-' + i })).status);
        assert.ok(statuses.slice(0, 8).every((s) => s === 401), statuses.join());
        assert.equal(statuses[8], 429);
        const other = await c.post('/auth/login', { email: 'someone-else@example.test', password: 'guess-number-1' });
        assert.equal(other.status, 401); // different account not locked by this key
      } finally { await strict.close(); }
    });
    it('limits registration and forgot-password', async () => {
      const strict = makeApp({ env: { RATE_LIMIT_MULTIPLIER: '1' } });
      try {
        const c = client(strict.app);
        let last;
        for (let i = 0; i < 7; i++) last = await c.post('/auth/forgot-password', { email: `a${i}@example.test` });
        assert.equal(last.status, 429);
        for (let i = 0; i < 11; i++) last = await c.post('/auth/register', { email: 'bad', name: '', password: 'x' });
        assert.equal(last.status, 429);
      } finally { await strict.close(); }
    });
  });

  describe('database failure handling', () => {
    it('returns 503 (not a crash or stack trace) when the database is unreachable', async () => {
      const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
      const broken = { query: async () => { throw err; }, tx: async () => { throw err; }, ping: async () => { throw err; }, close: async () => {} };
      const b = makeApp({ deps: { db: broken } });
      const login = await client(b.app).post('/auth/login', { email: 'a@example.test', password: PASSWORD });
      assert.equal(login.status, 503);
      assert.equal(login.body.error.code, 'database_unavailable');
      assert.ok(!JSON.stringify(login.body).includes('10.0.0.1'));
      const live = await client(b.app).get('/health/live');
      assert.equal(live.status, 200);
      const ready = await client(b.app).get('/health/ready');
      assert.equal(ready.status, 503);
    });
    it('readiness is OK with a working database', async () => {
      const ready = await client(app).get('/health/ready');
      assert.equal(ready.status, 200);
    });
  });

  describe('configuration safety', () => {
    it('never shows a stray ".env" comment as the operator name', () => {
      const cfg = loadConfig({ ...process.env, OPERATOR_NAME: '# CHANGE: your name', OPERATOR_EMAIL: '  ', OPERATOR_ADDRESS: '1 Real Road' });
      assert.equal(cfg.operator.name, null); assert.equal(cfg.operator.email, null); assert.equal(cfg.operator.address, '1 Real Road');
    });
    it('refuses to start in production with placeholder secrets or non-https origin', () => {
      const base = { ...process.env, NODE_ENV: 'production' };
      assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: 'http://x.org', SESSION_SECRET: 'q'.repeat(40) }), /https/);
      assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: 'https://x.org', SESSION_SECRET: 'change-me-change-me-change-me-change-me' }), /placeholder/);
      assert.throws(() => loadConfig({ ...base, PUBLIC_ORIGIN: 'https://x.org', SESSION_SECRET: 'short' }), /32/);
    });
  });
});

describe('consent, data minimisation and legal info', () => {
  let built; let app;
  before(() => { built = makeApp({ env: { OPERATOR_NAME: 'Test Operator', OPERATOR_EMAIL: 'privacy@example.test', OPERATOR_JURISDICTION: 'Ghana' } }); app = built.app; });
  after(() => built.close());
  beforeEach(() => resetDb(built.ctx.db));

  it('requires explicit Terms acceptance but no age confirmation to create an account', async () => {
    const base = { email: uniqueEmail(), name: 'No Consent', password: PASSWORD };
    for (const body of [base, { ...base, ageConfirmed: true }, { ...base, ageConfirmed: false, acceptTerms: true }, { ...base, acceptTerms: 'true' }]) {
      const res = await client(app).post('/auth/register', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'validation_error');
    }
    const { rows } = await built.ctx.db.query('SELECT count(*)::int AS n FROM users'); assert.equal(rows[0].n, 0, 'no account may exist without consent');
    const ok = await client(app).post('/auth/register', { ...base, acceptTerms: true }); assert.equal(ok.status, 201);
  });

  it('records WHEN and WHICH version of the terms were accepted, and includes that in the export', async () => {
    const u = await signup(app);
    const { rows } = await built.ctx.db.query('SELECT terms_accepted_at, terms_version FROM users');
    assert.ok(rows[0].terms_accepted_at); assert.match(rows[0].terms_version, /^\d{4}-\d{2}-\d{2}$/);
    const exp = (await u.get('/me/export')).body;
    assert.equal(exp.profile.termsVersion, rows[0].terms_version); assert.ok(exp.profile.termsAcceptedAt);
  });

  it('does not store browser/user-agent strings (data minimisation)', async () => {
    const cols = await built.ctx.db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`);
    assert.ok(!cols.rows.some((c) => /agent|ip/i.test(c.column_name)), cols.rows.map((c) => c.column_name).join());
    await client(app).agent.post('/api/v1/auth/register').set('User-Agent', 'SecretBrowser/9.9').send({ email: uniqueEmail(), name: 'UA', password: PASSWORD, ...CONSENT });
    const dump = JSON.stringify((await built.ctx.db.query('SELECT * FROM sessions')).rows);
    assert.ok(!dump.includes('SecretBrowser'));
  });

  it('exposes operator details and retention periods publicly (and says when unconfigured)', async () => {
    const res = await client(app).get('/legal');
    assert.equal(res.status, 200);
    assert.deepEqual({ name: res.body.data.operator.name, email: res.body.data.operator.email, j: res.body.data.operator.jurisdiction }, { name: 'Test Operator', email: 'privacy@example.test', j: 'Ghana' });
    assert.equal('minAge' in res.body.data, false); assert.equal(res.body.data.configured, true); assert.equal(res.body.data.retention.backupDays, 14);
    const bare = makeApp(); try { const r = await client(bare.app).get('/legal'); assert.equal(r.body.data.configured, false); assert.equal('minAge' in r.body.data, false); assert.equal(r.body.data.operator.name, null); } finally { await bare.close(); }
  });

  it('reset emails carry no marketing and the app has no marketing/unsubscribe surface', async () => {
    const sent = []; const mailer = { configured: true, send: async (m) => { sent.push(m); } };
    const m = makeApp({ deps: { mailer } });
    try { await resetDb(m.ctx.db); await signup(m.app, { email: 'mail@example.test' });
      await client(m.app).post('/auth/forgot-password', { email: 'mail@example.test' }); await new Promise((r) => setTimeout(r, 100));
      assert.equal(sent.length, 1); assert.match(sent[0].text, /no marketing/i); assert.match(sent[0].text, /#\/reset-password\?token=/);
    } finally { await m.close(); }
  });
});
