import type { ModuleState, Reducer } from '../../types/index.js';
import { isPasswordsAction, LETTERS_PER_COLUMN, type PasswordsState } from './types.js';
import { currentWord, isValidPassword } from './solve.js';

/**
 * Pure reducer for the Passwords module.
 *
 *  - CYCLE → advance one column's shown letter by ±1, wrapping (non-negative
 *    modulo) within its six letters. No solve/strike — just moves the column.
 *  - SUBMIT → if the five visible letters spell a listed word, solve; otherwise
 *    strike. On a strike the columns/positions are UNCHANGED so the team can
 *    keep cycling and retry.
 *
 * Contract obligations (project-context Testing Rules):
 *  - Actions arrive as `unknown` (untrusted) — guard, never throw. Out-of-bounds
 *    / NaN columnIndex and bad direction fall through unchanged.
 *  - Never mutate input state; return new objects via spread/map.
 *  - 'struck' is TRANSIENT: the bomb reducer rolls it into a team strike and
 *    re-arms the module (4.3/5.3 roll-up contract).
 *  - solved-inert: actions on a solved module are no-ops.
 *  - MODULE_RESET (forwarded whole, bypassing the bomb reducer's solved guard)
 *    re-arms and restores the generated start positions (faithful reset).
 *  - No Date.now(), no Math.random(), no I/O — Passwords has no time dependency.
 */
export const passwordsReducer: Reducer<ModuleState<PasswordsState>, unknown> = (state, action) => {
  if (!isPasswordsAction(action)) return state; // guard: malformed/unknown action → no-op

  if (action.type === 'MODULE_RESET') {
    const atStart =
      state.data.positions.length === state.data.startPositions.length &&
      state.data.positions.every((p, i) => p === state.data.startPositions[i]);
    return state.status === 'armed' && atStart
      ? state // already in the reset shape — avoid a needless new object
      : { ...state, status: 'armed', data: { ...state.data, positions: [...state.data.startPositions] } };
  }

  // Defense-in-depth: the bomb reducer keeps solved modules inert, but the
  // module reducer must be safe standalone (the sandbox runs it directly).
  if (state.status === 'solved') return state;

  if (action.type === 'CYCLE') {
    const { columnIndex, direction } = action;
    // Bounds/NaN guard: untrusted client input (project-context security rule).
    if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= state.data.positions.length) {
      return state;
    }
    const delta = direction === 'up' ? 1 : -1;
    const next = (((state.data.positions[columnIndex] + delta) % LETTERS_PER_COLUMN) + LETTERS_PER_COLUMN) % LETTERS_PER_COLUMN;
    const positions = state.data.positions.map((p, i) => (i === columnIndex ? next : p));
    return { ...state, data: { ...state.data, positions } };
  }

  // SUBMIT — recompute the shown word and check public list membership (no
  // stored answer). Columns/positions are left untouched either way.
  const solved = isValidPassword(currentWord(state.data));
  return { ...state, status: solved ? 'solved' : 'struck' };
};
