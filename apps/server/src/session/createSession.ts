import type { PlayerInfo, RoundConfig, SessionState } from '@bomb-squad/shared';

/**
 * Round defaults for a fresh session (GDD Flow 3 first-round kindness:
 * easy tier, 3 modules, 5:00 timer). Overridable per-create via the
 * SESSION_CREATE payload; reconfigurable later via ROUND_CONFIGURE (Story 8.1).
 */
export const DEFAULT_ROUND_CONFIG: RoundConfig = {
  difficulty: 'easy',
  moduleCount: 3,
  timerMs: 300_000,
  strikeSpeedUpPct: 25,
  modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
};

export interface CreateSessionArgs {
  sessionId: string;
  joinCode: string;
  /** Durable minted player id of the creating client (Story 2.7) — becomes the
   * Facilitator player. Decoupled from the ephemeral socket.id so a reconnect
   * re-attaches to the same record. This factory treats it as an opaque id. */
  facilitatorId: string;
  /** Validated config overrides (handler-sanitized; this factory trusts it). */
  config?: Partial<RoundConfig>;
}

/**
 * Pure factory for a brand-new lobby SessionState. No I/O, no clock, no
 * randomness — identifiers are minted by the caller (handler), so the same
 * args always produce a deep-equal result.
 *
 * The SESSION_CREATE contract carries no display name, so the facilitator's
 * PlayerInfo defaults to 'Facilitator' (roster naming is a 2.4/2.5 concern).
 */
export function createSessionState({
  sessionId,
  joinCode,
  facilitatorId,
  config,
}: CreateSessionArgs): SessionState {
  const facilitator: PlayerInfo = {
    playerId: facilitatorId,
    displayName: 'Facilitator',
    role: 'facilitator',
    isReady: false,
  };

  return {
    sessionId,
    joinCode,
    status: 'lobby',
    config: {
      ...DEFAULT_ROUND_CONFIG,
      ...config,
      // Merge nested modifiers explicitly so a partial config can't drop a field.
      modifiers: { ...DEFAULT_ROUND_CONFIG.modifiers, ...config?.modifiers },
    },
    players: { [facilitatorId]: facilitator },
    teams: {},
    roundNumber: 0,
    // Story 8.7: a fresh session is running, never paused.
    pausedAt: null,
    pauseKind: null,
    disconnectedPlayerIds: [],
  };
}
