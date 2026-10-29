// Minimal, transparent SQL migration runner.
//   node server/scripts/migrate.js          -> apply all pending migrations
//   node server/scripts/migrate.js down     -> roll back the most recent migration
//   node server/scripts/migrate.js status   -> list applied/pending
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const cmd = process.argv[2] ?? 'up';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const LOCK_ID = 727270001;

function listMigrations() {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.up.sql')).sort()
    .map((f) => f.replace('.up.sql', ''));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const all = listMigrations();

  if (cmd === 'status') {
    for (const m of all) console.log(`${applied.has(m) ? 'applied ' : 'pending '} ${m}`);
  } else if (cmd === 'up') {
    let count = 0;
    for (const m of all.filter((n) => !applied.has(n))) {
      const sql = fs.readFileSync(path.join(dir, `${m}.up.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m]);
        await client.query('COMMIT');
        console.log(`applied ${m}`); count++;
      } catch (err) { await client.query('ROLLBACK'); throw new Error(`Migration ${m} failed: ${err.message}`); }
    }
    if (!count) console.log('database is up to date');
  } else if (cmd === 'down') {
    const last = all.filter((n) => applied.has(n)).pop();
    if (!last) { console.log('nothing to roll back'); return; }
    const sql = fs.readFileSync(path.join(dir, `${last}.down.sql`), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [last]);
      await client.query('COMMIT'); console.log(`rolled back ${last}`);
    } catch (err) { await client.query('ROLLBACK'); throw err; }
  } else { throw new Error(`unknown command: ${cmd}`); }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch {} await client.end().catch(() => {}); });
