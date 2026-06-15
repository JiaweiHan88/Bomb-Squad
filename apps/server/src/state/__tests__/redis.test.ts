import { beforeEach, describe, expect, it } from '@jest/globals';
import { createRedisStore } from '../redis.js';
import type { RedisLike, RedisMultiLike } from '../redis.js';

type CommandName =
  | 'get' | 'set' | 'del' | 'ping' | 'quit' | 'keys' | 'scan'
  | 'watch' | 'unwatch' | 'multi' | 'exec';

/** In-memory fake that records commands issued against it. */
class FakeRedis implements RedisLike {
  private readonly store = new Map<string, string>();
  readonly commandLog: CommandName[] = [];
  status = 'ready';
  /** When true, the next MULTI/EXEC returns null once (models a WATCHed-key change). */
  failNextExec = false;

  async get(key: string): Promise<string | null> {
    this.commandLog.push('get');
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.commandLog.push('set');
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.commandLog.push('del');
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async ping(): Promise<string> {
    this.commandLog.push('ping');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  async watch(_key: string): Promise<'OK'> {
    this.commandLog.push('watch');
    return 'OK';
  }

  async unwatch(): Promise<'OK'> {
    this.commandLog.push('unwatch');
    return 'OK';
  }

  multi(): RedisMultiLike {
    this.commandLog.push('multi');
    const ops: Array<[string, string]> = [];
    const builder: RedisMultiLike = {
      set: (key: string, value: string) => {
        ops.push([key, value]);
        return builder;
      },
      exec: async () => {
        this.commandLog.push('exec');
        if (this.failNextExec) {
          this.failNextExec = false;
          return null; // WATCHed key changed mid-transaction — aborted.
        }
        for (const [k, v] of ops) this.store.set(k, v);
        return ops.map(() => [null, 'OK'] as [Error | null, unknown]);
      },
    };
    return builder;
  }

  /** The dedicated tx connection shares this fake's store, mirroring duplicate(). */
  duplicate(): RedisLike {
    return this;
  }

  /** EventEmitter hook — no-op in the fake; the real store attaches an 'error'
   * listener on the duplicated connection. */
  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }

  /** Test helper: read raw stored bytes for assertions. */
  raw(key: string): string | undefined {
    return this.store.get(key);
  }
}

describe('createRedisStore', () => {
  let fake: FakeRedis;

  beforeEach(() => {
    fake = new FakeRedis();
  });

  it('setJSON/getJSON round-trips a typed object', async () => {
    const store = createRedisStore(fake);
    const obj = { name: 'bomb', strikes: 2 };
    await store.setJSON('my-key', obj);
    const result = await store.getJSON<typeof obj>('my-key');
    expect(result).toEqual(obj);
  });

  it('getJSON of a missing key returns null', async () => {
    const store = createRedisStore(fake);
    const result = await store.getJSON('no-such-key');
    expect(result).toBeNull();
  });

  it('getJSON throws a descriptive error on a non-null, non-JSON value', async () => {
    // A foreign/legacy write or partial overwrite — must surface as a clear error,
    // never a raw SyntaxError and never silently as null (would mask data loss).
    await fake.set('corrupt', 'not-json');
    const store = createRedisStore(fake);
    await expect(store.getJSON('corrupt')).rejects.toThrow(
      'RedisStore.getJSON: malformed JSON at key "corrupt"',
    );
  });

  it('getJSON throws on an empty-string value (passes the null guard)', async () => {
    await fake.set('empty', '');
    const store = createRedisStore(fake);
    await expect(store.getJSON('empty')).rejects.toThrow('malformed JSON at key "empty"');
  });

  it('del removes a key', async () => {
    const store = createRedisStore(fake);
    await store.setJSON('to-remove', { x: 1 });
    await store.del('to-remove');
    expect(await store.getJSON('to-remove')).toBeNull();
  });

  it('ping returns true when reply is PONG', async () => {
    const store = createRedisStore(fake);
    expect(await store.ping()).toBe(true);
  });

  it('ping returns false when reply is not PONG', async () => {
    fake.ping = async () => 'NOT-PONG';
    const store = createRedisStore(fake);
    expect(await store.ping()).toBe(false);
  });

  it('ping returns false when the client throws', async () => {
    fake.ping = async () => { throw new Error('connection refused'); };
    const store = createRedisStore(fake);
    expect(await store.ping()).toBe(false);
  });

  it('isReady reflects the fake status', () => {
    const store = createRedisStore(fake);
    expect(store.isReady()).toBe(true);
    fake.status = 'reconnecting';
    expect(store.isReady()).toBe(false);
  });

  it('command log contains no keys/scan calls', async () => {
    const store = createRedisStore(fake);
    await store.setJSON('k', { v: 1 });
    await store.getJSON('k');
    await store.del('k');
    await store.ping();
    const forbidden = fake.commandLog.filter((c) => c === 'keys' || c === 'scan');
    expect(forbidden).toHaveLength(0);
  });

  describe('updateJSON (optimistic compare-and-set)', () => {
    it('commit path: writes the serialized value and returns committed:true', async () => {
      const store = createRedisStore(fake);
      await store.setJSON('counter', { n: 1 });

      const res = await store.updateJSON<{ n: number }, string>('counter', (current) => ({
        commit: true,
        value: { n: (current?.n ?? 0) + 1 },
        result: 'bumped',
      }));

      expect(res).toEqual({ committed: true, result: 'bumped' });
      expect(fake.raw('counter')).toBe(JSON.stringify({ n: 2 }));
      // WATCH → GET → MULTI/EXEC, exactly once.
      expect(fake.commandLog).toEqual(['set', 'watch', 'get', 'multi', 'exec']);
    });

    it('commit:false writes nothing, never calls multi, and unwatches', async () => {
      const store = createRedisStore(fake);
      await store.setJSON('counter', { n: 7 });
      fake.commandLog.length = 0;

      const res = await store.updateJSON<{ n: number }, string>('counter', () => ({
        commit: false,
        result: 'rejected',
      }));

      expect(res).toEqual({ committed: false, result: 'rejected' });
      expect(fake.raw('counter')).toBe(JSON.stringify({ n: 7 })); // unchanged
      expect(fake.commandLog).toContain('unwatch');
      expect(fake.commandLog).not.toContain('multi');
      expect(fake.commandLog).not.toContain('exec');
    });

    it('a one-time null EXEC reply triggers exactly one retry, then commits', async () => {
      const store = createRedisStore(fake);
      await store.setJSON('counter', { n: 0 });
      fake.failNextExec = true; // first EXEC aborts (WATCHed key changed)
      fake.commandLog.length = 0;

      let mutateCalls = 0;
      const res = await store.updateJSON<{ n: number }, number>('counter', (current) => {
        mutateCalls++;
        return { commit: true, value: { n: (current?.n ?? 0) + 1 }, result: mutateCalls };
      });

      expect(res.committed).toBe(true);
      expect(mutateCalls).toBe(2); // re-evaluated after the abort
      expect(fake.commandLog.filter((c) => c === 'watch')).toHaveLength(2);
      expect(fake.commandLog.filter((c) => c === 'exec')).toHaveLength(2);
      expect(fake.raw('counter')).toBe(JSON.stringify({ n: 1 }));
    });

    it('throws the contention error after maxRetries exhaustion', async () => {
      // A fake whose EXEC always aborts: every attempt loops back to watch.
      const alwaysAbort = new FakeRedis();
      alwaysAbort.multi = () => ({
        set() { return this; },
        async exec() { return null; },
      });
      const store = createRedisStore(alwaysAbort);
      await store.setJSON('hot', { n: 0 });

      await expect(
        store.updateJSON<{ n: number }, void>(
          'hot',
          (current) => ({ commit: true, value: { n: (current?.n ?? 0) + 1 }, result: undefined }),
          { maxRetries: 3 },
        ),
      ).rejects.toThrow('RedisStore.updateJSON: contention retry limit exceeded for key "hot"');
    });

    it('unwatches and surfaces malformed JSON read inside the transaction', async () => {
      const store = createRedisStore(fake);
      await fake.set('corrupt', 'not-json');
      fake.commandLog.length = 0;

      await expect(
        store.updateJSON('corrupt', () => ({ commit: true, value: {}, result: null })),
      ).rejects.toThrow('malformed JSON at key "corrupt"');
      // The WATCH must be released even on the throw path.
      expect(fake.commandLog).toContain('unwatch');
    });

    it('unwatches and surfaces an error thrown by mutate (no leaked WATCH on the shared connection)', async () => {
      const store = createRedisStore(fake);
      await store.setJSON('k', { v: 1 });
      fake.commandLog.length = 0;

      await expect(
        store.updateJSON('k', () => {
          throw new Error('mutate boom');
        }),
      ).rejects.toThrow('mutate boom');
      // A throwing mutate must release the WATCH so it can't poison the next
      // transaction on the shared dedicated connection — and must never commit.
      expect(fake.commandLog).toContain('unwatch');
      expect(fake.commandLog).not.toContain('multi');
      expect(fake.raw('k')).toBe(JSON.stringify({ v: 1 })); // unchanged
    });

    it('serializes concurrent updateJSON calls (no interleave) into the final value', async () => {
      const store = createRedisStore(fake);
      await store.setJSON('counter', { n: 0 });

      await Promise.all(
        Array.from({ length: 5 }, () =>
          store.updateJSON<{ n: number }, void>('counter', (current) => ({
            commit: true,
            value: { n: (current?.n ?? 0) + 1 },
            result: undefined,
          })),
        ),
      );

      expect(fake.raw('counter')).toBe(JSON.stringify({ n: 5 }));
    });
  });
});
