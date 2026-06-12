import { describe, expect, it } from 'vitest';
import { computeModuleLayout, DEFAULT_PLACEHOLDER_COUNT } from '../layout.js';

describe('computeModuleLayout', () => {
  it('returns one slot per module', () => {
    for (const count of [1, 2, 3, 5, 6, 8, 11]) {
      expect(computeModuleLayout(count)).toHaveLength(count);
    }
  });

  it('returns an empty layout for zero or negative counts', () => {
    expect(computeModuleLayout(0)).toEqual([]);
    expect(computeModuleLayout(-3)).toEqual([]);
  });

  it('is stable: same count yields identical positions across calls', () => {
    expect(computeModuleLayout(6)).toEqual(computeModuleLayout(6));
  });

  it('assigns stable, sequential module indexes', () => {
    const layout = computeModuleLayout(7);
    expect(layout.map((s) => s.moduleIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('produces finite coordinates and unit outward normals (front/back faces only)', () => {
    for (const slot of computeModuleLayout(11)) {
      for (const v of [...slot.position, ...slot.normal]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      // Normals point straight out of the chassis front (+z) or back (-z).
      expect(slot.normal[0]).toBe(0);
      expect(slot.normal[1]).toBe(0);
      expect(Math.abs(slot.normal[2])).toBe(1);
    }
  });

  it('never overlaps two slots on the same face', () => {
    // Includes counts > 12 (more than two 6-slot face batches): the grid must
    // grow extra rows, never wrap a third batch back onto an occupied face.
    for (const count of [11, 12, 13, 14, 24, 37]) {
      const seen = new Set<string>();
      for (const slot of computeModuleLayout(count)) {
        const key = slot.position.join(',') + '|' + slot.normal[2];
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('exposes the dev-harness default of 6 slots', () => {
    expect(DEFAULT_PLACEHOLDER_COUNT).toBe(6);
  });
});
