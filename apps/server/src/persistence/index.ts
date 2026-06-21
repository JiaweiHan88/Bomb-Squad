import { Pool } from 'pg';
import { createPostgresArchive } from './postgres.js';
import type { PostgresArchive, PoolLike, PoolClientLike, SessionArchiveRecord } from './postgres.js';

export type { PostgresArchive, PoolLike, PoolClientLike, SessionArchiveRecord };
export { createPostgresArchive } from './postgres.js';

export interface PostgresConnection {
  pool: Pool;
  archive: PostgresArchive;
}

/**
 * Construct a pg.Pool and wrap it with PostgresArchive.
 * The pool is lazy — the first query proves reachability.
 * Idle-client errors are logged; an unhandled pool 'error' event crashes Node.
 *
 * `connectionTimeoutMillis`/`query_timeout` bound the connect and query waits so a
 * half-open Postgres endpoint makes the `SELECT 1` probe reject fast instead of
 * hanging the readiness probe (and with it `/health` and every handshake gate).
 */
export function connectPostgres(url: string): PostgresConnection {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  pool.on('error', (err: Error) => {
    console.error('[postgres] idle client error', err.message);
  });
  const archive = createPostgresArchive(pool as unknown as PoolLike);
  return { pool, archive };
}
