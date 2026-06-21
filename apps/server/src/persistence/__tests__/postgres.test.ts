import { describe, expect, it } from '@jest/globals';
import { createPostgresArchive } from '../postgres.js';
import type { PoolLike, PoolClientLike, PostgresArchive, SessionArchiveRecord } from '../postgres.js';

/** A checked-out client that records every statement it runs, in order. */
class FakeClient implements PoolClientLike {
  readonly log: { text: string; params?: unknown[] }[] = [];
  released = false;
  failOn: string | null = null;

  async query(text: string, params?: unknown[]): Promise<unknown> {
    const head = text.trim().split(/\s+/, 1)[0]!.toUpperCase();
    if (this.failOn !== null && text.includes(this.failOn)) {
      this.log.push({ text: head, params });
      throw new Error(`boom on ${this.failOn}`);
    }
    this.log.push({ text: head, params });
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }

  /** Verbs in execution order, e.g. ['BEGIN','INSERT',...,'COMMIT']. */
  verbs(): string[] {
    return this.log.map((q) => q.text);
  }
}

/** Fake pool: simple queries (ensureSchema, ping) + a single checked-out client. */
class FakePool implements PoolLike {
  shouldFail = false;
  readonly simpleQueries: string[] = [];
  readonly client = new FakeClient();

  async query(text: string, _params?: unknown[]): Promise<unknown> {
    if (this.shouldFail) throw new Error('connection refused');
    this.simpleQueries.push(text.trim().split(/\s+/, 1)[0]!.toUpperCase());
    return { rows: [{ '?column?': 1 }] };
  }

  async connect(): Promise<PoolClientLike> {
    return this.client;
  }

  endCalled = false;
  async end(): Promise<void> {
    this.endCalled = true;
  }
}

const RECORD: SessionArchiveRecord = {
  sessionId: 's1',
  joinCode: 'ABC123',
  config: { timerMs: 300_000 },
  roundCount: 2,
  endedAt: 1_700_000_000_000,
  winnerTeamId: 'A',
  teams: [
    {
      teamId: 'A',
      cumulativeTimeMs: 90_000,
      rounds: [
        { roundIndex: 0, elapsedMs: 40_000, outcome: 'defused' },
        { roundIndex: 1, elapsedMs: 50_000, outcome: 'defused' },
      ],
    },
    {
      teamId: 'B',
      cumulativeTimeMs: 120_000,
      rounds: [{ roundIndex: 0, elapsedMs: 120_000, outcome: 'exploded' }],
    },
  ],
};

describe('createPostgresArchive — health', () => {
  it('ping returns true when SELECT 1 resolves', async () => {
    expect(await createPostgresArchive(new FakePool()).ping()).toBe(true);
  });

  it('ping returns false when SELECT 1 rejects', async () => {
    const pool = new FakePool();
    pool.shouldFail = true;
    expect(await createPostgresArchive(pool).ping()).toBe(false);
  });

  it('close calls pool.end()', async () => {
    const pool = new FakePool();
    await createPostgresArchive(pool).close();
    expect(pool.endCalled).toBe(true);
  });

  it('satisfies the PostgresArchive interface shape', () => {
    const archive: PostgresArchive = createPostgresArchive(new FakePool());
    expect(typeof archive.ping).toBe('function');
    expect(typeof archive.ensureSchema).toBe('function');
    expect(typeof archive.archiveSession).toBe('function');
    expect(typeof archive.close).toBe('function');
  });
});

describe('archiveSession — single transaction (Story 8.10 AC-3)', () => {
  it('wraps all inserts in one BEGIN…COMMIT and releases the client', async () => {
    const pool = new FakePool();
    await createPostgresArchive(pool).archiveSession(RECORD);

    const verbs = pool.client.verbs();
    expect(verbs[0]).toBe('BEGIN');
    expect(verbs[verbs.length - 1]).toBe('COMMIT');
    expect(verbs).not.toContain('ROLLBACK');
    // 1 sessions row + 2 team-result rows + 3 round rows = 6 INSERTs.
    expect(verbs.filter((v) => v === 'INSERT')).toHaveLength(6);
    expect(pool.client.released).toBe(true);
  });

  it('ensures the schema before writing (CREATE TABLE IF NOT EXISTS x3)', async () => {
    const pool = new FakePool();
    await createPostgresArchive(pool).archiveSession(RECORD);
    expect(pool.simpleQueries.filter((q) => q === 'CREATE')).toHaveLength(3);
  });

  it('rolls back and rethrows on a mid-transaction failure (no partial commit)', async () => {
    const pool = new FakePool();
    pool.client.failOn = 'session_rounds'; // fail on the first per-round insert
    const archive = createPostgresArchive(pool);

    await expect(archive.archiveSession(RECORD)).rejects.toThrow(/boom on session_rounds/);
    const verbs = pool.client.verbs();
    expect(verbs).toContain('BEGIN');
    expect(verbs).toContain('ROLLBACK');
    expect(verbs).not.toContain('COMMIT');
    expect(pool.client.released).toBe(true);
  });

  it('only ensures the schema once across multiple archives', async () => {
    const pool = new FakePool();
    const archive = createPostgresArchive(pool);
    await archive.archiveSession(RECORD);
    await archive.archiveSession({ ...RECORD, sessionId: 's2' });
    expect(pool.simpleQueries.filter((q) => q === 'CREATE')).toHaveLength(3); // not 6
  });
});
