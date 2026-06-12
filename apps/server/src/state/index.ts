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
 *
 * `connectTimeout`/`commandTimeout` bound the connect and per-command waits so a
 * black-holed endpoint (TCP accepted but no reply) makes `ping()` reject fast
 * instead of hanging the readiness probe — and with it `/health` and every
 * Socket.IO handshake gate. `maxRetriesPerRequest` only bounds retries, not the
 * offline-queue/connect wait, so the timeouts are what actually fail fast here.
 */
export function connectRedis(url: string): RedisConnection {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });
  client.on('error', (err: Error) => {
    console.error('[redis] connection error', err.message);
  });
  const store = createRedisStore(client as unknown as RedisLike);
  return { client, store };
}
