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
      try {
        return JSON.parse(raw) as T;
      } catch (err) {
        // A non-null value that isn't valid JSON (empty string, a foreign/legacy
        // write, a partial overwrite) must surface as a descriptive error, not a
        // raw SyntaxError — and never silently as `null`, which would mask data loss.
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`RedisStore.getJSON: malformed JSON at key "${key}": ${reason}`);
      }
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
