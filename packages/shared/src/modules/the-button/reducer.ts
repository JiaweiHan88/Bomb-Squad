import type { ModuleState, Reducer } from '../../types/index.js';
import { isButtonAction, type ButtonState } from './types.js';
import { decideButton, releaseDigitFor } from './solve.js';

/**
 * Pure reducer for The Button module.
 *
 * Interaction model (matches modulePressHoldHandlers, which never measures hold
 * duration): the only verbs are PRESS (pointer-down) and RELEASE (pointer-up);
 * the reducer judges what the pair meant from the GDD rule decision.
 *
 *  - PRESS → reveal the strip (`held: true`). No solve / strike yet. Idempotent
 *    while already held.
 *  - RELEASE on a TAP-answer button → solves regardless of the timer (a
 *    press-and-release is the correct play; the strip is irrelevant).
 *  - RELEASE on a HOLD-answer button → solves iff the displayed timer shows the
 *    strip's required digit in any position (`timerDigits.includes(...)`),
 *    otherwise a strike. RELEASE always clears `held`.
 *
 * Contract obligations (project-context Testing Rules):
 *  - Actions arrive as `unknown` (untrusted) — guard, never throw.
 *  - Never mutate input state; return new objects via spread.
 *  - 'struck' is TRANSIENT: the bomb reducer rolls it into a team strike and
 *    re-arms the module (4.3/5.3 roll-up contract).
 *  - solved-inert: actions on a solved module are no-ops.
 *  - MODULE_RESET (forwarded whole, bypassing the bomb reducer's solved guard)
 *    re-arms and un-holds; the generated layout/strip is preserved.
 *  - No Date.now(), no Math.random(), no I/O — the live timer enters as the
 *    RELEASE action's `timerDigits` input.
 */
export const buttonReducer: Reducer<ModuleState<ButtonState>, unknown> = (state, action) => {
  if (!isButtonAction(action)) return state; // guard: malformed/unknown action → no-op

  if (action.type === 'MODULE_RESET') {
    return state.status === 'armed' && !state.data.held
      ? state // already in the reset shape — avoid a needless new object
      : { ...state, status: 'armed', data: { ...state.data, held: false } };
  }

  // Defense-in-depth: the bomb reducer keeps solved modules inert, but the
  // module reducer must be safe standalone (the sandbox runs it directly).
  if (state.status === 'solved') return state;

  if (action.type === 'PRESS') {
    if (state.data.held) return state; // idempotent: already held
    return { ...state, data: { ...state.data, held: true } };
  }

  // RELEASE
  if (!state.data.held) return state; // a release with no matching press is a no-op

  const decision = decideButton(state.data.color, state.data.label, state.data.ctx);
  const solved =
    decision === 'tap'
      ? true // press-and-release: the timer is irrelevant
      : action.timerDigits.includes(releaseDigitFor(state.data.stripColor));

  return {
    ...state,
    status: solved ? 'solved' : 'struck',
    data: { ...state.data, held: false },
  };
};
