import type { TeamState } from '@bomb-squad/shared';

/**
 * The player the prep surface shows as the upcoming Defuser for a team. This MUST
 * mirror the server's pick in `apps/server/src/session/startRound.ts` — the prep
 * surface shows this derivation; ROUND_START commits it. Drift is a bug (story 8.3
 * decision 2).
 *
 * Story 8.9 removed the old non-negative modulo (which wrapped past the last
 * player — the rotation-never-ends bug): the index is read RAW.
 * - A natural rotation slot (`0 <= currentDefuserIndex < relayOrder.length`) →
 *   `relayOrder[currentDefuserIndex]`.
 * - Otherwise the team has exhausted its natural rotation. If the Facilitator has
 *   designated an equalisation volunteer it is the upcoming Defuser; else there is
 *   no upcoming Defuser for this team (it rests / awaits a volunteer) → null.
 */
export function upcomingDefuserId(team: TeamState): string | null {
  const { relayOrder, currentDefuserIndex } = team;
  if (currentDefuserIndex >= 0 && currentDefuserIndex < relayOrder.length) {
    return relayOrder[currentDefuserIndex] ?? null;
  }
  return team.equalisationVolunteerId ?? null;
}
