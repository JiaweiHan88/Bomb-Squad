import type { ModuleState } from '@bomb-squad/shared';

/**
 * Pure solve-LED visual state (no React, no three.js) — the layout.ts/chassis.ts
 * house pattern. The ModuleBay component applies the returned material
 * description verbatim; all decisions live (and are tested) here.
 *
 * State table (DESIGN.md componentSpec.moduleSolveLed, literal values):
 *   armed  → dim red, near-dormant
 *   solved → green with green glow — the single source of truth for "solved"
 *   struck → 600ms red flash, then back to the armed visual
 *
 * 'struck' is transient by contract (the bomb reducer rolls it into a team
 * strike and resets status to 'armed'), so the flash is driven by an
 * edge-triggered elapsed clock owned by the component, not by the status
 * resting at 'struck'. A 'struck' status with no active flash renders as armed.
 */

export type ModuleStatus = ModuleState<unknown>['status'];

/** Strike-flash window (EXPERIENCE.md: "module flashes red 600ms"). */
export const SOLVE_LED_FLASH_MS = 600;

export interface SolveLedVisual {
  color: string;
  emissive: string;
  emissiveIntensity: number;
}

// Raw hexes with token names — CSS vars can't reach WebGL materials.
const ARMED_VISUAL: SolveLedVisual = {
  color: '#7A0000', // --led-red-glow
  emissive: '#7A0000', // --led-red-glow
  emissiveIntensity: 0.25,
};
const SOLVED_VISUAL: SolveLedVisual = {
  color: '#3DFF7A', // --led-green
  emissive: '#15B548', // --led-green-glow
  emissiveIntensity: 1.4,
};
/** Reduced motion: one static red state for the window, no animated ramp. */
const FLASH_STATIC_VISUAL: SolveLedVisual = {
  color: '#FF2E2E', // --led-red
  emissive: '#FF2E2E', // --led-red
  emissiveIntensity: 1.8,
};
/** Normal motion: the flash decays from this peak down to the floor over 600ms. */
const FLASH_PEAK_INTENSITY = 2.2;
const FLASH_FLOOR_INTENSITY = 0.6;

/**
 * @param flashElapsedMs ms since the armed→struck edge was observed, or null
 *   when no flash is active. Out-of-window or garbage values (negative, NaN,
 *   ≥600) are treated as "no flash".
 */
export function solveLedVisual(
  status: ModuleStatus,
  flashElapsedMs: number | null,
  reducedMotion: boolean,
): SolveLedVisual {
  // Solved wins unconditionally — a solved module never shows red (AC2).
  if (status === 'solved') return SOLVED_VISUAL;

  const flashActive =
    flashElapsedMs !== null &&
    Number.isFinite(flashElapsedMs) &&
    flashElapsedMs >= 0 &&
    flashElapsedMs < SOLVE_LED_FLASH_MS;

  if (flashActive) {
    if (reducedMotion) return FLASH_STATIC_VISUAL;
    const remaining = 1 - flashElapsedMs / SOLVE_LED_FLASH_MS;
    return {
      color: '#FF2E2E', // --led-red
      emissive: '#FF2E2E', // --led-red
      emissiveIntensity:
        FLASH_FLOOR_INTENSITY + (FLASH_PEAK_INTENSITY - FLASH_FLOOR_INTENSITY) * remaining,
    };
  }

  // 'armed', or a transient/stale 'struck' with no active flash.
  return ARMED_VISUAL;
}
