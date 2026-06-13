/**
 * Pure timer engine — the executable form of the segment-reset contract in
 * `packages/shared/src/types/timer.ts`.
 *
 * WHY THE CLOCK IS INJECTED: every function takes `now` (epoch ms) as a
 * parameter and reads no clock of its own. This keeps the timer math a pure
 * reducer (no `Date.now()`, no `setTimeout`, no `Math.random()`, no I/O —
 * architecture Pattern 2 / project-context), so it is deterministically
 * testable by passing time as input. THIS FILE IS THE ONLY TIMER MATH: the
 * scheduler and socket handlers read the wall clock and persist/emit, but they
 * delegate every calculation here.
 *
 * Segment model (see timer.ts): the clock runs at one constant speed within a
 * segment. A speed change (strike) or a resume starts a FRESH segment so the
 * new rate never retro-applies to already-elapsed time, and so every running
 * broadcast carries a freshly-stamped server `startedAt` (the 4.4 `serverClock`
 * offset estimator depends on this — Story 8.4 broadcast-freshness invariant).
 */
import type { TimerState } from '@bomb-squad/shared';

/** Configured strike speed-up percentage range (RoundConfig.strikeSpeedUpPct). */
const MIN_SPEEDUP_PCT = 0;
const MAX_SPEEDUP_PCT = 50;

/** Start a fresh running segment of `durationMs` at `now`. Multiplier resets to 1. */
export function startSegment(durationMs: number, now: number): TimerState {
  // Defensive clamp: the handler validates timerMs > 0, but a pure fn must
  // never produce a NaN/negative timeline.
  const remainingAtStart = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  return { startedAt: now, remainingAtStart, speedMultiplier: 1, pausedAt: null };
}

/**
 * Displayed remaining time within the current segment, clamped at 0.
 *   remaining = remainingAtStart - (effectiveNow - startedAt) * speedMultiplier
 * `effectiveNow` is `pausedAt` while paused (the clock is frozen), else `now`.
 */
export function remainingMs(timer: TimerState, now: number): number {
  const effectiveNow = timer.pausedAt ?? now;
  const elapsed = (effectiveNow - timer.startedAt) * timer.speedMultiplier;
  const remaining = timer.remainingAtStart - elapsed;
  return remaining > 0 ? remaining : 0;
}

/**
 * True when the displayed clock has reached 0. A PAUSED timer is never expired
 * (remainingMs freezes at `pausedAt`), which is what makes the expiry scheduler
 * safe against a pause without Story 8.7 wiring resume re-arming.
 */
export function isExpired(timer: TimerState, now: number): boolean {
  return remainingMs(timer, now) <= 0;
}

/**
 * Rebase the timer for a recorded strike: snapshot the displayed remaining into
 * a fresh segment at `now` and COMPOUND the speed multiplier by `strikeSpeedUpPct`
 * (×1.00 → ×1.25 → ×1.56 at the default 25%). Preserves `pausedAt` so a strike
 * while paused keeps the (frozen) remaining and only changes the rate.
 */
export function rebaseForStrike(
  timer: TimerState,
  strikeSpeedUpPct: number,
  now: number,
): TimerState {
  const pct = clampPct(strikeSpeedUpPct);
  return {
    startedAt: now,
    remainingAtStart: remainingMs(timer, now),
    speedMultiplier: timer.speedMultiplier * (1 + pct / 100),
    pausedAt: timer.pausedAt,
  };
}

/** Freeze the clock at `now`. Idempotent: an already-paused timer returns unchanged (same ref). */
export function pause(timer: TimerState, now: number): TimerState {
  if (timer.pausedAt !== null) return timer;
  return { ...timer, pausedAt: now };
}

/**
 * Resume a paused clock by starting a FRESH segment carrying the frozen
 * remaining. Idempotent: a running timer returns unchanged (same ref). Simply
 * nulling `pausedAt` would silently subtract the whole paused span (timer.ts).
 */
export function resume(timer: TimerState, now: number): TimerState {
  if (timer.pausedAt === null) return timer;
  return {
    startedAt: now,
    remainingAtStart: remainingMs(timer, timer.pausedAt),
    speedMultiplier: timer.speedMultiplier,
    pausedAt: null,
  };
}

/**
 * Absolute epoch ms at which a RUNNING segment hits 0, for the scheduler's wake.
 * `null` when paused (no deadline) or when the multiplier is non-positive (guard).
 */
export function expiryInstant(timer: TimerState): number | null {
  if (timer.pausedAt !== null) return null;
  if (!(timer.speedMultiplier > 0)) return null;
  return timer.startedAt + timer.remainingAtStart / timer.speedMultiplier;
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return MIN_SPEEDUP_PCT;
  if (pct < MIN_SPEEDUP_PCT) return MIN_SPEEDUP_PCT;
  if (pct > MAX_SPEEDUP_PCT) return MAX_SPEEDUP_PCT;
  return pct;
}
