import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app, ctx } = createApp(config);
const { logger, db } = ctx;

// Wait for PostgreSQL (container start order is not a readiness guarantee).
async function waitForDb(maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i++) {
    try { await db.ping(); logger.info('database connection established'); return; }
    catch (err) {
      const delay = Math.min(1000 * i, 5000);
      logger.warn({ attempt: i, err: err.message }, `database not ready, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('database never became ready');
}

await waitForDb().catch((err) => { logger.fatal({ err: err.message }); process.exit(1); });

const server = app.listen(config.port, config.host, () =>
  logger.info({ port: config.port, env: config.env }, 'StudyMate listening'));

const timers = [];
const cleanup = () => ctx.services.auth.purgeExpired().catch((err) => logger.error({ err: err.message }, 'cleanup failed'));
cleanup();
timers.push(setInterval(cleanup, 60 * 60 * 1000));
// Generate in-app reminders for everyone every 15 minutes (they are also generated whenever a user loads notifications).
ctx.services.notifications.runForAll();
timers.push(setInterval(() => ctx.services.notifications.runForAll(), 15 * 60 * 1000));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  timers.forEach(clearInterval);
  const force = setTimeout(() => { logger.error('forced exit after timeout'); process.exit(1); }, 10_000);
  force.unref();
  server.close(async () => {
    try { await db.close(); } catch { /* ignore */ }
    logger.info('shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err: String(err) }, 'unhandled rejection'));
