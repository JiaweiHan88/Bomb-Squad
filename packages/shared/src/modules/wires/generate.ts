import type { BombContext } from '../../types/index.js';
import { makeSeededRng } from '../../seeding/index.js';
import { WIRE_COLORS, type WiresState, type WiresWire } from './types.js';

/**
 * Pure, seeded instance generator — the ONLY place randomness is allowed in a
 * module, and only via makeSeededRng (Math.random is banned project-wide).
 * Synchronous and CPU-cheap (called for all modules at round start).
 *
 * Layout (count + colours) comes from the seed alone. The answer is NOT
 * computed or stored here — the reducer recomputes solveWires(colours, ctx) at
 * cut-time from the public ctx carried in state, so no pre-computed solution
 * ever crosses to the client (Sprint 2 retro AI1). Every rule table ends in an
 * "Otherwise" row, so any layout is solvable — no generation constraint needed.
 * BombContext is read and stored by reference, never mutated.
 */
export function generateWires(seed: number, ctx: BombContext): WiresState {
  const rng = makeSeededRng(seed); // asserts non-negative integer seed
  const wireCount = 3 + Math.floor(rng() * 4); // uniform 3–6
  const wires: WiresWire[] = Array.from({ length: wireCount }, () => ({
    color: WIRE_COLORS[Math.floor(rng() * WIRE_COLORS.length)],
    cut: false,
  }));
  return { wires, ctx };
}
