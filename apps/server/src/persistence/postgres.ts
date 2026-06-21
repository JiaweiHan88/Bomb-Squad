/**
 * Postgres adapter — pool, readiness probe, and the session-end archive (Story 8.10).
 *
 * Persistence rule (project-context): NO writes during play — a completed session is
 * written ONCE, as a SINGLE transaction at session end (`archiveSession`), off the
 * game-tick path. The schema is created idempotently (`ensureSchema`,
 * `CREATE TABLE IF NOT EXISTS`) — there is no migration framework in V1; the server
 * waits on Postgres health before accepting connections, and `archiveSession`
 * guards-ensures the schema once per process so a Postgres-down-at-boot start still
 * archives correctly once Postgres returns.
 */
import type { RoundOutcome, TeamId } from '@bomb-squad/shared';

/** A pooled client checked out for a transaction (subset of pg.PoolClient). */
export interface PoolClientLike {
  query(text: string, params?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<unknown>;
  /** Check out a client for a multi-statement transaction (BEGIN…COMMIT). */
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

/** Plain data the handler builds from `SessionState` + the final scoreboard. */
export interface SessionArchiveRecord {
  sessionId: string;
  joinCode: string;
  /** The session's `RoundConfig` — stored verbatim as jsonb. */
  config: unknown;
  /** Total turns played (the session's terminal `roundNumber`). */
  roundCount: number;
  /** Server-epoch ms the session ended (injected — never `Date.now()` in the reducer). */
  endedAt: number;
  /** Strictly-lowest-cumulative winner; undefined on a tie / single-team session. */
  winnerTeamId?: TeamId;
  teams: {
    teamId: TeamId;
    cumulativeTimeMs: number;
    /** Per-round breakdown in turn order: `roundIndex` is 0-based. */
    rounds: { roundIndex: number; elapsedMs: number; outcome: RoundOutcome }[];
  }[];
}

export interface PostgresArchive {
  ping(): Promise<boolean>;
  /** Idempotently create the session-archive schema. Safe to call repeatedly. */
  ensureSchema(): Promise<void>;
  /** Write one completed session in a SINGLE transaction (idempotent on re-run). */
  archiveSession(record: SessionArchiveRecord): Promise<void>;
  close(): Promise<void>;
}

/** Idempotent DDL — one statement per `query` (node-pg simple-query rejects multi-statement params). */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sessions (
     session_id text PRIMARY KEY,
     join_code text NOT NULL,
     config jsonb NOT NULL,
     winner_team_id text,
     round_count integer NOT NULL,
     ended_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS session_team_results (
     session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
     team_id text NOT NULL,
     cumulative_time_ms integer NOT NULL,
     PRIMARY KEY (session_id, team_id)
   )`,
  `CREATE TABLE IF NOT EXISTS session_rounds (
     session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
     team_id text NOT NULL,
     round_index integer NOT NULL,
     elapsed_ms integer NOT NULL,
     outcome text NOT NULL,
     PRIMARY KEY (session_id, team_id, round_index)
   )`,
];

export function createPostgresArchive(pool: PoolLike): PostgresArchive {
  // Ensure the schema at most once per process; subsequent archives reuse the result.
  let schemaReady: Promise<void> | null = null;
  const ensureSchema = (): Promise<void> => {
    if (schemaReady === null) {
      schemaReady = (async () => {
        for (const ddl of SCHEMA_STATEMENTS) await pool.query(ddl);
      })().catch((err) => {
        // Reset so a transient failure can be retried on the next archive.
        schemaReady = null;
        throw err;
      });
    }
    return schemaReady;
  };

  return {
    async ping(): Promise<boolean> {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    ensureSchema,

    async archiveSession(record: SessionArchiveRecord): Promise<void> {
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO sessions (session_id, join_code, config, winner_team_id, round_count, ended_at)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
           ON CONFLICT (session_id) DO NOTHING`,
          [
            record.sessionId,
            record.joinCode,
            JSON.stringify(record.config),
            record.winnerTeamId ?? null,
            record.roundCount,
            record.endedAt,
          ],
        );
        for (const team of record.teams) {
          await client.query(
            `INSERT INTO session_team_results (session_id, team_id, cumulative_time_ms)
             VALUES ($1, $2, $3)
             ON CONFLICT (session_id, team_id) DO NOTHING`,
            [record.sessionId, team.teamId, team.cumulativeTimeMs],
          );
          for (const round of team.rounds) {
            await client.query(
              `INSERT INTO session_rounds (session_id, team_id, round_index, elapsed_ms, outcome)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (session_id, team_id, round_index) DO NOTHING`,
              [record.sessionId, team.teamId, round.roundIndex, round.elapsedMs, round.outcome],
            );
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        // Roll back so a partial write never commits; surface the original error.
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
