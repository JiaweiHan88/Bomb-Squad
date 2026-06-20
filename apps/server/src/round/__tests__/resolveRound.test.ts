import { describe, expect, it } from '@jest/globals';
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
            A: {
              teamId: 'A',
              relayOrder: ['p1'],
              currentDefuserIndex: 0,
              cumulativeTimeMs: opts?.cumulativeTimeMs ?? 0,
              roundTimesMs: opts?.cumulativeTimeMs ? [opts.cumulativeTimeMs] : [],
              equalisationRoundsPlayed: 0,
            },
          }
        : {},
  };
  if (opts?.withSession ?? true) await store.setJSON(sessionKey(SID), session);

  if (opts?.withRound ?? true) {
    const round: RoundState = {
      roundNumber: ROUND_NUMBER,
      status: 'active',
      defusers: { A: 'p1' },
      outcomes: {},
      retry: false,
    };
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
    expect(session.teams.A!.roundTimesMs).toEqual([1_000, 60_000]);
    // Single team → this resolution is the last → between-rounds entry fires.
    expect(session.status).toBe('between-rounds');

    expect((await loadRound(h))!.status).toBe('defused');
    expect(h.store.data.has(timerKey(SID, 'A'))).toBe(false);
    expect(h.cancelCalls).toEqual([{ sessionId: SID, teamId: 'A' }]);
    // Team result first, then the session-wide between-rounds entry (SESSION_STATE
    // routes clients to the scoreboard, SCOREBOARD carries the preview).
    expect(h.emitted).toEqual([
      { room: `session:${SID}:team:A`, event: 'BOMB_DEFUSED', payload: { teamId: 'A', elapsedMs: 60_000 } },
      { room: `session:${SID}`, event: 'SESSION_STATE', payload: session },
      {
        room: `session:${SID}`,
        event: 'SCOREBOARD',
        payload: {
          teams: { A: { cumulativeTimeMs: 61_000, rounds: [1_000, 60_000] } },
          winnerTeamId: 'A',
          failedTeams: [], // defused → no retry offered (Story 8.8)
        },
      },
    ]);
  });
});

describe('resolveRound — failures (AC-2)', () => {
  it('time-expired: remaining 0 → elapsed = timerMs, BOMB_EXPLODED, status=time-expired', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    // now far past the deadline → remainingMs clamps to 0 → displayed elapsed = timerMs.
    await resolveRound(h.deps, SID, 'A', 'time-expired', TIMER_MS + 10_000);

    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(TIMER_MS);
    expect((await loadSession(h))!.teams.A!.roundTimesMs).toEqual([TIMER_MS]);
    expect((await loadRound(h))!.status).toBe('time-expired');
    // Team failure event first, then the between-rounds entry (single team → last).
    expect(h.emitted[0]).toEqual({
      room: `session:${SID}:team:A`,
      event: 'BOMB_EXPLODED',
      payload: { teamId: 'A', elapsedMs: TIMER_MS },
    });
    expect(h.emitted.map((e) => e.event)).toEqual(['BOMB_EXPLODED', 'SESSION_STATE', 'SCOREBOARD']);
  });

  it('3rd strike: status=exploded, BOMB_EXPLODED with displayed elapsed at the strike instant', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'exploded', 30_000);

    expect((await loadRound(h))!.status).toBe('exploded');
    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(30_000);
    expect(h.emitted[0]).toMatchObject({ event: 'BOMB_EXPLODED', payload: { teamId: 'A', elapsedMs: 30_000 } });
  });
});

describe('resolveRound — per-team outcomes + retry better-of-two (Story 8.8)', () => {
  /** Overwrite the seeded round with retry: true (a re-attempt resolution). */
  const markRetry = async (h: Harness) => {
    const round = (await loadRound(h))!;
    await h.store.setJSON(roundKey(SID, ROUND_NUMBER), { ...round, retry: true });
  };

  it('records the per-team outcome on the RoundState (gates ROUND_RETRY)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'time-expired', TIMER_MS + 1);
    expect((await loadRound(h))!.outcomes).toEqual({ A: 'time-expired' });
  });

  it('a FIRST attempt appends (retry: false unchanged)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'defused', 60_000);
    expect((await loadSession(h))!.teams.A!.roundTimesMs).toEqual([60_000]);
  });

  it('a faster retry REPLACES the round time in place (better-of-two) and shifts cumulative', async () => {
    // Seed a failed round-1 time of 60s, then retry and defuse in 40s.
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0), cumulativeTimeMs: 60_000 });
    await markRetry(h);
    await resolveRound(h.deps, SID, 'A', 'defused', 40_000);

    const team = (await loadSession(h))!.teams.A!;
    expect(team.roundTimesMs).toEqual([40_000]); // replaced, not appended
    expect(team.cumulativeTimeMs).toBe(40_000); // shifted by (40k - 60k)
    // Invariant preserved.
    expect(team.cumulativeTimeMs).toBe(team.roundTimesMs.reduce((a, b) => a + b, 0));
  });

  it('a slower/again-failed retry leaves the recorded time UNCHANGED (keeps the better)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0), cumulativeTimeMs: 40_000 });
    await markRetry(h);
    await resolveRound(h.deps, SID, 'A', 'time-expired', TIMER_MS + 1); // elapsed = TIMER_MS (worse)

    const team = (await loadSession(h))!.teams.A!;
    expect(team.roundTimesMs).toEqual([40_000]); // unchanged
    expect(team.cumulativeTimeMs).toBe(40_000);
  });

  it('retry never grows roundTimesMs (no double-listing the same round)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0), cumulativeTimeMs: 50_000 });
    await markRetry(h);
    await resolveRound(h.deps, SID, 'A', 'defused', 30_000);
    expect((await loadSession(h))!.teams.A!.roundTimesMs).toHaveLength(1);
  });

  it('desync: a retry with no prior slot to replace falls back to append (logged, no throw)', async () => {
    // retry: true but the team has no recorded round time (roundTimesMs empty).
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) }); // cumulative 0 → roundTimesMs []
    await markRetry(h);
    await expect(resolveRound(h.deps, SID, 'A', 'defused', 30_000)).resolves.toBeUndefined();
    expect((await loadSession(h))!.teams.A!.roundTimesMs).toEqual([30_000]); // appended fallback
  });
});

describe('resolveRound — idempotency (AC-4)', () => {
  it('a second call on an already-resolved team is a no-op (timer key is the fence)', async () => {
    const h = await makeHarness({ timer: startSegment(TIMER_MS, 0) });
    await resolveRound(h.deps, SID, 'A', 'defused', 60_000);
    // BOMB_DEFUSED + the between-rounds entry (SESSION_STATE + SCOREBOARD).
    expect(h.emitted).toHaveLength(3);

    // Late strike after the defuse: timer key already deleted → no-op.
    await resolveRound(h.deps, SID, 'A', 'exploded', 70_000);
    expect(h.emitted).toHaveLength(3); // no second emit / no second between-rounds entry
    expect((await loadRound(h))!.status).toBe('defused'); // no status regression
    expect((await loadSession(h))!.teams.A!.cumulativeTimeMs).toBe(60_000); // no double time
    expect((await loadSession(h))!.teams.A!.roundTimesMs).toEqual([60_000]); // no double append
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

describe('resolveRound — concurrent two-team resolution (shared-session lost-update guard)', () => {
  it('records BOTH teams cumulativeTimeMs when they resolve concurrently — no clobber', async () => {
    // Both teams share one sessionKey. Without per-session serialization, both
    // resolutions read the same baseline session and the second setJSON wipes the
    // first team's recorded time. Resolve them concurrently and assert both land.
    const store = createMemoryRedisStore();
    const emitted: Emitted[] = [];
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
      teams: {
        A: { teamId: 'A', relayOrder: ['p1'], currentDefuserIndex: 0, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
        B: { teamId: 'B', relayOrder: ['p2'], currentDefuserIndex: 0, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
      },
    };
    await store.setJSON(sessionKey(SID), session);
    await store.setJSON(roundKey(SID, ROUND_NUMBER), {
      roundNumber: ROUND_NUMBER,
      status: 'active',
      defusers: { A: 'p1', B: 'p2' },
      retry: false,
    } as RoundState);
    await store.setJSON(timerKey(SID, 'A'), startSegment(TIMER_MS, 0));
    await store.setJSON(timerKey(SID, 'B'), startSegment(TIMER_MS, 0));

    const deps: ResolveRoundDeps = {
      redis: store,
      io: fakeIo(emitted),
      log: noopLog,
      timer: { cancel: () => {} },
    };

    await Promise.all([
      resolveRound(deps, SID, 'A', 'defused', 60_000),
      resolveRound(deps, SID, 'B', 'time-expired', TIMER_MS + 1),
    ]);

    const after = (await store.getJSON<SessionState>(sessionKey(SID)))!;
    expect(after.teams.A!.cumulativeTimeMs).toBe(60_000);
    expect(after.teams.B!.cumulativeTimeMs).toBe(TIMER_MS);
    expect(after.teams.A!.roundTimesMs).toEqual([60_000]);
    expect(after.teams.B!.roundTimesMs).toEqual([TIMER_MS]);
    // The session enters between-rounds exactly once — on the LAST team to resolve.
    expect(after.status).toBe('between-rounds');

    // Each team gets its own per-team result event; the between-rounds entry
    // (SESSION_STATE + SCOREBOARD) fires exactly once, not per team.
    expect(emitted.filter((e) => e.event === 'BOMB_DEFUSED')).toHaveLength(1);
    expect(emitted.filter((e) => e.event === 'BOMB_EXPLODED')).toHaveLength(1);
    expect(emitted.filter((e) => e.event === 'SESSION_STATE')).toHaveLength(1);
    expect(emitted.filter((e) => e.event === 'SCOREBOARD')).toHaveLength(1);
    expect(emitted).toHaveLength(4);

    // The SCOREBOARD preview carries both teams; A (60s) leads B (timerMs).
    const scoreboard = emitted.find((e) => e.event === 'SCOREBOARD')!.payload as {
      teams: Record<string, { cumulativeTimeMs: number; rounds: number[] }>;
      winnerTeamId?: string;
    };
    expect(scoreboard.teams.A).toEqual({ cumulativeTimeMs: 60_000, rounds: [60_000] });
    expect(scoreboard.teams.B).toEqual({ cumulativeTimeMs: TIMER_MS, rounds: [TIMER_MS] });
    expect(scoreboard.winnerTeamId).toBe('A');

    expect(store.data.has(timerKey(SID, 'A'))).toBe(false);
    expect(store.data.has(timerKey(SID, 'B'))).toBe(false);
  });

  it('first team to resolve does NOT enter between-rounds while the other is still live', async () => {
    const store = createMemoryRedisStore();
    const emitted: Emitted[] = [];
    const base = createSessionState({
      sessionId: SID,
      joinCode: 'ABC123',
      facilitatorId: 'fac',
      config: { timerMs: TIMER_MS },
    });
    await store.setJSON(sessionKey(SID), {
      ...base,
      status: 'active',
      roundNumber: ROUND_NUMBER,
      teams: {
        A: { teamId: 'A', relayOrder: ['p1'], currentDefuserIndex: 0, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
        B: { teamId: 'B', relayOrder: ['p2'], currentDefuserIndex: 0, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
      },
    } as SessionState);
    await store.setJSON(roundKey(SID, ROUND_NUMBER), {
      roundNumber: ROUND_NUMBER,
      status: 'active',
      defusers: { A: 'p1', B: 'p2' },
      retry: false,
    } as RoundState);
    await store.setJSON(timerKey(SID, 'A'), startSegment(TIMER_MS, 0));
    await store.setJSON(timerKey(SID, 'B'), startSegment(TIMER_MS, 0));

    const deps: ResolveRoundDeps = {
      redis: store,
      io: fakeIo(emitted),
      log: noopLog,
      timer: { cancel: () => {} },
    };

    // Only team A resolves; B's bomb is still live.
    await resolveRound(deps, SID, 'A', 'defused', 60_000);

    const after = (await store.getJSON<SessionState>(sessionKey(SID)))!;
    expect(after.status).toBe('active'); // NOT between-rounds — B still playing
    expect(after.teams.A!.cumulativeTimeMs).toBe(60_000);
    // Only A's team result; no SESSION_STATE / SCOREBOARD broadcast yet.
    expect(emitted.map((e) => e.event)).toEqual(['BOMB_DEFUSED']);
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
