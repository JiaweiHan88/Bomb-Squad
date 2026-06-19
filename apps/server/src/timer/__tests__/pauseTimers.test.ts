import { describe, expect, it } from '@jest/globals';
import type { TimerState } from '@bomb-squad/shared';
import { freezeRoundTimers, resumeRoundTimers } from '../pauseTimers.js';
import { timerKey } from '../../state/keys.js';
import { createMemoryRedisStore, noopLog } from '../../handlers/__tests__/testSocketServer.js';
import type { SessionIOServer } from '../../handlers/sessionHandlers.js';

/** Records every `io.to(room).emit(event, payload)` call. */
function fakeIo() {
  const emits: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emits.push({ room, event, payload }),
    }),
  } as unknown as SessionIOServer;
  return { io, emits };
}

/** Records arm/cancel for assertions; satisfies Pick<TimerScheduler,'arm'|'cancel'>. */
function fakeScheduler() {
  const calls: Array<{ kind: 'arm' | 'cancel'; teamId: string }> = [];
  return {
    timer: {
      arm: (_s: string, teamId: string, _t: TimerState) => calls.push({ kind: 'arm', teamId }),
      cancel: (_s: string, teamId: string) => calls.push({ kind: 'cancel', teamId }),
    } as never,
    calls,
  };
}

const SID = 'sess-1';
// A running timer that has already taken two strikes (speedMultiplier 1.5625).
const struckTimer = (): TimerState => ({
  startedAt: 1000,
  remainingAtStart: 200_000,
  speedMultiplier: 1.5625,
  pausedAt: null,
});

describe('freezeRoundTimers', () => {
  it('freezes the live timer, cancels the wake, and PERSISTS the key (never deletes it)', async () => {
    const redis = createMemoryRedisStore();
    await redis.setJSON(timerKey(SID, 'A'), struckTimer());
    const { io, emits } = fakeIo();
    const sched = fakeScheduler();

    await freezeRoundTimers(io, { redis, log: noopLog, timer: sched.timer }, SID, ['A'], 5000);

    const stored = await redis.getJSON<TimerState>(timerKey(SID, 'A'));
    expect(stored).not.toBeNull(); // KEY NOT DELETED (between-rounds gate safety)
    expect(stored!.pausedAt).toBe(5000);
    expect(stored!.speedMultiplier).toBe(1.5625); // strike accel preserved
    expect(sched.calls).toContainEqual({ kind: 'cancel', teamId: 'A' });
    expect(emits.some((e) => e.event === 'TIMER_UPDATE')).toBe(true);
  });

  it('skips a team with no live timer key (resting / resolved)', async () => {
    const redis = createMemoryRedisStore();
    const { io, emits } = fakeIo();
    const sched = fakeScheduler();
    await freezeRoundTimers(io, { redis, log: noopLog, timer: sched.timer }, SID, ['A', 'B'], 5000);
    expect(emits).toHaveLength(0);
  });
});

describe('resumeRoundTimers', () => {
  it('starts a fresh segment carrying the frozen remaining, preserves speedMultiplier, re-arms', async () => {
    const redis = createMemoryRedisStore();
    // Freeze first (remaining at pause = 200000 - (5000-1000)*1.5625 = 193750).
    await redis.setJSON(timerKey(SID, 'A'), { ...struckTimer(), pausedAt: 5000 });
    const { io } = fakeIo();
    const sched = fakeScheduler();

    await resumeRoundTimers(io, { redis, log: noopLog, timer: sched.timer }, SID, ['A'], 9000);

    const stored = await redis.getJSON<TimerState>(timerKey(SID, 'A'));
    expect(stored!.pausedAt).toBeNull();
    expect(stored!.startedAt).toBe(9000); // fresh segment at resume `now`
    expect(stored!.speedMultiplier).toBe(1.5625); // accel preserved
    // Frozen remaining carried forward — the paused span (5000→9000) is NOT burned.
    expect(stored!.remainingAtStart).toBeCloseTo(200_000 - (5000 - 1000) * 1.5625);
    expect(sched.calls).toContainEqual({ kind: 'arm', teamId: 'A' });
  });

  it('skips a timer that is not paused', async () => {
    const redis = createMemoryRedisStore();
    await redis.setJSON(timerKey(SID, 'A'), struckTimer()); // running, pausedAt null
    const { io } = fakeIo();
    const sched = fakeScheduler();
    await resumeRoundTimers(io, { redis, log: noopLog, timer: sched.timer }, SID, ['A'], 9000);
    expect(sched.calls).toHaveLength(0);
  });
});
