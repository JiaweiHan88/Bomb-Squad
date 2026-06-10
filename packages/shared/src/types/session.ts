export type PlayerRole = 'facilitator' | 'defuser' | 'expert' | 'spectator';

/** Exactly two teams per session. */
export type TeamId = 'A' | 'B';

export type DifficultyTier = 'easy' | 'medium' | 'hard';

export interface ModifierConfig {
  asymmetricExpertRoles: boolean;
  spectatorLifelines: boolean;
}

export interface RoundConfig {
  difficulty: DifficultyTier;
  /** Number of modules on the bomb. Range: 3–11. */
  moduleCount: number;
  /** Total round duration in milliseconds. */
  timerMs: number;
  /** Strike-based speed-up percentage per strike. Range: 0–50, compounding. Default: 25. */
  strikeSpeedUpPct: number;
  /** Override module pool by IDs. Undefined = use tier default pool. */
  modulePool?: string[];
  modifiers: ModifierConfig;
}

export interface PlayerInfo {
  playerId: string;
  displayName: string;
  role: PlayerRole;
  teamId?: TeamId;
  isReady: boolean;
}

export interface TeamState {
  teamId: TeamId;
  /** Player IDs in join/relay order. */
  relayOrder: string[];
  /** Index into relayOrder for the current round's defuser. */
  currentDefuserIndex: number;
  /** Cumulative defuse time in milliseconds across all completed rounds. */
  cumulativeTimeMs: number;
}

export interface SessionState {
  sessionId: string;
  /** Unguessable join code (≥6 chars, crypto-random — never sequential). */
  joinCode: string;
  status: 'lobby' | 'preparation' | 'active' | 'between-rounds' | 'ended';
  config: RoundConfig;
  players: Record<string, PlayerInfo>;
  teams: Partial<Record<TeamId, TeamState>>;
  roundNumber: number;
  modifiers: ModifierConfig;
}
