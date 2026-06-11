import { hash } from './hash.js';

export function deriveTemplateSeed(sessionId: string, roundNumber: number): number {
  return hash(sessionId + String(roundNumber));
}

export function deriveTeamSeed(templateSeed: number, teamId: string): number {
  return hash(String(templateSeed) + teamId);
}

export function deriveModuleSeed(teamSeed: number, moduleIndex: number): number {
  return hash(String(teamSeed) + String(moduleIndex));
}

/**
 * Returns a closure that produces pseudorandom floats in [0, 1) using mulberry32.
 * This is the ONLY approved way to introduce randomness in module generate(seed, ctx) functions.
 * Each call to the returned function advances the internal state — never call Math.random() instead.
 */
export function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function (): number {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
