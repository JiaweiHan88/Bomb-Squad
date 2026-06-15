import { describe, expect, it } from '@jest/globals';
import type { RoundState, SessionState, TimerState } from '@bomb-squad/shared';
import { createMemoryRedisStore, noopLog, type MemoryRedisStore } from '../../handlers/__tests__/testSocketServer.js';
import type { SessionIOServer } from '../../handlers/sessionHandlers.js';
import { roundKey, sessionKey, timerKey } from '../../state/keys.js';
import { createSessionState } from '../../session/createSession.js';
import { createTimerScheduler, type TimerScheduler } from '../timerScheduler.js';
import { startSegment, pause, rebaseForStrike } from '../timerCore.js';

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

/** Minimal fake io that records team-room emits. */
function fakeIo(emitted: Emitted[]): SessionIOServer {
  return {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  } as unknown as SessionIOServer;
}

interface Harness {
  scheduler: TimerScheduler;
  store: MemoryRedisStore;
  emitted: Emitted[];
  timers: Array<{ cb: () => void; ms: number; id: number }>;
  cleared: number[];
  setNow(n: number): void;
}

function makeHarness(): Harness {
  const store = createMemoryRedisStore();
  const emitted: Emitted[] = [];
  const timers: Array<{ cb: () => void; ms: number; id: number }> = [];
  const cleared: number[] = [];
  let now = 0;
  let nextId = 1;
  const scheduler = createTimerScheduler({
    redis: store,
    io: fakeIo(emitted),
    log: noopLog,
    clock: () => now,
    setTimer: (cb, ms) => {
      const id = nextId++;
      timers.push({ cb, ms, id });
      return id;
    },
    clearTimer: (handle) => {
      cleared.push(handle as number);
    },
  });
  return { scheduler, store, emitted, timers, cleared, setNow: (n) => (now = n) };
}

const SID = 'sess-1';
const ROUND_NUMBER = 1;
const running = (durationMs = 10_000): TimerState => startSegment(durationMs, 0);

/**
 * Seed an ACTIVE round so the timeout fire path can run the full Story 8.5
 * ceremony (resolveRound): session 'active' with team A, plus the RoundState the
 * ceremony's idempotency/outcome bookkeeping reads + writes.
 */
async function seedSession(store: MemoryRedisStore, timerMs = 10_000): Promise<void> {
  const base = createSessionState({
    sessionId: SID,
    joinCode: 'ABC123',
    facilitatorId: 'fac',
    config: { timerMs },
  });
  const session: SessionState = {
    ...base,
    status: 'active',
    roundNumber: ROUND_NUMBER,
    teams: { A: { teamId: 'A', relayOrder: ['p1'], currentDefuserIndex: 0, cumulativeTimeMs: 0 } },
  };
  await store.setJSON(sessionKey(SID), session);
  const round: RoundState = { roundNumber: ROUND_NUMBER, status: 'active', defusers: { A: 'p1' }, retry: false };
  await store.setJSON(roundKey(SID, ROUND_NUMBER), round);
}

describe('TimerScheduler.arm', () => {
  it('schedules a wake at expiryInstant (delay = remaining / multiplier)', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', running(10_000)); // startedAt 0, mult 1, now 0
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(10_000);
  });

  it('uses delay 0 (never negative) when the deadline is already past', () => {
    const h = makeHarness();
    h.setNow(50_000); // well past a 10s timer started at 0
    h.scheduler.arm(SID, 'A', running(10_000));
    expect(h.timers[0].ms).toBe(0);
  });

  it('does not schedule a wake for a paused timer (no live deadline)', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', pause(running(10_000), 1_000));
    expect(h.timers).toHaveLength(0);
  });

  it('replacing an existing key clears the prior wake (no double-fire)', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', running(10_000)); // handle 1
    h.scheduler.arm(SID, 'A', running(20_000)); // replaces → clears handle 1
    expect(h.cleared).toEqual([1]);
    expect(h.timers).toHaveLength(2);
  });
});

describe('TimerScheduler fire path (reload + revalidate)', () => {
  it('still-expired on fire → delegates to resolveRound: BOMB_EXPLODED + records time + sets status + timerKey deleted', async () => {
    const h = makeHarness();
    await seedSession(h.store, 10_000);
    await h.store.setJSON(timerKey(SID, 'A'), running(10_000));
    h.setNow(10_001); // past the deadline

    await h.scheduler.fireNow(SID, 'A');

    // Story 8.5: the timeout path now runs the full ceremony, not a bare emit.
    expect(h.emitted).toEqual([
      { room: `session:${SID}:team:A`, event: 'BOMB_EXPLODED', payload: { teamId: 'A', elapsedMs: 10_000 } },
    ]);
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(false);
    const session = (await h.store.getJSON<SessionState>(sessionKey(SID)))!;
    expect(session.teams.A!.cumulativeTimeMs).toBe(10_000); // displayed elapsed = timerMs
    expect(session.status).toBe('between-rounds');
    const round = (await h.store.getJSON<RoundState>(roundKey(SID, ROUND_NUMBER)))!;
    expect(round.status).toBe('time-expired');
  });

  it('reloaded timer is PAUSED → no-op (the scheduler-safety property)', async () => {
    const h = makeHarness();
    await seedSession(h.store);
    await h.store.setJSON(timerKey(SID, 'A'), pause(running(10_000), 5_000));
    h.setNow(10_000_000); // far past, but paused → not expired

    await h.scheduler.fireNow(SID, 'A');

    expect(h.emitted).toHaveLength(0);
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(true);
  });

  it('timer key deleted (round already resolved) → no-op', async () => {
    const h = makeHarness();
    await seedSession(h.store);
    h.setNow(10_001);
    // no timerKey written
    await h.scheduler.fireNow(SID, 'A');
    expect(h.emitted).toHaveLength(0);
  });

  it('reloaded timer rebased to a LATER deadline → no-op (revalidation catches it)', async () => {
    const h = makeHarness();
    await seedSession(h.store);
    // A resume-like rebase moved the deadline later: started at now=8000 with full 10s left.
    const rebasedLater: TimerState = { startedAt: 8_000, remainingAtStart: 10_000, speedMultiplier: 1, pausedAt: null };
    await h.store.setJSON(timerKey(SID, 'A'), rebasedLater);
    h.setNow(10_001); // past the ORIGINAL deadline but well within the new one

    await h.scheduler.fireNow(SID, 'A');

    expect(h.emitted).toHaveLength(0);
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(true);
  });

  it('reloaded running timer not-yet-expired on fire → RE-ARMS (self-heal), no explosion', async () => {
    // Regression: a fractional expiryInstant truncated by setTimeout can fire the
    // wake just before the deadline. fire() must re-arm rather than drop the
    // handle, or the bomb would silently never expire.
    const h = makeHarness();
    await seedSession(h.store);
    const stillRunning: TimerState = { startedAt: 0, remainingAtStart: 10_000, speedMultiplier: 1, pausedAt: null };
    await h.store.setJSON(timerKey(SID, 'A'), stillRunning);
    h.setNow(9_999); // 1 ms shy of expiry

    await h.scheduler.fireNow(SID, 'A');

    expect(h.emitted).toHaveLength(0); // not declared
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(true);
    // A fresh wake was scheduled for the remaining 1 ms.
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(1);
  });

  it('arm rounds a fractional expiry delay UP so the wake never fires early', () => {
    const h = makeHarness();
    // remaining 10_001 at ×1.25 → expiryInstant = 8000.8; ceil(8000.8 - 0) = 8001.
    const fractional: TimerState = { startedAt: 0, remainingAtStart: 10_001, speedMultiplier: 1.25, pausedAt: null };
    h.scheduler.arm(SID, 'A', fractional);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(8_001);
  });
});

describe('TimerScheduler cancel / dispose', () => {
  it('cancel clears a pending wake', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', running()); // handle 1
    h.scheduler.cancel(SID, 'A');
    expect(h.cleared).toEqual([1]);
  });

  it('cancelSession clears every wake for the session only', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', running()); // 1
    h.scheduler.arm(SID, 'B', running()); // 2
    h.scheduler.arm('other', 'A', running()); // 3
    h.scheduler.cancelSession(SID);
    expect(h.cleared.sort()).toEqual([1, 2]);
  });

  it('dispose clears all pending wakes', () => {
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', running()); // 1
    h.scheduler.arm('other', 'B', running()); // 2
    h.scheduler.dispose();
    expect(h.cleared.sort()).toEqual([1, 2]);
  });
});

describe('TimerScheduler.now', () => {
  it('returns the injected clock value', () => {
    const h = makeHarness();
    h.setNow(42);
    expect(h.scheduler.now()).toBe(42);
  });
});

// Sanity: the rebase helper used elsewhere produces an earlier deadline (strikes
// accelerate), so the scheduler re-arm in escalateOnStrike fires sooner — guard
// against a regression that would let it fire later.
describe('strike rebase moves the deadline earlier', () => {
  it('a 25% strike shortens the time-to-expiry', () => {
    const base = running(10_000); // expiry at 10_000
    const struck = rebaseForStrike(base, 25, 0); // remaining 10_000 at ×1.25 → expiry 8_000
    const h = makeHarness();
    h.scheduler.arm(SID, 'A', struck);
    expect(h.timers[0].ms).toBe(8_000);
  });
});
