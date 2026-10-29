import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import express from 'express';

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(true);
}
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createDb } from './utils/db.js';
import { createMailer } from './utils/mailer.js';
import { createLimiters } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { createAuthService } from './services/auth.service.js';
import { createAssignmentService } from './services/assignment.service.js';
import { createClassService } from './services/class.service.js';
import { createNoteService } from './services/note.service.js';
import { createExamService } from './services/exam.service.js';
import { createStudyService } from './services/study.service.js';
import { createCalendarService } from './services/calendar.service.js';
import { createNotificationService } from './services/notification.service.js';
import { createDashboardService } from './services/dashboard.service.js';
import { createAccountService } from './services/account.service.js';
import { createDictionaryService } from './services/dictionary.service.js';
import { userDto } from './utils/serialize.js';
import { apiRouter } from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config, overrides = {}) {
  const logger = overrides.logger ?? pino({
    level: config.logLevel,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  });
  const db = overrides.db ?? createDb(config, logger);
  const mailer = overrides.mailer ?? createMailer(config);
  const limiters = createLimiters(config);

  const ctx = { config, db, logger, mailer, limiters, services: {} };
  const s = ctx.services;
  s.auth = { ...createAuthService(ctx), dto: userDto };
  s.assignments = createAssignmentService(ctx);
  s.classes = createClassService(ctx);
  s.notes = createNoteService(ctx);
  s.exams = createExamService(ctx);
  s.study = createStudyService(ctx);
  s.calendar = createCalendarService(ctx);
  s.notifications = createNotificationService(ctx);
  s.dashboard = createDashboardService(ctx);
  s.account = createAccountService(ctx);
  s.dictionary = createDictionaryService(ctx);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id']?.toString().slice(0, 64) || crypto.randomUUID(),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  }));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"],
        objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));

  app.use(express.json({ limit: '300kb' }));
  app.use(cookieParser());

  // API responses must never be cached by browsers or shared caches.
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/v1', apiRouter(ctx));
  app.use('/api', notFoundHandler);

  const clientDir = config.clientDir ?? path.resolve(here, '../../client');
  app.use(express.static(clientDir, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      else res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
    },
  }));

  app.use(errorHandler(logger));

  return { app, ctx, close: async () => { await db.close(); } };
}
