import type { SessionState, TeamId, PlayerRole, RoundConfig } from '../types/session.js';
import type { BombState, StrikeCount } from '../types/bomb.js';
import type { ModuleState } from '../types/module.js';
import type { TimerState } from '../types/timer.js';

// Re-export core types used in payloads so consumers can import from events alone
export type { SessionState, TeamId, PlayerRole, RoundConfig, BombState, TimerState, StrikeCount };

// ─── Client → Server payloads ────────────────────────────────────────────────

export interface SessionCreatePayload {
  config?: Partial<RoundConfig>;
}

/**
 * Server acknowledgement for SESSION_CREATE. Delivered via the event's ack
 * callback so the creating client learns the new identifiers without racing a
 * subsequent broadcast.
 */
export interface SessionCreatedPayload {
  sessionId: string;
  joinCode: string;
}

export interface SessionJoinPayload {
  joinCode: string;
  displayName: string;
  role: PlayerRole;
}

/**
 * Facilitator-authored request to remove a player from the lobby roster
 * (Story 2.7). Carries the target's durable `playerId` — never a `socket.id`.
 * No ack: success is the SESSION_STATE broadcast + a SESSION_REMOVED notice to
 * the target; failure is a typed ERROR to the facilitator.
 */
export interface PlayerRemovePayload {
  playerId: string;
}

export interface TeamAssignPayload {
  playerId: string;
  teamId: TeamId;
  role: PlayerRole;
}

/**
 * A player toggling their OWN ready state in the lobby (Story 2.5). Carries no
 * `playerId`: a player may only set their own ready, so the server resolves the
 * caller from `socket.data.playerId` (the durable-id model, Story 2.7) — the
 * same "server resolves the identity, never trust a client-supplied one" rule
 * TEAM_ASSIGN follows for its target, applied here to the self. No ack: success
 * is the SESSION_STATE broadcast; failure is a typed ERROR to the caller.
 */
export interface PlayerReadyPayload {
  isReady: boolean;
}

export interface RoundConfigurePayload {
  config: RoundConfig;
}

export interface ModuleInteractPayload {
  teamId: TeamId;
  /**
   * Index into `BombState.modules`. Untrusted client input — the server MUST
   * bounds-check (`0 <= moduleIndex < modules.length`) before dereferencing.
   * Invariant: identifies the same module as `modules[moduleIndex].moduleId`.
   */
  moduleIndex: number;
  /** Module-specific action data. Validated and bounds-checked server-side before reaching a reducer. */
  action: unknown;
}

export interface RoundRetryPayload {
  teamId: TeamId;
}

export interface LifelineSendPayload {
  /** ID of a hint from the fixed pre-defined list. No free text allowed. */
  promptId: string;
}

/**
 * Expert manual navigation (Story 5.2 → consumed by Spectator Lounge, 9.4).
 * Untrusted client input — the server MUST validate (kebab-case chapter id,
 * bounded length) before persisting or rebroadcasting.
 */
export interface ManualPositionPayload {
  /** Chapter identifier in kebab-case, e.g. "wires". */
  chapterId: string;
}

// ─── Server → Client payloads ────────────────────────────────────────────────

export interface ModuleUpdate {
  /**
   * Index into `BombState.modules`. Invariant: `modules[moduleIndex].moduleId`
   * equals `state.moduleId`. Bomb-level changes (strikes, timer) are NOT bundled
   * here — they arrive via the dedicated STRIKE / TIMER_UPDATE events, which are
   * the single source of truth for those values.
   */
  moduleIndex: number;
  state: ModuleState<unknown>;
}

export interface StrikePayload {
  teamId: TeamId;
  /** New authoritative strike total (absolute, not a delta). */
  strikes: StrikeCount;
  timer: TimerState;
}

export interface RoundEndPayload {
  teamId: TeamId;
  /** Elapsed defuse time in ms. For failures, time at the moment of failure. */
  elapsedMs: number;
}

export interface ScoreboardPayload {
  /**
   * Per-team standings. `Partial` because a team may be absent (e.g. a session
   * scored before team B ever formed) — mirrors `SessionState.teams`.
   * `rounds[i]` is the elapsed defuse time in ms for round i; success vs failure
   * is conveyed by the BOMB_DEFUSED / BOMB_EXPLODED events, not encoded here.
   */
  teams: Partial<Record<TeamId, { cumulativeTimeMs: number; rounds: number[] }>>;
  winnerTeamId?: TeamId;
  /**
   * Teams whose JUST-RESOLVED round was a failure (`exploded` / `time-expired`)
   * — Story 8.8. Drives the Facilitator's "Retry round" affordance on the
   * between-rounds scoreboard (a defused round offers no retry). Empty/absent
   * when no team failed the round. The server remains the authority — the
   * `ROUND_RETRY` handler re-checks eligibility regardless of what the client shows.
   */
  failedTeams?: TeamId[];
}

export interface LifelineToastPayload {
  promptId: string;
  fromName: string;
}

export interface PauseResumePayload {
  reason: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

/**
 * Private identity packet (Story 2.7) sent to exactly one socket — the owner —
 * on create/join and on a successful reconnect-restore. The `reattachToken` is
 * a SECRET (the reconnect credential): it is never part of SessionState (which
 * the whole room receives) and is never logged. The client persists this to
 * sessionStorage and presents the token via the Socket.IO handshake `auth` on
 * (re)connect. `playerId` is the public, durable roster/authority key.
 */
export interface SessionIdentityPayload {
  sessionId: string;
  playerId: string;
  reattachToken: string;
}

/**
 * Notice sent to a client that the Facilitator removed from the session
 * (Story 2.7). The client clears its stored identity, drops to Landing, and
 * renders `message` verbatim (server-authored, human-readable).
 */
export interface SessionRemovedPayload {
  message: string;
}

/**
 * Broadcast of an Expert's current manual position. `playerId` lets Story 9.4
 * resolve "most-recently-navigated Expert" when a team has several (GDD A3:
 * the spectator manual is LOCKED to the active Expert's current page).
 */
export interface ExpertManualPositionPayload {
  /** Chapter identifier in kebab-case, e.g. "wires". */
  chapterId: string;
  /** The navigating Expert's player id. */
  playerId: string;
}

// ─── Voice (Story 3.1 — Role-Scoped LiveKit Token Minting) ───────────────────

/**
 * VOICE_TOKEN request. Intentionally empty: the requester supplies NO room and
 * NO role. The server derives both from the authoritative session state keyed
 * by the requesting socket — so a client can never ask for a room or a publish
 * grant its role does not allow (FR39: token-grant enforced, not UI-hidden).
 */
export interface VoiceTokenRequestPayload {
  // Reserved for future opt-in fields (e.g. requested device label). No
  // authority-bearing field may ever be added here.
  readonly _?: never;
}

/**
 * VOICE_TOKEN success response, delivered via the event's ack callback (the
 * requester needs a direct reply, not a broadcast). The `token` is a short-TTL
 * LiveKit JWT scoped to exactly `room` with exactly the caller's role grants.
 * NEVER log the `token` field (project-context Security).
 */
export interface VoiceTokenGrantPayload {
  /** LiveKit server URL the client connects to (from server Config). */
  url: string;
  /** Signed LiveKit access token (JWT). Secret — never logged. */
  token: string;
  /** The single room the token is scoped to (`bomb-room:…` or `spectator-lounge:…`). */
  room: string;
  /** The participant identity baked into the token (the server-side player id). */
  identity: string;
}

/** VOICE_TOKEN failure response (ack), used when no token can be minted. */
export interface VoiceTokenErrorPayload {
  error: string;
}
