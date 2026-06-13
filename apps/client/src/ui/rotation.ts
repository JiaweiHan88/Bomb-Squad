import type { TeamState } from '@bomb-squad/shared';

/**
 * The player next in rotation for a team: `relayOrder[currentDefuserIndex]`,
 * index normalized with a non-negative modulo. This MUST mirror the server's
 * pick in `apps/server/src/session/startRound.ts` — the prep surface shows
 * this derivation; ROUND_START commits it. Drift between the two is a bug
 * (story 8.3 decision 2).
 */
export function upcomingDefuserId(team: TeamState): string | null {
  const len = team.relayOrder.length;
  if (len === 0) return null;
  const index = ((team.currentDefuserIndex % len) + len) % len;
  return team.relayOrder[index] ?? null;
}
