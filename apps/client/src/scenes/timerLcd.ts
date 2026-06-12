/**
 * Pure timer-LCD math (no React, no three.js) — Story 4.4.
 *
 * The client never runs its own countdown: it renders the server's TimerState
 * descriptor (ADR-005) by re-evaluating the within-segment formula every frame.
 * Segment rebasing (resume, strike escalation) is the server's job — see the
 * segment-reset convention in packages/shared/src/types/timer.ts.
 */
import type { StrikeCount, TimerState } from '@bomb-squad/shared';

/**
 * Remaining ms within the current timer segment, clamped to ≥ 0.
 * AC3: the extrapolated zero is a display floor — never negative, never an
 * event. When pausedAt is set the clock is frozen (pausedAt substitutes now).
 */
export function timerRemainingMs(timer: TimerState, serverNowMs: number): number {
  const now = timer.pausedAt ?? serverNowMs;
  const remaining = timer.remainingAtStart - (now - timer.startedAt) * timer.speedMultiplier;
  return remaining > 0 ? remaining : 0;
}

/**
 * M:SS (extends to MM:SS for ≥10-minute configs). Seconds are floored — the
 * display must never show a second that has not fully elapsed away.
 */
export function formatTimerDisplay(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Unlit-segment ghost layer for a display string: every digit becomes 8 (the
 * DSEG all-segments-lit glyph); the colon survives. DSEG7's fixed-width digits
 * make the ghost a perfect underlay with zero per-digit position math.
 */
export function timerGhostFor(display: string): string {
  return display.replace(/\d/g, '8');
}

/** Under this remaining time the LCD glow pulses on the second (EXPERIENCE.md). */
export const LCD_PULSE_THRESHOLD_MS = 10_000;
/** Base glow intensity multiplier (DESIGN componentSpec.timer glow). */
export const LCD_GLOW_BASE = 1;
/** "+20% glow intensity per strike" (DESIGN componentSpec.timer pulseOnStrike). */
export const LCD_GLOW_STRIKE_STEP = 0.2;
/** Peak pulse boost at the instant the displayed second flips. */
export const LCD_GLOW_PULSE_BOOST = 0.9;

/**
 * Complete glow-intensity description, applied verbatim by the component (the
 * LCD's single animated scalar — digits NEVER animate, AC2):
 *  - base + 20% per strike;
 *  - under 10s remaining, a pulse phase-locked to the digit change: peak right
 *    after the displayed second flips, decaying to nothing as the next flip
 *    approaches (a paused/dead clock has frozen remaining → frozen glow);
 *  - reducedMotion strips the pulse, keeping the static strike-adjusted base.
 */
export function lcdGlowIntensity(
  remainingMs: number,
  strikes: StrikeCount,
  reducedMotion: boolean,
): number {
  const base = LCD_GLOW_BASE + strikes * LCD_GLOW_STRIKE_STEP;
  if (reducedMotion) return base;
  if (remainingMs <= 0 || remainingMs >= LCD_PULSE_THRESHOLD_MS) return base;
  // Time since the displayed second flipped, as a 0→1 phase: remaining just
  // dropped past a whole second when remaining % 1000 is just under 1000.
  const phase = (1000 - (remainingMs % 1000)) / 1000;
  return base + LCD_GLOW_PULSE_BOOST * (1 - phase);
}

// ─── Housing geometry (chassis-local) ────────────────────────────────────────
// The LCD housing sits on the chassis top face (+y), centred at x = 0, in the
// band between 4.2's indicator zone (rows around z = −0.25, single-row max
// z-extent −0.18) and the battery tray (single-row min z-extent +0.02).
// Supported envelope: ≤6 indicators / ≤8 batteries (single-row layouts) — the
// overlap test in __tests__/timerLcd.test.ts enforces it; two-row layouts
// would consume the band and need a renegotiation with Story 8.2's ranges.

/** Housing box [w, h, d] (mutable tuple type matches CHASSIS_SIZE / R3F args). */
export const TIMER_HOUSING_SIZE: [number, number, number] = [1.1, 0.55, 0.16];
/** Housing footprint on the top face, for overlap tests. */
export const TIMER_HOUSING_FOOTPRINT = {
  halfWidth: TIMER_HOUSING_SIZE[0] / 2,
  minZ: -0.16,
  maxZ: 0,
} as const;
/** Footprint centre → housing box centre z. */
export const TIMER_HOUSING_CENTER_Z =
  (TIMER_HOUSING_FOOTPRINT.minZ + TIMER_HOUSING_FOOTPRINT.maxZ) / 2;

/**
 * The 84px ruling (DESIGN typography.scale.timer) translated to world units:
 * at the overview pose (distance ≈5.2, fov 45°, 1080p stage) one pixel
 * ≈ 2·5.2·tan(22.5°)/1080 ≈ 0.004 world units → 84px digits ≈ 0.35 world
 * units tall (same conversion documented for the 10px solve LED in 4.3).
 */
export const TIMER_DIGIT_HEIGHT = 0.35;
