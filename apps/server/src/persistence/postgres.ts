/**
 * Postgres adapter — pool + readiness probe only.
 * Session-archive writes land in Story 8.10 as a single transaction at session end;
 * this story is pool + health only.
 */

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface PostgresArchive {
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createPostgresArchive(pool: PoolLike): PostgresArchive {
  return {
    async ping(): Promise<boolean> {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
