/**
 * Pure chassis-metadata feature layout (no React, no three.js).
 *
 * Places the BombContext features — serial sticker, battery cells, indicator
 * chips, port plates — on the four NON-module faces of the chassis. The front
 * and back (±z) faces belong to module slots (layout.ts fills front first,
 * then back at count > 6), so metadata there would collide at higher counts:
 *   - serial sticker → right end face (+x): one large feature, instantly
 *     readable when that face rotates into view (AC2 <10 s findability)
 *   - indicator chips + battery tray → top face (+y), separate z zones
 *   - port plates → bottom face (−y)
 *
 * Project rule: feature geometry/layout is data-driven from counts, never
 * hardcoded JSX repetition. Positions depend only on (index, count) — fully
 * deterministic, no randomness.
 */
import { CHASSIS_SIZE } from './layout.js';

export interface ChassisFeature {
  index: number;
  /** Feature centre on the chassis surface, chassis-local space [x, y, z]. */
  position: [number, number, number];
  /** Unit outward normal of the face the feature sits on. */
  normal: [number, number, number];
}

export interface ChassisFeatureLayout {
  serial: { position: [number, number, number]; normal: [number, number, number] };
  batteries: ChassisFeature[];
  /** Graphite tray enclosing all battery cells; null when batteryCount is 0. */
  batteryTray: { position: [number, number, number]; size: [number, number] } | null;
  indicators: ChassisFeature[];
  ports: ChassisFeature[];
}

/** Sticker extents on the +x end face: [width along z, height along y]. */
export const SERIAL_STICKER_SIZE: readonly [number, number] = [0.85, 0.45];
/** Per-feature [x, z] footprints — used by renderers for sizing and by tests for overlap checks. */
export const INDICATOR_FOOTPRINT: readonly [number, number] = [0.36, 0.14];
export const BATTERY_FOOTPRINT: readonly [number, number] = [0.1, 0.24];
export const PORT_FOOTPRINT: readonly [number, number] = [0.42, 0.3];

const HALF_W = CHASSIS_SIZE[0] / 2;
const HALF_H = CHASSIS_SIZE[1] / 2;

/** Indicator grid: centred rows in the front half (−z zone) of the top face. */
const INDICATOR_MAX_PER_ROW = 6;
const INDICATOR_STEP_X = 0.42;
const INDICATOR_STEP_Z = 0.18;
const INDICATOR_CENTER_Z = -0.25;

/** Battery grid: centred rows in the back half (+z zone) of the top face. */
const BATTERY_MAX_PER_ROW = 8;
const BATTERY_STEP_X = 0.16;
const BATTERY_STEP_Z = 0.26;
// Pulled in from 0.26 so a two-row tray (battery 9–12) keeps its padded box
// within HALF_D (0.525): back cell z=0.33 → tray maxZ=0.51 ≤ 0.525. Still clears
// the indicator zone (front cell edge −0.05 vs indicator back edge −0.09).
const BATTERY_CENTER_Z = 0.2;
const BATTERY_TRAY_PADDING = 0.06;

/** Port grid: centred row(s) on the bottom face. */
const PORT_MAX_PER_ROW = 6;
const PORT_STEP_X = 0.5;
const PORT_STEP_Z = 0.34;
const PORT_CENTER_Z = 0;

const sanitize = (count: number): number =>
  Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

function grid(
  count: number,
  faceY: number,
  normalY: 1 | -1,
  maxPerRow: number,
  stepX: number,
  stepZ: number,
  centerZ: number,
): ChassisFeature[] {
  const features: ChassisFeature[] = [];
  const rows = Math.ceil(count / maxPerRow);
  for (let i = 0; i < count; i++) {
    const col = i % maxPerRow;
    const row = Math.floor(i / maxPerRow);
    // Centre each row on its OWN column count, so a partial final row stays
    // centred under the full rows instead of shifting toward −x.
    const rowCols = Math.min(count - row * maxPerRow, maxPerRow);
    features.push({
      index: i,
      position: [
        (col - (rowCols - 1) / 2) * stepX,
        faceY,
        centerZ + (row - (rows - 1) / 2) * stepZ,
      ],
      normal: [0, normalY, 0],
    });
  }
  return features;
}

export function computeChassisFeatureLayout(ctx: {
  batteryCount: number;
  indicatorCount: number;
  portCount: number;
}): ChassisFeatureLayout {
  const batteryCount = sanitize(ctx.batteryCount);
  const indicatorCount = sanitize(ctx.indicatorCount);
  const portCount = sanitize(ctx.portCount);

  const batteries = grid(
    batteryCount, HALF_H, 1,
    BATTERY_MAX_PER_ROW, BATTERY_STEP_X, BATTERY_STEP_Z, BATTERY_CENTER_Z,
  );

  let batteryTray: ChassisFeatureLayout['batteryTray'] = null;
  if (batteries.length > 0) {
    const xs = batteries.map((b) => b.position[0]);
    const zs = batteries.map((b) => b.position[2]);
    const minX = Math.min(...xs) - BATTERY_FOOTPRINT[0] / 2 - BATTERY_TRAY_PADDING;
    const maxX = Math.max(...xs) + BATTERY_FOOTPRINT[0] / 2 + BATTERY_TRAY_PADDING;
    const minZ = Math.min(...zs) - BATTERY_FOOTPRINT[1] / 2 - BATTERY_TRAY_PADDING;
    const maxZ = Math.max(...zs) + BATTERY_FOOTPRINT[1] / 2 + BATTERY_TRAY_PADDING;
    batteryTray = {
      position: [(minX + maxX) / 2, HALF_H, (minZ + maxZ) / 2],
      size: [maxX - minX, maxZ - minZ],
    };
  }

  return {
    serial: { position: [HALF_W, 0, 0], normal: [1, 0, 0] },
    batteries,
    batteryTray,
    indicators: grid(
      indicatorCount, HALF_H, 1,
      INDICATOR_MAX_PER_ROW, INDICATOR_STEP_X, INDICATOR_STEP_Z, INDICATOR_CENTER_Z,
    ),
    ports: grid(
      portCount, -HALF_H, -1,
      PORT_MAX_PER_ROW, PORT_STEP_X, PORT_STEP_Z, PORT_CENTER_Z,
    ),
  };
}
