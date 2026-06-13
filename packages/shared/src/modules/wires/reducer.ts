import type { ModuleState, Reducer } from '../../types/index.js';
import { isWiresAction, type WiresState } from './types.js';
import { solveWires } from './solve.js';

/**
 * Pure reducer for the wires module.
 *
 * Contract obligations (project-context Testing Rules):
 * - Actions arrive as `unknown` (untrusted client input) — guard, never throw.
 * - Never mutate input state; return new objects via spread/map.
 * - 'struck' is TRANSIENT: returned to signal a wrong cut; the bomb reducer
 *   rolls it into a team strike and re-arms the module. The severed wire
 *   stays severed in data (cuts are physical).
 * - Cutting an already-severed wire is a no-op (idempotent — never a second
 *   strike for the same wire).
 * - MODULE_RESET (forwarded whole by the bomb reducer, bypassing its
 *   solved-inert guard) restores all wires uncut; layout/solution unchanged.
 * - No Date.now(), no Math.random(), no I/O.
 */
export const wiresReducer: Reducer<ModuleState<WiresState>, unknown> = (state, action) => {
  if (!isWiresAction(action)) return state; // guard: malformed/unknown action → no-op

  if (action.type === 'MODULE_RESET') {
    return {
      ...state,
      status: 'armed',
      data: {
        ...state.data,
        wires: state.data.wires.map((wire) => (wire.cut ? { ...wire, cut: false } : wire)),
      },
    };
  }

  // Defense-in-depth: the bomb reducer already keeps solved modules inert,
  // but the module reducer must be safe standalone (sandbox runs it directly).
  if (state.status === 'solved') return state;

  const { wireIndex } = action;
  if (!Number.isInteger(wireIndex) || wireIndex < 0 || wireIndex >= state.data.wires.length) {
    return state; // guard: out-of-bounds / NaN / fractional index → no-op
  }
  if (state.data.wires[wireIndex].cut) return state; // idempotent: severed stays severed

  // Recompute the answer at cut-time from the colour layout (cut-invariant) +
  // the public ctx in state — never a pre-computed solution in module data
  // (Sprint 2 retro AI1). solveWires is pure and cheap (≤6 wires, ≤5 rules).
  const solutionIndex = solveWires(
    state.data.wires.map((wire) => wire.color),
    state.data.ctx,
  );

  return {
    ...state,
    status: wireIndex === solutionIndex ? 'solved' : 'struck',
    data: {
      ...state.data,
      wires: state.data.wires.map((wire, i) => (i === wireIndex ? { ...wire, cut: true } : wire)),
    },
  };
};
