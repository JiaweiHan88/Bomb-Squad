/**
 * Pure module-slot layout for the bomb scene (no React, no three.js).
 *
 * Project rule: module geometry/layout is data-driven, never hardcoded JSX
 * repetition. Since Story 4.3 the slot list is driven by BombState.modules
 * (each slot renders its module's data — id → renderer registry lookup,
 * status → solve LED); this file owns only the position math.
 *
 * Slots fill a 3-wide grid on the chassis front face, then continue onto the
 * back face (mirroring the KTANE two-faced bomb). The grid grows downward in
 * rows as needed, so any count lays out without overlap — the 6-per-face nominal
 * is just the dev-harness baseline, not a cap.
 */
export interface ModuleSlot {
  moduleIndex: number;
  /** Slot centre in chassis-local space [x, y, z]. */
  position: [number, number, number];
  /** Unit outward normal of the face the slot sits on (front +z / back -z). */
  normal: [number, number, number];
}

/** Slots per face: 3 columns × 2 rows. */
const COLS = 3;
const ROWS = 2;
const SLOTS_PER_FACE = COLS * ROWS;

/** Chassis proportions (must match the placeholder chassis in BombScene). */
export const CHASSIS_SIZE: [number, number, number] = [3, 1.5, 1.05];

/** Spacing between slot centres. */
const STEP_X = 0.95;
const STEP_Y = 0.7;

/** 1-based, zero-padded bay micro-label (mockup .bay-tag): 0 → "MOD-01". */
export function formatBayTag(moduleIndex: number): string {
  return `MOD-${String(moduleIndex + 1).padStart(2, '0')}`;
}

/**
 * Human-readable module-type label for the Preparation placeholder bomb (4.6):
 * the kebab-case moduleId rendered as upper-case words. "wires" → "WIRES",
 * "the-button" → "THE BUTTON". Derived from the id so a new module type needs
 * no label table — the prep bay tag reads whatever pool the round config holds.
 */
export function formatModuleType(moduleId: string): string {
  return moduleId.replace(/-/g, ' ').toUpperCase();
}

export function computeModuleLayout(count: number): ModuleSlot[] {
  if (!Number.isFinite(count) || count <= 0) return [];

  const slots: ModuleSlot[] = [];
  const faceZ = CHASSIS_SIZE[2] / 2;

  for (let i = 0; i < count; i++) {
    const faceBatch = Math.floor(i / SLOTS_PER_FACE);
    const face = faceBatch % 2 === 0 ? 1 : -1;
    // Running slot index ON THIS FACE: prior full batches on the same face
    // contribute SLOTS_PER_FACE each. This lets the grid grow downward in extra
    // rows instead of wrapping a third batch back onto an occupied face (which
    // silently overlapped slot 12 onto slot 0).
    const onFace = Math.floor(faceBatch / 2) * SLOTS_PER_FACE + (i % SLOTS_PER_FACE);
    const col = onFace % COLS;
    const row = Math.floor(onFace / COLS);
    // Centre the grid: col 0..2 → -1..+1 steps; row 0..1 → +0.5/-0.5 steps,
    // growing downward for overflow rows. Mirror x on the back face so the grid
    // reads left-to-right when facing it.
    const x = (col - (COLS - 1) / 2) * STEP_X * face;
    const y = ((ROWS - 1) / 2 - row) * STEP_Y;

    slots.push({
      moduleIndex: i,
      position: [x, y, face * faceZ],
      normal: [0, 0, face],
    });
  }

  return slots;
}
