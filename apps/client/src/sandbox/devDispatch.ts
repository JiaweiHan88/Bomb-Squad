import type { ModuleState, StrikeCount } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import type { ModuleActionDispatch } from '../modules/dispatch.js';
import type { SandboxModule } from '../modules/index.js';

/**
 * Dev-only LOCAL dispatch backend for /dev/sandbox — explicitly NOT the
 * production path (production = MODULE_INTERACT → server handler →
 * bombReducer → MODULE_UPDATE, arriving in Story 5.3 / Epic 8). It runs the
 * module's own reducer client-side and mirrors the server's roll-up contract
 * so the DefuserView under test sees byte-identical state sequencing:
 *
 * - 'struck' is TRANSIENT: emitted, then immediately re-armed (the same
 *   back-to-back pulse the server produces — the worst-case sequencing the
 *   4.3 LED flash was built against).
 * - solved modules are inert to MODULE_ACTIONs but MODULE_RESET passes.
 * - strikes saturate at 3; bomb.solved = all modules solved.
 */

type ReduceFn = SandboxModule['reduce'];

export interface DevReduceResult {
  /** ModuleState sequence to apply via applyModuleUpdate, in order. */
  updates: ModuleState<unknown>[];
  /** True when the action earned a (team-wide) strike. */
  struck: boolean;
}

const isReset = (action: unknown): boolean =>
  typeof action === 'object' &&
  action !== null &&
  (action as { type?: unknown }).type === 'MODULE_RESET';

/** Pure mirror of the server's applyModuleResult sequencing (unit-tested). */
export function reduceDevModuleAction(
  mod: ModuleState<unknown>,
  reduce: ReduceFn,
  action: unknown,
): DevReduceResult {
  // Solved-inert guard (bombReducer parity); reset deliberately bypasses it.
  if (mod.status === 'solved' && !isReset(action)) return { updates: [], struck: false };
  const next = reduce(mod, action);
  if (next.status === 'struck') {
    return { updates: [next, { ...next, status: 'armed' }], struck: true };
  }
  return { updates: [next], struck: false };
}

/** Builds the backend installed via setModuleActionDispatch by the sandbox. */
export function createDevModuleDispatch(modules: readonly SandboxModule[]): ModuleActionDispatch {
  const byId = new Map(modules.map((m) => [m.id, m]));
  return (moduleIndex, action) => {
    const store = useGameStore.getState();
    const mod = store.bomb?.modules[moduleIndex];
    if (!mod) return false; // out-of-range index → no-op (mirrors server guard)
    const binding = byId.get(mod.moduleId);
    if (!binding) return false; // unregistered module → no-op

    const { updates, struck } = reduceDevModuleAction(mod, binding.reduce, action);
    for (const state of updates) store.applyModuleUpdate({ moduleIndex, state });

    // Bomb-level roll-up (strikes / solved) — server parity for display.
    const after = useGameStore.getState().bomb;
    if (!after) return true;
    const strikes = struck ? (Math.min(after.strikes + 1, 3) as StrikeCount) : after.strikes;
    const solved = after.modules.length > 0 && after.modules.every((m) => m.status === 'solved');
    if (strikes !== after.strikes || solved !== after.solved) {
      store.setBomb({ ...after, strikes, solved });
    }
    return true;
  };
}
