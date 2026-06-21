import type { SessionState } from '@bomb-squad/shared';
import { selectActiveTeam } from './relayComplete.js';

/**
 * Pure transition: lobby | between-rounds → preparation (Story 8.3, FR8).
 * No I/O, no clock, no randomness — same discipline as assignPlayerToTeam.
 *
 * `roundNumber` increments HERE, not at ROUND_START: prep belongs to a
 * specific round (Story 8.6: "the next round's Preparation phase begins for
 * the next Defuser"), and Story 8.2's seed chain needs the number settled
 * before generation runs inside ROUND_START.
 *
 * ACTIVE-TEAM SELECTION (Story 8.11, Model B — REPLACES the 8.6/8.9 uniform
 * advance): exactly ONE team plays each round. We pick it with the pure shared
 * `selectActiveTeam` (the snake rule) BEFORE the `+1` so it reads the
 * just-finished `roundNumber` and computes the round about to open
 * (`roundNumber + 1`); the result is stashed in `activeTeamId` for `startRound`
 * to consume and the client to route on. The per-team rotation pointers are NO
 * LONGER advanced here — under Model B a pointer advances ONLY when its team
 * actually plays, which `resolveRound` now does (decision recorded in Story 8.11
 * Task 2). This removes the old "advance EVERY team's `currentDefuserIndex` by
 * +1" write entirely, so `cancelPreparation` has nothing to reverse.
 *
 * The retry path (`retryRound`, not this function) sets `activeTeamId =
 * retryingTeamId` itself and leaves `roundNumber`/pointers untouched.
 *
 * Prep has no countdown — GDD A9 says facilitator-controlled; the phase ends
 * when the facilitator sends ROUND_START.
 *
 * Guard (defensive — the handler errors first, but pure functions never
 * trust): any other status returns the state unchanged (same reference), so
 * a duplicate emit is a structural no-op for the handler.
 */
export function openPreparation(state: SessionState): SessionState {
  if (state.status !== 'lobby' && state.status !== 'between-rounds') return state;

  // Select the single active team for the round about to open (snake rule). Read
  // on the pre-increment state so `selectActiveTeam` computes for `roundNumber+1`.
  const activeTeamId = selectActiveTeam(state);

  return {
    ...state,
    status: 'preparation',
    roundNumber: state.roundNumber + 1,
    activeTeamId,
  };
}
