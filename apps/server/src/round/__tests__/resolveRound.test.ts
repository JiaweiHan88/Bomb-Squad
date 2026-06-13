import type { RoundState, SessionState, TeamId, TimerState } from '@bomb-squad/shared';
import { createMemoryRedisStore, noopLog, type MemoryRedisStore } from '../../handlers/__tests__/testSocketServer.js';
import type { SessionIOServer } from '../../handlers/sessionHandlers.js';
import { roundKey, sessionKey, timerKey } from '../../state/keys.js';
import { createSessionState } from '../../session/createSession.js';
import { rebaseForStrike, startSegment } from '../../timer/timerCore.js';
import { onBombDefused, onThirdStrike, resolveRound, type ResolveRoundDeps } from '../resolveRound.js';

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

interface CancelCall {
  sessionId: string;
  teamId: TeamId;
}

const SID = 'sess-1';
const TIMER_MS = 300_000;
const ROUND_NUMBER = 1;

interface Harness {
  deps: ResolveRoundDeps;
  store: MemoryRedisStore;
  emitted: Emitted[];
  cancelCalls: CancelCall[];
}

/**
 * Seed an active round: a session (status 'active', team A with a known
 * cumulativeTimeMs), the round state, and a live timer. Override the timer to
 * model defuse-mid-round / strike-accelerated cases.
 */
async function makeHarness(opts?: {
  timer?: TimerState;
  cumulativeTimeMs?: number;
  withTimer?: boolean;
  withSession?: boolean;
  withRound?: boolean;
  withTeam?: boolean;
}): Promise<Harness> {
  const store = createMemoryRedisStore();
  const emitted: Emitted[] = [];
  const cancelCalls: CancelCall[] = [];

  const base = createSessionState({
    sessionId: SID,
    joinCode: 'ABC123',
    facilitatorId: 'fac',
    config: { timerMs: TIMER_MS },
  });
  const session: SessionState = {
    ...base,
    status: 'active',
    roundNumber: ROUND_NUMBER,
    teams:
      (opts?.withTeam ?? true)
        ? {
            A: { teamId: 'A', relayOrder: ['p1'], currentDefuserIndex: 0, cumulativeTimeMs: opts?.cumulativeTimeMs ?? 0 },
          }
        : {},
  };
  if (opts?.withSession ?? true) await store.setJSON(sessionKey(SID), session);

  if (opts?.withRound ?? true) {
    const round: RoundState = { roundNumber: ROUND_NUMBER, status: 'active', defusers: { A: 'p1' }, retry: false };
    await store.setJSON(roundKey(SID, ROUND_NUMBER), round);
  }

  if (opts?.withTimer ?? true) {
    await store.setJSON(timerKey(SID, 'A'), opts?.timer ?? startSegment(TIMER_MS, 0));
  }

  return {
    deps: {
      redis: store,
      io: fakeIo(emitted),
      log: noopLog,
      timer: { cancel: (sessionId, teamId) => cancelCalls.push({ sessionId, teamId }) },
    },
    store,
    emitted,
    cancelCalls,
  };
}

const loadSession = (h: Harness) => h.store.getJSON<SessionState>(sessionKey(SID));
const loadRound = (h: Harness) => h.store.getJSON<RoundState>(roundKey(SID, ROUND_NUMBER));

describe('resolveRound — defuse (AC-1)', () => {
  it('records cumulativeTimeMs, emits BOMB_DEFUSED, cancels wake, deletes timer key, sets status=defused', async () => {
    // Defuse 60s into a normal ×1 round: displayed elapsed = 300_000 - 240_000.
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0), cumulativeTimeMs: 1_000 });
    await resolveRound(h.deps, SID, 'A', 'defused', 60_000);

    const session = (await loadSession(h))!;
    expect(session.teams.A!.cumulativeTimeMs).toBe(1_000 + 60_000);
    expect(session.status).toBe('between-rounds');

    expect((await loadRound(h))!.status).toBe('defused');
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(false);
    expect(h.cancelCalls).toEqual([{ sessionId: SID, teamId: 'A' }]);
    expect(h.emitted).toEqual([
      { room: `session:${SID}:team:A`, event: 'BOMB_DEFUSED', payload: { teamId: 'A', elapsedMs: 60_000 } },
    ]);
  });
});

describe('resolveRound — failures (AC-2)', () => {
  it('time-expired: remaining 0 → elapsed = timerMs, BOMB_EXPLODED, status=time-expired', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    // now far past the deadline → remainingMs clamps to 0 → displayed elapsed = timerMs.
    await resolveRound(h.deps, SID, 'A', 'time-expired', TIMER_MS + 10_000);

    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(TIMER_MS);
    expect((await loadRound(h))!.status).toBe('time-expired');
    expect(h.emitted).toEqual([
      { room: `session:${SID}:team:A`, event: 'BOMB_EXPLODED', payload: { teamId: 'A', elapsedMs: TIMER_MS } },
    ]);
  });

  it('3rd strike: status=exploded, BOMB_EXPLODED with displayed elapsed at the strike instant', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'exploded', 30_000);

    expect((await loadRound(h))!.status).toBe('exploded');
    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(30_000);
    expect(h.emitted[0]).toMatchObject({ event: 'BOMB_EXPLODED', payload: { teamId: 'A', elapsedMs: 30_000 } });
  });
});

describe('resolveRound — idempotency (AC-4)', () => {
  it('a second call on an already-resolved team is a no-op (timer key is the fence)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'defused', 60_000);
    expect(h.emitted).toHaveLength(1);

    // Late strike after the defuse: timer key already deleted → no-op.
    await resolveRound(h.deps, SID, 'A', 'exploded', 70_000);
    expect(h.emitted).toHaveLength(1); // no second emit
    expect((await loadRound(h))!.status).toBe('defused'); // no status regression
    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(60_000); // no double time
  });
});

describe('resolveRound — desync paths are logged no-ops, never throw', () => {
  it('no live timer → no-op', async () => {
    const h = await makeHarness({ withTimer: false });
    await expect(resolveRound(h.deps, SID, 'A', 'defused', 1_000)).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(0);
    expect(h.cancelCalls).toHaveLength(0);
  });

  it('no session → no-op', async () => {
    const h = await makeHarness({ withSession: false });
    await expect(resolveRound(h.deps, SID, 'A', 'defused', 1_000)).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(0);
  });

  it('no round state → no-op', async () => {
    const h = await makeHarness({ withRound: false });
    await expect(resolveRound(h.deps, SID, 'A', 'defused', 1_000)).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(0);
  });

  it('unknown team → no-op (cannot record time)', async () => {
    const h = await makeHarness({ withTeam: false });
    await expect(resolveRound(h.deps, SID, 'A', 'defused', 1_000)).resolves.toBeUndefined();
    expect(h.emitted).toHaveLength(0);
  });
});

describe('resolveRound — honest elapsed reconciliation (AC-5)', () => {
  it('a strike-accelerated round does not over-count: displayed elapsed ≤ timerMs and matches the LCD', async () => {
    // Two 25% strikes at t=0 with full time remaining → ×1.5625; the displayed
    // clock now drains 1.5625× wall time. At wall now=100_000, displayed elapsed
    // = timerMs - remaining = 100_000 * 1.5625 = 156_250 (NOT the wall 100_000).
    const struck = rebaseForStrike(rebaseForStrike(startSegment(TIMER_MS, 0), 25, 0), 25, 0);
    const h = await makeHarness({ timer: struck });
    await resolveRound(h.deps, SID, 'A', 'defused', 100_000);

    const recorded = (await loadSession(h))!.teams.A!.cumulativeTimeMs;
    expect(recorded).toBe(156_250);
    expect(recorded).toBeLessThanOrEqual(TIMER_MS);
    // The emitted payload carries the same value (AC-5 consistency).
    expect(h.emitted[0].payload).toEqual({ teamId: 'A', elapsedMs: 156_250 });
  });

  it('elapsed is clamped at 0 and never negative', async () => {
    // now BEFORE the segment start (clock skew) → remaining would exceed timerMs;
    // displayed elapsed clamps to 0 rather than going negative.
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 10_000) });
    await resolveRound(h.deps, SID, 'A', 'defused', 0);
    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(0);
  });
});

describe('resolveRound — named trigger wrappers (Story 4.7 seam)', () => {
  it('onBombDefused resolves as defused', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await onBombDefused(h.deps, SID, 'A', 60_000);
    expect((await loadRound(h))!.status).toBe('defused');
    expect(h.emitted[0]).toMatchObject({ event: 'BOMB_DEFUSED' });
  });

  it('onThirdStrike resolves as exploded', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await onThirdStrike(h.deps, SID, 'A', 30_000);
    expect((await loadRound(h))!.status).toBe('exploded');
    expect(h.emitted[0]).toMatchObject({ event: 'BOMB_EXPLODED' });
  });
});
