import { hash } from './hash.js';

/**
 * Guards a numeric field that flows into a seed string. Non-integer, negative, or
 * NaN values would silently produce a valid-looking-but-wrong seed, so reject them
 * at the boundary instead. (The server is also expected to bounds-check moduleIndex
 * against the bomb's module count — this is defense-in-depth at the seeding layer.)
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Fields are joined with a ':' delimiter so the boundary between two operands is
 * unambiguous. Without it, `('sid1', 2)` and `('sid', 12)` both hash "sid12", and
 * two numeric fields (teamSeed, moduleIndex) collide whenever their digits line up
 * — e.g. `(12, 34)` and `(1, 234)` both hash "1234". ':' cannot appear in any field
 * (sessionId/teamId are alphanumeric, the rest are integers).
 */
export function deriveTemplateSeed(sessionId: string, roundNumber: number): number {
  assertNonNegativeInteger(roundNumber, 'roundNumber');
  return hash(`${sessionId}:${roundNumber}`);
}

export function deriveTeamSeed(templateSeed: number, teamId: string): number {
  assertNonNegativeInteger(templateSeed, 'templateSeed');
  return hash(`${templateSeed}:${teamId}`);
}

export function deriveModuleSeed(teamSeed: number, moduleIndex: number): number {
  assertNonNegativeInteger(teamSeed, 'teamSeed');
  assertNonNegativeInteger(moduleIndex, 'moduleIndex');
  return hash(`${teamSeed}:${moduleIndex}`);
}

/**
 * Returns a closure that produces pseudorandom floats in [0, 1) using mulberry32.
 * This is the ONLY approved way to introduce randomness in module generate(seed, ctx) functions.
 * Each call to the returned function advances the internal state — never call Math.random() instead.
 *
 * `seed` must be a non-negative integer (the seed-chain functions return unsigned
 * 32-bit integers). Passing a float or negative value is rejected rather than being
 * silently truncated to a colliding stream.
 */
export function makeSeededRng(seed: number): () => number {
  assertNonNegativeInteger(seed, 'seed');
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
