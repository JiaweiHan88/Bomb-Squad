import type { SessionState, TeamId } from '@bomb-squad/shared';

/**
 * Pure transition: between-rounds → preparation for a RETRY of the just-resolved
 * round (Story 8.8, FR14). No I/O, no clock, no randomness — same discipline as
 * `openPreparation`/`cancelPreparation`.
 *
 * The crucial difference from `openPreparation`: a retry re-attempts the SAME
 * round, so `roundNumber` is UNCHANGED and every team's `currentDefuserIndex` is
 * UNCHANGED. Reusing the same `roundNumber` is exactly what makes the seed chain
 * (`templateSeed = hash(sessionId + ":" + roundNumber)`) reproduce the identical
 * bomb on the subsequent ROUND_START (Story 8.2 / NFR10 — the reused-seed
 * guarantee). `openPreparation` would `+1` both, which is wrong for a retry.
 *
 * It records the retry intent in the transient `retryingTeamId` marker (the team
 * re-attempting the failed round) PLUS `retryDefuserId` — the EXACT player who
 * played the failed round, supplied by the handler from the persisted
 * `RoundState.defusers[teamId]`. `startRound` consumes + clears both: only that
 * team is armed, with that SAME Defuser; the other team rests (reusing the Story
 * 8.9 resting-team machinery). The Defuser is carried EXPLICITLY rather than
 * recomputed from the rotation pointer because under Model B (Story 8.11) the
 * pointer ADVANCES at resolve, so by retry time `currentDefuserIndex` already
 * points at the NEXT player — recomputing it would arm the wrong Defuser (the
 * Jay-reported 2026-06-21 bug). The failed-round eligibility gate (was this team's
 * last outcome a failure?) lives in the handler, which loads the persisted
 * `RoundState.outcomes` — this pure transition only flips the phase + records
 * intent.
 *
 * Guard (defensive — the handler errors first, but pure functions never trust):
 * any status other than 'between-rounds' returns the same reference, so a
 * duplicate emit is a structural no-op for the handler.
 */
export function retryRound(state: SessionState, teamId: TeamId, defuserId: string): SessionState {
  if (state.status !== 'between-rounds') return state;
  // Set activeTeamId too (Story 8.11): the retrying team IS the active team this
  // round, so the client routes the other team to spectate. `startRound`'s retry
  // branch arms `retryDefuserId`; `cancelPreparation` clears all three markers.
  return { ...state, status: 'preparation', retryingTeamId: teamId, retryDefuserId: defuserId, activeTeamId: teamId };
}
