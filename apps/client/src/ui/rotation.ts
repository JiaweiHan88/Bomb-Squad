import type { TeamState } from '@bomb-squad/shared';

/**
 * The player the prep surface shows as the upcoming Defuser for a team. This MUST
 * mirror the server's pick in `apps/server/src/session/startRound.ts` — the prep
 * surface shows this derivation; ROUND_START commits it. Drift is a bug (story 8.3
 * decision 2).
 *
 * The index is read RAW (Story 8.9 removed the wrapping modulo). Under Model B
 * (Story 8.11) `currentDefuserIndex` is the team's NEXT un-played slot (= natural
 * rounds played), so `relayOrder[currentDefuserIndex]` is exactly the player about
 * to defuse — this expression is unchanged from 8.9 and still mirrors
 * `startRound`'s pick. (Whether the team plays THIS round is the caller's concern:
 * the prep surface only shows this for the ACTIVE team — Story 8.11.)
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
