import { createRedisStore } from '../redis.js';
import type { RedisLike } from '../redis.js';

type CommandName = 'get' | 'set' | 'del' | 'ping' | 'quit' | 'keys' | 'scan';

/** In-memory fake that records commands issued against it. */
class FakeRedis implements RedisLike {
  private readonly store = new Map<string, string>();
  readonly commandLog: CommandName[] = [];
  status = 'ready';

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
});
