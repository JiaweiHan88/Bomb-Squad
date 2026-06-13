import { makeSeededRng } from '../seeding/index.js';
import { MODULE_GENERATORS } from '../modules/registry.js';

/** RoundConfig documented module-count range; the 4.1 renderer slot layout is proven for this domain. */
const MIN_MODULE_COUNT = 3;
const MAX_MODULE_COUNT = 11;

/**
 * Draw `moduleCount` module IDs from `pool` using makeSeededRng(templateSeed).
 * The layout is the per-ROUND structure: it depends only on templateSeed, so both
 * teams in a round get the IDENTICAL module sequence (AC1, identical layout).
 *
 * Duplicates across slots are allowed (KTANE-authentic) and mandatory when
 * `pool.length < moduleCount`.
 *
 * Generation runs handler-side at round start (NOT inside a reducer), so it
 * fails loud on a contract violation — a catchable exception is the right outcome
 * and far better than a bomb with a dead slot. Guards:
 *  - moduleCount: integer in [3, 11]
 *  - pool: non-empty
 *  - every pool ID has a registered generator in MODULE_GENERATORS (until 5.3
 *    lands Wires, only 'dev-demo' is generatable, so the only working pool
 *    override is ['dev-demo']).
 */
export function generateLayout(
  templateSeed: number,
  moduleCount: number,
  pool: readonly string[],
): string[] {
  if (!Number.isInteger(moduleCount) || moduleCount < MIN_MODULE_COUNT || moduleCount > MAX_MODULE_COUNT) {
    throw new RangeError(
      `moduleCount must be an integer in [${MIN_MODULE_COUNT}, ${MAX_MODULE_COUNT}], got ${moduleCount}`,
    );
  }
  if (pool.length === 0) {
    throw new RangeError('module pool must be non-empty');
  }
  for (const id of pool) {
    if (!(id in MODULE_GENERATORS)) {
      throw new RangeError(
        `module pool contains unregistered id "${id}" — no generator in MODULE_GENERATORS ` +
          `(only ['dev-demo'] is generatable until Story 5.3 lands Wires)`,
      );
    }
  }

  const rng = makeSeededRng(templateSeed); // asserts templateSeed is a non-negative integer
  const layout: string[] = [];
  for (let i = 0; i < moduleCount; i++) {
    layout.push(pool[Math.floor(rng() * pool.length)]);
  }
  return layout;
}
