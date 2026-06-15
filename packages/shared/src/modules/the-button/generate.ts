import type { BombContext } from '../../types/index.js';
import { makeSeededRng } from '../../seeding/index.js';
import { BUTTON_COLORS, BUTTON_LABELS, STRIP_COLORS, type ButtonState } from './types.js';

/**
 * Pure, seeded instance generator — the ONLY place randomness is allowed in a
 * module, and only via makeSeededRng (Math.random is banned project-wide).
 * Synchronous and CPU-cheap (called for all modules at round start).
 *
 * Layout (colour + label + strip colour) comes from the seed alone. The answer
 * is NOT computed or stored here — the reducer recomputes decideButton at
 * interaction time from the public ctx carried in state, so no pre-computed
 * solution ever crosses to the client (Sprint 2 retro AI1). The decision table
 * ends in a catch-all, so every layout is solvable. BombContext is read and
 * stored by reference, never mutated.
 */
export function generateButton(seed: number, ctx: BombContext): ButtonState {
  const rng = makeSeededRng(seed); // asserts non-negative integer seed
  const color = BUTTON_COLORS[Math.floor(rng() * BUTTON_COLORS.length)];
  const label = BUTTON_LABELS[Math.floor(rng() * BUTTON_LABELS.length)];
  const stripColor = STRIP_COLORS[Math.floor(rng() * STRIP_COLORS.length)];
  return { color, label, stripColor, held: false, ctx };
}
