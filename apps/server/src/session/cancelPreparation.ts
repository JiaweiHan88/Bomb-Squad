import type { SessionState } from '@bomb-squad/shared';

/**
 * Pure transition: preparation → lobby (Story 8.3). The exact inverse of
 * `openPreparation` — it decrements `roundNumber` back so a cancel + re-open
 * lands on the same number (the seed chain in Story 8.2 must not skip a
 * roundNumber for a round that never ran). No I/O, no clock, no randomness.
 *
 * Why this exists: a facilitator who opens prep before assigning anyone to a
 * team (or who simply changes their mind) was otherwise stranded — prep had no
 * exit and ROUND_START refuses with NO_POPULATED_TEAM. This is the back door.
 *
 * Guard (defensive — the handler errors first, but pure functions never
 * trust): any status other than 'preparation' returns the same reference, so a
 * duplicate emit is a structural no-op for the handler.
 *
 * Scope note: prep is only reachable from 'lobby' in Story 8.3, so cancel
 * always returns to 'lobby'. When 'between-rounds' → preparation becomes
 * reachable (Stories 8.5/8.6), cancel must restore the originating phase rather
 * than hard-coding 'lobby'.
 */
export function cancelPreparation(state: SessionState): SessionState {
  if (state.status !== 'preparation') return state;
  return { ...state, status: 'lobby', roundNumber: state.roundNumber - 1 };
}
