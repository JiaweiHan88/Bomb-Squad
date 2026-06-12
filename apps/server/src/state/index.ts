import { Redis } from 'ioredis';
import { createRedisStore } from './redis.js';
import type { RedisStore, RedisLike } from './redis.js';

export type { RedisStore, RedisLike };
export * from './keys.js';
export { createRedisStore } from './redis.js';

export interface RedisConnection {
  client: InstanceType<typeof Redis>;
  store: RedisStore;
}

/**
 * Construct a lazily-connected ioredis client and wrap it with RedisStore.
 * The caller (start()) must `await client.connect()` before use.
 * Error events are logged rather than thrown — an unhandled 'error' event crashes Node.
 */
export function connectRedis(url: string): RedisConnection {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  client.on('error', (err: Error) => {
    console.error('[redis] connection error', err.message);
  });
  const store = createRedisStore(client as unknown as RedisLike);
  return { client, store };
}
