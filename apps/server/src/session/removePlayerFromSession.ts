import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';

/**
 * Pure removal (Story 2.7): returns a new SessionState with the player gone from
 * the roster AND pruned from any team's relayOrder, so no ghost relay entry
 * survives. No I/O, no clock, no randomness — same discipline as
 * addPlayerToSession / assignPlayerToTeam.
 *
 * Mirrors assignPlayerToTeam's `teams` ownership: a team whose relayOrder
 * empties after the prune is deleted, keeping `teams` matching its Partial
 * semantics (a team exists iff someone is on it). `currentDefuserIndex` is left
 * untouched — this reducer is lobby-phase only (the handler guards on status),
 * where no round has run, so there is nothing to clamp.
 *
 * Idempotency guard (defensive — the handler checks first, but pure functions
 * never trust): an absent playerId returns the same reference, so the caller's
 * updateJSON commits nothing.
 */
export function removePlayerFromSession(state: SessionState, playerId: string): SessionState {
  if (state.players[playerId] === undefined) return state;

  const players = { ...state.players };
  delete players[playerId];

  // Prune the id from any team's relayOrder; delete a team that empties.
  let teams: Partial<Record<TeamId, TeamState>> | undefined;
  for (const [teamId, team] of Object.entries(state.teams) as [TeamId, TeamState][]) {
    if (!team.relayOrder.includes(playerId)) continue;
    teams ??= { ...state.teams };
    const relayOrder = team.relayOrder.filter((id) => id !== playerId);
    if (relayOrder.length === 0) {
      delete teams[teamId];
    } else {
      teams[teamId] = { ...team, relayOrder };
    }
  }

  return { ...state, players, ...(teams !== undefined ? { teams } : {}) };
}
