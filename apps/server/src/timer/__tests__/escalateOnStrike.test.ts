import type { SessionState, StrikeCount, TeamId, TimerState } from '@bomb-squad/shared';
import { createMemoryRedisStore, noopLog, type MemoryRedisStore } from '../../handlers/__tests__/testSocketServer.js';
import type { SessionIOServer } from '../../handlers/sessionHandlers.js';
import { sessionKey, timerKey } from '../../state/keys.js';
import { createSessionState } from '../../session/createSession.js';
import { startSegment } from '../timerCore.js';
import { escalateOnStrike, type EscalateOnStrikeDeps } from '../escalateOnStrike.js';
import type { TimerScheduler } from '../timerScheduler.js';

interface Emitted {
  room: string;
  event: string;
  payload: unknown;
}

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

interface ArmCall {
  sessionId: string;
  teamId: TeamId;
  timer: TimerState;
}

function fakeScheduler(armCalls: ArmCall[]): TimerScheduler {
  return {
    now: () => 0,
    arm: (sessionId, teamId, timer) => armCalls.push({ sessionId, teamId, timer }),
    cancel: () => {},
    cancelSession: () => {},
    dispose: () => {},
    fireNow: async () => {},
  };
}

const SID = 'sess-1';

interface Harness {
  deps: EscalateOnStrikeDeps;
  store: MemoryRedisStore;
  emitted: Emitted[];
  armCalls: ArmCall[];
}

async function makeHarness(strikeSpeedUpPct: number, withTimer = true): Promise<Harness> {
  const store = createMemoryRedisStore();
  const emitted: Emitted[] = [];
  const armCalls: ArmCall[] = [];
  const session: SessionState = createSessionState({
    sessionId: SID,
    joinCode: 'ABC123',
    facilitatorId: 'fac',
    config: { strikeSpeedUpPct },
  });
  await store.setJSON(sessionKey(SID), session);
  if (withTimer) await store.setJSON(timerKey(SID, 'A'), startSegment(300_000, 0));
  return {
    deps: { redis: store, io: fakeIo(emitted), log: noopLog, timer: fakeScheduler(armCalls) },
    store,
    emitted,
    armCalls,
  };
}

async function loadTimer(store: MemoryRedisStore): Promise<TimerState> {
  return (await store.getJSON<TimerState>(timerKey(SID, 'A')))!;
}

describe('escalateOnStrike', () => {
  it('strike 1 at 25% → ×1.25, STRIKE emitted with rebased timer, scheduler re-armed', async () => {
    const h = await makeHarness(25);
    await escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000);

    const persisted = await loadTimer(h.store);
    expect(persisted.speedMultiplier).toBe(1.25);
    expect(persisted.startedAt).toBe(1_000);

    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({
      room: `session:${SID}:team:A`,
      event: 'STRIKE',
      payload: { teamId: 'A', strikes: 1 },
    });
    expect((h.emitted[0].payload as { timer: TimerState }).timer.speedMultiplier).toBe(1.25);

    expect(h.armCalls).toHaveLength(1);
    expect(h.armCalls[0].timer.speedMultiplier).toBe(1.25);
  });

  it('strike 2 compounds to ×1.5625', async () => {
    const h = await makeHarness(25);
    // First strike rebases the stored timer.
    await escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000);
    await escalateOnStrike(h.deps, SID, 'A', 2 as StrikeCount, 2_000);
    expect((await loadTimer(h.store)).speedMultiplier).toBe(1.5625);
    expect(h.emitted.at(-1)).toMatchObject({ event: 'STRIKE', payload: { strikes: 2 } });
  });

  it('strike 3 → early return: no rebase, no STRIKE, no re-arm (8.5 owns the explosion)', async () => {
    const h = await makeHarness(25);
    const before = await loadTimer(h.store);
    await escalateOnStrike(h.deps, SID, 'A', 3 as StrikeCount, 5_000);
    expect(await loadTimer(h.store)).toEqual(before); // unchanged
    expect(h.emitted).toHaveLength(0);
    expect(h.armCalls).toHaveLength(0);
  });

  it('no live timer in Redis → no-op, no throw, no STRIKE', async () => {
    const h = await makeHarness(25, /* withTimer */ false);
    await expect(escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000)).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(0);
    expect(h.armCalls).toHaveLength(0);
  });

  it('honours a non-default strikeSpeedUpPct (50% → ×1.5)', async () => {
    const h = await makeHarness(50);
    await escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000);
    expect((await loadTimer(h.store)).speedMultiplier).toBe(1.5);
  });

  it('strikeSpeedUpPct 0 → multiplier stays 1.0 but STRIKE still broadcasts the new count', async () => {
    const h = await makeHarness(0);
    await escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000);
    expect((await loadTimer(h.store)).speedMultiplier).toBe(1);
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]).toMatchObject({ event: 'STRIKE', payload: { strikes: 1 } });
  });

  it('strikes < 1 (0 / desync) → no-op: no rebase, no STRIKE, no re-arm', async () => {
    const h = await makeHarness(25);
    const before = await loadTimer(h.store);
    await escalateOnStrike(h.deps, SID, 'A', 0 as StrikeCount, 1_000);
    expect(await loadTimer(h.store)).toEqual(before); // untouched
    expect(h.emitted).toHaveLength(0);
    expect(h.armCalls).toHaveLength(0);
  });

  it('live timer but no session in Redis → logged no-op, no rebase, no STRIKE', async () => {
    const h = await makeHarness(25);
    await h.store.del(sessionKey(SID)); // session vanished, timer still live
    const before = await loadTimer(h.store);
    await expect(escalateOnStrike(h.deps, SID, 'A', 1 as StrikeCount, 1_000)).resolves.toBeUndefined();
    expect(await loadTimer(h.store)).toEqual(before); // not rebased at a silent 0%
    expect(h.emitted).toHaveLength(0);
    expect(h.armCalls).toHaveLength(0);
  });
});
