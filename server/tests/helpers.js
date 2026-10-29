import request from 'supertest';
import pino from 'pino';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';

export function makeApp({ env = {}, deps = {} } = {}) {
  const config = loadConfig({ ...process.env, RATE_LIMIT_MULTIPLIER: '1000', ...env });
  return createApp(config, deps);
}

export const resetDb = (db) => db.query('TRUNCATE users CASCADE');

// Captures warn+ log lines (used to read DEV-only reset links).
export function captureLogger() {
  const lines = [];
  const logger = pino({ level: 'warn' }, { write: (l) => lines.push(JSON.parse(l)) });
  return { logger, lines };
}

// Cookie-keeping API client that attaches the CSRF token automatically once known.
export function client(app) {
  const agent = request.agent(app);
  const c = { agent, csrf: null };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    c[m] = (url, body, { csrf = true, headers = {} } = {}) => {
      let r = agent[m](`/api/v1${url}`);
      if (c.csrf && csrf && m !== 'get') r = r.set('X-CSRF-Token', c.csrf);
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return body !== undefined ? r.send(body) : r;
    };
  }
  return c;
}

export const PASSWORD = 'correct-horse-battery';
// Explicit Terms acceptance every sign-up must carry.
export const CONSENT = { acceptTerms: true };
let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}${Date.now()}${counter++}@example.test`;

export async function signup(app, { email = uniqueEmail(), name = 'Test User', password = PASSWORD } = {}) {
  const c = client(app);
  const res = await c.post('/auth/register', { email, name, password, ...CONSENT });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  c.csrf = res.body.data.csrfToken;
  c.user = res.body.data.user;
  c.email = email;
  return c;
}

export const inDays = (n, hours = 0) => new Date(Date.now() + n * 86400000 + hours * 3600000).toISOString();
export const inHours = (n) => new Date(Date.now() + n * 3600000).toISOString();
