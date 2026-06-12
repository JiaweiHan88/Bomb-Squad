import type { BombAction, BombState, ModuleState, Reducer, StrikeCount } from '@bomb-squad/shared';
import { MODULE_REDUCERS, type ModuleReducer } from './MODULE_REDUCERS.js';

/**
 * Defensive guard on module-reducer output (closes the 1.6-deferred item):
 * the registry erases per-module types, so a buggy reducer could return a
 * rebound moduleId (permanently re-routing the slot to another reducer) or an
 * out-of-contract status. Out-of-contract output is dropped — the action
 * becomes a no-op rather than corrupting bomb state.
 */
function isContractResult(
  prev: ModuleState<unknown>,
  next: ModuleState<unknown> | null | undefined,
): next is ModuleState<unknown> {
  return (
    typeof next === 'object' &&
    next !== null &&
    next.moduleId === prev.moduleId &&
    (next.status === 'armed' || next.status === 'solved' || next.status === 'struck')
  );
}

function applyModuleResult(
  state: BombState,
  moduleIndex: number,
  next: ModuleState<unknown>,
): BombState {
  // Build new modules array — never mutate in place.
  const wasStruck = next.status === 'struck';
  const newModules = state.modules.map((m, i) => {
    if (i !== moduleIndex) return m;
    // 'struck' is transient: roll up into team strike, then reset to 'armed'.
    return wasStruck ? { ...next, status: 'armed' as const } : next;
  });

  const newStrikes: StrikeCount = wasStruck
    ? (Math.min(state.strikes + 1, 3) as StrikeCount)
    : state.strikes;

  // A bomb is solved when it has at least one module and all modules are solved.
  const solved = newModules.length > 0 && newModules.every((m) => m.status === 'solved');

  return { ...state, modules: newModules, strikes: newStrikes, solved };
}

export function createBombReducer(
  registry: Record<string, ModuleReducer>,
): Reducer<BombState, BombAction> {
  return (state, action) => {
    switch (action.type) {
      case 'MODULE_ACTION': {
        const mod = state.modules[action.moduleIndex];
        if (!mod) return state; // guard: unknown index → no-op
        // Solved modules are inert: further interactions are ignored. This keeps a
        // solved module from striking on stray input and prevents `solved` from
        // ever regressing true → false.
        if (mod.status === 'solved') return state;
        const reduce = registry[mod.moduleId];
        if (!reduce) return state; // guard: unregistered module → no-op
        const next = reduce(mod, action.payload);
        if (!isContractResult(mod, next)) return state; // guard: out-of-contract output → no-op
        return applyModuleResult(state, action.moduleIndex, next);
      }
      case 'MODULE_RESET': {
        const mod = state.modules[action.moduleIndex];
        if (!mod) return state; // guard: unknown index → no-op
        const reduce = registry[mod.moduleId];
        if (!reduce) return state; // guard: unregistered module → no-op
        // Reset deliberately bypasses the solved-inert guard above: the module
        // reducer restores its initial state, so a solved module returns to 'armed'.
        // The full action is passed so the module reducer can discriminate on `type`.
        const next = reduce(mod, action);
        if (!isContractResult(mod, next)) return state; // guard: out-of-contract output → no-op
        return applyModuleResult(state, action.moduleIndex, next);
      }
      default:
        // Unknown action types fall through — never throw.
        return state;
    }
  };
}

export const bombReducer = createBombReducer(MODULE_REDUCERS);
