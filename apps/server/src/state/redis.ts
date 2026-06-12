/**
 * Redis adapter — O(1) typed get/set/del/ping/isReady over an injected RedisLike client.
 * Forbidden: KEYS, SCAN, HGETALL/SMEMBERS over wildcards, MGET across sessions.
 */

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  status: string;
}

export interface RedisStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  ping(): Promise<boolean>;
  isReady(): boolean;
}

export function createRedisStore(client: RedisLike): RedisStore {
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      const raw = await client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    },

    async setJSON<T>(key: string, value: T): Promise<void> {
      await client.set(key, JSON.stringify(value));
    },

    async del(key: string): Promise<void> {
      await client.del(key);
    },

    async ping(): Promise<boolean> {
      try {
        const reply = await client.ping();
        return reply === 'PONG';
      } catch {
        return false;
      }
    },

    isReady(): boolean {
      return client.status === 'ready';
    },
  };
}
