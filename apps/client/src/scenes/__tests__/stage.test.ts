import { describe, expect, it } from 'vitest';
import { computeStageSize } from '../stage.js';

describe('computeStageSize', () => {
  it('returns an exact fit for a 16:9 viewport', () => {
    expect(computeStageSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(computeStageSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('letterboxes a 16:10 viewport with horizontal bars (full width, reduced height)', () => {
    expect(computeStageSize(1920, 1200)).toEqual({ width: 1920, height: 1080 });
  });

  it('letterboxes a 21:9 viewport with vertical bars (full height, reduced width)', () => {
    expect(computeStageSize(2560, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('never exceeds the viewport in either dimension', () => {
    const cases: Array<[number, number]> = [
      [1280, 720],
      [1366, 768],
      [1920, 1200],
      [2560, 1080],
      [3440, 1440],
      [1280, 1024],
    ];
    for (const [w, h] of cases) {
      const { width, height } = computeStageSize(w, h);
      expect(width).toBeLessThanOrEqual(w);
      expect(height).toBeLessThanOrEqual(h);
      // Aspect is preserved at 16:9 within float tolerance.
      expect(width / height).toBeCloseTo(16 / 9, 5);
    }
  });

  it('supports a custom aspect ratio', () => {
    expect(computeStageSize(1000, 1000, 2)).toEqual({ width: 1000, height: 500 });
    expect(computeStageSize(1000, 1000, 0.5)).toEqual({ width: 500, height: 1000 });
  });

  it('returns zero size (never NaN/negative) for degenerate inputs', () => {
    expect(computeStageSize(0, 1080)).toEqual({ width: 0, height: 0 });
    expect(computeStageSize(1920, 0)).toEqual({ width: 0, height: 0 });
    expect(computeStageSize(-100, 500)).toEqual({ width: 0, height: 0 });
    expect(computeStageSize(500, -1)).toEqual({ width: 0, height: 0 });
    expect(computeStageSize(1920, 1080, 0)).toEqual({ width: 0, height: 0 });
    expect(computeStageSize(1920, 1080, -2)).toEqual({ width: 0, height: 0 });
  });
});
