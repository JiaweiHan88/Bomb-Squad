import type { BombContext, IndicatorLabel, PortType } from '../types/bomb.js';
import { makeSeededRng } from '../seeding/index.js';

/**
 * Serial-number alphabet: A–Z excluding O (avoids 0/O confusion) and Y (KTANE
 * convention). Vowels A/E/I/U remain in the set so Simon Says' "serial contains
 * a vowel" branch is reachable in both outcomes.
 */
const SERIAL_LETTERS = 'ABCDEFGHIJKLMNPQRSTUVWXZ';
const SERIAL_LENGTH = 6;

/** Full sample space for indicators (the 11 IndicatorLabel union members). */
const INDICATOR_LABELS: readonly IndicatorLabel[] = [
  'SND', 'CLR', 'CAR', 'IND', 'FRQ', 'SIG', 'NSA', 'MSA', 'TRN', 'BOB', 'FRK',
];

/** Full sample space for ports (the 6 PortType union members). */
const PORT_TYPES: readonly PortType[] = [
  'DVI-D', 'Parallel', 'PS/2', 'RJ-45', 'Serial', 'Stereo RCA',
];

/**
 * Render-envelope caps — LOAD-BEARING, do not raise without renderer rework.
 * The 4.4 timer-LCD housing and 4.5 strike housing overlap tests prove clearance
 * ONLY for a single-row metadata layout: ≤6 indicators and ≤8 batteries. Exceeding
 * either pushes features into a second row that collides with the housings and the
 * overlap tests fail loudly. The 4.2 chassis battery cells also spill off the top
 * face well before these caps. Generating within the envelope IS the clamp those
 * deferred items (deferred-work.md: 4.2 / 4.4 / 4.5) asked this story to add.
 * Per-difficulty range tuning is a GDD [ASSUMPTION: pending playtesting] — V1
 * ships one range for all tiers; do not build tiered ranges here.
 */
const MAX_BATTERIES = 8;
const MAX_INDICATORS = 6;
const MAX_PORTS = PORT_TYPES.length; // 6 — the full distinct set

/** Inclusive integer in [min, max] from the supplied seeded rng. */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Draw `count` distinct members from `pool` (sampling without replacement) via a
 * partial Fisher–Yates shuffle over a copy. Deterministic for a given rng stream.
 */
function pickDistinct<T>(rng: () => number, pool: readonly T[], count: number): T[] {
  const copy = pool.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, count);
}

/**
 * Generate a team's frozen BombContext from its teamSeed.
 *
 * All randomness comes from a SINGLE makeSeededRng(teamSeed) stream consumed in a
 * fixed order (serial → batteries → indicators → ports). The order is stable so
 * the same teamSeed always reproduces the same context (retry semantics, AC3).
 * Module values are independent of this stream — they derive from deriveModuleSeed,
 * NOT from continued draws here (see assembleBomb's RNG-stream discipline note), so
 * widening a range below never silently reshuffles modules.
 *
 * The returned object is DEEP-FROZEN (object, indicators array + each entry, ports
 * array) — AC2's runtime teeth on top of the readonly types. NOTE: freeze is a
 * generation-time guarantee only; a JSON round-trip through Redis yields unfrozen
 * objects, so the enduring guards are the readonly types + reducer purity.
 */
export function generateBombContext(teamSeed: number): BombContext {
  const rng = makeSeededRng(teamSeed); // asserts teamSeed is a non-negative integer

  // Serial: 6 chars, each of the first 5 a letter-or-digit, LAST always a digit
  // (BombContext.serialNumber contract — dev-demo and multiple module rules read it).
  let serialNumber = '';
  for (let i = 0; i < SERIAL_LENGTH - 1; i++) {
    if (rng() < 0.5) {
      serialNumber += SERIAL_LETTERS[Math.floor(rng() * SERIAL_LETTERS.length)];
    } else {
      serialNumber += String(randInt(rng, 0, 9));
    }
  }
  serialNumber += String(randInt(rng, 0, 9));

  const batteryCount = randInt(rng, 0, MAX_BATTERIES);

  const indicatorCount = randInt(rng, 0, MAX_INDICATORS);
  const indicators = pickDistinct(rng, INDICATOR_LABELS, indicatorCount).map((label) =>
    Object.freeze({ label, lit: rng() < 0.5 }),
  );

  const portCount = randInt(rng, 0, MAX_PORTS);
  const ports = pickDistinct(rng, PORT_TYPES, portCount);

  return Object.freeze({
    serialNumber,
    batteryCount,
    indicators: Object.freeze(indicators),
    ports: Object.freeze(ports),
  });
}
