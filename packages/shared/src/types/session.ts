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
  /**
   * Per-round elapsed-time history (Story 8.6). `roundTimesMs[i]` is the team's
   * recorded displayed-elapsed for round i+1, appended by `resolveRound` as each
   * round resolves. Maintained invariant: `cumulativeTimeMs === sum(roundTimesMs)`.
   * Both are kept because `ScoreboardPayload` carries both and Story 8.5 already
   * reads `cumulativeTimeMs`; this array is the per-round breakdown the
   * between-round preview (8.6) and final scoreboard (8.10) render.
   */
  roundTimesMs: number[];
  /**
   * Number of odd-team equalisation rounds this team has played (Story 8.9, FR44).
   * A shorter team owes `max(teamA.len, teamB.len) - this.relayOrder.length`
   * equalisation rounds; this counter increments (in `startRound`) each time an
   * equalisation round is committed for the team, so `equalisationRoundsOwed`
   * converges to 0 and `isRelayComplete` becomes true once every owed round is
   * played. The longer team (and equal-size teams) never owe any, so this stays 0.
   * Default 0 at every construction site (a fresh team owes nothing yet).
   */
  equalisationRoundsPlayed: number;
  /**
   * The Facilitator-assigned volunteer Defuser for the team's NEXT equalisation
   * round (Story 8.9 AC-2, FR44). Set explicitly via the `TEAM_ASSIGN` event while
   * between rounds / in preparation (the documented exception to "rotation is the
   * sole Defuser authority" — 8.6 decision (c)); consumed and cleared by
   * `startRound` when the equalisation round commits. Undefined when no volunteer
   * is pending. The server NEVER auto-picks it — an equalisation `ROUND_START`
   * refuses until the Facilitator designates one (GDD: "Facilitator assigns a
   * volunteer Defuser").
   */
  equalisationVolunteerId?: string;
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
  /**
   * Pause freeze (Story 8.7, FR13). ORTHOGONAL to `status` — a pause freezes ON
   * TOP of `active`/`between-rounds`, it is NOT a status value, so the session
   * remembers (and resumes into) the exact phase it paused from. `null` = running.
   * The server-epoch ms the pause began (parallels the per-team
   * `TimerState.pausedAt` that freezes a live round's countdown).
   */
  pausedAt: number | null;
  /**
   * Why the session is paused (Story 8.7). `'facilitator'` = a manual between-rounds
   * hold (resume is a free Facilitator click — no ready gate). `'disconnect'` = a
   * mid-round participant dropped (resume requires the Facilitator PLUS all
   * participants ready). `null` when running. The kind drives the resume gate.
   */
  pauseKind: 'facilitator' | 'disconnect' | null;
  /**
   * Durable player ids currently dropped during a mid-round disconnect pause
   * (Story 8.7). Drives the amber strip's "who dropped" and is cleared per-player
   * as each reconnects (the reconnect restore re-sends their BOMB_INIT). Empty
   * unless `pauseKind === 'disconnect'`.
   */
  disconnectedPlayerIds: string[];
}
