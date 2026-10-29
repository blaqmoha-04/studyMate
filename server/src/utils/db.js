import pg from 'pg';

// Return DATE-less timestamptz as JS Date (default) but keep int8 as numbers where safe.
pg.types.setTypeParser(20, (v) => Number(v));

export function createDb(config, logger) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on('error', (err) => logger?.error({ err: err.message }, 'idle database client error'));

  const query = (text, params) => pool.query(text, params);

  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn((text, params) => client.query(text, params));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async function ping() {
    await pool.query('SELECT 1');
    return true;
  }

  return { pool, query, tx, ping, close: () => pool.end() };
}
