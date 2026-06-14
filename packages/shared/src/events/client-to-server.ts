import type {
  SessionCreatePayload,
  SessionCreatedPayload,
  SessionJoinPayload,
  TeamAssignPayload,
  RoundConfigurePayload,
  ModuleInteractPayload,
  RoundRetryPayload,
  LifelineSendPayload,
  ManualPositionPayload,
  PlayerRemovePayload,
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
 *
 * Events that the client needs a direct response to use a Socket.IO ack
 * callback (last parameter) rather than relying on a follow-up broadcast.
 */
export interface ClientToServerEvents {
  SESSION_CREATE: (payload: SessionCreatePayload, ack: (result: SessionCreatedPayload) => void) => void;
  SESSION_JOIN: (payload: SessionJoinPayload) => void;
  /** Facilitator-only (Story 2.7). Removes a player from the lobby roster by
   * durable playerId. No ack: success = SESSION_STATE broadcast + SESSION_REMOVED
   * to the target; failure = typed ERROR to the caller. */
  PLAYER_REMOVE: (payload: PlayerRemovePayload) => void;
  TEAM_ASSIGN: (payload: TeamAssignPayload) => void;
  ROUND_CONFIGURE: (payload: RoundConfigurePayload) => void;
  /** Facilitator-only. Opens the Preparation phase for the next round (Story 8.3).
   * No ack: success is the SESSION_STATE broadcast, failure a typed ERROR. */
  PREPARATION_OPEN: () => void;
  /** Facilitator-only. Returns Preparation to the lobby for the same round
   * (Story 8.3) — the inverse of PREPARATION_OPEN. No ack: success is the
   * SESSION_STATE broadcast, failure a typed ERROR. */
  PREPARATION_CANCEL: () => void;
  ROUND_START: () => void;
  MODULE_INTERACT: (payload: ModuleInteractPayload) => void;
  MANUAL_NAVIGATE: (payload: ManualPositionPayload) => void;
  FACILITATOR_PAUSE: () => void;
  FACILITATOR_RESUME: () => void;
  ROUND_RETRY: (payload: RoundRetryPayload) => void;
  LIFELINE_SEND: (payload: LifelineSendPayload) => void;
}
