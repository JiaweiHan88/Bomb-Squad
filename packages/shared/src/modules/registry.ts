import type { BombContext } from '../types/bomb.js';
import type { DifficultyTier } from '../types/session.js';
import { DEV_DEMO_MODULE_ID } from './dev-demo/types.js';
// Import the generator directly from its own file, NOT via the module barrel
// (./dev-demo/index.js → ../index.js), so the registry never depends on the
// barrel that parallel module stories (5.3 Wires onward) edit.
import { generateDevDemo } from './dev-demo/generate.js';

/**
 * A module's seeded instance generator. `seed` is the per-(team,slot) moduleSeed
 * from the seed chain; `ctx` is the frozen per-team BombContext. Returns the
 * module's opaque `data` payload (typed per-module in its own dir, erased here).
 */
export type ModuleGenerator = (seed: number, ctx: BombContext) => unknown;

/**
 * Open/closed module GENERATOR registry — the generation-time twin of the
 * server's MODULE_REDUCERS. Add one entry per module; bomb assembly
 * (generateRoundBombs) never changes when a module is added.
 *
 * Entries are cast to ModuleGenerator: each generate fn is fully typed in its
 * own module dir (e.g. generateDevDemo → DevDemoState); the per-module return
 * type is deliberately erased to `unknown` at this registry boundary, which is
 * where assembly dispatches by moduleId. This mirrors the 5.1 type-erasure
 * pattern (one documented cast at the boundary).
 *
 * Story 5.3 adds `'wires': generateWires as ModuleGenerator` — one line, same
 * open/closed property as MODULE_REDUCERS.
 */
export const MODULE_GENERATORS: Record<string, ModuleGenerator> = {
  // dev-demo: Story 5.1 reference module. It is registered but in NO tier pool
  // (see TIER_POOLS below) — the only way it reaches a bomb is a Facilitator
  // modulePool override of ['dev-demo']. Until 5.3 lands Wires it is the only
  // generatable module in-tree.
  [DEV_DEMO_MODULE_ID]: generateDevDemo as ModuleGenerator,
};

/**
 * Canonical production module IDs (kebab-case). Fixed here so every Epic 5–7
 * module story conforms to one ID instead of inventing its own. `'dev-demo'` is
 * intentionally absent — it is a reference module, not a production module, and
 * belongs to no tier pool.
 */
export const MODULE_IDS = [
  'wires',
  'the-button',
  'passwords',
  'keypads',
  'whos-on-first',
  'wire-sequences',
  'mazes',
  'complicated-wires',
  'simon-says',
  'memory',
  'morse-code',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Default module pool per difficulty tier — each tier is a superset of the
 * easier one (harder rounds can still draw easy modules). Generation resolves
 * `config.modulePool ?? TIER_POOLS[config.difficulty]`.
 *
 * NOTE: these list the canonical IDs, but only `'dev-demo'` has a registered
 * generator until Story 5.3+ land the real modules. A round configured to a
 * tier pool therefore cannot be generated yet (every pool ID must be in
 * MODULE_GENERATORS — generateLayout enforces this and fails loud); the only
 * working V1 pool is a `modulePool: ['dev-demo']` override. The IDs are fixed
 * now so the module stories conform to them, and 8.1's difficulty-gating UI can
 * consume these pools.
 */
export const TIER_POOLS: Record<DifficultyTier, readonly string[]> = {
  easy: ['wires', 'the-button', 'passwords'],
  medium: [
    'wires',
    'the-button',
    'passwords',
    'keypads',
    'whos-on-first',
    'wire-sequences',
    'mazes',
  ],
  hard: [...MODULE_IDS],
};
