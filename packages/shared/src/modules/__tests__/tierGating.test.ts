import { describe, expect, it } from '@jest/globals';
import {
  TIER_CATALOG,
  TIER_DEFAULTS,
  MODULE_IDS,
  MODULE_GENERATORS,
  TIER_POOLS,
} from '../registry.js';
import type { DifficultyTier } from '../../types/session.js';

const TIERS: readonly DifficultyTier[] = ['easy', 'medium', 'hard'];

describe('TIER_CATALOG (display/gating metadata)', () => {
  it('lists only canonical MODULE_IDS in every tier', () => {
    for (const tier of TIERS) {
      for (const id of TIER_CATALOG[tier]) {
        expect(MODULE_IDS).toContain(id);
      }
    }
  });

  it('has no duplicate ids within a tier', () => {
    for (const tier of TIERS) {
      const ids = TIER_CATALOG[tier];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is a superset chain: easy ⊆ medium ⊆ hard', () => {
    const easy = new Set(TIER_CATALOG.easy);
    const medium = new Set(TIER_CATALOG.medium);
    const hard = new Set(TIER_CATALOG.hard);
    for (const id of easy) expect(medium.has(id)).toBe(true);
    for (const id of medium) expect(hard.has(id)).toBe(true);
    expect(medium.size).toBeGreaterThan(easy.size);
    expect(hard.size).toBeGreaterThan(medium.size);
  });

  it('matches Decision 006 canonical tiering', () => {
    expect([...TIER_CATALOG.easy]).toEqual(['wires', 'the-button', 'passwords']);
    expect([...TIER_CATALOG.medium]).toEqual([
      'wires',
      'the-button',
      'passwords',
      'keypads',
      'whos-on-first',
      'wire-sequences',
      'mazes',
    ]);
    expect([...TIER_CATALOG.hard]).toEqual([...MODULE_IDS]);
  });

  it('keeps TIER_POOLS (runtime) a subset of TIER_CATALOG (display) per tier', () => {
    // Runtime generation pool may only contain modules the catalog tier surfaces.
    for (const tier of TIERS) {
      const catalog = new Set<string>(TIER_CATALOG[tier]);
      for (const id of TIER_POOLS[tier]) expect(catalog.has(id)).toBe(true);
    }
  });
});

describe('TIER_DEFAULTS (recommended count + timer per tier)', () => {
  it('has module counts within the 3–11 range', () => {
    for (const tier of TIERS) {
      const { moduleCount } = TIER_DEFAULTS[tier];
      expect(Number.isInteger(moduleCount)).toBe(true);
      expect(moduleCount).toBeGreaterThanOrEqual(3);
      expect(moduleCount).toBeLessThanOrEqual(11);
    }
  });

  it('uses the GDD table values (easy 3/5:00, medium 5/6:00, hard 7/7:00)', () => {
    expect(TIER_DEFAULTS.easy).toEqual({ moduleCount: 3, timerMs: 300_000 });
    expect(TIER_DEFAULTS.medium).toEqual({ moduleCount: 5, timerMs: 360_000 });
    expect(TIER_DEFAULTS.hard).toEqual({ moduleCount: 7, timerMs: 420_000 });
  });

  it('escalates count and timer monotonically with difficulty', () => {
    expect(TIER_DEFAULTS.easy.moduleCount).toBeLessThan(TIER_DEFAULTS.medium.moduleCount);
    expect(TIER_DEFAULTS.medium.moduleCount).toBeLessThan(TIER_DEFAULTS.hard.moduleCount);
    expect(TIER_DEFAULTS.easy.timerMs).toBeLessThan(TIER_DEFAULTS.medium.timerMs);
    expect(TIER_DEFAULTS.medium.timerMs).toBeLessThan(TIER_DEFAULTS.hard.timerMs);
  });
});

describe('generatable subset (catalog ∩ generators)', () => {
  it('today only the Easy trio is generatable', () => {
    const generatable = TIER_CATALOG.hard.filter((id) => id in MODULE_GENERATORS);
    expect(generatable.sort()).toEqual(['passwords', 'the-button', 'wires']);
  });
});
