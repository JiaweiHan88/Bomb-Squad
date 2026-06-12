import { createPostgresArchive } from '../postgres.js';
import type { PoolLike, PostgresArchive } from '../postgres.js';

/** Fake pool that can be configured to resolve or reject SELECT 1. */
class FakePool implements PoolLike {
  shouldFail = false;

  async query(_text: string, _params?: unknown[]): Promise<unknown> {
    if (this.shouldFail) throw new Error('connection refused');
    return { rows: [{ '?column?': 1 }] };
  }

  endCalled = false;
  async end(): Promise<void> {
    this.endCalled = true;
  }
}

describe('createPostgresArchive', () => {
  it('ping returns true when SELECT 1 resolves', async () => {
    const pool = new FakePool();
    const archive = createPostgresArchive(pool);
    expect(await archive.ping()).toBe(true);
  });

  it('ping returns false when SELECT 1 rejects', async () => {
    const pool = new FakePool();
    pool.shouldFail = true;
    const archive = createPostgresArchive(pool);
    expect(await archive.ping()).toBe(false);
  });

  it('close calls pool.end()', async () => {
    const pool = new FakePool();
    const archive = createPostgresArchive(pool);
    await archive.close();
    expect(pool.endCalled).toBe(true);
  });

  it('exposes no write method (runtime guard)', () => {
    const pool = new FakePool();
    const archive = createPostgresArchive(pool);
    // Compile-time: PostgresArchive type has no insert/write. Runtime guard for safety.
    expect((archive as unknown as Record<string, unknown>)['insert']).toBeUndefined();
    expect((archive as unknown as Record<string, unknown>)['write']).toBeUndefined();
    expect((archive as unknown as Record<string, unknown>)['save']).toBeUndefined();
    expect((archive as unknown as Record<string, unknown>)['create']).toBeUndefined();
  });

  it('satisfies the PostgresArchive interface shape', () => {
    const pool = new FakePool();
    const archive: PostgresArchive = createPostgresArchive(pool);
    expect(typeof archive.ping).toBe('function');
    expect(typeof archive.close).toBe('function');
  });
});
