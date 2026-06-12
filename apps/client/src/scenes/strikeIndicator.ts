import type { StrikeCount } from '@bomb-squad/shared';
import type { SolveLedVisual } from './moduleLed.js';
import { TIMER_HOUSING_FOOTPRINT } from './timerLcd.js';

/**
 * Pure strike-indicator visuals + geometry (no React, no three.js) — Story 4.5.
 *
 * The chassis carries 2 strike LED dots beside the timer (DESIGN
 * componentSpec.strikeIndicator; EXPERIENCE HUD hierarchy #2 "adjacent right
 * of timer"). Only the two survivable strikes are displayed: the third strike
 * IS the explosion (GDD win/loss), the server's event — at strikes === 3 both
 * dots simply stay lit as a display floor.
 *
 * Strikes are team-wide server truth rendered verbatim from bomb.strikes —
 * the client never derives or attributes them.
 */

/** The two dots, data-driven (project rule: no hardcoded JSX repetition). */
export const STRIKE_DOT_INDICES: ReadonlyArray<0 | 1> = [0, 1];

// Raw hexes with token names — CSS vars can't reach WebGL materials.
// DESIGN componentSpec.strikeIndicator, literal values. Active is ledRed, NOT
// ledAmber: the explicit componentSpec + mockup overrule the general
// "amber = strike-1 cue" semantic reservation (specific-over-general, the
// 4.2/4.3 precedence ruling).
const INACTIVE_VISUAL: SolveLedVisual = {
  color: '#7A0000', // --led-red-glow
  emissive: '#7A0000', // --led-red-glow
  emissiveIntensity: 0.25, // "inactive: ledRedGlow, opacity 0.25"
};
const ACTIVE_VISUAL: SolveLedVisual = {
  color: '#FF2E2E', // --led-red
  emissive: '#FF2E2E', // --led-red
  emissiveIntensity: 1.5, // "active: ledRed, glow 0 0 12px" (< timer's 16px halo)
};

/**
 * Visual state for one strike dot. Both states are static — shared constants,
 * never allocated per call (and unlike moduleLed's animated flash branch, no
 * scratch object is needed here: nothing animates).
 */
export function strikeLedVisual(dotIndex: 0 | 1, strikes: StrikeCount): SolveLedVisual {
  return dotIndex < strikes ? ACTIVE_VISUAL : INACTIVE_VISUAL;
}

// ─── Housing geometry (chassis-local) ────────────────────────────────────────
// A graphite sibling block to the timer housing, in the SAME top-face z-band
// (z ∈ [−0.16, 0] — the gap between 4.2's indicator zone and battery tray,
// overlap-proven in 4.4 at the single-row envelope of ≤6 indicators /
// ≤8 batteries), placed in the free x-band right of the timer housing that
// 4.4's completion notes reserved (housing is 1.1 wide centred at x = 0 →
// free right of x ≈ 0.6). Same height/depth/tilt as the timer housing so the
// pair reads as one instrument cluster at the overview pose.

/** Housing box [w, h, d] (mutable tuple type matches CHASSIS_SIZE / R3F args). */
export const STRIKE_HOUSING_SIZE: [number, number, number] = [0.36, 0.55, 0.16];
/** Housing centre x — adjacent right of the timer housing with a 0.09 gap. */
export const STRIKE_HOUSING_CENTER_X = 0.82;
/** Footprint on the top face, for overlap tests. */
export const STRIKE_HOUSING_FOOTPRINT = {
  minX: STRIKE_HOUSING_CENTER_X - STRIKE_HOUSING_SIZE[0] / 2,
  maxX: STRIKE_HOUSING_CENTER_X + STRIKE_HOUSING_SIZE[0] / 2,
  minZ: TIMER_HOUSING_FOOTPRINT.minZ,
  maxZ: TIMER_HOUSING_FOOTPRINT.maxZ,
} as const;

/**
 * Mockup .strike-led is 18px → ≈0.075wu diameter via the 0.0042 wu/px
 * overview conversion (the same trace as the 10px solve LED and 84px timer
 * digits); .row gap is 9px ≈ 0.038wu.
 */
export const STRIKE_LED_RADIUS = 0.0375;
export const STRIKE_LED_GAP = 0.038;
/** Centre-to-centre distance between the two dots. */
export const STRIKE_LED_SEPARATION = STRIKE_LED_RADIUS * 2 + STRIKE_LED_GAP;
