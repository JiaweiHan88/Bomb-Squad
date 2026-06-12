import type { BombAction, BombState, ModuleState, Reducer, StrikeCount } from '@bomb-squad/shared';
import { MODULE_REDUCERS, type ModuleReducer } from './MODULE_REDUCERS.js';

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
    if (action.type === 'MODULE_ACTION') {
      const mod = state.modules[action.moduleIndex];
      if (!mod) return state; // guard: unknown index → no-op
      const reduce = registry[mod.moduleId];
      if (!reduce) return state; // guard: unregistered module → no-op
      return applyModuleResult(state, action.moduleIndex, reduce(mod, action.payload));
    }
    // Unknown action types fall through — never throw.
    return state;
  };
}

export const bombReducer = createBombReducer(MODULE_REDUCERS);
