import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';

/**
 * Pure transition: preparation → (lobby | between-rounds) — the exact inverse of
 * `openPreparation` (Story 8.3, extended by 8.6). Decrements `roundNumber` back
 * so a cancel + re-open lands on the same number (the seed chain in Story 8.2
 * must not skip a roundNumber for a round that never ran). No I/O, no clock, no
 * randomness.
 *
 * ORIGINATING-PHASE RESTORE (Story 8.6, AC-4): prep can now be opened from EITHER
 * 'lobby' (round 1) or 'between-rounds' (round 2+), so cancel must restore the
 * right one rather than hard-coding 'lobby'. We derive it from `roundNumber`:
 * a session starts at roundNumber 0 in the lobby (createSession) and
 * `openPreparation` increments, so while in 'preparation' roundNumber === 1 ⟺
 * opened from the lobby (round 1) and roundNumber >= 2 ⟺ opened from
 * between-rounds. When restoring 'between-rounds' we also REVERSE the per-team
 * `currentDefuserIndex` advance that `openPreparation` applied (−1), so
 * open∘cancel is the identity and a cancel + re-advance lands on the same Defuser.
 *
 * RETRY RECONCILE (Story 8.8 — resolves deferred-work.md:7): a retry preparation
 * (entered via `retryRound`, not `openPreparation`) reuses the SAME `roundNumber`
 * and does NOT advance the rotation pointer. So the monotonic `roundNumber >= 2`
 * derivation + blind `−1` reversal below would CORRUPT the relay if applied to a
 * cancelled retry prep (it would wrongly decrement `roundNumber` and every
 * `currentDefuserIndex`). We detect a retry prep by its `retryingTeamId` marker
 * and cancel it cleanly: return to 'between-rounds' clearing the marker, with
 * `roundNumber` AND every pointer UNCHANGED. The non-retry open∘cancel identity
 * is preserved exactly for normal preps.
 *
 * Why this exists: a facilitator who opens prep before assigning anyone to a
 * team (or who simply changes their mind) was otherwise stranded — prep had no
 * exit and ROUND_START refuses with NO_POPULATED_TEAM. This is the back door.
 *
 * Guard (defensive — the handler errors first, but pure functions never
 * trust): any status other than 'preparation' returns the same reference, so a
 * duplicate emit is a structural no-op for the handler.
 */
export function cancelPreparation(state: SessionState): SessionState {
  if (state.status !== 'preparation') return state;

  // Retry prep (Story 8.8): clear the marker, return to between-rounds, leave
  // roundNumber + every currentDefuserIndex untouched (retryRound never advanced
  // them). Strip retryingTeamId via rest-destructure (immutable).
  if (state.retryingTeamId !== undefined) {
    const { retryingTeamId: _consumed, ...rest } = state;
    return { ...rest, status: 'between-rounds' };
  }

  const returnTo = state.roundNumber >= 2 ? 'between-rounds' : 'lobby';

  // Reverse the rotation advance openPreparation applied on the between-rounds
  // path (round 2+). The lobby path never advanced, so leave indices untouched.
  const teams =
    returnTo === 'between-rounds'
      ? (Object.fromEntries(
          Object.entries(state.teams).map(([teamId, team]) => [
            teamId,
            { ...team, currentDefuserIndex: team.currentDefuserIndex - 1 },
          ]),
        ) as Partial<Record<TeamId, TeamState>>)
      : state.teams;

  return { ...state, status: returnTo, roundNumber: state.roundNumber - 1, teams };
}
