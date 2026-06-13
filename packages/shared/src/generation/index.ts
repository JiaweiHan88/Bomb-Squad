/**
 * Deterministic seeded bomb generation (architecture Pattern 4): config →
 * templateSeed → shared layout → per-team frozen BombContext + module data →
 * BombState. Pure TypeScript, zero deps, callable from the server helper
 * (initializeRoundBombs) or any sandbox. The server keeps only the I/O wrapper.
 */
export { generateBombContext } from './bombContext.js';
export { generateLayout } from './layout.js';
export { generateRoundBombs } from './assembleBomb.js';
