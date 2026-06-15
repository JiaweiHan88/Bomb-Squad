import { describe, expect, it, test } from '@jest/globals';
import type { IndicatorLabel, PortType } from '../../types/bomb.js';
import { generateBombContext } from '../bombContext.js';

const SERIAL_LETTERS = new Set('ABCDEFGHIJKLMNPQRSTUVWXZ'.split(''));
const ALL_INDICATORS: readonly IndicatorLabel[] = [
  'SND', 'CLR', 'CAR', 'IND', 'FRQ', 'SIG', 'NSA', 'MSA', 'TRN', 'BOB', 'FRK',
];
const ALL_PORTS: readonly PortType[] = [
  'DVI-D', 'Parallel', 'PS/2', 'RJ-45', 'Serial', 'Stereo RCA',
];
const VOWELS = new Set(['A', 'E', 'I', 'U']);

/** Seeds 0..n-1 — explicit, deterministic sample (never Math.random in tests). */
const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('generateBombContext — serial number invariants', () => {
  it('is exactly 6 characters for every seed', () => {
    for (const s of seeds(200)) {
      expect(generateBombContext(s).serialNumber).toHaveLength(6);
    }
  });

  it('always ends in a digit 0–9', () => {
    for (const s of seeds(200)) {
      const last = generateBombContext(s).serialNumber.slice(-1);
      expect(last).toMatch(/^[0-9]$/);
    }
  });

  it('uses only digits or allowed letters (no O, no Y) in every position', () => {
    for (const s of seeds(200)) {
      for (const ch of generateBombContext(s).serialNumber) {
        const ok = /[0-9]/.test(ch) || SERIAL_LETTERS.has(ch);
        expect(ok).toBe(true);
        expect(ch).not.toBe('O');
        expect(ch).not.toBe('Y');
      }
    }
  });

  it('reaches both vowel-present and vowel-absent serials across seeds', () => {
    let withVowel = false;
    let withoutVowel = false;
    for (const s of seeds(200)) {
      const serial = generateBombContext(s).serialNumber;
      const hasVowel = serial.split('').some((c) => VOWELS.has(c));
      if (hasVowel) withVowel = true;
      else withoutVowel = true;
    }
    expect(withVowel).toBe(true);
    expect(withoutVowel).toBe(true);
  });

  it('reaches both odd and even last digits across seeds', () => {
    let odd = false;
    let even = false;
    for (const s of seeds(200)) {
      const last = Number(generateBombContext(s).serialNumber.slice(-1));
      if (last % 2 === 0) even = true;
      else odd = true;
    }
    expect(odd).toBe(true);
    expect(even).toBe(true);
  });
});

describe('generateBombContext — feature ranges (render envelope)', () => {
  it('keeps batteryCount within 0–8 inclusive and reaches both ends', () => {
    let sawMin = false;
    let sawNearMax = false;
    for (const s of seeds(500)) {
      const n = generateBombContext(s).batteryCount;
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(8);
      if (n === 0) sawMin = true;
      if (n >= 7) sawNearMax = true;
    }
    expect(sawMin).toBe(true);
    expect(sawNearMax).toBe(true);
  });

  it('emits 0–6 DISTINCT indicators drawn from the 11-label space, each with a lit boolean', () => {
    for (const s of seeds(500)) {
      const { indicators } = generateBombContext(s);
      expect(indicators.length).toBeGreaterThanOrEqual(0);
      expect(indicators.length).toBeLessThanOrEqual(6);
      const labels = indicators.map((i) => i.label);
      expect(new Set(labels).size).toBe(labels.length); // distinct
      for (const ind of indicators) {
        expect(ALL_INDICATORS).toContain(ind.label);
        expect(typeof ind.lit).toBe('boolean');
      }
    }
  });

  it('emits 0–6 DISTINCT ports drawn from the 6-port space', () => {
    for (const s of seeds(500)) {
      const { ports } = generateBombContext(s);
      expect(ports.length).toBeGreaterThanOrEqual(0);
      expect(ports.length).toBeLessThanOrEqual(6);
      expect(new Set(ports).size).toBe(ports.length); // distinct
      for (const p of ports) expect(ALL_PORTS).toContain(p);
    }
  });

  it('never exceeds the load-bearing caps (≤8 batteries / ≤6 indicators) over a wide seed sweep', () => {
    let maxBatteries = 0;
    let maxIndicators = 0;
    for (const s of seeds(1000)) {
      const ctx = generateBombContext(s);
      maxBatteries = Math.max(maxBatteries, ctx.batteryCount);
      maxIndicators = Math.max(maxIndicators, ctx.indicators.length);
    }
    expect(maxBatteries).toBeLessThanOrEqual(8);
    expect(maxIndicators).toBeLessThanOrEqual(6);
  });

  it('both lit and unlit indicators occur across seeds', () => {
    let lit = false;
    let unlit = false;
    for (const s of seeds(500)) {
      for (const ind of generateBombContext(s).indicators) {
        if (ind.lit) lit = true;
        else unlit = true;
      }
    }
    expect(lit).toBe(true);
    expect(unlit).toBe(true);
  });
});

describe('generateBombContext — determinism & immutability', () => {
  it('is deterministic: same seed → deep-equal context', () => {
    for (const s of seeds(50)) {
      expect(generateBombContext(s)).toEqual(generateBombContext(s));
    }
  });

  it('accepts the seed-0 boundary (hash can return 0)', () => {
    expect(() => generateBombContext(0)).not.toThrow();
  });

  it('rejects a negative or non-integer seed (seed-chain guard)', () => {
    expect(() => generateBombContext(-1)).toThrow();
    expect(() => generateBombContext(1.5)).toThrow();
    expect(() => generateBombContext(Number.NaN)).toThrow();
  });

  it('deep-freezes the context, its indicators array + entries, and ports array', () => {
    // Seed chosen to yield at least one indicator and one port.
    let ctx = generateBombContext(0);
    for (let s = 0; ctx.indicators.length === 0 || ctx.ports.length === 0; s++) {
      ctx = generateBombContext(s);
    }
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.indicators)).toBe(true);
    expect(Object.isFrozen(ctx.indicators[0])).toBe(true);
    expect(Object.isFrozen(ctx.ports)).toBe(true);

    expect(() => {
      (ctx as { batteryCount: number }).batteryCount = 9;
    }).toThrow();
    expect(() => {
      (ctx.ports as PortType[]).push('Serial');
    }).toThrow();
    expect(() => {
      (ctx.indicators[0] as { lit: boolean }).lit = !ctx.indicators[0].lit;
    }).toThrow();
  });
});
