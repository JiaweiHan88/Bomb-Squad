import type { PlayerInfo, PlayerRole, SessionState } from '@bomb-squad/shared';

export interface JoinPlayerArgs {
  /** Socket id of the joining client — same identity scheme as the facilitator. */
  playerId: string;
  /** Handler-validated (trimmed, 1–24 chars); this function trusts it. */
  displayName: string;
  /** Handler-validated (never 'facilitator'); this function trusts it. */
  role: PlayerRole;
}

/**
 * Pure join: returns a new SessionState with the player added to the roster.
 * No I/O, no clock, no randomness — same discipline as createSessionState.
 *
 * Idempotency guard: if the playerId is already in the roster, the state is
 * returned unchanged (same reference). This keeps a duplicate SESSION_JOIN a
 * no-op and — critically — means a facilitator re-joining their own session
 * can never demote their 'facilitator' role.
 *
 * No teamId is assigned here — team assignment is Story 2.4's TEAM_ASSIGN.
 */
export function addPlayerToSession(state: SessionState, args: JoinPlayerArgs): SessionState {
  if (state.players[args.playerId] !== undefined) return state;

  const player: PlayerInfo = {
    playerId: args.playerId,
    displayName: args.displayName,
    role: args.role,
    isReady: false,
  };

  return {
    ...state,
    players: { ...state.players, [args.playerId]: player },
  };
}
