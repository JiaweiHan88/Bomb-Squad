/**
 * Redis adapter — O(1) typed get/set/del/ping/isReady over an injected RedisLike client,
 * plus updateJSON: an optimistic WATCH/MULTI compare-and-set for race-safe load→modify→store.
 * Forbidden: KEYS, SCAN, HGETALL/SMEMBERS over wildcards, MGET across sessions.
 */

/** The slice of an ioredis MULTI pipeline we use: a single queued SET, then EXEC. */
export interface RedisMultiLike {
  set(key: string, value: string): RedisMultiLike;
  /** EXEC resolves to null when a WATCHed key changed mid-transaction (aborted). */
  exec(): Promise<[Error | null, unknown][] | null>;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  // Optimistic-transaction primitives. The concrete ioredis client already has
  // these; widening the interface here is what lets updateJSON use them.
  watch(key: string): Promise<unknown>;
  unwatch(): Promise<unknown>;
  multi(): RedisMultiLike;
  duplicate(): RedisLike;
  status: string;
}

export interface RedisStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  ping(): Promise<boolean>;
  isReady(): boolean;
  /**
   * Race-safe compare-and-set on a single JSON key. Loads the current value,
   * runs the PURE `mutate` against it, and — only when `mutate` returns
   * `commit: true` — atomically writes `value` iff the key was untouched since
   * the load (optimistic WATCH/MULTI). On a concurrent write it retries from a
   * fresh load (up to `maxRetries`, default 5), so the guard inside `mutate`
   * is always evaluated against the committed-at-write state.
   *
   * `mutate` MUST be pure and idempotent — it may run once per attempt. Carry
   * any per-attempt decision out through the returned `result`, never side
   * effects. `commit: false` writes nothing and returns immediately.
   */
  updateJSON<T, R>(
    key: string,
    mutate: (current: T | null) => { commit: boolean; value?: T; result: R },
    opts?: { maxRetries?: number },
  ): Promise<{ committed: boolean; result: R }>;
}

/** Parse a raw Redis string the same way getJSON does (throws on malformed JSON). */
function parseJSON<T>(key: string, raw: string | null): T | null {
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
}

export function createRedisStore(client: RedisLike): RedisStore {
  // WATCH is connection-scoped and the rest of the server multiplexes commands
  // over `client`. Running WATCH/MULTI there would let concurrent transactions
  // interleave their awaits and silently break the guarantee. So updateJSON runs
  // on its own dedicated connection (lazily duplicated, cached) and every call is
  // serialized through ONE in-process promise chain — no two transactions ever
  // overlap on that connection. A single global queue (not per-key) is required
  // BECAUSE the connection is shared across keys: per-key queueing would let two
  // different-key transactions interleave MULTI/EXEC on the one connection. At
  // human-speed lobby join rates a global queue is free; cross-process safety
  // still comes from WATCH/EXEC-null → retry once the store is multi-process.
  let txConn: RedisLike | null = null;
  let txQueueTail: Promise<unknown> = Promise.resolve();

  function transactionConnection(): RedisLike {
    if (txConn === null) txConn = client.duplicate();
    return txConn;
  }

  async function runTransaction<T, R>(
    key: string,
    mutate: (current: T | null) => { commit: boolean; value?: T; result: R },
    maxRetries: number,
  ): Promise<{ committed: boolean; result: R }> {
    const conn = transactionConnection();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await conn.watch(key);
      let current: T | null;
      try {
        current = parseJSON<T>(key, await conn.get(key));
      } catch (err) {
        // A leaked WATCH poisons the NEXT unrelated transaction on this
        // connection — always release it before surfacing the error.
        await conn.unwatch();
        throw err;
      }

      const decision = mutate(current);
      if (!decision.commit) {
        await conn.unwatch();
        return { committed: false, result: decision.result };
      }

      const reply = await conn.multi().set(key, JSON.stringify(decision.value)).exec();
      // EXEC clears the WATCH itself (success or abort), so no unwatch here.
      if (reply !== null) {
        return { committed: true, result: decision.result };
      }
      // null reply: a WATCHed-key change aborted the transaction — retry from a
      // fresh load so the guard re-evaluates against the new state.
    }
    throw new Error(
      `RedisStore.updateJSON: contention retry limit exceeded for key "${key}"`,
    );
  }

  return {
    async getJSON<T>(key: string): Promise<T | null> {
      return parseJSON<T>(key, await client.get(key));
    },

    async setJSON<T>(key: string, value: T): Promise<void> {
      await client.set(key, JSON.stringify(value));
    },

    async del(key: string): Promise<void> {
      await client.del(key);
    },

    updateJSON<T, R>(
      key: string,
      mutate: (current: T | null) => { commit: boolean; value?: T; result: R },
      opts?: { maxRetries?: number },
    ): Promise<{ committed: boolean; result: R }> {
      const maxRetries = opts?.maxRetries ?? 5;
      // Chain after whatever is already queued — regardless of its outcome, we
      // only use the prior promise for ordering — so transactions run strictly
      // one at a time on the shared dedicated connection.
      const run = txQueueTail.then(
        () => runTransaction<T, R>(key, mutate, maxRetries),
        () => runTransaction<T, R>(key, mutate, maxRetries),
      );
      // Tail never rejects, so the next caller chains cleanly and a failed
      // transaction can't raise an unhandledRejection on the bookkeeping promise.
      txQueueTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
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
