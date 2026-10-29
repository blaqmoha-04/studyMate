// Administrator tool for data-deletion REQUESTS from people who cannot sign in (e.g. a forgotten password).
//   docker compose run --rm app node server/scripts/delete-user.js person@example.com --yes
// Verify the requester's identity first (for example by replying to the email address on the account).
// Permanently deletes the account and all linked data from the live database. Backups age out on their own schedule.
import pino from 'pino';
import { loadConfig } from '../src/config/env.js';
import { createDb } from '../src/utils/db.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
const confirmed = process.argv.includes('--yes');
if (!email) { console.error('Usage: node server/scripts/delete-user.js <email> [--yes]'); process.exit(1); }
const config = loadConfig(); const db = createDb(config, pino({ level: 'silent' }));
try {
  const { rows } = await db.query('SELECT id, created_at FROM users WHERE lower(email) = $1', [email]);
  if (!rows[0]) { console.error('No account with that email (nothing deleted).'); process.exitCode = 1; }
  else {
    const counts = await db.query(
      `SELECT (SELECT count(*) FROM assignments WHERE user_id=$1)::int AS assignments, (SELECT count(*) FROM class_schedules WHERE user_id=$1)::int AS classes,
              (SELECT count(*) FROM study_notes WHERE user_id=$1)::int AS notes, (SELECT count(*) FROM exams WHERE user_id=$1)::int AS exams,
              (SELECT count(*) FROM study_sessions WHERE user_id=$1)::int AS study_sessions`, [rows[0].id]);
    console.log('Account found. It holds:', counts.rows[0]);
    if (!confirmed) { console.log('Dry run. Re-run with --yes to delete permanently.'); }
    else { await db.tx(async (q) => { await q('DELETE FROM users WHERE id = $1', [rows[0].id]); }); console.log('Deleted. Backups containing this account expire after the configured retention period.'); }
  }
} finally { await db.close(); }
