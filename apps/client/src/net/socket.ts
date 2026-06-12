import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@bomb-squad/shared';

// NOTE: generic order is SWAPPED vs the server.
// Server: Server<ClientToServerEvents, ServerToClientEvents>
// Client: Socket<ServerToClientEvents, ClientToServerEvents>
export type AppClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(url: string): AppClientSocket {
  return io(url, { autoConnect: false, transports: ['websocket'] });
}
