import type { ModuleState, Reducer } from '../../types/index.js';
import { isDevDemoAction, type DevDemoState } from './types.js';
import { classifyCut, classifyRelease } from './solve.js';

/**
 * Pure reducer for the dev-demo module.
 *
 * Contract obligations (every module reducer must satisfy these — reviewed
 * against project-context Testing Rules):
 * - Actions arrive as `unknown` (untrusted client input) — guard, never throw.
 * - Never mutate input state; return new objects via spread.
 * - 'struck' is TRANSIENT: returned to signal a wrong interaction; the bomb
 *   reducer rolls it into a team strike and re-arms the module.
 * - Repeating a completed action is a no-op (severed wire, released button).
 * - MODULE_RESET (forwarded whole by the bomb reducer, bypassing its
 *   solved-inert guard) restores the initial generated state.
 * - No Date.now(), no Math.random(), no I/O.
 */
export const devDemoReducer: Reducer<ModuleState<DevDemoState>, unknown> = (state, action) => {
  if (!isDevDemoAction(action)) return state; // guard: malformed/unknown action → no-op

  if (action.type === 'MODULE_RESET') {
    return {
      ...state,
      status: 'armed',
      data: { ...state.data, wireCut: false, held: false },
    };
  }

  // Defense-in-depth: the bomb reducer already keeps solved modules inert,
  // but the module reducer must be safe standalone (sandbox runs it directly).
  if (state.status === 'solved') return state;

  switch (action.type) {
    case 'CUT': {
      if (state.data.wireCut) return state; // idempotent: a severed wire stays severed
      const verdict = classifyCut(state.data);
      return {
        ...state,
        // 'progress' (cut-press step 1): the cut is correct but doesn't solve.
        status: verdict === 'solve' ? 'solved' : verdict === 'strike' ? 'struck' : state.status,
        data: { ...state.data, wireCut: true },
      };
    }
    case 'BUTTON_DOWN': {
      if (state.data.held) return state; // idempotent: already held
      return { ...state, data: { ...state.data, held: true } };
    }
    case 'BUTTON_UP': {
      if (!state.data.held) return state; // guard: release without a press
      const verdict = classifyRelease(state.data); // never 'progress' for a release
      return {
        ...state,
        status: verdict === 'solve' ? 'solved' : 'struck',
        data: { ...state.data, held: false },
      };
    }
    default:
      return state;
  }
};
