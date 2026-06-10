import type { SessionState, TeamId, PlayerRole, RoundConfig } from '../types/session.js';
import type { BombState } from '../types/bomb.js';
import type { ModuleState } from '../types/module.js';
import type { TimerState } from '../types/timer.js';

// Re-export core types used in payloads so consumers can import from events alone
export type { SessionState, TeamId, PlayerRole, RoundConfig, BombState, TimerState };

// ─── Client → Server payloads ────────────────────────────────────────────────

export interface SessionCreatePayload {
  config?: Partial<RoundConfig>;
}

export interface SessionJoinPayload {
  joinCode: string;
  displayName: string;
  role: PlayerRole;
}

export interface TeamAssignPayload {
  playerId: string;
  teamId: TeamId;
  role: PlayerRole;
}

export interface RoundConfigurePayload {
  config: RoundConfig;
}

export interface ModuleInteractPayload {
  teamId: TeamId;
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

// ─── Server → Client payloads ────────────────────────────────────────────────

export interface ModuleUpdate {
  moduleIndex: number;
  state: ModuleState<unknown>;
  /** Optional bomb-level changes bundled with the module update. */
  bombDelta?: {
    strikes?: number;
    timer?: TimerState;
    solved?: boolean;
  };
}

export interface StrikePayload {
  teamId: TeamId;
  strikes: number;
  timer: TimerState;
}

export interface RoundEndPayload {
  teamId: TeamId;
  /** Elapsed defuse time in ms. For failures, time at the moment of failure. */
  elapsedMs: number;
}

export interface ScoreboardPayload {
  teams: Record<TeamId, { cumulativeTimeMs: number; rounds: number[] }>;
  winnerTeamId?: TeamId;
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
