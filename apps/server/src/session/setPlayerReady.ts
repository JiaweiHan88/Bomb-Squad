import type { SessionState } from '@bomb-squad/shared';

/**
 * Pure ready-toggle (Story 2.5): returns a new SessionState with the player's
 * `isReady` set to the given value, preserving every other field. No I/O, no
 * clock, no randomness — same discipline as assignPlayerToTeam /
 * removePlayerFromSession.
 *
 * `isReady` is informational (the roster reflects it; the facilitator may open
 * preparation regardless), so this reducer owns nothing but the one field.
 *
 * Guard clauses (defensive — the handler checks first, but pure functions never
 * trust):
 * - unknown playerId → return the same reference (nothing to toggle);
 * - already exactly `isReady` → return the same reference (idempotent), so the
 *   caller's updateJSON commits nothing and broadcasts nothing.
 */
export function setPlayerReady(
  state: SessionState,
  playerId: string,
  isReady: boolean,
): SessionState {
  const player = state.players[playerId];
  if (player === undefined) return state;
  if (player.isReady === isReady) return state;

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, isReady },
    },
  };
}
