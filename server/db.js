import 'dotenv/config';
import pg from 'pg';

const useSsl = (process.env.PG_SSL ?? 'true') !== 'false';

/** Supabase Postgres 연결 풀 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/** 쿼리 헬퍼: const { rows } = await q('...', [a, b]) */
export function q(text, params) {
  return pool.query(text, params);
}

/** 한 줄 헬퍼 */
export async function q1(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

/** 트랜잭션 헬퍼: await tx(async (client) => { ... }) */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
