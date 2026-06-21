import type { SessionState } from '@bomb-squad/shared';
import { isRelayComplete } from './relayComplete.js';

/**
 * Pure transition: between-rounds → ended (Story 8.10, FR45). No I/O, no clock —
 * the Postgres archive write lives in the SESSION_END handler; this only flips the
 * phase. Same guard discipline as `openPreparation`: any non-eligible state returns
 * the SAME reference (a structural no-op the handler treats as idempotent).
 *
 * Eligible ONLY from `'between-rounds'` AND when the relay is complete
 * (`isRelayComplete` — every team finished its rotation + owed equalisation rounds).
 * The handler gates on the same predicate before archiving, so this is the pure twin
 * of that check; calling it on an incomplete relay or wrong phase is a no-op.
 *
 * Clears the transient per-round intent (`activeTeamId` / `retryingTeamId`) — the
 * session is over, nothing is "up next".
 */
export function endSession(state: SessionState): SessionState {
  if (state.status !== 'between-rounds' || !isRelayComplete(state)) return state;

  const { activeTeamId: _active, retryingTeamId: _retrying, ...rest } = state;
  return { ...rest, status: 'ended' };
}
