import type { SessionState } from '@bomb-squad/shared';

/**
 * Pure transition: preparation → (lobby | between-rounds) — the inverse of
 * `openPreparation` (Story 8.3, extended by 8.6, simplified by 8.11). Decrements
 * `roundNumber` back so a cancel + re-open lands on the same number (the seed
 * chain in Story 8.2 must not skip a roundNumber for a round that never ran). No
 * I/O, no clock, no randomness.
 *
 * ORIGINATING-PHASE RESTORE (Story 8.6, AC-4): prep can be opened from EITHER
 * 'lobby' (round 1) or 'between-rounds' (round 2+), so cancel restores the right
 * one. We derive it from `roundNumber`: a session starts at roundNumber 0 in the
 * lobby and `openPreparation` increments, so while in 'preparation' roundNumber
 * === 1 ⟺ opened from the lobby and roundNumber >= 2 ⟺ opened from between-rounds.
 *
 * MODEL B (Story 8.11): `openPreparation` no longer advances the per-team rotation
 * pointers (a pointer advances only when its team plays, in `resolveRound`), so
 * there is NOTHING to reverse here — the old uniform `currentDefuserIndex - 1`
 * reversal is GONE. Cancel only rolls back `roundNumber`, restores the originating
 * phase, and clears the transient `activeTeamId` selection. open∘cancel is the
 * identity for the pointers because neither touches them.
 *
 * RETRY RECONCILE (Story 8.8): a retry preparation (entered via `retryRound`)
 * reuses the SAME `roundNumber` and never advanced anything. We detect it by its
 * `retryingTeamId` marker and cancel cleanly: return to 'between-rounds' clearing
 * BOTH the retry marker and `activeTeamId`, with `roundNumber` AND every pointer
 * UNCHANGED.
 *
 * Guard (defensive): any status other than 'preparation' returns the same
 * reference, so a duplicate emit is a structural no-op for the handler.
 */
export function cancelPreparation(state: SessionState): SessionState {
  if (state.status !== 'preparation') return state;

  // Retry prep (Story 8.8): clear the retry marker + activeTeamId, return to
  // between-rounds, leave roundNumber + every pointer untouched (retryRound never
  // advanced them). Strip the transient fields via rest-destructure (immutable).
  if (state.retryingTeamId !== undefined) {
    const { retryingTeamId: _retry, activeTeamId: _active, ...rest } = state;
    return { ...rest, status: 'between-rounds' };
  }

  const returnTo = state.roundNumber >= 2 ? 'between-rounds' : 'lobby';

  // Clear the transient active-team selection (immutable rest-destructure). No
  // pointer reversal — openPreparation no longer advances them (Model B).
  const { activeTeamId: _active, ...rest } = state;
  return { ...rest, status: returnTo, roundNumber: state.roundNumber - 1 };
}
