/**
 * TestSocketServer — integration-test harness for Socket.IO handlers
 * (architecture Testing boundary: handlers are tested through a real socket
 * round-trip, with an in-memory RedisStore fake instead of real infra).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIOServer, type DefaultEventsMap } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bomb-squad/shared';
import type { RedisStore } from '../../state/redis.js';
import type { SessionLog, SessionSocketData } from '../sessionHandlers.js';

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
