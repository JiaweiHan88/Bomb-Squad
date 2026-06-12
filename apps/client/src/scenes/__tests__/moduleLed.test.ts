import { describe, expect, it } from 'vitest';
import { SOLVE_LED_FLASH_MS, solveLedVisual } from '../moduleLed.js';

// DESIGN.md componentSpec.moduleSolveLed literals (colors.hud tokens).
const LED_RED_GLOW = '#7A0000'; // --led-red-glow (armed: dim)
const LED_GREEN = '#3DFF7A'; // --led-green (solved)
const LED_GREEN_GLOW = '#15B548'; // --led-green-glow (solved emissive)
const LED_RED = '#FF2E2E'; // --led-red (struck flash)

describe('solveLedVisual', () => {
  it('armed with no flash → dim red, low emissive', () => {
    const v = solveLedVisual('armed', null, false);
    expect(v.color).toBe(LED_RED_GLOW);
    expect(v.emissive).toBe(LED_RED_GLOW);
    expect(v.emissiveIntensity).toBeLessThan(0.5);
  });

  it('solved → green with green glow (AC2: green is the single source of truth)', () => {
    const v = solveLedVisual('solved', null, false);
    expect(v.color).toBe(LED_GREEN);
    expect(v.emissive).toBe(LED_GREEN_GLOW);
    expect(v.emissiveIntensity).toBeGreaterThan(0.5);
  });

  it('flash window is exactly 600ms', () => {
    expect(SOLVE_LED_FLASH_MS).toBe(600);
  });

  it('active flash → bright red across the whole 600ms window', () => {
    for (const elapsed of [0, 300, 599]) {
      const v = solveLedVisual('armed', elapsed, false);
      expect(v.color).toBe(LED_RED);
      expect(v.emissive).toBe(LED_RED);
      expect(v.emissiveIntensity).toBeGreaterThan(0.5);
    }
  });

  it('flash decays over the window (normal motion)', () => {
    const start = solveLedVisual('armed', 0, false).emissiveIntensity;
    const mid = solveLedVisual('armed', 300, false).emissiveIntensity;
    const late = solveLedVisual('armed', 599, false).emissiveIntensity;
    expect(start).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
  });

  it('reduced motion → static flash, no intermediate intensity values', () => {
    const at0 = solveLedVisual('armed', 0, true);
    const at300 = solveLedVisual('armed', 300, true);
    const at599 = solveLedVisual('armed', 599, true);
    expect(at0).toEqual(at300);
    expect(at300).toEqual(at599);
    expect(at0.color).toBe(LED_RED);
  });

  it('expired flash (≥600ms) → armed visual', () => {
    for (const elapsed of [600, 601, 10_000]) {
      expect(solveLedVisual('armed', elapsed, false)).toEqual(solveLedVisual('armed', null, false));
    }
  });

  it('solved wins over any flash state — a solved module never shows red', () => {
    for (const elapsed of [0, 300, 599]) {
      for (const reduced of [false, true]) {
        expect(solveLedVisual('solved', elapsed, reduced)).toEqual(
          solveLedVisual('solved', null, reduced),
        );
      }
    }
  });

  it("transient 'struck' status without an active flash renders as armed (dim red)", () => {
    expect(solveLedVisual('struck', null, false)).toEqual(solveLedVisual('armed', null, false));
    expect(solveLedVisual('struck', 600, false)).toEqual(solveLedVisual('armed', null, false));
  });

  it("'struck' status with an active flash shows the flash", () => {
    expect(solveLedVisual('struck', 100, false).color).toBe(LED_RED);
  });

  it('garbage elapsed values (negative/NaN) → plain status mapping, never NaN intensity', () => {
    for (const elapsed of [-1, -500, Number.NaN]) {
      const v = solveLedVisual('armed', elapsed, false);
      expect(v).toEqual(solveLedVisual('armed', null, false));
      expect(Number.isFinite(v.emissiveIntensity)).toBe(true);
    }
  });
});
