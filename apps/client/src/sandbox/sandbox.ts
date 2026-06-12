import type { BombContext, BombState } from '@bomb-squad/shared';
import type { SandboxModule } from '../modules/index.js';

/** Pure sandbox helpers (no React, no store) — unit-tested. */

/**
 * Parses the seed input field: a non-negative integer in plain decimal
 * (the seed-chain functions reject anything else with a RangeError).
 */
export function parseSeed(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A one-module BombState around generate(seed, ctx) — seeded into the REAL
 * gameStore (setBomb) so the DefuserView under test reads production state
 * via the production path, not a parallel props channel.
 */
export function buildSandboxBomb(
  module: SandboxModule,
  seed: number,
  ctx: BombContext,
): BombState {
  return {
    context: ctx,
    modules: [{ moduleId: module.id, status: 'armed', data: module.generate(seed, ctx) }],
    strikes: 0,
    solved: false,
  };
}
