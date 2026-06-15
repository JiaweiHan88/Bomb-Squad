/**
 * Preparation placeholder-bomb slot source (Story 4.6, Option A — the
 * config-derived orientation board). No React, no three.js: pure derivation
 * from the round config the client already holds in `session.config`.
 *
 * The Defuser orients to *which* module types sit on the bomb and *how many*
 * slots they will face — never any randomised value. The committed per-slot
 * assignment is only fixed at generation (ROUND_START), so this shows the
 * candidate pool cycled across the slot count: a true orientation aid, not the
 * committed layout (Task 0 records the trade-off).
 */
import type { RoundConfig } from '@bomb-squad/shared';
import { TIER_POOLS } from '@bomb-squad/shared';

/** A prep slot carries a module *type* only — never a generated value. */
export interface PrepModule {
  moduleId: string;
}

/**
 * Resolve the prep bomb's type-only module list from the round config. The pool
 * is resolved exactly as generation does (`config.modulePool ?? TIER_POOLS[...]`)
 * and cycled across `moduleCount` slots so positions match the real bomb. An
 * empty/absent pool degrades to the value-free placeholder type rather than
 * throwing — the prep view must always render.
 */
export function buildPrepModules(config: RoundConfig): PrepModule[] {
  const pool = config.modulePool ?? TIER_POOLS[config.difficulty] ?? [];
  const types = pool.length > 0 ? pool : ['placeholder'];
  const count =
    Number.isFinite(config.moduleCount) && config.moduleCount > 0
      ? Math.floor(config.moduleCount)
      : 0;
  return Array.from({ length: count }, (_, i) => ({ moduleId: types[i % types.length] }));
}
