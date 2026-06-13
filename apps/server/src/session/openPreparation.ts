import type { SessionState } from '@bomb-squad/shared';

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
 * Prep has no countdown — GDD A9 says facilitator-controlled (default
 * 2–5 min is display guidance); the phase ends when the facilitator sends
 * ROUND_START.
 *
 * Guard (defensive — the handler errors first, but pure functions never
 * trust): any other status returns the state unchanged (same reference), so
 * a duplicate emit is a structural no-op for the handler. `'between-rounds'`
 * is unreachable until Stories 8.5/8.6 land but is the documented contract.
 */
export function openPreparation(state: SessionState): SessionState {
  if (state.status !== 'lobby' && state.status !== 'between-rounds') return state;
  return { ...state, status: 'preparation', roundNumber: state.roundNumber + 1 };
}
