import type { BombContext } from '../types/bomb.js';
import type { DifficultyTier } from '../types/session.js';
import { DEV_DEMO_MODULE_ID } from './dev-demo/types.js';
import { WIRES_MODULE_ID } from './wires/types.js';
// Import each generator directly from its own file, NOT via the module barrel
// (./<mod>/index.js → ../index.js), so the registry never depends on the barrel
// that parallel module stories edit.
import { generateDevDemo } from './dev-demo/generate.js';
import { generateWires } from './wires/generate.js';

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
 * Add one entry per module — same open/closed property as MODULE_REDUCERS.
 */
export const MODULE_GENERATORS: Record<string, ModuleGenerator> = {
  // dev-demo: Story 5.1 reference module. It is registered but in NO tier pool
  // (see TIER_POOLS below) — the only way it reaches a bomb is a Facilitator
  // modulePool override of ['dev-demo'].
  [DEV_DEMO_MODULE_ID]: generateDevDemo as ModuleGenerator,
  // wires: Story 5.3 walking-skeleton module, the first real generatable module
  // and the sole member of every tier pool until 5.4 (the-button) / 5.5
  // (passwords) land. Registered here (Story 4.7 closed the gap 5.3 left) so a
  // default-config round can actually build a bomb for snapshot sync to ride.
  [WIRES_MODULE_ID]: generateWires as ModuleGenerator,
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
 * INTERIM COMPOSITION (Story 4.7): every pool ID must have a registered
 * generator in MODULE_GENERATORS (generateLayout enforces this and fails loud),
 * and `'wires'` (5.3) is currently the only real generatable module. So all
 * three tiers are `['wires']` for now — a default-config round must build a real
 * bomb for snapshot sync, and a pool listing not-yet-implemented modules would
 * throw at ROUND_START. RE-EXPAND these as modules land: 5.4 the-button, 5.5
 * passwords, then keypads/whos-on-first/wire-sequences/mazes (medium) and the
 * full MODULE_IDS set (hard). The canonical target composition is preserved in
 * `MODULE_IDS` + the per-story backlog; widen each tier when its modules are
 * registered. A Facilitator can still override with an explicit `modulePool`
 * (e.g. `['dev-demo']`).
 */
export const TIER_POOLS: Record<DifficultyTier, readonly string[]> = {
  easy: ['wires'],
  medium: ['wires'],
  hard: ['wires'],
};
