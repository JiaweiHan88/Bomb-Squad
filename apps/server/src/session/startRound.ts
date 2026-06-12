import type { PlayerInfo, RoundState, SessionState, TeamId } from '@bomb-squad/shared';

/**
 * Discriminated result: the handler needs both the next SessionState and the
 * RoundState to persist (two keys), or a machine-readable reason to refuse.
 * Pure functions never throw on bad input (project rule).
 */
export type StartRoundResult =
  | { ok: true; state: SessionState; round: RoundState }
  | { ok: false; reason: 'NOT_IN_PREPARATION' | 'NO_POPULATED_TEAM' };

/**
 * Pure transition: preparation → active, committing the Defuser per team by
 * rotation (Story 8.3, FR11). No I/O, no clock, no randomness.
 *
 * Rotation pick = `relayOrder[currentDefuserIndex]` (relayOrder = team join /
 * assignment order, the GDD default rotation). The index is normalized with a
 * non-negative modulo before use — the read-side resolution of the deferred
 * 2.4 review item "`currentDefuserIndex` not re-clamped when a player leaves
 * relayOrder" (deferred-work.md). Pointer ADVANCEMENT between rounds belongs
 * to Stories 8.6/8.9; this function only reads it.
 *
 * Role commitment (one defuser per team, settled in the story spec):
 * - The selected player becomes 'defuser' — even if currently 'spectator';
 *   relay order is the authority (GDD: every player defuses).
 * - Any OTHER player on that team holding 'defuser' becomes 'expert'.
 * - The facilitator and off-team players are never touched.
 *
 * Integrity guard: a team whose selected relayOrder entry is missing from
 * `players` (the known relayOrder ↔ teamId divergence, deferred-work.md) is
 * skipped rather than crashing; if every populated team is skipped the start
 * is refused.
 */
export function startRound(state: SessionState): StartRoundResult {
  if (state.status !== 'preparation') return { ok: false, reason: 'NOT_IN_PREPARATION' };

  const defusers: Partial<Record<TeamId, string>> = {};
  for (const team of Object.values(state.teams)) {
    const len = team.relayOrder.length;
    if (len === 0) continue;
    const index = ((team.currentDefuserIndex % len) + len) % len;
    const playerId = team.relayOrder[index]!;
    if (state.players[playerId] === undefined) continue;
    defusers[team.teamId] = playerId;
  }
  if (Object.keys(defusers).length === 0) return { ok: false, reason: 'NO_POPULATED_TEAM' };

  const players: Record<string, PlayerInfo> = { ...state.players };
  for (const [teamId, defuserId] of Object.entries(defusers) as [TeamId, string][]) {
    for (const player of Object.values(state.players)) {
      if (player.teamId !== teamId) continue;
      if (player.playerId === defuserId) {
        if (player.role !== 'defuser') players[player.playerId] = { ...player, role: 'defuser' };
      } else if (player.role === 'defuser') {
        players[player.playerId] = { ...player, role: 'expert' };
      }
    }
  }

  return {
    ok: true,
    state: { ...state, status: 'active', players },
    round: {
      roundNumber: state.roundNumber,
      status: 'active',
      defusers,
      retry: false, // Story 8.8 owns retry.
    },
  };
}
