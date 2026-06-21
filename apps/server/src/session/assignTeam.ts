import type { PlayerRole, SessionState, TeamId, TeamState } from '@bomb-squad/shared';

export interface AssignTeamArgs {
  /** Roster key of the target player. Handler-validated to exist; this function guards anyway. */
  playerId: string;
  teamId: TeamId;
  /** Handler-validated (never 'facilitator'); this function trusts it. */
  role: PlayerRole;
}

/**
 * Pure assignment: returns a new SessionState with the player moved onto a
 * team with the given role. No I/O, no clock, no randomness — same discipline
 * as createSessionState / addPlayerToSession.
 *
 * This function owns the `teams` record. `relayOrder` is kept equal to
 * assignment order because the GDD's default defuse rotation IS team join
 * order; Epic 8 stories own reordering and rotation mechanics. Rules:
 * - The target TeamState is created lazily on first assignment.
 * - A player joins the end of the target team's relayOrder (once).
 * - Moving teams removes the player from the old relayOrder; an emptied team
 *   is deleted, keeping `teams` matching its Partial semantics (a team exists
 *   iff someone is on it).
 * - A role-only change never moves the player's relayOrder position.
 * - `currentDefuserIndex` stays 0: the handler's lobby-phase guard means no
 *   round has ever run when team MOVES execute (TEAM_ASSIGN only moves teams in
 *   the lobby), so there is nothing to clamp here. Story 8.9 resolves the
 *   deferred "index not re-clamped on a cross-team move" item (deferred-work.md)
 *   at the READ side instead: `startRound` no longer wraps the index with a
 *   modulo — it reads it RAW with an `0 <= index < relayOrder.length` bounds
 *   check, so an out-of-range index cleanly yields "no natural pick" (exhausted)
 *   rather than wrapping to the wrong player. The Story 8.9 equalisation
 *   volunteer designation is a role-only change (no team move, no relayOrder
 *   mutation), so it likewise never desynchronises the index.
 *
 * Guard clauses (defensive — the handler errors first, but pure functions
 * never trust): unknown playerId or a facilitator target returns the state
 * unchanged (same reference). Idempotency: re-asserting the player's current
 * teamId + role also returns the same reference, so a duplicate emit is a
 * structural no-op for the handler (no persist, no broadcast).
 */
export function assignPlayerToTeam(state: SessionState, args: AssignTeamArgs): SessionState {
  const player = state.players[args.playerId];
  if (player === undefined) return state;
  if (player.role === 'facilitator') return state;
  if (player.teamId === args.teamId && player.role === args.role) return state;

  const teams: Partial<Record<TeamId, TeamState>> = { ...state.teams };

  // Leaving a previous team: drop the player from its relayOrder.
  if (player.teamId !== undefined && player.teamId !== args.teamId) {
    const previous = teams[player.teamId];
    if (previous !== undefined) {
      const relayOrder = previous.relayOrder.filter((id) => id !== args.playerId);
      if (relayOrder.length === 0) {
        delete teams[player.teamId];
      } else {
        teams[player.teamId] = { ...previous, relayOrder };
      }
    }
  }

  // Joining the target team: create lazily, append once, preserve order.
  const target: TeamState = teams[args.teamId] ?? {
    teamId: args.teamId,
    relayOrder: [],
    currentDefuserIndex: 0,
    cumulativeTimeMs: 0,
    roundTimesMs: [],
    roundOutcomes: [], // Story 8.10: per-round outcome history (lock-step with roundTimesMs).
    equalisationRoundsPlayed: 0, // Story 8.9: a fresh team owes no equalisation yet.
  };
  teams[args.teamId] = target.relayOrder.includes(args.playerId)
    ? target
    : { ...target, relayOrder: [...target.relayOrder, args.playerId] };

  return {
    ...state,
    players: {
      ...state.players,
      [args.playerId]: { ...player, teamId: args.teamId, role: args.role },
    },
    teams,
  };
}
