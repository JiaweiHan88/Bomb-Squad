import { describe, expect, it } from 'vitest';
import type { RoundConfig } from '@bomb-squad/shared';
import { buildPrepModules } from '../prepLayout.js';

const config = (overrides: Partial<RoundConfig> = {}): RoundConfig => ({
  difficulty: 'easy',
  moduleCount: 3,
  timerMs: 300_000,
  strikeSpeedUpPct: 25,
  modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
  ...overrides,
});

describe('buildPrepModules (Story 4.6 Option A — config-derived orientation board)', () => {
  it('produces exactly moduleCount slots', () => {
    for (const moduleCount of [3, 5, 8, 11]) {
      expect(buildPrepModules(config({ moduleCount }))).toHaveLength(moduleCount);
    }
  });

  it('cycles the tier pool across the slots (orientation board, not a committed layout)', () => {
    const slots = buildPrepModules(config({ moduleCount: 5, modulePool: ['wires', 'the-button'] }));
    expect(slots.map((s) => s.moduleId)).toEqual([
      'wires',
      'the-button',
      'wires',
      'the-button',
      'wires',
    ]);
  });

  it('resolves the tier default pool when no modulePool override is set', () => {
    // Easy pool is currently ['wires']; every slot reads that type.
    const slots = buildPrepModules(config({ difficulty: 'easy', moduleCount: 4 }));
    expect(slots.every((s) => s.moduleId === 'wires')).toBe(true);
  });

  it('an explicit modulePool override wins over the tier default', () => {
    const slots = buildPrepModules(config({ moduleCount: 2, modulePool: ['passwords'] }));
    expect(slots.map((s) => s.moduleId)).toEqual(['passwords', 'passwords']);
  });

  it('degrades an empty pool to the value-free placeholder type rather than throwing', () => {
    const slots = buildPrepModules(config({ moduleCount: 2, modulePool: [] }));
    expect(slots.map((s) => s.moduleId)).toEqual(['placeholder', 'placeholder']);
  });

  it('returns no slots for a zero/invalid moduleCount (prep view renders nothing)', () => {
    expect(buildPrepModules(config({ moduleCount: 0 }))).toEqual([]);
    expect(buildPrepModules(config({ moduleCount: -2 }))).toEqual([]);
  });
});
