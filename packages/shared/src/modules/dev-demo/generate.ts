import type { BombContext } from '../../types/index.js';
import { makeSeededRng } from '../../seeding/index.js';
import type { DevDemoState } from './types.js';
import { solutionForLabel } from './solve.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Pure, seeded instance generator — the ONLY place randomness is allowed in a
 * module, and only via makeSeededRng (Math.random is banned project-wide).
 * Synchronous and CPU-cheap (called for all modules at round start).
 *
 * The authoritative `solution` is DERIVED from the seeded label via the same
 * manual rule the Expert reads (solutionForLabel) — the Defuser-visible label
 * is the puzzle's lookup key. The label's trailing character comes from
 * BombContext.serialNumber (last char is always a digit) — a deliberate
 * demonstration that bomb metadata flows into module data without ever being
 * mutated.
 */
export function generateDevDemo(seed: number, ctx: BombContext): DevDemoState {
  const rng = makeSeededRng(seed); // asserts non-negative integer seed
  const letter = () => LETTERS[Math.floor(rng() * LETTERS.length)];
  const serialDigit = ctx.serialNumber[ctx.serialNumber.length - 1];
  const label = `${letter()}${letter()}-${serialDigit}`;
  return {
    solution: solutionForLabel(label),
    label,
    wireCut: false,
    held: false,
  };
}
