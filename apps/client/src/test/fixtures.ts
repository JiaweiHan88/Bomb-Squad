import type {
  PlayerInfo,
  RoundConfig,
  SessionState,
  TeamId,
  TeamState,
} from '@bomb-squad/shared';

/** Minimal valid RoundConfig for seeding a session in a component test. */
export function makeRoundConfig(overrides: Partial<RoundConfig> = {}): RoundConfig {
  return {
    difficulty: 'easy',
    moduleCount: 3,
    timerMs: 300_000,
    strikeSpeedUpPct: 25,
    modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
    ...overrides,
  };
}

/** A roster entry. `playerId` is required; everything else defaults. */
export function makePlayer(
  overrides: Partial<PlayerInfo> & Pick<PlayerInfo, 'playerId'>,
): PlayerInfo {
  return {
    displayName: 'Player',
    role: 'defuser',
    isReady: false,
    ...overrides,
  };
}

/** A team with a single-player relay order, defuser at index 0. */
export function makeTeam(
  teamId: TeamId,
  relayOrder: string[],
  overrides: Partial<TeamState> = {},
): TeamState {
  return {
    teamId,
    relayOrder,
    currentDefuserIndex: 0,
    cumulativeTimeMs: 0,
    roundTimesMs: [],
    equalisationRoundsPlayed: 0,
    ...overrides,
  };
}

/** A lobby-status session; override `players`/`teams`/`status` per test. */
export function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    status: 'lobby',
    config: makeRoundConfig(),
    players: {},
    teams: {},
    roundNumber: 0,
    pausedAt: null,
    pauseKind: null,
    disconnectedPlayerIds: [],
    ...overrides,
  };
}
