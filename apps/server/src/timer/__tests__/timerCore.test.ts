import { describe, expect, it } from '@jest/globals';
import type { TimerState } from '@bomb-squad/shared';
import {
  startSegment,
  remainingMs,
  isExpired,
  rebaseForStrike,
  pause,
  resume,
  expiryInstant,
} from '../timerCore.js';

const T0 = 1_000_000; // arbitrary epoch ms
const DUR = 300_000; // 5:00

const running = (overrides: Partial<TimerState> = {}): TimerState => ({
  startedAt: T0,
  remainingAtStart: DUR,
  speedMultiplier: 1,
  pausedAt: null,
  ...overrides,
});

describe('startSegment', () => {
  it('produces a fresh running segment at multiplier 1', () => {
    expect(startSegment(DUR, T0)).toEqual({
      startedAt: T0,
      remainingAtStart: DUR,
      speedMultiplier: 1,
      pausedAt: null,
    });
  });

  it('clamps a non-finite or negative duration to 0 (no NaN timeline)', () => {
    expect(startSegment(Number.NaN, T0).remainingAtStart).toBe(0);
    expect(startSegment(-5, T0).remainingAtStart).toBe(0);
  });
});

describe('remainingMs', () => {
  it('decrements at ×1.0 (wall time == displayed time)', () => {
    expect(remainingMs(running(), T0 + 10_000)).toBe(DUR - 10_000);
  });

  it('decrements faster at ×1.25 and ×1.56', () => {
    expect(remainingMs(running({ speedMultiplier: 1.25 }), T0 + 10_000)).toBe(DUR - 12_500);
    expect(remainingMs(running({ speedMultiplier: 1.5625 }), T0 + 10_000)).toBe(DUR - 15_625);
  });

  it('clamps at 0 past expiry (never negative)', () => {
    expect(remainingMs(running({ remainingAtStart: 5_000 }), T0 + 10_000)).toBe(0);
  });

  it('freezes while paused — advancing now does not change it', () => {
    const paused = running({ pausedAt: T0 + 30_000 });
    expect(remainingMs(paused, T0 + 30_000)).toBe(DUR - 30_000);
    expect(remainingMs(paused, T0 + 999_999)).toBe(DUR - 30_000);
  });
});

describe('isExpired', () => {
  it('false before the deadline, true at/after it', () => {
    const t = running({ remainingAtStart: 10_000 });
    expect(isExpired(t, T0 + 9_999)).toBe(false);
    expect(isExpired(t, T0 + 10_000)).toBe(true);
    expect(isExpired(t, T0 + 10_001)).toBe(true);
  });

  it('NEVER expired while paused (the scheduler-safety property)', () => {
    const paused = running({ remainingAtStart: 10_000, pausedAt: T0 + 10_000 });
    expect(isExpired(paused, T0 + 10_000)).toBe(true); // frozen at exactly 0
    const pausedWithTime = running({ remainingAtStart: 10_000, pausedAt: T0 + 5_000 });
    expect(isExpired(pausedWithTime, T0 + 9_999_999)).toBe(false);
  });
});

describe('rebaseForStrike', () => {
  it('compounds the multiplier ×1.0 → ×1.25 → ×1.5625 at the default 25%', () => {
    const s1 = rebaseForStrike(running(), 25, T0 + 1_000);
    expect(s1.speedMultiplier).toBe(1.25);
    const s2 = rebaseForStrike(s1, 25, T0 + 2_000);
    expect(s2.speedMultiplier).toBe(1.5625);
  });

  it('honours a non-default percentage (50% → ×1.5; tolerant for non-power-of-two)', () => {
    expect(rebaseForStrike(running(), 50, T0).speedMultiplier).toBe(1.5);
    expect(rebaseForStrike(running(), 30, T0).speedMultiplier).toBeCloseTo(1.3, 10);
  });

  it('clamps the percentage into [0, 50]', () => {
    expect(rebaseForStrike(running(), -10, T0).speedMultiplier).toBe(1); // 0%
    expect(rebaseForStrike(running(), 999, T0).speedMultiplier).toBe(1.5); // 50%
  });

  it('snapshots the displayed remaining and opens a fresh segment at now', () => {
    // Halfway through a 5:00 run: 2:30 displayed remaining.
    const s1 = rebaseForStrike(running(), 25, T0 + 150_000);
    expect(s1.startedAt).toBe(T0 + 150_000);
    expect(s1.remainingAtStart).toBe(150_000);
    // Only the RATE changes — the displayed remaining at the rebase instant is preserved.
    expect(remainingMs(s1, T0 + 150_000)).toBe(150_000);
  });

  it('preserves pausedAt (a strike while paused keeps the clock frozen)', () => {
    const paused = running({ pausedAt: T0 + 30_000 });
    const struck = rebaseForStrike(paused, 25, T0 + 30_000);
    expect(struck.pausedAt).toBe(T0 + 30_000);
    expect(struck.speedMultiplier).toBe(1.25);
    expect(struck.remainingAtStart).toBe(DUR - 30_000);
  });
});

describe('pause / resume', () => {
  it('pause freezes at now; resume preserves remaining across an arbitrary paused span', () => {
    const paused = pause(running(), T0 + 60_000); // 4:00 remaining, frozen
    expect(paused.pausedAt).toBe(T0 + 60_000);
    // Resume 1,000,000 ms later — the paused span must not be subtracted.
    const resumed = resume(paused, T0 + 60_000 + 1_000_000);
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.startedAt).toBe(T0 + 60_000 + 1_000_000);
    expect(remainingMs(resumed, resumed.startedAt)).toBe(DUR - 60_000);
  });

  it('pause is idempotent (same reference) on an already-paused timer', () => {
    const paused = pause(running(), T0 + 10_000);
    expect(pause(paused, T0 + 50_000)).toBe(paused);
  });

  it('resume is idempotent (same reference) on a running timer', () => {
    const t = running();
    expect(resume(t, T0 + 10_000)).toBe(t);
  });
});

describe('expiryInstant', () => {
  it('returns the absolute instant the running clock hits 0', () => {
    expect(expiryInstant(running())).toBe(T0 + DUR);
    expect(expiryInstant(running({ speedMultiplier: 2 }))).toBe(T0 + DUR / 2);
  });

  it('returns null while paused (no live deadline)', () => {
    expect(expiryInstant(running({ pausedAt: T0 + 10_000 }))).toBeNull();
  });

  it('returns null for a non-positive multiplier (guard)', () => {
    expect(expiryInstant(running({ speedMultiplier: 0 }))).toBeNull();
  });
});

describe('immutability (deep-frozen input must not throw — project rule)', () => {
  it.each([
    ['remainingMs', (t: TimerState) => remainingMs(t, T0 + 5_000)],
    ['isExpired', (t: TimerState) => isExpired(t, T0 + 5_000)],
    ['rebaseForStrike', (t: TimerState) => rebaseForStrike(t, 25, T0 + 5_000)],
    ['pause', (t: TimerState) => pause(t, T0 + 5_000)],
    ['resume', (t: TimerState) => resume({ ...t, pausedAt: T0 + 1_000 }, T0 + 5_000)],
    ['expiryInstant', (t: TimerState) => expiryInstant(t)],
  ])('%s does not mutate or throw on a frozen timer', (_name, fn) => {
    const frozen = Object.freeze(running());
    expect(() => fn(frozen)).not.toThrow();
  });

  it('startSegment output for a frozen-input flow is independent', () => {
    expect(() => startSegment(DUR, T0)).not.toThrow();
  });
});
