import { describe, expect, it } from 'vitest';
import type { StrikeCount } from '@bomb-squad/shared';
import {
  STRIKE_DOT_INDICES,
  STRIKE_HOUSING_FOOTPRINT,
  STRIKE_HOUSING_SIZE,
  STRIKE_LED_RADIUS,
  STRIKE_LED_SEPARATION,
  strikeLedVisual,
} from '../strikeIndicator.js';
import { TIMER_HOUSING_FOOTPRINT } from '../timerLcd.js';
import { BATTERY_FOOTPRINT, computeChassisFeatureLayout } from '../chassis.js';
import { CHASSIS_SIZE } from '../layout.js';

const HALF_W = CHASSIS_SIZE[0] / 2;
const HALF_D = CHASSIS_SIZE[2] / 2;

describe('strikeLedVisual', () => {
  // DESIGN componentSpec.strikeIndicator: inactive = ledRedGlow @ 0.25,
  // active = ledRed with glow. dotIndex < strikes → active.
  it('0 strikes → both dots inactive', () => {
    expect(strikeLedVisual(0, 0).color).toBe('#7A0000');
    expect(strikeLedVisual(1, 0).color).toBe('#7A0000');
  });

  it('1 strike → dot 0 active, dot 1 inactive', () => {
    expect(strikeLedVisual(0, 1).color).toBe('#FF2E2E');
    expect(strikeLedVisual(1, 1).color).toBe('#7A0000');
  });

  it('2 strikes → both dots active', () => {
    expect(strikeLedVisual(0, 2).color).toBe('#FF2E2E');
    expect(strikeLedVisual(1, 2).color).toBe('#FF2E2E');
  });

  it('3 strikes (the explosion strike) → both dots stay active — display floor', () => {
    expect(strikeLedVisual(0, 3).color).toBe('#FF2E2E');
    expect(strikeLedVisual(1, 3).color).toBe('#FF2E2E');
  });

  it('inactive intensity is the dim 0.25 socket; active carries the glow', () => {
    expect(strikeLedVisual(0, 0).emissiveIntensity).toBeCloseTo(0.25);
    expect(strikeLedVisual(0, 1).emissiveIntensity).toBeGreaterThan(1);
  });

  it('returns shared constants — no allocation per call (identity check)', () => {
    const dots: ReadonlyArray<0 | 1> = STRIKE_DOT_INDICES;
    const counts: StrikeCount[] = [0, 1, 2, 3];
    for (const dot of dots) {
      for (const strikes of counts) {
        expect(strikeLedVisual(dot, strikes)).toBe(strikeLedVisual(dot, strikes));
      }
    }
    // Exactly two distinct states exist (active/inactive), shared across dots.
    expect(strikeLedVisual(0, 0)).toBe(strikeLedVisual(1, 0));
    expect(strikeLedVisual(0, 2)).toBe(strikeLedVisual(1, 2));
    expect(strikeLedVisual(0, 0)).not.toBe(strikeLedVisual(0, 2));
  });
});

describe('strike LED row geometry', () => {
  it('two dots, separated edge-to-edge by the mockup gap (9px ≈ 0.038wu)', () => {
    expect(STRIKE_DOT_INDICES).toEqual([0, 1]);
    // Separation = diameter + gap; both derive from the 0.0042 wu/px conversion.
    expect(STRIKE_LED_SEPARATION).toBeCloseTo(STRIKE_LED_RADIUS * 2 + 0.038, 3);
    // Row fits on the housing face with margin on both sides.
    expect(STRIKE_LED_SEPARATION + STRIKE_LED_RADIUS * 2).toBeLessThan(STRIKE_HOUSING_SIZE[0]);
  });
});

describe('STRIKE_HOUSING_FOOTPRINT vs chassis top-face occupants', () => {
  it('stays on the top face, clear of the end-rib zone', () => {
    expect(STRIKE_HOUSING_FOOTPRINT.minZ).toBeGreaterThanOrEqual(-HALF_D);
    expect(STRIKE_HOUSING_FOOTPRINT.maxZ).toBeLessThanOrEqual(HALF_D);
    expect(STRIKE_HOUSING_FOOTPRINT.minX).toBeGreaterThanOrEqual(-HALF_W);
    // BombScene's raised end ribs sit inset 0.08 from the ±x faces and
    // protrude above the top face — keep a margin well clear of them.
    expect(STRIKE_HOUSING_FOOTPRINT.maxX).toBeLessThanOrEqual(HALF_W - 0.2);
  });

  it('sits beside the timer housing (adjacent right, EXPERIENCE hierarchy #2) without touching it', () => {
    expect(STRIKE_HOUSING_FOOTPRINT.minX).toBeGreaterThan(TIMER_HOUSING_FOOTPRINT.halfWidth);
  });

  it('stays inside the timer housing z-band, inheriting its proven indicator/battery clearance', () => {
    // The band z ∈ [minZ, maxZ] of the timer housing was overlap-tested in 4.4
    // against the indicator zone and battery tray at the single-row envelope.
    expect(STRIKE_HOUSING_FOOTPRINT.minZ).toBeGreaterThanOrEqual(TIMER_HOUSING_FOOTPRINT.minZ);
    expect(STRIKE_HOUSING_FOOTPRINT.maxZ).toBeLessThanOrEqual(TIMER_HOUSING_FOOTPRINT.maxZ);
  });

  it('clears the indicator zone and battery tray directly at the single-row envelope (≤6 / ≤8)', () => {
    const layout = computeChassisFeatureLayout({
      batteryCount: 8,
      indicatorCount: 6,
      portCount: 6,
    });
    const indicatorMaxZ = Math.max(
      ...layout.indicators.map((f) => f.position[2] + 0.14 / 2),
    );
    expect(indicatorMaxZ).toBeLessThanOrEqual(STRIKE_HOUSING_FOOTPRINT.minZ);
    expect(layout.batteryTray).not.toBeNull();
    const trayMinZ =
      layout.batteryTray!.position[2] - layout.batteryTray!.size[1] / 2;
    expect(trayMinZ).toBeGreaterThanOrEqual(STRIKE_HOUSING_FOOTPRINT.maxZ);
    for (const cell of layout.batteries) {
      expect(cell.position[2] - BATTERY_FOOTPRINT[1] / 2).toBeGreaterThanOrEqual(
        STRIKE_HOUSING_FOOTPRINT.maxZ,
      );
    }
  });
});
