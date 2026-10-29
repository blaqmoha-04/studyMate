// Administrator tool: print a one-hour password-reset link for a user (use when SMTP isn't configured).
//   docker compose run --rm app node server/scripts/reset-link.js user@example.com
import pino from 'pino';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/utils/db.js';
import { createAuthService } from '../src/services/auth.service.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) { console.error('Usage: node server/scripts/reset-link.js <email>'); process.exit(1); }
const config = loadConfig(); const logger = pino({ level: 'silent' }); const db = createDb(config, logger);
try {
  const { rows } = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (!rows[0]) { console.error('No account with that email.'); process.exitCode = 1; }
  else {
    const auth = createAuthService({ db, config, mailer: { configured: false }, logger });
    const raw = await auth.createResetToken(rows[0].id);
    console.log(`Reset link (valid 1 hour, single use):\n${auth.resetLink(raw)}\nSend it to the user over a trusted channel.`);
  }
} finally { await db.close(); }
