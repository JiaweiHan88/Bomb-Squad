import { beforeEach, describe, expect, it } from 'vitest';
import type { TimerState } from '@bomb-squad/shared';
import {
  estimateClockOffset,
  noteTimerBroadcast,
  resetClockOffset,
  resetClockOffsetForTest,
  serverNow,
} from '../serverClock.js';

const running = (overrides: Partial<TimerState> = {}): TimerState => ({
  startedAt: 5_000,
  remainingAtStart: 300_000,
  speedMultiplier: 1,
  pausedAt: null,
  ...overrides,
});

describe('estimateClockOffset', () => {
  it('running segment: offset = startedAt − receivedAt (client behind server)', () => {
    expect(estimateClockOffset(running(), 3_000)).toBe(2_000);
  });

  it('sign-correct when the client clock is ahead of the server', () => {
    expect(estimateClockOffset(running(), 8_000)).toBe(-3_000);
  });

  it('paused broadcast → null (startedAt is not fresh on a frozen segment)', () => {
    expect(estimateClockOffset(running({ pausedAt: 4_000 }), 3_000)).toBeNull();
  });
});

describe('serverClock module state', () => {
  beforeEach(() => resetClockOffsetForTest());

  it('defaults to offset 0 before any broadcast (dev harness / pre-connect)', () => {
    expect(serverNow(1_234)).toBe(1_234);
  });

  it('applies a running-segment estimate', () => {
    noteTimerBroadcast(running(), 3_000); // offset +2000
    expect(serverNow(10_000)).toBe(12_000);
  });

  it('keeps the previous offset across a paused broadcast', () => {
    noteTimerBroadcast(running(), 3_000); // offset +2000
    noteTimerBroadcast(running({ pausedAt: 9_000 }), 9_999);
    expect(serverNow(10_000)).toBe(12_000);
  });

  it('refreshes on each running broadcast (architecture: refreshed per timer broadcast)', () => {
    noteTimerBroadcast(running(), 3_000); // offset +2000
    noteTimerBroadcast(running({ startedAt: 70_000 }), 69_500); // offset +500
    expect(serverNow(10_000)).toBe(10_500);
  });

  it('resetClockOffset() drops a stale offset back to 0 (Story 8.4 disconnect reset)', () => {
    noteTimerBroadcast(running(), 3_000); // offset +2000
    expect(serverNow(10_000)).toBe(12_000);
    resetClockOffset();
    expect(serverNow(10_000)).toBe(10_000);
  });
});
