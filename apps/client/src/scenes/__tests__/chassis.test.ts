import { describe, expect, it } from 'vitest';
import { CHASSIS_SIZE } from '../layout.js';
import {
  BATTERY_FOOTPRINT,
  INDICATOR_FOOTPRINT,
  PORT_FOOTPRINT,
  SERIAL_STICKER_SIZE,
  computeChassisFeatureLayout,
  type ChassisFeature,
} from '../chassis.js';

const HALF_W = CHASSIS_SIZE[0] / 2;
const HALF_H = CHASSIS_SIZE[1] / 2;
const HALF_D = CHASSIS_SIZE[2] / 2;

/** Axis-aligned rect overlap on the x/z plane (footprints are [x, z] extents). */
function overlapsXZ(
  a: ChassisFeature,
  b: ChassisFeature,
  fa: readonly [number, number],
  fb: readonly [number, number],
): boolean {
  const dx = Math.abs(a.position[0] - b.position[0]);
  const dz = Math.abs(a.position[2] - b.position[2]);
  return dx < (fa[0] + fb[0]) / 2 && dz < (fa[1] + fb[1]) / 2;
}

function assertNoNaN(features: ChassisFeature[]): void {
  for (const f of features) {
    for (const v of [...f.position, ...f.normal]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  }
}

describe('computeChassisFeatureLayout', () => {
  it('always places the serial sticker on the right end face (+x), inside the face', () => {
    const { serial } = computeChassisFeatureLayout({
      batteryCount: 2,
      indicatorCount: 2,
      portCount: 2,
    });
    expect(serial.normal).toEqual([1, 0, 0]);
    expect(serial.position[0]).toBe(HALF_W);
    // Sticker extents fit the 1.05 (z) × 1.5 (y) end face.
    expect(Math.abs(serial.position[2]) + SERIAL_STICKER_SIZE[0] / 2).toBeLessThanOrEqual(HALF_D);
    expect(Math.abs(serial.position[1]) + SERIAL_STICKER_SIZE[1] / 2).toBeLessThanOrEqual(HALF_H);
  });

  it.each([0, 1, 2, 4, 8, 12])('lays out %i battery cells on the top face', (count) => {
    const { batteries } = computeChassisFeatureLayout({
      batteryCount: count,
      indicatorCount: 0,
      portCount: 0,
    });
    expect(batteries).toHaveLength(count);
    assertNoNaN(batteries);
    for (const cell of batteries) {
      expect(cell.normal).toEqual([0, 1, 0]);
      expect(cell.position[1]).toBe(HALF_H);
      expect(Math.abs(cell.position[0]) + BATTERY_FOOTPRINT[0] / 2).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(cell.position[2]) + BATTERY_FOOTPRINT[1] / 2).toBeLessThanOrEqual(HALF_D);
    }
  });

  // Sweep the full GDD indicator domain (subset of 11 labels) — the 4.1 review
  // found an overlap bug precisely in the count range tests didn't cover.
  it.each([0, 1, 2, 3, 5, 6, 7, 9, 11])('lays out %i indicator chips on the top face', (count) => {
    const { indicators } = computeChassisFeatureLayout({
      batteryCount: 0,
      indicatorCount: count,
      portCount: 0,
    });
    expect(indicators).toHaveLength(count);
    assertNoNaN(indicators);
    for (const chip of indicators) {
      expect(chip.normal).toEqual([0, 1, 0]);
      expect(chip.position[1]).toBe(HALF_H);
      expect(Math.abs(chip.position[0]) + INDICATOR_FOOTPRINT[0] / 2).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(chip.position[2]) + INDICATOR_FOOTPRINT[1] / 2).toBeLessThanOrEqual(HALF_D);
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('lays out %i port plates on the bottom face', (count) => {
    const { ports } = computeChassisFeatureLayout({
      batteryCount: 0,
      indicatorCount: 0,
      portCount: count,
    });
    expect(ports).toHaveLength(count);
    assertNoNaN(ports);
    for (const plate of ports) {
      expect(plate.normal).toEqual([0, -1, 0]);
      expect(plate.position[1]).toBe(-HALF_H);
      expect(Math.abs(plate.position[0]) + PORT_FOOTPRINT[0] / 2).toBeLessThanOrEqual(HALF_W);
      expect(Math.abs(plate.position[2]) + PORT_FOOTPRINT[1] / 2).toBeLessThanOrEqual(HALF_D);
    }
  });

  it('never overlaps features within a group at max realistic counts', () => {
    const { batteries, indicators, ports } = computeChassisFeatureLayout({
      batteryCount: 12,
      indicatorCount: 11,
      portCount: 6,
    });
    const groups: Array<[ChassisFeature[], readonly [number, number]]> = [
      [batteries, BATTERY_FOOTPRINT],
      [indicators, INDICATOR_FOOTPRINT],
      [ports, PORT_FOOTPRINT],
    ];
    for (const [features, footprint] of groups) {
      for (let i = 0; i < features.length; i++) {
        for (let j = i + 1; j < features.length; j++) {
          expect(overlapsXZ(features[i], features[j], footprint, footprint)).toBe(false);
        }
      }
    }
  });

  it('never overlaps indicators with battery cells (both live on the top face)', () => {
    const { batteries, indicators } = computeChassisFeatureLayout({
      batteryCount: 12,
      indicatorCount: 11,
      portCount: 0,
    });
    for (const chip of indicators) {
      for (const cell of batteries) {
        expect(overlapsXZ(chip, cell, INDICATOR_FOOTPRINT, BATTERY_FOOTPRINT)).toBe(false);
      }
    }
  });

  it.each([
    ['NaN', NaN],
    ['negative', -3],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ])('treats %s counts as 0 and never emits NaN', (_label, bad) => {
    const layout = computeChassisFeatureLayout({
      batteryCount: bad,
      indicatorCount: bad,
      portCount: bad,
    });
    expect(layout.batteries).toEqual([]);
    expect(layout.indicators).toEqual([]);
    expect(layout.ports).toEqual([]);
    for (const v of [...layout.serial.position, ...layout.serial.normal]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('floors fractional counts', () => {
    const layout = computeChassisFeatureLayout({
      batteryCount: 2.9,
      indicatorCount: 1.5,
      portCount: 0.4,
    });
    expect(layout.batteries).toHaveLength(2);
    expect(layout.indicators).toHaveLength(1);
    expect(layout.ports).toHaveLength(0);
  });

  it('is deterministic: identical input → identical output, stable index mapping', () => {
    const input = { batteryCount: 4, indicatorCount: 3, portCount: 2 };
    const a = computeChassisFeatureLayout(input);
    const b = computeChassisFeatureLayout(input);
    expect(a).toEqual(b);
    a.indicators.forEach((chip, i) => expect(chip.index).toBe(i));
    a.batteries.forEach((cell, i) => expect(cell.index).toBe(i));
    a.ports.forEach((plate, i) => expect(plate.index).toBe(i));
  });

  it('sizes the battery tray to enclose all cells, absent when count is 0', () => {
    const none = computeChassisFeatureLayout({ batteryCount: 0, indicatorCount: 0, portCount: 0 });
    expect(none.batteryTray).toBeNull();

    const some = computeChassisFeatureLayout({ batteryCount: 4, indicatorCount: 0, portCount: 0 });
    expect(some.batteryTray).not.toBeNull();
    const tray = some.batteryTray!;
    for (const cell of some.batteries) {
      expect(Math.abs(cell.position[0] - tray.position[0]) + BATTERY_FOOTPRINT[0] / 2).toBeLessThanOrEqual(tray.size[0] / 2);
      expect(Math.abs(cell.position[2] - tray.position[2]) + BATTERY_FOOTPRINT[1] / 2).toBeLessThanOrEqual(tray.size[1] / 2);
    }
  });

  // Regression: the padded tray box (not just the cells) must stay on the top
  // face. Multi-row trays (battery 9–12) previously overhung the rear edge —
  // invisible to cell-only checks. Sweep including the two-row range.
  it.each([1, 2, 8, 9, 10, 12])('keeps the battery tray box within the top face at %i cells', (count) => {
    const { batteryTray } = computeChassisFeatureLayout({
      batteryCount: count,
      indicatorCount: 0,
      portCount: 0,
    });
    expect(batteryTray).not.toBeNull();
    const tray = batteryTray!;
    expect(Math.abs(tray.position[0]) + tray.size[0] / 2).toBeLessThanOrEqual(HALF_W);
    expect(Math.abs(tray.position[2]) + tray.size[1] / 2).toBeLessThanOrEqual(HALF_D);
  });

  // Regression: a partial final row must stay centred (symmetric about x=0),
  // not shift toward −x from being centred on the first row's column count.
  it.each([
    ['indicators', { batteryCount: 0, indicatorCount: 9, portCount: 0 }, 'indicators' as const],
    ['batteries', { batteryCount: 12, indicatorCount: 0, portCount: 0 }, 'batteries' as const],
  ])('centres a partial last row of %s symmetrically', (_label, input, group) => {
    const layout = computeChassisFeatureLayout(input);
    const xs = layout[group].map((f) => f.position[0]);
    // Centred ⇒ min and max x are mirror images about 0.
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 10);
  });
});
