/**
 * TestSocketServer — integration-test harness for Socket.IO handlers
 * (architecture Testing boundary: handlers are tested through a real socket
 * round-trip, with an in-memory RedisStore fake instead of real infra).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIOServer, type DefaultEventsMap } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionState,
  TeamId,
  TimerState,
} from '@bomb-squad/shared';
import type { RedisStore, UpdateDecision } from '../../state/redis.js';
import type { SessionLog, SessionSocketData } from '../sessionHandlers.js';
import { createTimerScheduler, type TimerScheduler } from '../../timer/timerScheduler.js';

export type TestIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SessionSocketData
>;
export type TestClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface MemoryRedisStore extends RedisStore {
  /** Raw backing map (key → serialized JSON) for direct assertions. */
  data: Map<string, string>;
}

export interface MemoryRedisStoreOptions {
  /**
   * One-shot interleave hook for updateJSON. Fires ONCE, between this store's
   * read of `key` and its write, then disarms — modelling "another client wrote
   * between my load and my commit". A test arms it to mutate `data`; the fake
   * notices `data` changed since its read and re-runs `mutate` against the new
   * value, exercising the real adapter's WATCH/EXEC-null → retry path (which a
   * single-threaded Map is otherwise too atomic to surface).
   */
  onBeforeCommit?: (key: string) => void | Promise<void>;
}

/** Map-backed RedisStore fake. Pass `overrides` to inject failures, `options` to arm the race hook. */
export function createMemoryRedisStore(
  overrides?: Partial<RedisStore>,
  options?: MemoryRedisStoreOptions,
): MemoryRedisStore {
  const data = new Map<string, string>();
  let onBeforeCommit = options?.onBeforeCommit;

  const store: MemoryRedisStore = {
    data,
    async getJSON<T>(key: string): Promise<T | null> {
      const raw = data.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async setJSON<T>(key: string, value: T): Promise<void> {
      data.set(key, JSON.stringify(value));
    },
    async del(key: string): Promise<void> {
      data.delete(key);
    },
    async updateJSON<T, R>(
      key: string,
      mutate: (current: T | null) => UpdateDecision<T, R>,
      _opts?: { maxRetries?: number },
    ): Promise<{ committed: boolean; result: R }> {
      // Re-read → mutate, looping if the one-shot hook (or anything) changed the
      // raw bytes between read and write. Models the optimistic retry: a fresh
      // read on every attempt, so the guard inside `mutate` re-evaluates.
      for (;;) {
        const before = data.get(key);
        const current = before === undefined ? null : (JSON.parse(before) as T);
        const decision = mutate(current);

        if (onBeforeCommit) {
          const hook = onBeforeCommit;
          onBeforeCommit = undefined; // self-clearing: fire exactly once
          await hook(key);
        }

        // If the raw bytes moved since our read, retry from a fresh load — this
        // is the "WATCHed key changed, EXEC returned null" branch.
        if (data.get(key) !== before) continue;

        if (!decision.commit) return { committed: false, result: decision.result };
        data.set(key, JSON.stringify(decision.value));
        return { committed: true, result: decision.result };
      }
    },
    async ping(): Promise<boolean> {
      return true;
    },
    isReady(): boolean {
      return true;
    },
    ...overrides,
  };
  return store;
}

/** No-op pino-shaped logger for handler deps. */
export const noopLog: SessionLog = {
  info: () => {},
  error: () => {},
};

/**
 * A {@link TimerScheduler} for handler tests: an injected mutable clock and a
 * NO-OP `setTimer` (no real OS timeout ever fires, so nothing leaks between
 * tests). Drive expiry deterministically with `setNow(...)` + `fireNow(...)`.
 * Records `arm()` calls for assertions.
 */
export interface TestScheduler extends TimerScheduler {
  readonly armCalls: ReadonlyArray<{ sessionId: string; teamId: TeamId; timer: TimerState }>;
  setNow(nowMs: number): void;
}

export function createTestScheduler(deps: {
  redis: RedisStore;
  io: TestIOServer;
  log: SessionLog;
}): TestScheduler {
  let nowMs = 0;
  const armCalls: Array<{ sessionId: string; teamId: TeamId; timer: TimerState }> = [];
  const base = createTimerScheduler({
    redis: deps.redis,
    io: deps.io,
    log: deps.log,
    clock: () => nowMs,
    setTimer: () => 0, // never auto-fires; tests call fireNow() explicitly
    clearTimer: () => {},
  });
  return {
    ...base,
    arm(sessionId, teamId, timer) {
      armCalls.push({ sessionId, teamId, timer });
      base.arm(sessionId, teamId, timer);
    },
    armCalls,
    setNow(n: number): void {
      nowMs = n;
    },
  };
}

export interface TestSocketServer {
  url: string;
  io: TestIOServer;
  /** Connects a typed client socket; resolves once connected. Pass `auth` to
   * present a handshake auth payload (Story 2.7 reattach token). */
  connectClient(auth?: Record<string, unknown>): Promise<TestClientSocket>;
  /** Connect with `auth` AND capture the first SESSION_STATE — the listener is
   * attached before the handshake completes (as the real client binds before
   * connect), so a server-driven reattach broadcast can't be missed. */
  connectClientCapturingState(
    auth: Record<string, unknown>,
  ): Promise<{ socket: TestClientSocket; state: SessionState }>;
  /** Connect with `auth` and capture the FIRST payload of each named event. Every
   * listener is attached before the handshake completes, so fast server-driven
   * replay emits (e.g. a mid-round reattach's BOMB_INIT/TIMER_UPDATE) are never
   * missed. Returns one promise per event; an event that never arrives stays
   * pending (race it against a timeout to assert absence). */
  connectClientCapturing(
    auth: Record<string, unknown>,
    eventNames: string[],
  ): Promise<{ socket: TestClientSocket; events: Record<string, Promise<unknown>> }>;
  /** Disconnects all clients and closes server + HTTP listener. */
  close(): Promise<void>;
}

export async function startTestSocketServer(
  register: (io: TestIOServer) => void,
): Promise<TestSocketServer> {
  const httpServer = createServer();
  const io: TestIOServer = new SocketIOServer(httpServer);
  register(io);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const clients: TestClientSocket[] = [];

  return {
    url,
    io,
    async connectClient(auth?: Record<string, unknown>): Promise<TestClientSocket> {
      const socket: TestClientSocket = ioClient(url, { transports: ['websocket'], auth });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
      });
      return socket;
    },
    async connectClientCapturingState(
      auth: Record<string, unknown>,
    ): Promise<{ socket: TestClientSocket; state: SessionState }> {
      const socket: TestClientSocket = ioClient(url, { transports: ['websocket'], auth });
      clients.push(socket);
      // Attach the SESSION_STATE listener immediately (before connect resolves)
      // so a fast server-driven reattach broadcast is never missed.
      const statePromise = new Promise<SessionState>((resolve) =>
        socket.once('SESSION_STATE', (s) => resolve(s)),
      );
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
      });
      return { socket, state: await statePromise };
    },
    async connectClientCapturing(
      auth: Record<string, unknown>,
      eventNames: string[],
    ): Promise<{ socket: TestClientSocket; events: Record<string, Promise<unknown>> }> {
      const socket: TestClientSocket = ioClient(url, { transports: ['websocket'], auth });
      clients.push(socket);
      // Attach every listener BEFORE connect resolves so a fast server-driven
      // replay emit cannot slip through before the test starts listening.
      const events: Record<string, Promise<unknown>> = {};
      for (const name of eventNames) {
        events[name] = new Promise((resolve) =>
          socket.once(name as keyof ServerToClientEvents, (p: unknown) => resolve(p)),
        );
      }
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', () => resolve());
          socket.once('connect_error', (err) => reject(err));
        });
      } catch (err) {
        // Handshake failed: the function rejects (the caller never receives
        // `events`), but the half-initialized socket would linger in `clients`
        // with dangling `once` listeners — tear it down before propagating.
        socket.disconnect();
        throw err;
      }
      return { socket, events };
    },
    async close(): Promise<void> {
      for (const client of clients) client.disconnect();
      // io.close() also closes the underlying HTTP server.
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}
