import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@bomb-squad/shared';

// NOTE: generic order is SWAPPED vs the server.
// Server: Server<ClientToServerEvents, ServerToClientEvents>
// Client: Socket<ServerToClientEvents, ClientToServerEvents>
export type AppClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Module-level handle to the app's single socket so UI event handlers (e.g.
// Landing's "Host a session") can emit without prop-drilling or putting the
// socket in Zustand (it is a connection, not snapshot state).
let instance: AppClientSocket | null = null;

export function createSocket(url: string): AppClientSocket {
  instance = io(url, { autoConnect: false, transports: ['websocket'] });
  return instance;
}

/**
 * The socket created by the App bootstrap. Call from event handlers only
 * (never at module top level — the socket exists only after App's effect runs).
 */
export function getSocket(): AppClientSocket {
  if (instance === null) {
    throw new Error('getSocket() called before createSocket() — socket not initialized');
  }
  return instance;
}
