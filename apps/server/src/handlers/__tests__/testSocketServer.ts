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
  TeamId,
  TimerState,
} from '@bomb-squad/shared';
import type { RedisStore } from '../../state/redis.js';
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

/** Map-backed RedisStore fake. Pass `overrides` to inject failures. */
export function createMemoryRedisStore(overrides?: Partial<RedisStore>): MemoryRedisStore {
  const data = new Map<string, string>();
  return {
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
    async ping(): Promise<boolean> {
      return true;
    },
    isReady(): boolean {
      return true;
    },
    ...overrides,
  };
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
  /** Connects a typed client socket; resolves once connected. */
  connectClient(): Promise<TestClientSocket>;
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
    async connectClient(): Promise<TestClientSocket> {
      const socket: TestClientSocket = ioClient(url, { transports: ['websocket'] });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
      });
      return socket;
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
