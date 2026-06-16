import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';

/**
 * Pure transition: lobby | between-rounds → preparation (Story 8.3, FR8).
 * No I/O, no clock, no randomness — same discipline as assignPlayerToTeam.
 *
 * `roundNumber` increments HERE, not at ROUND_START: prep belongs to a
 * specific round (Story 8.6: "the next round's Preparation phase begins for
 * the next Defuser"), and Story 8.2's seed chain
 * (`templateSeed = hash(sessionId + ":" + roundNumber)`) needs the number
 * settled before generation runs inside ROUND_START.
 *
 * ROTATION ADVANCE (Story 8.6, AC-3): when opening prep FROM 'between-rounds'
 * (i.e. for round 2+), every team's `currentDefuserIndex` advances by one so the
 * next round's Defuser is the next player in `relayOrder`. `startRound` only
 * READS the index (it normalizes with a non-negative modulo); this is the write
 * the `startRound.ts` "pointer ADVANCEMENT belongs to 8.6/8.9" seam pointed at.
 * Opening prep FROM 'lobby' (round 1) leaves indices at 0 — round 1 uses the
 * first player in rotation. Story 8.9 (relay orchestration / odd-team
 * equalisation) layers "every player defuses once" on top of this simple +1.
 *
 * Prep has no countdown — GDD A9 says facilitator-controlled (default
 * 2–5 min is display guidance); the phase ends when the facilitator sends
 * ROUND_START.
 *
 * Guard (defensive — the handler errors first, but pure functions never
 * trust): any other status returns the state unchanged (same reference), so
 * a duplicate emit is a structural no-op for the handler.
 */
export function openPreparation(state: SessionState): SessionState {
  if (state.status !== 'lobby' && state.status !== 'between-rounds') return state;

  // Advance the rotation pointer only when starting a NEW round after a previous
  // one (between-rounds → preparation). Round 1 (lobby → preparation) keeps 0.
  const advanceRotation = state.status === 'between-rounds';
  const teams = advanceRotation
    ? (Object.fromEntries(
        Object.entries(state.teams).map(([teamId, team]) => [
          teamId,
          { ...team, currentDefuserIndex: team.currentDefuserIndex + 1 },
        ]),
      ) as Partial<Record<TeamId, TeamState>>)
    : state.teams;

  return { ...state, status: 'preparation', roundNumber: state.roundNumber + 1, teams };
}
