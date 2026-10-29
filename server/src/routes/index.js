import express from 'express';
import { originAndContentType, csrfProtection } from '../middleware/csrf.js';
import { loadSession } from '../middleware/session.js';
import { authRoutes } from './auth.routes.js';
import { legalInfo } from '../legal.js';
import { resourceRoutes } from './resources.routes.js';

export function apiRouter(ctx) {
  const { config, db, limiters } = ctx;
  const r = express.Router();

  // Health endpoints: no auth, no rate limit, no secrets.
  r.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  r.get('/health/ready', async (req, res) => {
    try { await db.ping(); res.json({ status: 'ok', database: 'up' }); }
    catch { res.status(503).json({ status: 'unavailable', database: 'down' }); }
  });

  r.use(originAndContentType(config));
  r.use(limiters.api);
  // Public: operator details and retention periods used by the legal pages.
  r.get('/legal', (req, res) => res.json({ data: legalInfo(config) }));
  r.use(loadSession(ctx));
  r.use(csrfProtection);

  r.use('/auth', authRoutes(ctx));
  r.use('/', resourceRoutes(ctx));
  return r;
}
