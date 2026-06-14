import type {
  ModuleUpdate,
  StrikePayload,
  RoundEndPayload,
  ScoreboardPayload,
  LifelineToastPayload,
  PauseResumePayload,
  ErrorPayload,
  ExpertManualPositionPayload,
  SessionIdentityPayload,
  SessionRemovedPayload,
} from './payloads.js';
import type { SessionState } from '../types/session.js';
import type { BombState } from '../types/bomb.js';
import type { TimerState } from '../types/timer.js';

/**
 * Events the server emits to clients.
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
export interface ServerToClientEvents {
  SESSION_STATE: (state: SessionState) => void;
  /** Private identity packet (Story 2.7) — unicast to the owning socket on
   * create/join/reconnect-restore. Carries the secret reattachToken; never
   * broadcast, never logged. */
  SESSION_IDENTITY: (payload: SessionIdentityPayload) => void;
  /** Sent to a client the Facilitator removed (Story 2.7). The client drops to
   * Landing and shows the notice. */
  SESSION_REMOVED: (payload: SessionRemovedPayload) => void;
  BOMB_INIT: (state: BombState) => void;
  MODULE_UPDATE: (update: ModuleUpdate) => void;
  TIMER_UPDATE: (timer: TimerState) => void;
  STRIKE: (payload: StrikePayload) => void;
  BOMB_DEFUSED: (payload: RoundEndPayload) => void;
  BOMB_EXPLODED: (payload: RoundEndPayload) => void;
  SCOREBOARD: (payload: ScoreboardPayload) => void;
  LIFELINE_TOAST: (payload: LifelineToastPayload) => void;
  EXPERT_MANUAL_POSITION: (payload: ExpertManualPositionPayload) => void;
  PAUSED: (payload: PauseResumePayload) => void;
  RESUMED: (payload: PauseResumePayload) => void;
  ERROR: (payload: ErrorPayload) => void;
}
