import type {
  SessionCreatePayload,
  SessionJoinPayload,
  TeamAssignPayload,
  RoundConfigurePayload,
  ModuleInteractPayload,
  RoundRetryPayload,
  LifelineSendPayload,
} from './payloads.js';

/**
 * Events the client may send to the server.
 *
 * Wire the server socket as:
 *   new Server<ClientToServerEvents, ServerToClientEvents>(httpServer)
 * Wire the client socket as:
 *   io(url) as Socket<ServerToClientEvents, ClientToServerEvents>
 * Note: Server<C,S> and Socket<S,C> swap the generic parameter order.
 *
 * Once typed, socket.emit('unknown_string', data) is a compile-time error.
 * Event names follow SCREAMING_SNAKE_CASE per project convention.
 */
export interface ClientToServerEvents {
  SESSION_CREATE: (payload: SessionCreatePayload) => void;
  SESSION_JOIN: (payload: SessionJoinPayload) => void;
  TEAM_ASSIGN: (payload: TeamAssignPayload) => void;
  ROUND_CONFIGURE: (payload: RoundConfigurePayload) => void;
  ROUND_START: () => void;
  MODULE_INTERACT: (payload: ModuleInteractPayload) => void;
  FACILITATOR_PAUSE: () => void;
  FACILITATOR_RESUME: () => void;
  ROUND_RETRY: (payload: RoundRetryPayload) => void;
  LIFELINE_SEND: (payload: LifelineSendPayload) => void;
}
