import { describe, expect, it } from 'vitest';
import type { TimerState } from '@bomb-squad/shared';
import {
  LCD_GLOW_BASE,
  LCD_GLOW_PULSE_BOOST,
  LCD_GLOW_STRIKE_STEP,
  LCD_PULSE_THRESHOLD_MS,
  TIMER_HOUSING_FOOTPRINT,
  formatTimerDisplay,
  lcdGlowIntensity,
  timerGhostFor,
  timerRemainingMs,
} from '../timerLcd.js';
import {
  BATTERY_FOOTPRINT,
  INDICATOR_FOOTPRINT,
  computeChassisFeatureLayout,
} from '../chassis.js';
import { CHASSIS_SIZE } from '../layout.js';

const running = (overrides: Partial<TimerState> = {}): TimerState => ({
  startedAt: 1_000,
  remainingAtStart: 300_000,
  speedMultiplier: 1,
  pausedAt: null,
  ...overrides,
});

describe('timerRemainingMs', () => {
  it('extrapolates within a segment at speed 1.0', () => {
    expect(timerRemainingMs(running(), 61_000)).toBe(240_000);
  });

  it('applies the strike speed multiplier (compounding values per GDD)', () => {
    expect(timerRemainingMs(running({ speedMultiplier: 1.25 }), 61_000)).toBe(225_000);
    expect(timerRemainingMs(running({ speedMultiplier: 1.5625 }), 61_000)).toBe(206_250);
  });

  it('substitutes pausedAt for now — advancing the clock changes nothing', () => {
    const paused = running({ pausedAt: 31_000 });
    expect(timerRemainingMs(paused, 31_000)).toBe(270_000);
    expect(timerRemainingMs(paused, 999_999)).toBe(270_000);
  });

  it('clamps at zero — extrapolated zero is a display floor, never negative (AC3)', () => {
    expect(timerRemainingMs(running(), 301_001)).toBe(0);
    expect(timerRemainingMs(running(), 10_000_000)).toBe(0);
  });
});

describe('formatTimerDisplay', () => {
  it('formats M:SS with floored seconds', () => {
    expect(formatTimerDisplay(0)).toBe('0:00');
    expect(formatTimerDisplay(9_999)).toBe('0:09'); // floor — never a second that has not elapsed
    expect(formatTimerDisplay(59_999)).toBe('0:59');
    expect(formatTimerDisplay(60_000)).toBe('1:00');
    expect(formatTimerDisplay(299_000)).toBe('4:59');
    expect(formatTimerDisplay(300_000)).toBe('5:00');
  });

  it('extends naturally to MM:SS for ≥10-minute configs', () => {
    expect(formatTimerDisplay(600_000)).toBe('10:00');
    expect(formatTimerDisplay(754_999)).toBe('12:34');
  });

  it('treats negative input as zero', () => {
    expect(formatTimerDisplay(-500)).toBe('0:00');
  });
});

describe('timerGhostFor', () => {
  it('replaces every digit with 8 (DSEG all-segments glyph), keeping the colon', () => {
    expect(timerGhostFor('4:32')).toBe('8:88');
    expect(timerGhostFor('0:00')).toBe('8:88');
    expect(timerGhostFor('12:05')).toBe('88:88');
  });
});

describe('lcdGlowIntensity', () => {
  it('base glow at 0 strikes, +20% per strike (DESIGN componentSpec.timer)', () => {
    expect(lcdGlowIntensity(60_000, 0, false)).toBeCloseTo(LCD_GLOW_BASE);
    expect(lcdGlowIntensity(60_000, 1, false)).toBeCloseTo(LCD_GLOW_BASE + LCD_GLOW_STRIKE_STEP);
    expect(lcdGlowIntensity(60_000, 2, false)).toBeCloseTo(
      LCD_GLOW_BASE + 2 * LCD_GLOW_STRIKE_STEP,
    );
  });

  it('no pulse at or above the 10s threshold', () => {
    expect(lcdGlowIntensity(LCD_PULSE_THRESHOLD_MS, 0, false)).toBeCloseTo(LCD_GLOW_BASE);
    expect(lcdGlowIntensity(LCD_PULSE_THRESHOLD_MS + 1, 0, false)).toBeCloseTo(LCD_GLOW_BASE);
  });

  it('under 10s the pulse peaks at the digit change and decays within the second', () => {
    const justChanged = lcdGlowIntensity(8_999, 0, false); // digit just flipped 9→8
    const halfway = lcdGlowIntensity(8_500, 0, false);
    const nearlyNext = lcdGlowIntensity(8_001, 0, false);
    expect(justChanged).toBeGreaterThan(halfway);
    expect(halfway).toBeGreaterThan(nearlyNext);
    expect(justChanged).toBeGreaterThan(LCD_GLOW_BASE + 0.5 * LCD_GLOW_PULSE_BOOST);
    expect(nearlyNext).toBeLessThan(LCD_GLOW_BASE + 0.05 * LCD_GLOW_PULSE_BOOST);
  });

  it('pulse decays monotonically across the displayed second', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const remaining of [8_999, 8_750, 8_500, 8_250, 8_001]) {
      const glow = lcdGlowIntensity(remaining, 0, false);
      expect(glow).toBeLessThan(prev);
      prev = glow;
    }
  });

  it('holds the static base at 0:00 — no pulse on a dead clock', () => {
    expect(lcdGlowIntensity(0, 0, false)).toBeCloseTo(LCD_GLOW_BASE);
  });

  it('reduced motion → no pulse, static strike-adjusted base (EXPERIENCE a11y)', () => {
    for (const remaining of [9_999, 9_500, 9_001, 5_500]) {
      expect(lcdGlowIntensity(remaining, 0, true)).toBeCloseTo(LCD_GLOW_BASE);
      expect(lcdGlowIntensity(remaining, 2, true)).toBeCloseTo(
        LCD_GLOW_BASE + 2 * LCD_GLOW_STRIKE_STEP,
      );
    }
  });

  it('strike steps and pulse compose under 10s', () => {
    const glow = lcdGlowIntensity(8_999, 2, false);
    expect(glow).toBeGreaterThan(LCD_GLOW_BASE + 2 * LCD_GLOW_STRIKE_STEP);
  });
});

describe('TIMER_HOUSING_FOOTPRINT vs chassis top-face features', () => {
  // The housing straddles the top-face band between 4.2's indicator zone (−z)
  // and battery tray (+z). Supported envelope: single-row layouts — ≤6
  // indicators, ≤8 batteries. Two-row layouts (≥7 indicators / ≥9 batteries)
  // consume the central band; if Story 8.2's generation ranges ever exceed the
  // envelope, the band must be renegotiated (documented limitation).
  const HALF_D = CHASSIS_SIZE[2] / 2;
  const HALF_W = CHASSIS_SIZE[0] / 2;

  it('stays on the top face', () => {
    expect(TIMER_HOUSING_FOOTPRINT.minZ).toBeGreaterThanOrEqual(-HALF_D);
    expect(TIMER_HOUSING_FOOTPRINT.maxZ).toBeLessThanOrEqual(HALF_D);
    expect(TIMER_HOUSING_FOOTPRINT.halfWidth).toBeLessThanOrEqual(HALF_W);
  });

  it('clears the indicator zone at the max single-row count (6)', () => {
    const layout = computeChassisFeatureLayout({
      batteryCount: 0,
      indicatorCount: 6,
      portCount: 0,
    });
    for (const indicator of layout.indicators) {
      const indicatorMaxZ = indicator.position[2] + INDICATOR_FOOTPRINT[1] / 2;
      expect(indicatorMaxZ).toBeLessThanOrEqual(TIMER_HOUSING_FOOTPRINT.minZ);
    }
  });

  it('clears the battery tray at the max single-row count (8)', () => {
    const layout = computeChassisFeatureLayout({
      batteryCount: 8,
      indicatorCount: 0,
      portCount: 0,
    });
    expect(layout.batteryTray).not.toBeNull();
    const trayMinZ = layout.batteryTray!.position[2] - layout.batteryTray!.size[1] / 2;
    expect(trayMinZ).toBeGreaterThanOrEqual(TIMER_HOUSING_FOOTPRINT.maxZ);
    // sanity: footprints derived from real cells too, not just the tray box
    for (const battery of layout.batteries) {
      const cellMinZ = battery.position[2] - BATTERY_FOOTPRINT[1] / 2;
      expect(cellMinZ).toBeGreaterThanOrEqual(TIMER_HOUSING_FOOTPRINT.maxZ);
    }
  });

  it('clears both zones simultaneously at the dev-context counts', () => {
    const layout = computeChassisFeatureLayout({
      batteryCount: 2,
      indicatorCount: 2,
      portCount: 2,
    });
    const trayMinZ = layout.batteryTray!.position[2] - layout.batteryTray!.size[1] / 2;
    expect(trayMinZ).toBeGreaterThanOrEqual(TIMER_HOUSING_FOOTPRINT.maxZ);
    for (const indicator of layout.indicators) {
      expect(indicator.position[2] + INDICATOR_FOOTPRINT[1] / 2).toBeLessThanOrEqual(
        TIMER_HOUSING_FOOTPRINT.minZ,
      );
    }
  });
});
