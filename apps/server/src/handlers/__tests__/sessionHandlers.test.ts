import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  SessionState,
  SessionCreatePayload,
  SessionCreatedPayload,
  SessionIdentityPayload,
  SessionRemovedPayload,
  ErrorPayload,
  RoundState,
  TimerState,
  BombState,
  TeamId,
  TeamState,
} from '@bomb-squad/shared';
import {
  registerSessionHandlers,
  parseSessionCreatePayload,
  parseSessionJoinPayload,
  parseTeamAssignPayload,
  teamRoom,
  MAX_PLAYERS,
  type SessionLog,
} from '../sessionHandlers.js';
import { createSessionState } from '../../session/createSession.js';
import { sessionKey, joinCodeKey, roundKey, timerKey, bombKey, reattachKey } from '../../state/keys.js';
import {
  startTestSocketServer,
  createMemoryRedisStore,
  createTestScheduler,
  noopLog,
  fakeArchive,
  createSpyArchive,
  type SpyArchive,
  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
  type TestScheduler,
} from './testSocketServer.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Promise for the next emission of a server event on a client socket. */
function nextEvent<T>(socket: TestClientSocket, event: 'SESSION_STATE' | 'ERROR'): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event, ((payload: T) => resolve(payload)) as never);
  });
}

/** Emit SESSION_CREATE and resolve with the ack payload. */
function createSession(
  socket: TestClientSocket,
  payload: SessionCreatePayload = {},
): Promise<SessionCreatedPayload> {
  return new Promise((resolve) => {
    socket.emit('SESSION_CREATE', payload, resolve);
  });
}

/**
 * Pad every populated team to the min size of 2 (Story 8.9 follow-up guard) with a
 * SYNTHETIC, socketless Expert, via a direct store write (no broadcast). Used by
 * setups that form 1-player-per-team via the lobby flow, which the guard now
 * refuses. The pad is never the Defuser (rotation picks index 0 = the real player)
 * and has no socket, so team-room membership and per-team assertions are unchanged
 * — it only satisfies `undersizedTeams`. Call AFTER team assignment, BEFORE
 * PREPARATION_OPEN.
 */
async function padTeamsToMinSize(store: MemoryRedisStore, sessionId: string): Promise<void> {
  const s = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
  const players = { ...s.players };
  const teams = { ...s.teams };
  for (const [teamId, team] of Object.entries(teams) as [TeamId, TeamState][]) {
    if (team.relayOrder.length >= 2) continue;
    const padId = `pad-${teamId}`;
    players[padId] = { playerId: padId, displayName: `Pad-${teamId}`, role: 'expert', teamId, isReady: true };
    teams[teamId] = { ...team, relayOrder: [...team.relayOrder, padId] };
  }
  await store.setJSON(sessionKey(sessionId), { ...s, players, teams });
}

describe('SESSION_CREATE handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let client: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    client = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  it('acks with a UUID sessionId and a ≥6-char uppercase-alphanumeric joinCode', async () => {
    const ack = await createSession(client);
    expect(ack.sessionId).toMatch(UUID_RE);
    expect(ack.joinCode).toMatch(/^[A-Z0-9]{6,}$/);
  });

  it('broadcasts SESSION_STATE: lobby status, facilitator player, default config', async () => {
    const statePromise = nextEvent<SessionState>(client, 'SESSION_STATE');
    const ack = await createSession(client);
    const state = await statePromise;

    expect(state.sessionId).toBe(ack.sessionId);
    expect(state.joinCode).toBe(ack.joinCode);
    expect(state.status).toBe('lobby');
    expect(state.roundNumber).toBe(0);
    expect(state.teams).toEqual({});
    expect(state.config).toEqual({
      difficulty: 'easy',
      moduleCount: 3,
      timerMs: 300_000,
      strikeSpeedUpPct: 25,
      modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
    });

    const players = Object.values(state.players);
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ role: 'facilitator', displayName: 'Facilitator', isReady: false });
  });

  it('persists the session and the joinCode → sessionId lookup in Redis', async () => {
    const ack = await createSession(client);

    const session = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(session.sessionId).toBe(ack.sessionId);
    expect(session.status).toBe('lobby');

    const lookup = JSON.parse(store.data.get(joinCodeKey(ack.joinCode))!) as string;
    expect(lookup).toBe(ack.sessionId);
  });

  it('merges a partial config over defaults without dropping modifiers', async () => {
    const statePromise = nextEvent<SessionState>(client, 'SESSION_STATE');
    await createSession(client, { config: { timerMs: 600_000 } });
    const state = await statePromise;

    expect(state.config.timerMs).toBe(600_000);
    expect(state.config.difficulty).toBe('easy');
    expect(state.config.moduleCount).toBe(3);
    expect(state.config.modifiers).toEqual({
      asymmetricExpertRoles: false,
      spectatorLifelines: false,
    });
  });

  it('rejects an invalid config with ERROR — no ack, nothing persisted', async () => {
    const errorPromise = nextEvent<ErrorPayload>(client, 'ERROR');
    const ackSpy = jest.fn();
    client.emit('SESSION_CREATE', { config: { moduleCount: 99 } } as never, ackSpy);
    const error = await errorPromise;

    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.recoverable).toBe(true);
    expect(ackSpy).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });

  it('rejects an unknown difficulty with ERROR', async () => {
    const errorPromise = nextEvent<ErrorPayload>(client, 'ERROR');
    client.emit('SESSION_CREATE', { config: { difficulty: 'nightmare' } } as never, jest.fn());
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(store.data.size).toBe(0);
  });

  it('two creates yield distinct sessionIds and joinCodes', async () => {
    const first = await createSession(client);
    const second = await createSession(client);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.joinCode).not.toBe(first.joinCode);
  });

  it('emits ERROR and no SESSION_STATE when persistence fails', async () => {
    await server.close();
    store = createMemoryRedisStore({
      setJSON: async () => {
        throw new Error('redis down');
      },
    });
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    client = await server.connectClient();

    const stateSpy = jest.fn();
    client.on('SESSION_STATE', stateSpy);
    const errorPromise = nextEvent<ErrorPayload>(client, 'ERROR');
    const ackSpy = jest.fn();
    client.emit('SESSION_CREATE', {}, ackSpy);
    const error = await errorPromise;

    expect(error.code).toBe('SESSION_CREATE_FAILED');
    expect(error.recoverable).toBe(true);
    expect(ackSpy).not.toHaveBeenCalled();
    expect(stateSpy).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });

  it('emits ERROR and persists nothing when the collision-check read throws', async () => {
    await server.close();
    // RedisStore.getJSON throws on a malformed value / mid-session drop; the
    // collision check awaits it, so the throw must route to SESSION_CREATE_FAILED.
    store = createMemoryRedisStore({
      getJSON: async () => {
        throw new Error('redis down');
      },
    });
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    client = await server.connectClient();

    const stateSpy = jest.fn();
    client.on('SESSION_STATE', stateSpy);
    const errorPromise = nextEvent<ErrorPayload>(client, 'ERROR');
    const ackSpy = jest.fn();
    client.emit('SESSION_CREATE', {}, ackSpy);
    const error = await errorPromise;

    expect(error.code).toBe('SESSION_CREATE_FAILED');
    expect(ackSpy).not.toHaveBeenCalled();
    expect(stateSpy).not.toHaveBeenCalled();
    expect(store.data.size).toBe(0);
  });
});

describe('SESSION_JOIN handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Seed the fake store with a session + its joincode lookup, bypassing SESSION_CREATE. */
  async function seedSession(state: SessionState): Promise<void> {
    await store.setJSON(sessionKey(state.sessionId), state);
    await store.setJSON(joinCodeKey(state.joinCode), state.sessionId);
  }

  it('happy path: joiner lands in the roster and BOTH sockets receive the new SESSION_STATE', async () => {
    const ack = await createSession(facilitator);

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });

    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);
    for (const state of [facState, joinerState]) {
      expect(Object.keys(state.players)).toHaveLength(2);
      const maya = Object.values(state.players).find((p) => p.displayName === 'Maya')!;
      expect(maya).toMatchObject({ role: 'expert', isReady: false });
      expect(maya.teamId).toBeUndefined();
    }
  });

  it('persists the joined roster to Redis (not just the broadcast)', async () => {
    const ack = await createSession(facilitator);
    const statePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'defuser' });
    await statePromise;

    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(Object.keys(stored.players)).toHaveLength(2);
    expect(Object.values(stored.players).some((p) => p.role === 'defuser')).toBe(true);
  });

  it('unknown code → SESSION_NOT_FOUND to the joiner only; store untouched', async () => {
    await createSession(facilitator);
    const sizeBefore = store.data.size;

    const facSpy = jest.fn();
    facilitator.on('ERROR', facSpy);
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', { joinCode: 'ZZZZZZ', displayName: 'Maya', role: 'expert' });
    const error = await errorPromise;

    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.recoverable).toBe(true);
    expect(error.message).toMatch(/code/i);
    expect(store.data.size).toBe(sizeBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('normalizes the code: lowercase + padding still joins', async () => {
    const ack = await createSession(facilitator);
    const statePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', {
      joinCode: `  ${ack.joinCode.toLowerCase()} `,
      displayName: 'Maya',
      role: 'spectator',
    });
    const state = await statePromise;
    expect(Object.keys(state.players)).toHaveLength(2);
  });

  it.each([
    ['facilitator role', { joinCode: 'ABC123', displayName: 'Maya', role: 'facilitator' }],
    ['empty name', { joinCode: 'ABC123', displayName: '   ', role: 'expert' }],
    ['5-char code', { joinCode: 'ABC12', displayName: 'Maya', role: 'expert' }],
  ])('invalid payload (%s) → INVALID_PAYLOAD, nothing persisted', async (_label, payload) => {
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', payload as never);
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(store.data.size).toBe(0);
  });

  it('full session (16 players) → SESSION_FULL', async () => {
    let state = createSessionState({
      sessionId: 'sess-full',
      joinCode: 'FULLUP',
      facilitatorId: 'sock-fac',
    });
    for (let i = 1; i < MAX_PLAYERS; i++) {
      state = {
        ...state,
        players: {
          ...state.players,
          [`sock-${i}`]: {
            playerId: `sock-${i}`,
            displayName: `P${i}`,
            role: 'spectator',
            isReady: false,
          },
        },
      };
    }
    expect(Object.keys(state.players)).toHaveLength(MAX_PLAYERS);
    await seedSession(state);

    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', { joinCode: 'FULLUP', displayName: 'Late', role: 'expert' });
    const error = await errorPromise;
    expect(error.code).toBe('SESSION_FULL');
    const stored = JSON.parse(store.data.get(sessionKey('sess-full'))!) as SessionState;
    expect(Object.keys(stored.players)).toHaveLength(MAX_PLAYERS);
  });

  // AC 2: a round is in flight (preparation/active/ended) — refuse, change nothing.
  it.each(['preparation', 'active', 'ended'] as const)(
    'mid-round status %s → SESSION_NOT_JOINABLE, zero writes',
    async (status) => {
      const base = createSessionState({
        sessionId: 'sess-live',
        joinCode: 'LIVE99',
        facilitatorId: 'sock-fac',
      });
      await seedSession({ ...base, status });
      const bytesBefore = store.data.get(sessionKey('sess-live'));

      const facSpy = jest.fn();
      facilitator.on('SESSION_STATE', facSpy);
      const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
      joiner.emit('SESSION_JOIN', { joinCode: 'LIVE99', displayName: 'Maya', role: 'expert' });
      const error = await errorPromise;

      expect(error.code).toBe('SESSION_NOT_JOINABLE');
      // commit:false performs no write — the stored bytes are byte-identical.
      expect(store.data.get(sessionKey('sess-live'))).toBe(bytesBefore);
      expect(facSpy).not.toHaveBeenCalled();
    },
  );

  // AC 3: between-rounds admits, but the late joiner is in NO team's relayOrder
  // (emergent ineligibility — Epic 8 owns the actual relay slotting).
  it('between-rounds → joiner admitted, in NO relayOrder, teams untouched; both sockets get SESSION_STATE', async () => {
    const ack = await createSession(facilitator);
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    // Flip the live session to between-rounds with an established relay rotation.
    const seeded: SessionState = {
      ...live,
      status: 'between-rounds',
      roundNumber: 1,
      players: {
        ...live.players,
        'sock-d1': { playerId: 'sock-d1', displayName: 'Dee', role: 'defuser', isReady: true, teamId: 'A' },
      },
      teams: {
        A: { teamId: 'A', relayOrder: ['sock-d1'], currentDefuserIndex: 0, cumulativeTimeMs: 12_000, roundTimesMs: [12_000], roundOutcomes: ['defused'], equalisationRoundsPlayed: 0 },
      },
    };
    await store.setJSON(sessionKey(ack.sessionId), seeded);

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Late', role: 'expert' });
    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);

    for (const s of [facState, joinerState]) {
      const late = Object.values(s.players).find((p) => p.displayName === 'Late');
      expect(late).toBeDefined();
      expect(late!.teamId).toBeUndefined(); // not slotted into any team
      // Emergent ineligibility: present in NO team's relayOrder.
      for (const team of Object.values(s.teams)) {
        expect(team!.relayOrder).not.toContain(late!.playerId);
      }
      // The established rotation is untouched.
      expect(s.teams.A!.relayOrder).toEqual(['sock-d1']);
    }
  });

  // AC 1 (the headline): prove the guard re-evaluates AFTER a concurrent write.
  // A plain read-check would push the roster to 17; updateJSON re-runs the
  // capacity guard against the interleaved state and rejects the loser.
  it('race: a concurrent join landing mid-transaction → loser gets SESSION_FULL, roster capped at 16', async () => {
    // Seed at 15 (facilitator + 14).
    let state = createSessionState({ sessionId: 'sess-race', joinCode: 'RACER1', facilitatorId: 'sock-fac' });
    for (let i = 1; i < 15; i++) {
      state = {
        ...state,
        players: {
          ...state.players,
          [`sock-${i}`]: { playerId: `sock-${i}`, displayName: `P${i}`, role: 'spectator', isReady: false },
        },
      };
    }
    expect(Object.keys(state.players)).toHaveLength(15);

    // One-shot hook: a 16th player lands during the first join's transaction
    // (15 → 16), forcing the retry where the capacity guard re-evaluates.
    const raceStore = createMemoryRedisStore(undefined, {
      onBeforeCommit: (key) => {
        const cur = JSON.parse(raceStore.data.get(key)!) as SessionState;
        raceStore.data.set(
          key,
          JSON.stringify({
            ...cur,
            players: {
              ...cur.players,
              'sock-interloper': { playerId: 'sock-interloper', displayName: 'Sneak', role: 'spectator', isReady: false },
            },
          }),
        );
      },
    });
    await raceStore.setJSON(sessionKey('sess-race'), state);
    await raceStore.setJSON(joinCodeKey('RACER1'), 'sess-race');

    const raceServer = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: raceStore,
        log: noopLog,
        timer: createTestScheduler({ redis: raceStore, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    try {
      const raceJoiner = await raceServer.connectClient();
      const errorPromise = nextEvent<ErrorPayload>(raceJoiner, 'ERROR');
      raceJoiner.emit('SESSION_JOIN', { joinCode: 'RACER1', displayName: 'Late', role: 'expert' });
      const error = await errorPromise;

      expect(error.code).toBe('SESSION_FULL');
      const stored = JSON.parse(raceStore.data.get(sessionKey('sess-race'))!) as SessionState;
      expect(Object.keys(stored.players)).toHaveLength(16); // capped — never 17
      expect(stored.players['sock-interloper']).toBeDefined();
      expect(Object.values(stored.players).some((p) => p.displayName === 'Late')).toBe(false);
    } finally {
      await raceServer.close();
    }
  });

  it('idempotent re-join: converges the joiner, no growth, no extra broadcast to others', async () => {
    const ack = await createSession(facilitator);
    const firstState = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    await firstState;

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const secondState = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya2', role: 'defuser' });
    const state = await secondState;

    expect(Object.keys(state.players)).toHaveLength(2);
    const maya = Object.values(state.players).find((p) => p.playerId !== facilitatorIdOf(state))!;
    expect(maya.displayName).toBe('Maya');
    expect(maya.role).toBe('expert');
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('updateJSON failure (incl. retry-limit) → SESSION_JOIN_FAILED to joiner, no broadcast to the room', async () => {
    const ack = await createSession(facilitator);
    // The atomic CAS now owns the write; failing it (e.g. contention-limit
    // throw) must surface as SESSION_JOIN_FAILED with no broadcast.
    store.updateJSON = async () => {
      throw new Error('RedisStore.updateJSON: contention retry limit exceeded for key "x"');
    };

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    const error = await errorPromise;

    expect(error.code).toBe('SESSION_JOIN_FAILED');
    expect(error.recoverable).toBe(true);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('dangling joincode (session key missing) → SESSION_NOT_FOUND', async () => {
    await store.setJSON(joinCodeKey('GHOST1'), 'sess-ghost');

    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', { joinCode: 'GHOST1', displayName: 'Maya', role: 'expert' });
    const error = await errorPromise;
    expect(error.code).toBe('SESSION_NOT_FOUND');
  });

  // AR15: the join code is the session's only secret — it must never reach a log
  // line on ANY path (admitted, full, refused).
  it('AR15: the join code never appears in a log line (admitted / full / refused)', async () => {
    const lines: string[] = [];
    const capturingLog: SessionLog = {
      info: (obj, msg) => lines.push(`${JSON.stringify(obj)} ${msg ?? ''}`),
      error: (obj, msg) => lines.push(`${JSON.stringify(obj)} ${msg ?? ''}`),
    };
    const logStore = createMemoryRedisStore();
    const logServer = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: logStore,
        log: capturingLog,
        timer: createTestScheduler({ redis: logStore, io, log: capturingLog }),
        archive: fakeArchive,
      }),
    );
    try {
      const fac = await logServer.connectClient();
      const ack = await new Promise<SessionCreatedPayload>((resolve) =>
        fac.emit('SESSION_CREATE', {}, resolve),
      );

      // Admitted path.
      const okJoiner = await logServer.connectClient();
      const okState = nextEvent<SessionState>(okJoiner, 'SESSION_STATE');
      okJoiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
      await okState;

      // Full path: cram the session to capacity, then a refused join.
      const live = JSON.parse(logStore.data.get(sessionKey(ack.sessionId))!) as SessionState;
      let crammed = live;
      for (let i = Object.keys(crammed.players).length; i < MAX_PLAYERS; i++) {
        crammed = {
          ...crammed,
          players: {
            ...crammed.players,
            [`sock-${i}`]: { playerId: `sock-${i}`, displayName: `P${i}`, role: 'spectator', isReady: false },
          },
        };
      }
      await logStore.setJSON(sessionKey(ack.sessionId), crammed);
      const fullJoiner = await logServer.connectClient();
      const fullErr = nextEvent<ErrorPayload>(fullJoiner, 'ERROR');
      fullJoiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Late', role: 'expert' });
      expect((await fullErr).code).toBe('SESSION_FULL');

      // Refused (unknown code) path.
      const badJoiner = await logServer.connectClient();
      const badErr = nextEvent<ErrorPayload>(badJoiner, 'ERROR');
      badJoiner.emit('SESSION_JOIN', { joinCode: 'ZZZZZZ', displayName: 'Nope', role: 'expert' });
      await badErr;

      const blob = lines.join('\n');
      expect(blob).not.toContain(ack.joinCode);
      expect(blob).not.toContain('ZZZZZZ');
    } finally {
      await logServer.close();
    }
  });
});

/** The facilitator's playerId in a state snapshot (the only 'facilitator' role). */
function facilitatorIdOf(state: SessionState): string {
  return Object.values(state.players).find((p) => p.role === 'facilitator')!.playerId;
}

describe('parseSessionJoinPayload (boundary validation)', () => {
  const VALID = { joinCode: 'ABC123', displayName: 'Maya', role: 'expert' };

  it('accepts a valid payload and rebuilds a sanitized object', () => {
    expect(parseSessionJoinPayload(VALID)).toEqual({
      ok: true,
      joinCode: 'ABC123',
      displayName: 'Maya',
      role: 'expert',
    });
  });

  it('normalizes the code (trim + uppercase) and trims the name', () => {
    const result = parseSessionJoinPayload({
      joinCode: ' ktane5 ',
      displayName: '  Maya  ',
      role: 'defuser',
    });
    expect(result).toEqual({ ok: true, joinCode: 'KTANE5', displayName: 'Maya', role: 'defuser' });
  });

  it('rejects codes that are not exactly 6 alphanumerics after normalization', () => {
    expect(parseSessionJoinPayload({ ...VALID, joinCode: 'ABC12' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, joinCode: 'ABC1234' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, joinCode: 'ABC-12' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, joinCode: 'AB:123' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, joinCode: 123456 }).ok).toBe(false);
  });

  it('bounds the display name to 1–24 chars after trim', () => {
    expect(parseSessionJoinPayload({ ...VALID, displayName: '' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, displayName: '   ' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, displayName: 'x'.repeat(25) }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, displayName: 'x'.repeat(24) }).ok).toBe(true);
  });

  it("rejects role 'facilitator' and unknown roles — the facilitator seat is mint-only", () => {
    expect(parseSessionJoinPayload({ ...VALID, role: 'facilitator' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, role: 'admin' }).ok).toBe(false);
    expect(parseSessionJoinPayload({ ...VALID, role: undefined }).ok).toBe(false);
  });

  it('rejects non-object payloads and missing fields', () => {
    expect(parseSessionJoinPayload(undefined).ok).toBe(false);
    expect(parseSessionJoinPayload('nope').ok).toBe(false);
    expect(parseSessionJoinPayload([1]).ok).toBe(false);
    expect(parseSessionJoinPayload({}).ok).toBe(false);
    expect(parseSessionJoinPayload({ joinCode: 'ABC123' }).ok).toBe(false);
  });

  it('ignores unknown extra keys (rebuilt object carries only the three fields)', () => {
    expect(parseSessionJoinPayload({ ...VALID, hax: true })).toEqual({
      ok: true,
      joinCode: 'ABC123',
      displayName: 'Maya',
      role: 'expert',
    });
  });
});

describe('parseSessionCreatePayload (boundary validation)', () => {
  it('tolerates a missing payload', () => {
    expect(parseSessionCreatePayload(undefined)).toEqual({ ok: true });
  });

  it('accepts an empty object and an empty config', () => {
    expect(parseSessionCreatePayload({})).toEqual({ ok: true });
    expect(parseSessionCreatePayload({ config: {} })).toEqual({ ok: true, config: {} });
  });

  it('rejects non-object payloads and configs', () => {
    expect(parseSessionCreatePayload('nope').ok).toBe(false);
    expect(parseSessionCreatePayload([1]).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: 'nope' }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: [1] }).ok).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(parseSessionCreatePayload({ config: { moduleCount: 2 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { moduleCount: 12 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { moduleCount: 3.5 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { timerMs: 0 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { timerMs: -1 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { strikeSpeedUpPct: 51 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { strikeSpeedUpPct: -1 } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { strikeSpeedUpPct: 25.5 } }).ok).toBe(false);
  });

  it('rejects unknown config keys and unknown/non-boolean modifiers', () => {
    expect(parseSessionCreatePayload({ config: { hax: true } }).ok).toBe(false);
    expect(parseSessionCreatePayload({ config: { modifiers: { hax: true } } }).ok).toBe(false);
    expect(
      parseSessionCreatePayload({ config: { modifiers: { spectatorLifelines: 'yes' } } }).ok,
    ).toBe(false);
  });

  it('rebuilds a sanitized config (valid keys pass through, bounds inclusive)', () => {
    const result = parseSessionCreatePayload({
      config: {
        difficulty: 'hard',
        moduleCount: 11,
        timerMs: 1,
        strikeSpeedUpPct: 0,
        modulePool: ['wires'],
        modifiers: { asymmetricExpertRoles: true },
      },
    });
    expect(result).toEqual({
      ok: true,
      config: {
        difficulty: 'hard',
        moduleCount: 11,
        timerMs: 1,
        strikeSpeedUpPct: 0,
        modulePool: ['wires'],
        modifiers: { asymmetricExpertRoles: true },
      },
    });
  });
});

describe('parseTeamAssignPayload (boundary validation)', () => {
  const valid = { playerId: 'sock-maya', teamId: 'A', role: 'defuser' };

  it('accepts a valid payload and rebuilds a sanitized object', () => {
    expect(parseTeamAssignPayload(valid)).toEqual({
      ok: true,
      playerId: 'sock-maya',
      teamId: 'A',
      role: 'defuser',
    });
  });

  it("rejects teamIds other than exactly 'A' or 'B'", () => {
    expect(parseTeamAssignPayload({ ...valid, teamId: 'C' }).ok).toBe(false);
    expect(parseTeamAssignPayload({ ...valid, teamId: 'a' }).ok).toBe(false);
    expect(parseTeamAssignPayload({ ...valid, teamId: 1 }).ok).toBe(false);
  });

  it("rejects role 'facilitator' and unknown roles — the facilitator seat is mint-only", () => {
    expect(parseTeamAssignPayload({ ...valid, role: 'facilitator' }).ok).toBe(false);
    expect(parseTeamAssignPayload({ ...valid, role: 'admin' }).ok).toBe(false);
  });

  it('bounds the playerId to a 1–128 char string', () => {
    expect(parseTeamAssignPayload({ ...valid, playerId: '' }).ok).toBe(false);
    expect(parseTeamAssignPayload({ ...valid, playerId: 'x'.repeat(129) }).ok).toBe(false);
    expect(parseTeamAssignPayload({ ...valid, playerId: 'x'.repeat(128) }).ok).toBe(true);
    expect(parseTeamAssignPayload({ ...valid, playerId: 42 }).ok).toBe(false);
  });

  it('rejects non-object payloads and missing fields', () => {
    expect(parseTeamAssignPayload(null).ok).toBe(false);
    expect(parseTeamAssignPayload('A').ok).toBe(false);
    expect(parseTeamAssignPayload([]).ok).toBe(false);
    expect(parseTeamAssignPayload({}).ok).toBe(false);
    expect(parseTeamAssignPayload({ playerId: 'x', teamId: 'A' }).ok).toBe(false);
  });

  it('ignores unknown extra keys (rebuilt object carries only the three fields)', () => {
    const result = parseTeamAssignPayload({ ...valid, sneaky: 'extra' });
    expect(result).toEqual({ ok: true, playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
  });
});

describe('TEAM_ASSIGN handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Join a socket into the session and resolve with that socket's broadcast
   * snapshot. Also drains the facilitator's copy of the join broadcast so a
   * later facSpy/assignment listener can't race this in-flight broadcast. */
  async function joinAs(
    socket: TestClientSocket,
    joinCode: string,
    displayName: string,
    role: 'defuser' | 'expert' | 'spectator',
  ): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role });
    const [state] = await Promise.all([statePromise, facStatePromise]);
    return state;
  }

  /** The roster playerId of the (single) player with this display name. */
  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  it('happy path: facilitator assigns a joiner; BOTH sockets receive the updated SESSION_STATE', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });

    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);
    for (const state of [facState, joinerState]) {
      expect(state.players[mayaId]).toMatchObject({ teamId: 'A', role: 'defuser' });
      expect(state.teams.A).toEqual({
        teamId: 'A',
        relayOrder: [mayaId],
        currentDefuserIndex: 0,
        cumulativeTimeMs: 0,
        roundTimesMs: [],
        roundOutcomes: [],
        equalisationRoundsPlayed: 0,
      });
    }
  });

  it('persists the assignment to Redis (not just the broadcast)', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');

    const statePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'B', role: 'spectator' });
    await statePromise;

    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(stored.players[mayaId]).toMatchObject({ teamId: 'B', role: 'spectator' });
    expect(stored.teams.B?.relayOrder).toEqual([mayaId]);
  });

  it('AC2: a non-facilitator socket → NOT_FACILITATOR, no broadcast, store byte-identical', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(error.recoverable).toBe(true);
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('a connected socket that never entered a session → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('TEAM_ASSIGN', { playerId: 'sock-x', teamId: 'A', role: 'defuser' });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });

  it('unknown target playerId → PLAYER_NOT_FOUND, no state change', async () => {
    const ack = await createSession(facilitator);
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: 'sock-ghost', teamId: 'A', role: 'defuser' });
    const error = await errorPromise;

    expect(error.code).toBe('PLAYER_NOT_FOUND');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
  });

  it("targeting the facilitator → INVALID_ASSIGNMENT (they don't sit on a team)", async () => {
    const ack = await createSession(facilitator);
    const stateBefore = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    const facId = facilitatorIdOf(stateBefore);

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: facId, teamId: 'A', role: 'defuser' });
    const error = await errorPromise;

    expect(error.code).toBe('INVALID_ASSIGNMENT');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(
      JSON.stringify(stateBefore),
    );
  });

  it('non-lobby session → NOT_IN_LOBBY', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_LOBBY');
  });

  it.each([
    ['bad teamId', { playerId: 'sock-x', teamId: 'C', role: 'defuser' }],
    ['facilitator role', { playerId: 'sock-x', teamId: 'A', role: 'facilitator' }],
    ['non-object', 'A-defuser'],
  ])('invalid payload (%s) → INVALID_PAYLOAD', async (_label, payload) => {
    await createSession(facilitator);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', payload as never);
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('reassign A→B: relayOrder moves, the emptied team is deleted', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');

    const first = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    await first;

    const second = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'B', role: 'defuser' });
    const state = await second;

    expect(state.teams.A).toBeUndefined();
    expect(state.teams.B?.relayOrder).toEqual([mayaId]);
  });

  it('idempotent repeat of the same assignment → no persist, no extra broadcast', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');

    const first = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    await first;
    const storedAfterFirst = store.data.get(sessionKey(ack.sessionId));

    const joinerSpy = jest.fn();
    joiner.on('SESSION_STATE', joinerSpy);
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    // Fence: an invalid emit produces an ERROR to the facilitator; per-socket
    // ordering guarantees the idempotent assign above completed by then.
    const fence = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { teamId: 'C' } as never);
    await fence;

    expect(joinerSpy).not.toHaveBeenCalled();
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedAfterFirst);
  });

  it('persist failure → TEAM_ASSIGN_FAILED to the facilitator, no broadcast', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined, 'Maya');

    const realSet = store.setJSON.bind(store);
    store.setJSON = async (key, value) => {
      if (key === sessionKey(ack.sessionId)) throw new Error('redis down');
      return realSet(key, value);
    };

    const joinerSpy = jest.fn();
    joiner.on('SESSION_STATE', joinerSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    const error = await errorPromise;

    expect(error.code).toBe('TEAM_ASSIGN_FAILED');
    expect(joinerSpy).not.toHaveBeenCalled();
  });

  it('two joiners assigned to the same team land in relayOrder in assignment order', async () => {
    const ack = await createSession(facilitator);
    const second = await server.connectClient();
    const joined1 = await joinAs(joiner, ack.joinCode, 'Maya', 'expert');
    const mayaId = idOf(joined1, 'Maya');
    const joined2 = await joinAs(second, ack.joinCode, 'Devon', 'expert');
    const devonId = idOf(joined2, 'Devon');

    const first = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    await first;
    const secondState = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: devonId, teamId: 'A', role: 'expert' });
    const state = await secondState;

    expect(state.teams.A?.relayOrder).toEqual([mayaId, devonId]);
  });
});

describe('PREPARATION_OPEN handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Join a socket into the session and resolve with that socket's broadcast snapshot. */
  async function joinAs(
    socket: TestClientSocket,
    joinCode: string,
    displayName: string,
  ): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    // Drain the facilitator's copy too so a later listener can't race it.
    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    const [state] = await Promise.all([statePromise, facStatePromise]);
    return state;
  }

  /** The roster playerId of the (single) player with this display name. */
  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  // Await the broadcast on BOTH sockets so no stale snapshot is still in flight
  // when a test registers its own listeners (the prep-open guard now requires a
  // populated team, so these tests must assign before opening — same drain
  // discipline as the ROUND_START setup).
  const everyone = () =>
    Promise.all([facilitator, joiner].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')));

  /**
   * Create a session, join Maya, assign her to Team A, then pad the team to the
   * min size of 2 (Story 8.9 guard) with a synthetic Expert — all broadcasts
   * drained. The pad is a direct store write (no broadcast); the test's own
   * PREPARATION_OPEN reads the padded state.
   */
  async function sessionWithTeam(): Promise<{ sessionId: string; joinCode: string }> {
    const ack = await createSession(facilitator);
    let bc = everyone();
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    const [, joined] = await bc;
    bc = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(joined, 'Maya'), teamId: 'A', role: 'expert' });
    await bc;
    await padTeamsToMinSize(store, ack.sessionId);
    return ack;
  }

  it('happy path: lobby → preparation, roundNumber 1, ALL sockets receive SESSION_STATE', async () => {
    const ack = await sessionWithTeam();

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('PREPARATION_OPEN');

    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);
    for (const state of [facState, joinerState]) {
      expect(state.status).toBe('preparation');
      expect(state.roundNumber).toBe(1);
    }
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(stored.status).toBe('preparation');
    expect(stored.roundNumber).toBe(1);
  });

  it('non-facilitator → NOT_FACILITATOR, no broadcast, store byte-identical', async () => {
    const ack = await createSession(facilitator);
    await joinAs(joiner, ack.joinCode, 'Maya');
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PREPARATION_OPEN');
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(error.recoverable).toBe(true);
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('non-facilitator advance IN between-rounds → NOT_FACILITATOR, no broadcast, store byte-identical', async () => {
    // AC-3: the between-rounds advance (PREPARATION_OPEN) is facilitator-only.
    // The authority gate must fire BEFORE the phase transition, so a
    // non-facilitator probe in between-rounds learns nothing and changes
    // nothing (no index advance, no roundNumber bump, no broadcast).
    const ack = await sessionWithTeam(); // joiner (Maya) is assigned to Team A
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), {
      ...live,
      status: 'between-rounds',
      roundNumber: 1,
      teams: {
        ...live.teams,
        A: { ...live.teams.A!, cumulativeTimeMs: 12_000, roundTimesMs: [12_000] },
      },
    });
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PREPARATION_OPEN');
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(error.recoverable).toBe(true);
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('already in preparation → silent idempotent no-op (no persist, no broadcast, no error)', async () => {
    const ack = await sessionWithTeam();
    const opened = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await opened;
    const storedAfterFirst = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorSpy = jest.fn();
    facilitator.on('ERROR', errorSpy);
    facilitator.emit('PREPARATION_OPEN');
    // Fence: an invalid TEAM_ASSIGN produces an ERROR; per-socket ordering
    // guarantees the duplicate open above completed by then.
    const fence = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { teamId: 'C' } as never);
    await fence;

    expect(facSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1); // the fence only
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedAfterFirst);
  });

  it('active session → CANNOT_OPEN_PREP', async () => {
    const ack = await createSession(facilitator);
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    const error = await errorPromise;
    expect(error.code).toBe('CANNOT_OPEN_PREP');
  });

  it('a connected socket that never entered a session → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('PREPARATION_OPEN');
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });

  it('no populated team → CANNOT_OPEN_PREP (the prep-open guard), no broadcast', async () => {
    const ack = await createSession(facilitator);
    await joinAs(joiner, ack.joinCode, 'Maya'); // joined but never assigned to a team
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    const error = await errorPromise;

    expect(error.code).toBe('CANNOT_OPEN_PREP');
    expect(error.message).toMatch(/team/i);
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('a 1-player team → TEAM_TOO_SMALL, no broadcast (min-team-size guard, Story 8.9 follow-up)', async () => {
    // A lone Defuser with no Expert to read the manual can never solve a bomb.
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya');
    const bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(joined, 'Maya'), teamId: 'A', role: 'expert' });
    await bc;
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    const error = await errorPromise;

    expect(error.code).toBe('TEAM_TOO_SMALL');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('persist failure → PREPARATION_OPEN_FAILED, no broadcast', async () => {
    const ack = await sessionWithTeam();
    const realSet = store.setJSON.bind(store);
    store.setJSON = async (key, value) => {
      if (key === sessionKey(ack.sessionId)) throw new Error('redis down');
      return realSet(key, value);
    };

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    const error = await errorPromise;

    expect(error.code).toBe('PREPARATION_OPEN_FAILED');
    expect(facSpy).not.toHaveBeenCalled();
  });
});

describe('PREPARATION_CANCEL handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  // Drain the broadcast on both sockets per emit so no stale snapshot lingers.
  const everyone = () =>
    Promise.all([facilitator, joiner].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')));

  /** Create, join + assign Maya to Team A, pad to min size 2 (guard), then open prep. */
  async function openedPrep(): Promise<{ sessionId: string; joinCode: string }> {
    const ack = await createSession(facilitator);
    let bc = everyone();
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    const [, joined] = await bc;
    bc = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(joined, 'Maya'), teamId: 'A', role: 'expert' });
    await bc;
    await padTeamsToMinSize(store, ack.sessionId);
    bc = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await bc;
    return ack;
  }

  it('happy path: preparation → lobby, roundNumber back to 0, ALL sockets receive SESSION_STATE', async () => {
    const ack = await openedPrep();

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    facilitator.emit('PREPARATION_CANCEL');

    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);
    for (const state of [facState, joinerState]) {
      expect(state.status).toBe('lobby');
      expect(state.roundNumber).toBe(0);
    }
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(stored.status).toBe('lobby');
    expect(stored.roundNumber).toBe(0);
  });

  it('non-facilitator → NOT_FACILITATOR, no broadcast', async () => {
    await openedPrep();
    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PREPARATION_CANCEL');
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('not in preparation (still lobby) → CANNOT_CANCEL_PREP', async () => {
    await createSession(facilitator);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_CANCEL');
    const error = await errorPromise;
    expect(error.code).toBe('CANNOT_CANCEL_PREP');
  });

  it('a connected socket that never entered a session → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('PREPARATION_CANCEL');
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });
});

describe('ROUND_START handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;
  let devon: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    maya = await server.connectClient();
    devon = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  async function joinAs(
    socket: TestClientSocket,
    joinCode: string,
    displayName: string,
  ): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    // Drain the facilitator's copy too so a later listener can't race it.
    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    const [state] = await Promise.all([statePromise, facStatePromise]);
    return state;
  }

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  /** Create session, join Maya (Team A) + Devon (Team B), open preparation. */
  async function setupPrepared(): Promise<{
    sessionId: string;
    mayaId: string;
    devonId: string;
  }> {
    const ack = await createSession(facilitator);
    const j1 = await joinAs(maya, ack.joinCode, 'Maya');
    const mayaId = idOf(j1, 'Maya');
    const j2 = await joinAs(devon, ack.joinCode, 'Devon');
    const devonId = idOf(j2, 'Devon');

    // Await each broadcast on ALL sockets so no stale snapshot is still in
    // flight when a test registers its own nextEvent listeners.
    const everyone = () =>
      Promise.all(
        [facilitator, maya, devon].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')),
      );
    let done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'expert' });
    await done;
    done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: devonId, teamId: 'B', role: 'expert' });
    await done;
    // Each team is 1 player via the lobby flow; pad to the min size of 2 (synthetic
    // socketless Expert) so the guard admits the round without altering the picks.
    await padTeamsToMinSize(store, ack.sessionId);
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;
    return { sessionId: ack.sessionId, mayaId, devonId };
  }

  it('happy path (Model B): activates with ONLY the active team armed (A); B rests; joins team rooms', async () => {
    const { sessionId, mayaId, devonId } = await setupPrepared();

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const mayaStatePromise = nextEvent<SessionState>(maya, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    const [facState, mayaState] = await Promise.all([facStatePromise, mayaStatePromise]);

    for (const state of [facState, mayaState]) {
      expect(state.status).toBe('active');
      expect(state.activeTeamId).toBe('A'); // round 1 → Team A (snake first turn)
      expect(state.players[mayaId]).toMatchObject({ role: 'defuser', teamId: 'A' });
      // Devon (Team B) RESTS this round — not a defuser.
      expect(state.players[devonId]).toMatchObject({ role: 'expert', teamId: 'B' });
      expect(Object.values(state.players).find((p) => p.role === 'facilitator')).toBeDefined();
    }

    const round = JSON.parse(store.data.get(roundKey(sessionId, 1))!) as RoundState;
    expect(round).toEqual({
      roundNumber: 1,
      status: 'active',
      defusers: { A: mayaId }, // single active team
      outcomes: {},
      retry: false,
    });

    // Every roster socket still joins its team room (harmless for the resting team).
    const teamA = await server.io.in(teamRoom(sessionId, 'A')).fetchSockets();
    const teamB = await server.io.in(teamRoom(sessionId, 'B')).fetchSockets();
    expect(teamA.map((s) => s.data.playerId)).toEqual([mayaId]);
    expect(teamB.map((s) => s.data.playerId)).toEqual([devonId]);
  });

  it('between-rounds advance → ROUND_START commits the NEXT rotation Defuser (Model B, single-team relay)', async () => {
    // Two players relay on Team A (single-team session). After round 1, the
    // resolution ceremony advanced A's pointer to index 1. The facilitator's
    // advance keeps it (openPreparation no longer advances), and the next
    // ROUND_START commits relayOrder[1], proving the rotation moved end-to-end.
    const ack = await createSession(facilitator);
    const j1 = await joinAs(maya, ack.joinCode, 'Maya');
    const mayaId = idOf(j1, 'Maya');
    const j2 = await joinAs(devon, ack.joinCode, 'Devon');
    const devonId = idOf(j2, 'Devon');

    const everyone = () =>
      Promise.all([facilitator, maya, devon].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')));
    let done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'defuser' });
    await done;
    done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: devonId, teamId: 'A', role: 'expert' });
    await done;

    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    const relayOrder = seeded.teams.A!.relayOrder;
    expect(relayOrder).toEqual([mayaId, devonId]);

    // Flip into between-rounds at round 1 with A's pointer ALREADY advanced to 1
    // (as resolveRound leaves it after round 1 completes — Model B).
    await store.setJSON(sessionKey(ack.sessionId), {
      ...seeded,
      status: 'between-rounds',
      roundNumber: 1,
      teams: {
        ...seeded.teams,
        A: { ...seeded.teams.A!, currentDefuserIndex: 1, cumulativeTimeMs: 9_000, roundTimesMs: [9_000] },
      },
    });

    // Facilitator advances → preparation, roundNumber 2, activeTeamId A; the
    // pointer is UNCHANGED (advance is at resolve, not here).
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;
    const advanced = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(advanced.status).toBe('preparation');
    expect(advanced.roundNumber).toBe(2);
    expect(advanced.activeTeamId).toBe('A');
    expect(advanced.teams.A!.currentDefuserIndex).toBe(1);

    // ROUND_START commits the NEXT defuser (relayOrder[1] = devon), not round 1's.
    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    await statePromise;

    const round2 = JSON.parse(store.data.get(roundKey(ack.sessionId, 2))!) as RoundState;
    expect(round2.defusers.A).toBe(relayOrder[1]);
    expect(round2.defusers.A).not.toBe(relayOrder[0]);
  });

  it('generates + persists a bomb ONLY for the active team and broadcasts BOMB_INIT to it (Model B)', async () => {
    const { sessionId } = await setupPrepared();

    const mayaBomb = new Promise<BombState>((res) => maya.once('BOMB_INIT', (b) => res(b as BombState)));
    // Maya (Team A, active) gets exactly one BOMB_INIT; Devon (Team B, resting) none.
    const mayaBombSpy = jest.fn();
    maya.on('BOMB_INIT', mayaBombSpy);
    const devonBombSpy = jest.fn();
    devon.on('BOMB_INIT', devonBombSpy);

    facilitator.emit('ROUND_START');
    const a = await mayaBomb;

    expect(a.modules.length).toBeGreaterThan(0);

    // Persisted under the active team's private bomb key; the resting team has none.
    expect(store.data.has(bombKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(bombKey(sessionId, 'B'))).toBe(false);
    const persistedA = JSON.parse(store.data.get(bombKey(sessionId, 'A'))!) as BombState;
    expect(persistedA).toEqual(a);

    await new Promise((r) => setTimeout(r, 100));
    expect(mayaBombSpy).toHaveBeenCalledTimes(1);
    expect(devonBombSpy).not.toHaveBeenCalled();
  });

  it('non-facilitator → NOT_FACILITATOR, no broadcast, no round key', async () => {
    const { sessionId } = await setupPrepared();

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('ROUND_START');
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(store.data.get(roundKey(sessionId, 1))).toBeUndefined();
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('still in lobby → CANNOT_START_ROUND', async () => {
    await createSession(facilitator);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_START');
    const error = await errorPromise;
    expect(error.code).toBe('CANNOT_START_ROUND');
  });

  it('preparation with no populated team → CANNOT_START_ROUND, state unchanged', async () => {
    const ack = await createSession(facilitator);
    // The PREPARATION_OPEN guard now prevents reaching prep with no populated
    // team via the handler, so seed that state directly — ROUND_START keeps its
    // own NO_POPULATED_TEAM defense (a player can leave between open and start).
    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), {
      ...seeded,
      status: 'preparation',
      roundNumber: 1,
    });
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_START');
    const error = await errorPromise;

    expect(error.code).toBe('CANNOT_START_ROUND');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
  });

  it('Model B: an exhausted ACTIVE team does not wrap — ROUND_START refuses (no wrong pick)', async () => {
    const { sessionId } = await setupPrepared();
    const stored = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(stored.activeTeamId).toBe('A');
    // Force the active team A past its relayOrder (index 7). The old modulo wrapped
    // (7 % 1 = 0 → Maya); Model B reads it raw, so A is exhausted with no owed
    // round → ROUND_START refuses rather than committing a wrapped pick.
    await store.setJSON(sessionKey(sessionId), {
      ...stored,
      teams: { ...stored.teams, A: { ...stored.teams.A!, currentDefuserIndex: 7 } },
    });

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_START');
    expect((await errorPromise).code).toBe('CANNOT_START_ROUND');
    expect(store.data.get(roundKey(sessionId, 1))).toBeUndefined(); // no round committed
  });

  it('a never-joined socket → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('ROUND_START');
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });

  it('persist failure → ROUND_START_FAILED, no broadcast', async () => {
    const { sessionId } = await setupPrepared();
    const realSet = store.setJSON.bind(store);
    store.setJSON = async (key, value) => {
      if (key === sessionKey(sessionId)) throw new Error('redis down');
      return realSet(key, value);
    };

    const mayaSpy = jest.fn();
    maya.on('SESSION_STATE', mayaSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_START');
    const error = await errorPromise;

    expect(error.code).toBe('ROUND_START_FAILED');
    expect(mayaSpy).not.toHaveBeenCalled();
  });
});

describe('ROUND_START — timer mint & expiry (Story 8.4)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let scheduler: TestScheduler;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;
  let devon: TestClientSocket;

  const TIMER_MS = 2_000;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) => {
      scheduler = createTestScheduler({ redis: store, io, log: noopLog });
      registerSessionHandlers(io, { redis: store, log: noopLog, timer: scheduler, archive: fakeArchive });
    });
    facilitator = await server.connectClient();
    maya = await server.connectClient();
    devon = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Resolve with the next emission of an arbitrary server event. */
  function onceEvent<T>(socket: TestClientSocket, event: string): Promise<T> {
    return new Promise<T>((resolve) => {
      socket.once(event as 'SESSION_STATE', ((payload: T) => resolve(payload)) as never);
    });
  }

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  function joinAs(socket: TestClientSocket, joinCode: string, displayName: string): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    return statePromise;
  }

  /**
   * Create (short timer), join Maya (Team A) + Devon (Team B), open prep — the
   * exact discipline of the ROUND_START describe's setupPrepared (drain every
   * broadcast on all sockets so no stale snapshot races a later listener).
   */
  async function prep(): Promise<{ sessionId: string }> {
    const ack = await createSession(facilitator, { config: { timerMs: TIMER_MS } });
    const j1 = await joinAs(maya, ack.joinCode, 'Maya');
    const mayaId = idOf(j1, 'Maya');
    const j2 = await joinAs(devon, ack.joinCode, 'Devon');
    const devonId = idOf(j2, 'Devon');

    const everyone = () =>
      Promise.all([facilitator, maya, devon].map((s) => nextEvent<SessionState>(s, 'SESSION_STATE')));
    let done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: mayaId, teamId: 'A', role: 'expert' });
    await done;
    done = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: devonId, teamId: 'B', role: 'expert' });
    await done;
    // Pad each 1-player team to the min size of 2 (Story 8.9 guard) without
    // altering the Defuser picks or team-room membership.
    await padTeamsToMinSize(store, ack.sessionId);
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;
    return { sessionId: ack.sessionId };
  }

  it('mints a fresh TimerState to the team room, persists it, and arms the scheduler', async () => {
    const { sessionId } = await prep();

    const timerPromise = onceEvent<TimerState>(maya, 'TIMER_UPDATE');
    facilitator.emit('ROUND_START');
    const timer = await timerPromise;

    expect(timer).toMatchObject({ remainingAtStart: TIMER_MS, speedMultiplier: 1, pausedAt: null });
    expect(typeof timer.startedAt).toBe('number');

    const persisted = JSON.parse(store.data.get(timerKey(sessionId, 'A'))!) as TimerState;
    expect(persisted).toEqual(timer);

    expect(scheduler.armCalls.map((c) => c.teamId)).toContain('A');
  });

  it('Model B: only the ACTIVE team gets a timer; the resting team gets none', async () => {
    const { sessionId } = await prep();

    const mayaTimer = onceEvent<TimerState>(maya, 'TIMER_UPDATE');
    // Devon (Team B, resting in round 1) must NOT receive any timer.
    const devonSawTimer = jest.fn();
    devon.on('TIMER_UPDATE', devonSawTimer);

    facilitator.emit('ROUND_START');
    await mayaTimer;
    // Give any stray cross-team broadcast a window to (not) arrive.
    await new Promise((r) => setTimeout(r, 150));

    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(timerKey(sessionId, 'B'))).toBe(false);
    expect(scheduler.armCalls.map((c) => c.teamId)).toEqual(['A']);
    expect(devonSawTimer).not.toHaveBeenCalled();
  });

  it('authoritative expiry: single active team resolves immediately into between-rounds (8.5/8.6 ceremony)', async () => {
    const { sessionId } = await prep();

    const started = onceEvent<TimerState>(maya, 'TIMER_UPDATE');
    facilitator.emit('ROUND_START');
    await started;

    // Under Model B only Team A is armed, so when A expires it is the LAST (only)
    // team to resolve → the round completes and the session enters between-rounds
    // immediately, with a SCOREBOARD preview to the whole session (Story 8.6).
    const explodedPromise = onceEvent<RoundEndPayloadLike>(maya, 'BOMB_EXPLODED');
    const scoreboardPromise = onceEvent<unknown>(maya, 'SCOREBOARD');
    scheduler.setNow(TIMER_MS + 1); // advance the server clock past the deadline
    await scheduler.fireNow(sessionId, 'A');
    const exploded = await explodedPromise;
    await scoreboardPromise;

    expect(exploded).toEqual({ teamId: 'A', elapsedMs: TIMER_MS });
    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(false);
    const after = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(after.teams.A!.cumulativeTimeMs).toBe(TIMER_MS);
    expect(after.teams.A!.roundTimesMs).toEqual([TIMER_MS]);
    // Resolve advanced A's pointer (Model B single advance site).
    expect(after.teams.A!.currentDefuserIndex).toBe(1);
    expect(after.status).toBe('between-rounds');
  });
});

interface RoundEndPayloadLike {
  teamId: 'A' | 'B';
  elapsedMs: number;
}

describe('Story 2.7: durable identity, disconnect cleanup, PLAYER_REMOVE, reattach', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
        // Short grace so disconnect-removal tests don't wait the 8s default, but
        // long enough that an in-test reconnect reliably wins the cancellation race.
        disconnectGraceMs: 500,
      }),
    );
    facilitator = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Resolve with the next SESSION_IDENTITY packet on a socket. */
  function nextIdentity(socket: TestClientSocket): Promise<SessionIdentityPayload> {
    return new Promise((resolve) => socket.once('SESSION_IDENTITY', (p) => resolve(p)));
  }

  /** Create a session and capture the facilitator's identity packet. */
  async function createWithIdentity(): Promise<{ ack: SessionCreatedPayload; identity: SessionIdentityPayload }> {
    const idPromise = nextIdentity(facilitator);
    const ack = await createSession(facilitator);
    return { ack, identity: await idPromise };
  }

  /** Join a fresh socket, capturing both its identity and post-join snapshot. */
  async function joinWithIdentity(
    joinCode: string,
    displayName: string,
    role: 'defuser' | 'expert' | 'spectator' = 'expert',
  ): Promise<{ socket: TestClientSocket; identity: SessionIdentityPayload; state: SessionState }> {
    const socket = await server.connectClient();
    const idPromise = nextIdentity(socket);
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role });
    const [identity, state] = await Promise.all([idPromise, statePromise]);
    return { socket, identity, state };
  }

  // ── Identity mint ──────────────────────────────────────────────────────────
  it('SESSION_CREATE mints a durable identity: reattach record stored, token absent from the broadcast', async () => {
    const { ack, identity } = await createWithIdentity();
    expect(identity.sessionId).toBe(ack.sessionId);
    expect(identity.playerId).toMatch(UUID_RE);
    expect(identity.reattachToken).toMatch(UUID_RE);

    // The reattach record resolves the token → the durable identity.
    const record = JSON.parse(store.data.get(reattachKey(ack.sessionId, identity.reattachToken))!);
    expect(record).toMatchObject({ playerId: identity.playerId, role: 'facilitator' });

    // The token is a secret — never part of the broadcast SessionState.
    const state = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(JSON.stringify(state)).not.toContain(identity.reattachToken);
    expect(state.players[identity.playerId]?.role).toBe('facilitator');
  });

  it('SESSION_JOIN mints a joiner identity; the durable id keys the roster', async () => {
    const { ack } = await createWithIdentity();
    const { identity, state } = await joinWithIdentity(ack.joinCode, 'Maya');
    expect(state.players[identity.playerId]).toMatchObject({ displayName: 'Maya', role: 'expert' });
    expect(store.data.get(reattachKey(ack.sessionId, identity.reattachToken))).toBeDefined();
  });

  // ── Disconnect cleanup (AC 3) — after the grace window elapses ──────────────
  it('a lobby disconnect frees the seat after the grace + broadcasts; the reattach record survives', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');

    const facUpdate = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.disconnect(); // no reconnect → the grace timer fires the removal
    const after = await facUpdate;

    expect(after.players[identity.playerId]).toBeUndefined();
    expect(Object.keys(after.players)).toHaveLength(1); // facilitator only
    // Capacity freed in the store; reattach record kept so a refresh re-attaches.
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(Object.keys(stored.players)).toHaveLength(1);
    expect(store.data.get(reattachKey(ack.sessionId, identity.reattachToken))).toBeDefined();
  });

  it('a non-lobby (active) disconnect does NOT remove the player even after the grace (Epic 8 owns mid-round)', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 650)); // past the 500ms grace
    const afterStored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(afterStored.players[identity.playerId]).toBeDefined();
  });

  it('refresh race: the OLD socket disconnecting AFTER the NEW one reconnects must NOT free the live seat (AC 4)', async () => {
    const { ack } = await createWithIdentity();
    const { socket: oldSocket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');

    // Model a page refresh where the NEW socket connects (resolving the same
    // durable id via the reattach token) BEFORE the OLD socket's disconnect fires
    // — the ordering that defeats a naive "cancel-on-reconnect" guard, because at
    // reconnect time there is no pending removal to cancel.
    const newSocket = await server.connectClient({
      sessionId: ack.sessionId,
      reattachToken: identity.reattachToken,
    });

    // Now the stale socket finally drops. A live socket still holds Maya's id, so
    // the disconnect handler must skip scheduling the seat removal.
    oldSocket.disconnect();
    await new Promise((r) => setTimeout(r, 650)); // past the 500ms grace

    const afterStored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(afterStored.players[identity.playerId]).toMatchObject({ displayName: 'Maya', role: 'expert' });
    expect(Object.keys(afterStored.players)).toHaveLength(2); // facilitator + Maya

    newSocket.disconnect();
  });

  // ── PLAYER_REMOVE (AC 1/2) ────────────────────────────────────────────────────
  it('facilitator removes a player: roster shrinks, SESSION_REMOVED to the target, reattach record deleted', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity, state } = await joinWithIdentity(ack.joinCode, 'Maya');
    expect(Object.keys(state.players)).toHaveLength(2);

    const removed = new Promise<SessionRemovedPayload>((resolve) =>
      socket.once('SESSION_REMOVED', (p) => resolve(p)),
    );
    const facUpdate = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('PLAYER_REMOVE', { playerId: identity.playerId });

    const [notice, after] = await Promise.all([removed, facUpdate]);
    expect(notice.message).toMatch(/removed/i);
    expect(after.players[identity.playerId]).toBeUndefined();
    // Kick is permanent: the reattach record is gone.
    expect(store.data.get(reattachKey(ack.sessionId, identity.reattachToken))).toBeUndefined();
  });

  it('a non-facilitator PLAYER_REMOVE → NOT_FACILITATOR, store byte-identical, no broadcast', async () => {
    const { ack, identity: facId } = await createWithIdentity();
    const { socket } = await joinWithIdentity(ack.joinCode, 'Maya');
    const before = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(socket, 'ERROR');
    socket.emit('PLAYER_REMOVE', { playerId: facId.playerId }); // joiner tries to remove the facilitator
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(before);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('the facilitator removing themselves → INVALID_REMOVAL, no writes', async () => {
    const { ack, identity } = await createWithIdentity();
    const before = store.data.get(sessionKey(ack.sessionId));
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PLAYER_REMOVE', { playerId: identity.playerId });
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_REMOVAL');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(before);
  });

  it('removing an unknown player → INVALID_REMOVAL, no writes', async () => {
    const { ack } = await createWithIdentity();
    const before = store.data.get(sessionKey(ack.sessionId));
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PLAYER_REMOVE', { playerId: 'no-such-id' });
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_REMOVAL');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(before);
  });

  it('updateJSON failure during removal → PLAYER_REMOVE_FAILED, no broadcast', async () => {
    const { ack } = await createWithIdentity();
    const { identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    store.updateJSON = async () => {
      throw new Error('boom');
    };
    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PLAYER_REMOVE', { playerId: identity.playerId });
    const error = await errorPromise;
    expect(error.code).toBe('PLAYER_REMOVE_FAILED');
    expect(facSpy).not.toHaveBeenCalled();
  });

  // ── Reattach (AC 4) ───────────────────────────────────────────────────────────
  it('reconnect with a valid reattach token converges to the same player record — no duplicate', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    socket.disconnect(); // reconnect within the grace cancels the seat removal

    // Reconnect a fresh socket presenting the token → server restore converges to
    // the SAME durable id (no duplicate, no capacity error).
    const { state } = await server.connectClientCapturingState({
      sessionId: ack.sessionId,
      reattachToken: identity.reattachToken,
    });
    expect(state.players[identity.playerId]).toMatchObject({ displayName: 'Maya', role: 'expert' });
    expect(Object.keys(state.players)).toHaveLength(2); // facilitator + the one Maya, no dup
  });

  it('a refresh within the grace window preserves the player team + role + relayOrder (AC 4 — same seat)', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');

    // Facilitator reassigns Maya to Team A as defuser.
    const assigned = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: identity.playerId, teamId: 'A', role: 'defuser' });
    await assigned;

    // Maya refreshes: disconnect, then reconnect with her token within the grace —
    // the removal is cancelled, so her seat is never torn down (the bug this fixes).
    socket.disconnect();
    const { state } = await server.connectClientCapturingState({
      sessionId: ack.sessionId,
      reattachToken: identity.reattachToken,
    });

    expect(state.players[identity.playerId]).toMatchObject({ teamId: 'A', role: 'defuser' });
    expect(state.teams.A?.relayOrder).toContain(identity.playerId);
    expect(Object.keys(state.players)).toHaveLength(2);
  });

  it('a reconnect with a bad/absent token is treated as a fresh client (no restore)', async () => {
    const { ack } = await createWithIdentity();
    const stranger = await server.connectClient({ sessionId: ack.sessionId, reattachToken: 'not-a-real-token' });
    // No restore broadcast should arrive; a plain SESSION_JOIN still works as a fresh join.
    const statePromise = nextEvent<SessionState>(stranger, 'SESSION_STATE');
    stranger.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Newbie', role: 'spectator' });
    const state = await statePromise;
    const newbie = Object.values(state.players).find((p) => p.displayName === 'Newbie');
    expect(newbie).toBeDefined();
  });

  // ── Mid-round reattach replay (bomb-view refresh fix) ────────────────────────
  // A refresh during an active round must re-join the team room AND replay the
  // live bomb + timer, or the client renders the DEV placeholder modules and goes
  // stale on the next team-scoped broadcast.
  const SAMPLE_BOMB: BombState = {
    context: { serialNumber: 'AB1', batteryCount: 2, indicators: [], ports: [] },
    modules: [],
    strikes: 0,
    solved: false,
  };
  const SAMPLE_TIMER: TimerState = {
    startedAt: 1000,
    remainingAtStart: 300_000,
    speedMultiplier: 1,
    pausedAt: null,
  };

  /** Settle to 'received' if `p` resolves first, else 'timeout' after `ms`. */
  const raceTimeout = (p: Promise<unknown>, ms: number): Promise<'received' | 'timeout'> =>
    Promise.race([
      p.then(() => 'received' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms)),
    ]);

  /** Join Maya, assign her to Team A as defuser, then force the session active.
   * A live timer key means the team is still playing; resolveRound deletes it on
   * defuse/explosion while leaving the bomb key — so `writeTimer: false` models a
   * resolved team within a still-active (multi-team) session. */
  async function setupActiveDefuser(
    opts: { writeBomb?: boolean; writeTimer?: boolean } = {},
  ): Promise<{ ack: SessionCreatedPayload; identity: SessionIdentityPayload; socket: TestClientSocket }> {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    const assigned = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: identity.playerId, teamId: 'A', role: 'defuser' });
    await assigned;
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });
    if (opts.writeBomb ?? true) await store.setJSON(bombKey(ack.sessionId, 'A'), SAMPLE_BOMB);
    if (opts.writeTimer ?? true) await store.setJSON(timerKey(ack.sessionId, 'A'), SAMPLE_TIMER);
    return { ack, identity, socket };
  }

  it('mid-round reattach re-joins the team room and replays BOMB_INIT + TIMER_UPDATE', async () => {
    const { ack, identity, socket } = await setupActiveDefuser();
    socket.disconnect(); // refresh

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['BOMB_INIT', 'TIMER_UPDATE'],
    );
    expect(await events['BOMB_INIT']).toEqual(SAMPLE_BOMB);
    // Story 8.7 (merged): the mid-round disconnect auto-pauses the session and
    // freezes the clock, so the reattach replays the FROZEN timer (pausedAt set at
    // the disconnect instant — now()=0 in this harness), not the original running one.
    expect(await events['TIMER_UPDATE']).toEqual({ ...SAMPLE_TIMER, pausedAt: 0 });

    // Re-joined the team room so subsequent team-scoped broadcasts reach it.
    const teamSockets = await server.io.in(teamRoom(ack.sessionId, 'A')).fetchSockets();
    expect(teamSockets.some((s) => s.data.playerId === identity.playerId)).toBe(true);
    rejoined.disconnect();
  });

  it('mid-round reattach with no team assignment replays neither bomb nor timer', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });
    socket.disconnect();

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['SESSION_STATE', 'BOMB_INIT'],
    );
    expect(await events['SESSION_STATE']).toBeDefined(); // snapshot still delivered
    await expect(raceTimeout(events['BOMB_INIT'], 100)).resolves.toBe('timeout');
    rejoined.disconnect();
  });

  it('mid-round reattach with bomb/timer keys absent restores without throwing and replays no bomb', async () => {
    const { ack, identity } = await setupActiveDefuser({ writeBomb: false, writeTimer: false });
    // Maya's socket from setup is still open; the reattach is a separate socket.

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['SESSION_STATE', 'BOMB_INIT'],
    );
    expect(await events['SESSION_STATE']).toBeDefined(); // restore ran — no throw
    await expect(raceTimeout(events['BOMB_INIT'], 100)).resolves.toBe('timeout');
    rejoined.disconnect();
  });

  it('reattach for a resolved team (timer key gone, bomb key kept) replays neither — no stale playable bomb', async () => {
    // resolveRound deletes the timer on defuse/explosion but keeps the bomb while
    // a sibling team keeps the session active. Replaying BOMB_INIT here would wipe
    // the client's result banner (setBomb clears resolution) — so it must not.
    const { ack, identity } = await setupActiveDefuser({ writeBomb: true, writeTimer: false });

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['SESSION_STATE', 'BOMB_INIT', 'TIMER_UPDATE'],
    );
    expect(await events['SESSION_STATE']).toBeDefined();
    await expect(raceTimeout(events['BOMB_INIT'], 100)).resolves.toBe('timeout');
    await expect(raceTimeout(events['TIMER_UPDATE'], 100)).resolves.toBe('timeout');
    rejoined.disconnect();
  });

  it('reattach with a live timer but absent bomb key replays neither (both-or-neither gate)', async () => {
    // If only the bomb key is evicted while the timer is still live, a timer-only
    // replay would leave the client ticking over the DEV placeholder modules — the
    // very desync this fix prevents. Both emits are gated on the bomb being present.
    const { ack, identity } = await setupActiveDefuser({ writeBomb: false, writeTimer: true });

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['SESSION_STATE', 'BOMB_INIT', 'TIMER_UPDATE'],
    );
    expect(await events['SESSION_STATE']).toBeDefined();
    await expect(raceTimeout(events['BOMB_INIT'], 100)).resolves.toBe('timeout');
    await expect(raceTimeout(events['TIMER_UPDATE'], 100)).resolves.toBe('timeout');
    rejoined.disconnect();
  });

  it('a lobby reattach replays no bomb (the replay is status-gated to active)', async () => {
    const { ack } = await createWithIdentity();
    const { socket, identity } = await joinWithIdentity(ack.joinCode, 'Maya');
    socket.disconnect();

    const { socket: rejoined, events } = await server.connectClientCapturing(
      { sessionId: ack.sessionId, reattachToken: identity.reattachToken },
      ['SESSION_STATE', 'BOMB_INIT'],
    );
    expect(await events['SESSION_STATE']).toBeDefined();
    await expect(raceTimeout(events['BOMB_INIT'], 100)).resolves.toBe('timeout');
    rejoined.disconnect();
  });

  // ── AR15: the reattach token is a secret ─────────────────────────────────────
  it('AR15: the reattach token never appears in a log line across create/join/remove/disconnect', async () => {
    const lines: string[] = [];
    const capturingLog: SessionLog = {
      info: (obj, msg) => lines.push(`${JSON.stringify(obj)} ${msg ?? ''}`),
      error: (obj, msg) => lines.push(`${JSON.stringify(obj)} ${msg ?? ''}`),
    };
    const logStore = createMemoryRedisStore();
    const logServer = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: logStore,
        log: capturingLog,
        timer: createTestScheduler({ redis: logStore, io, log: capturingLog }),
        archive: fakeArchive,
      }),
    );
    try {
      const fac = await logServer.connectClient();
      const facId = new Promise<SessionIdentityPayload>((r) => fac.once('SESSION_IDENTITY', r));
      const ack = await new Promise<SessionCreatedPayload>((r) => fac.emit('SESSION_CREATE', {}, r));
      const facIdentity = await facId;

      const joiner = await logServer.connectClient();
      const joinId = new Promise<SessionIdentityPayload>((r) => joiner.once('SESSION_IDENTITY', r));
      const joined = new Promise<SessionState>((r) => joiner.once('SESSION_STATE', r));
      joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
      const joinerIdentity = await joinId;
      await joined;

      const removeBroadcast = new Promise<SessionState>((r) => fac.once('SESSION_STATE', r));
      fac.emit('PLAYER_REMOVE', { playerId: joinerIdentity.playerId });
      await removeBroadcast;

      const blob = lines.join('\n');
      expect(blob).not.toContain(facIdentity.reattachToken);
      expect(blob).not.toContain(joinerIdentity.reattachToken);
      expect(blob).not.toContain(ack.joinCode);
    } finally {
      await logServer.close();
    }
  });
});

describe('PLAYER_READY handler (Story 2.5)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Join a socket and drain both broadcasts; resolve with the joiner's snapshot. */
  async function joinAs(
    socket: TestClientSocket,
    joinCode: string,
    displayName: string,
  ): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    const [state] = await Promise.all([statePromise, facStatePromise]);
    return state;
  }

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  it('happy path: a joiner sets ready; BOTH sockets receive SESSION_STATE with isReady true; persisted', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya');
    const mayaId = idOf(joined, 'Maya');

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerStatePromise = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('PLAYER_READY', { isReady: true });

    const [facState, joinerState] = await Promise.all([facStatePromise, joinerStatePromise]);
    for (const state of [facState, joinerState]) {
      expect(state.players[mayaId].isReady).toBe(true);
    }
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(stored.players[mayaId].isReady).toBe(true);
  });

  it('toggles back to false', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya');
    const mayaId = idOf(joined, 'Maya');

    let next = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('PLAYER_READY', { isReady: true });
    expect((await next).players[mayaId].isReady).toBe(true);

    next = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('PLAYER_READY', { isReady: false });
    expect((await next).players[mayaId].isReady).toBe(false);
  });

  it('idempotent repeat of the same value → no second broadcast, no persist', async () => {
    const ack = await createSession(facilitator);
    await joinAs(joiner, ack.joinCode, 'Maya');

    const first = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('PLAYER_READY', { isReady: true });
    await first;
    const storedAfterFirst = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    joiner.emit('PLAYER_READY', { isReady: true }); // same value → noop
    // Fence: an invalid emit produces an ERROR; per-socket ordering guarantees the
    // idempotent toggle above was processed by then.
    const fence = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PLAYER_READY', 'nope' as never);
    await fence;

    expect(facSpy).not.toHaveBeenCalled();
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedAfterFirst);
  });

  it.each([
    ['string isReady', { isReady: 'yes' }],
    ['missing isReady', {}],
    ['non-object', 'ready'],
    ['null', null],
  ])('invalid payload (%s) → INVALID_PAYLOAD', async (_label, payload) => {
    const ack = await createSession(facilitator);
    await joinAs(joiner, ack.joinCode, 'Maya');
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PLAYER_READY', payload as never);
    expect((await errorPromise).code).toBe('INVALID_PAYLOAD');
  });

  it('a connected socket that never entered a session → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('PLAYER_READY', { isReady: true });
    expect((await errorPromise).code).toBe('NOT_IN_SESSION');
  });

  it('non-lobby (active) session → no mutation, no broadcast (lobby-phase guard)', async () => {
    const ack = await createSession(facilitator);
    const joined = await joinAs(joiner, ack.joinCode, 'Maya');
    const mayaId = idOf(joined, 'Maya');
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...stored, status: 'active' });

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    joiner.emit('PLAYER_READY', { isReady: true }); // inert in non-lobby
    // Fence on the joiner's own ERROR (invalid payload) to order past the noop.
    const fence = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PLAYER_READY', 'x' as never);
    await fence;

    expect(facSpy).not.toHaveBeenCalled();
    const after = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(after.players[mayaId].isReady).toBe(false);
  });

  it('updateJSON throw → PLAYER_READY_FAILED to the caller, no broadcast', async () => {
    const ack = await createSession(facilitator);
    await joinAs(joiner, ack.joinCode, 'Maya');

    store.updateJSON = async () => {
      throw new Error('redis down');
    };

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('PLAYER_READY', { isReady: true });
    const error = await errorPromise;

    expect(error.code).toBe('PLAYER_READY_FAILED');
    expect(error.recoverable).toBe(true);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('AR15: the join code never appears in any log line', async () => {
    const lines: string[] = [];
    const record = (obj: object, msg?: string): void => {
      lines.push(JSON.stringify(obj) + (msg ? ` ${msg}` : ''));
    };
    const capturingLog: SessionLog = { info: record, error: record };
    const logStore = createMemoryRedisStore();
    const logServer = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: logStore,
        log: capturingLog,
        timer: createTestScheduler({ redis: logStore, io, log: capturingLog }),
        archive: fakeArchive,
      }),
    );
    try {
      const fac = await logServer.connectClient();
      const j = await logServer.connectClient();
      const ack = await new Promise<SessionCreatedPayload>((resolve) =>
        fac.emit('SESSION_CREATE', {}, resolve),
      );
      const jState = nextEvent<SessionState>(j, 'SESSION_STATE');
      j.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
      await jState;

      const broadcast = nextEvent<SessionState>(fac, 'SESSION_STATE');
      j.emit('PLAYER_READY', { isReady: true });
      await broadcast;

      const blob = lines.join('\n');
      expect(blob).toContain('player ready set'); // it did log
      expect(blob).not.toContain(ack.joinCode);
    } finally {
      await logServer.close();
    }
  });
});

describe('ROUND_CONFIGURE handler (Story 8.1)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let joiner: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    joiner = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  const fullConfig = {
    difficulty: 'medium' as const,
    moduleCount: 5,
    timerMs: 360_000,
    strikeSpeedUpPct: 25,
    modulePool: ['wires', 'the-button'],
    modifiers: { asymmetricExpertRoles: true, spectatorLifelines: false },
  };

  it('happy path: facilitator config broadcasts the new SESSION_STATE and persists it', async () => {
    const ack = await createSession(facilitator);

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_CONFIGURE', { config: fullConfig });
    const state = await statePromise;

    expect(state.config).toEqual(fullConfig);
    const stored = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(stored.config).toEqual(fullConfig);
  });

  it('AC2: a non-facilitator socket → NOT_FACILITATOR, no broadcast, store byte-identical', async () => {
    const ack = await createSession(facilitator);
    // joiner enters the session so it has a socket.data.sessionId pointer.
    const facJoinDrain = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const joinerState = nextEvent<SessionState>(joiner, 'SESSION_STATE');
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    await Promise.all([facJoinDrain, joinerState]);
    const storedBefore = store.data.get(sessionKey(ack.sessionId));

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('ROUND_CONFIGURE', { config: fullConfig });
    const error = await errorPromise;

    expect(error.code).toBe('NOT_FACILITATOR');
    expect(error.recoverable).toBe(true);
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('a connected socket that never entered a session → NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('ROUND_CONFIGURE', { config: fullConfig });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });

  it('invalid payload (out-of-range count) → INVALID_PAYLOAD, nothing persisted/broadcast', async () => {
    const ack = await createSession(facilitator);
    const storedBefore = store.data.get(sessionKey(ack.sessionId));
    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_CONFIGURE', { config: { ...fullConfig, moduleCount: 99 } } as never);
    const error = await errorPromise;

    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(storedBefore);
    expect(facSpy).not.toHaveBeenCalled();
  });

  it('un-generatable pool id → INVALID_PAYLOAD (fails here, not at round start)', async () => {
    await createSession(facilitator);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_CONFIGURE', { config: { ...fullConfig, modulePool: ['keypads'] } } as never);
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.message).toMatch(/keypads/);
  });

  it('a partial config (missing fields) → INVALID_PAYLOAD (ROUND_CONFIGURE needs a full config)', async () => {
    await createSession(facilitator);
    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_CONFIGURE', { config: { difficulty: 'hard' } } as never);
    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
  });

  it('rejects configuring an active round → NOT_IN_CONFIGURABLE_PHASE', async () => {
    const ack = await createSession(facilitator);
    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...seeded, status: 'active' });

    const errorPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_CONFIGURE', { config: fullConfig });
    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_CONFIGURABLE_PHASE');
  });

  it('allows configuring between rounds', async () => {
    const ack = await createSession(facilitator);
    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), { ...seeded, status: 'between-rounds' });

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_CONFIGURE', { config: fullConfig });
    const state = await statePromise;
    expect(state.config).toEqual(fullConfig);
  });

  it('idempotent: re-asserting the current config does not re-broadcast', async () => {
    const ack = await createSession(facilitator);
    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;

    const facSpy = jest.fn();
    facilitator.on('SESSION_STATE', facSpy);
    // Re-send the existing config verbatim (DEFAULT_ROUND_CONFIG, modifiers complete).
    facilitator.emit('ROUND_CONFIGURE', { config: seeded.config });
    // Give the server a tick; no broadcast should arrive.
    await new Promise((r) => setTimeout(r, 30));
    expect(facSpy).not.toHaveBeenCalled();
  });
});

describe('Relay orchestration — Model B sequential play (Story 8.11)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let scheduler: TestScheduler;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;
  let devon: TestClientSocket;
  let ana: TestClientSocket;
  let bo: TestClientSocket;

  const TIMER_MS = 2_000;
  let clock = 0;

  beforeEach(async () => {
    clock = 0;
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) => {
      scheduler = createTestScheduler({ redis: store, io, log: noopLog });
      registerSessionHandlers(io, { redis: store, log: noopLog, timer: scheduler, archive: fakeArchive });
    });
    facilitator = await server.connectClient();
    maya = await server.connectClient();
    devon = await server.connectClient();
    ana = await server.connectClient();
    bo = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  function onceEvent<T>(socket: TestClientSocket, event: string): Promise<T> {
    return new Promise<T>((resolve) => {
      socket.once(event as 'SESSION_STATE', ((payload: T) => resolve(payload)) as never);
    });
  }

  /** Join a socket and assign to a team, draining the facilitator's broadcasts. */
  async function joinAssign(
    socket: TestClientSocket,
    joinCode: string,
    name: string,
    teamId: 'A' | 'B',
  ): Promise<string> {
    const joined = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName: name, role: 'expert' });
    const state = await joined;
    const id = idOf(state, name);
    const facBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: id, teamId, role: 'expert' });
    await facBc;
    return id;
  }

  /** Facilitator advances (open prep) → returns the new preparation state. */
  async function openPrep(): Promise<SessionState> {
    const facBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('PREPARATION_OPEN');
    return facBc;
  }

  /** Start the round → returns the active session state. */
  async function startRoundNow(): Promise<SessionState> {
    const facBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    return facBc;
  }

  /** Expire the active team's timer → drives the resolution + between-rounds entry. */
  async function expireActive(sessionId: string, teamId: 'A' | 'B'): Promise<void> {
    clock += TIMER_MS + 1;
    scheduler.setNow(clock);
    const scoreboard = onceEvent<unknown>(facilitator, 'SCOREBOARD');
    await scheduler.fireNow(sessionId, teamId);
    await scoreboard;
  }

  it('equal 2v2 snake: A,B,B,A — exactly one team armed each round; layout shared per pair; relay completes', async () => {
    const ack = await createSession(facilitator, { config: { timerMs: TIMER_MS } });
    const mayaId = await joinAssign(maya, ack.joinCode, 'Maya', 'A');
    const devonId = await joinAssign(devon, ack.joinCode, 'Devon', 'A');
    const anaId = await joinAssign(ana, ack.joinCode, 'Ana', 'B');
    const boId = await joinAssign(bo, ack.joinCode, 'Bo', 'B');
    const sessionId = ack.sessionId;

    // ── Round 1: pair 1, first turn → Team A (Maya). Only A armed. ──────────────
    let prep = await openPrep();
    expect(prep.activeTeamId).toBe('A');
    const r1Bomb = onceEvent<BombState>(maya, 'BOMB_INIT');
    await startRoundNow();
    const bombR1 = await r1Bomb;
    let round = JSON.parse(store.data.get(roundKey(sessionId, 1))!) as RoundState;
    expect(round.defusers).toEqual({ A: mayaId }); // single active team
    // Only Team A has a bomb + live timer; Team B rests (no keys).
    expect(store.data.has(bombKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(timerKey(sessionId, 'B'))).toBe(false);
    await expireActive(sessionId, 'A');

    // ── Round 2: pair 1, second turn → Team B (Ana). Shares R1's layout. ───────
    prep = await openPrep();
    expect(prep.activeTeamId).toBe('B');
    const r2Bomb = onceEvent<BombState>(ana, 'BOMB_INIT');
    await startRoundNow();
    const bombR2 = await r2Bomb;
    round = JSON.parse(store.data.get(roundKey(sessionId, 2))!) as RoundState;
    expect(round.defusers).toEqual({ B: anaId });
    // IDENTICAL layout (same pairIndex) but INDEPENDENT values (deriveTeamSeed).
    expect(bombR2.modules.map((m) => m.moduleId)).toEqual(bombR1.modules.map((m) => m.moduleId));
    expect(JSON.stringify(bombR2.modules)).not.toEqual(JSON.stringify(bombR1.modules));
    await expireActive(sessionId, 'B');

    // ── Round 3: pair 2, first turn → Team B (Bo). ─────────────────────────────
    prep = await openPrep();
    expect(prep.activeTeamId).toBe('B');
    const r3Bomb = onceEvent<BombState>(bo, 'BOMB_INIT');
    await startRoundNow();
    const bombR3 = await r3Bomb;
    round = JSON.parse(store.data.get(roundKey(sessionId, 3))!) as RoundState;
    expect(round.defusers).toEqual({ B: boId });
    // Pair 2 layout differs from pair 1.
    expect(bombR3.modules.map((m) => m.moduleId)).not.toEqual(bombR1.modules.map((m) => m.moduleId));
    await expireActive(sessionId, 'B');

    // ── Round 4: pair 2, second turn → Team A (Devon). Shares R3's layout. ──────
    prep = await openPrep();
    expect(prep.activeTeamId).toBe('A');
    const r4Bomb = onceEvent<BombState>(devon, 'BOMB_INIT');
    await startRoundNow();
    const bombR4 = await r4Bomb;
    round = JSON.parse(store.data.get(roundKey(sessionId, 4))!) as RoundState;
    expect(round.defusers).toEqual({ A: devonId });
    expect(bombR4.modules.map((m) => m.moduleId)).toEqual(bombR3.modules.map((m) => m.moduleId));
    await expireActive(sessionId, 'A');

    // Every player defused exactly once; the next advance is refused RELAY_COMPLETE.
    const stored = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(stored.teams.A!.currentDefuserIndex).toBe(2);
    expect(stored.teams.B!.currentDefuserIndex).toBe(2);
    const errP = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    expect((await errP).code).toBe('RELAY_COMPLETE');
  });

  /**
   * Seed a between-rounds 3v2 relay (A=[a0,a1,a2], B=[b0,b1]) with synthetic team
   * rosters at the given pointer state. Both teams are ≥2 (the min size), so this
   * is a valid odd-team relay (B owes 1 equalisation). The real `facilitator`
   * socket drives the facilitator actions; team players need only exist on the
   * roster (TEAM_ASSIGN + the defuser pick resolve by playerId, not socket).
   */
  async function seedOddRelay(patch: {
    roundNumber: number;
    aIndex: number;
    bIndex: number;
    bPlayed?: number;
  }): Promise<string> {
    const ack = await createSession(facilitator, { config: { timerMs: TIMER_MS } });
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    const mk = (id: string, teamId: 'A' | 'B') => ({
      playerId: id,
      displayName: id,
      role: 'expert' as const,
      teamId,
      isReady: true,
    });
    const players = {
      ...live.players,
      a0: mk('a0', 'A'), a1: mk('a1', 'A'), a2: mk('a2', 'A'),
      b0: mk('b0', 'B'), b1: mk('b1', 'B'),
    };
    const seeded: SessionState = {
      ...live,
      status: 'between-rounds',
      roundNumber: patch.roundNumber,
      players,
      teams: {
        A: { teamId: 'A', relayOrder: ['a0', 'a1', 'a2'], currentDefuserIndex: patch.aIndex, cumulativeTimeMs: 0, roundTimesMs: [], roundOutcomes: [], equalisationRoundsPlayed: 0 },
        B: { teamId: 'B', relayOrder: ['b0', 'b1'], currentDefuserIndex: patch.bIndex, cumulativeTimeMs: 0, roundTimesMs: [], roundOutcomes: [], equalisationRoundsPlayed: patch.bPlayed ?? 0 },
      },
    };
    await store.setJSON(sessionKey(ack.sessionId), seeded);
    return ack.sessionId;
  }

  it('odd 3v2: the snake routes B into an equalisation round with the Facilitator volunteer; A rests', async () => {
    // After 5 turns (A,B,B,A,A) both naturals are exhausted (A index 3, B index 2);
    // the snake's 6th turn (pair 3, second turn) is B's owed equalisation round.
    const sessionId = await seedOddRelay({ roundNumber: 5, aIndex: 3, bIndex: 2 });

    const prep = await openPrep();
    expect(prep.activeTeamId).toBe('B'); // equalisation turn for B
    expect(prep.roundNumber).toBe(6);

    // No volunteer yet → ROUND_START refuses (the server never auto-picks).
    const errP = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_START');
    expect((await errP).code).toBe('EQUALISATION_VOLUNTEER_REQUIRED');

    // Designate b0 (TEAM_ASSIGN), then start the equalisation round → only B armed.
    const designated = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: 'b0', teamId: 'B', role: 'defuser' });
    expect((await designated).teams.B!.equalisationVolunteerId).toBe('b0');
    await startRoundNow();
    const round = JSON.parse(store.data.get(roundKey(sessionId, 6))!) as RoundState;
    expect(round.defusers).toEqual({ B: 'b0' }); // A rests

    // The equalisation bump + volunteer clear happen at RESOLVE (Model B single site).
    await expireActive(sessionId, 'B');
    const stored = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(stored.teams.B!.equalisationRoundsPlayed).toBe(1);
    expect(stored.teams.B!.equalisationVolunteerId).toBeUndefined();

    // Both teams now on the same count (3) → the advance is refused RELAY_COMPLETE.
    const errP2 = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    expect((await errP2).code).toBe('RELAY_COMPLETE');
  });

  it('TEAM_ASSIGN volunteer refuses a team that owes nothing / an off-team player', async () => {
    const sessionId = await seedOddRelay({ roundNumber: 5, aIndex: 3, bIndex: 2 });

    // Team A owes no equalisation round.
    let err = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: 'a0', teamId: 'A', role: 'defuser' });
    expect((await err).code).toBe('NO_EQUALISATION_ROUND');

    // a0 is not on Team B (off-team volunteer).
    err = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('TEAM_ASSIGN', { playerId: 'a0', teamId: 'B', role: 'defuser' });
    expect((await err).code).toBe('INVALID_VOLUNTEER');
    expect(sessionId).toBeDefined();
  });

  it('relay-complete: the advance is refused RELAY_COMPLETE and is a pure no-op', async () => {
    // A,B,B,A,A then B's equalisation all played → everyone defused.
    const sessionId = await seedOddRelay({ roundNumber: 6, aIndex: 3, bIndex: 2, bPlayed: 1 });
    const storedBefore = store.data.get(sessionKey(sessionId));

    const errP = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('PREPARATION_OPEN');
    expect((await errP).code).toBe('RELAY_COMPLETE');
    // Refusal does NOT silently wrap the rotation.
    expect(store.data.get(sessionKey(sessionId))).toBe(storedBefore);
  });

  it('a non-facilitator advance at relay-complete is still NOT_FACILITATOR (authority before completeness)', async () => {
    // Maya joins (a real non-facilitator socket), then seed a relay-complete state
    // that preserves her on the roster so the authority gate fires before completeness.
    const ack = await createSession(facilitator, { config: { timerMs: TIMER_MS } });
    await joinAssign(maya, ack.joinCode, 'Maya', 'A');
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    await store.setJSON(sessionKey(ack.sessionId), {
      ...live,
      status: 'between-rounds',
      roundNumber: 1,
      teams: {
        A: { ...live.teams.A!, currentDefuserIndex: live.teams.A!.relayOrder.length },
      },
    });

    const errorPromise = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('PREPARATION_OPEN');
    expect((await errorPromise).code).toBe('NOT_FACILITATOR');
  });
});

describe('Retry a failed round (Story 8.8)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;
  let devon: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      }),
    );
    facilitator = await server.connectClient();
    maya = await server.connectClient();
    devon = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  async function joinAssign(socket: TestClientSocket, joinCode: string, name: string, teamId: 'A' | 'B'): Promise<void> {
    const joined = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName: name, role: 'expert' });
    const state = await joined;
    const facBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(state, name), teamId, role: 'expert' });
    await facBc;
  }

  /**
   * Run round 1 to active (capturing each team's generated bomb), then seed the
   * post-resolution between-rounds snapshot: Team A FAILED (time-expired,
   * 300s recorded), Team B DEFUSED (20s recorded). roundNumber stays 1.
   */
  async function setupFailedRoundOne(): Promise<{
    sessionId: string;
    mayaId: string;
    devonId: string;
    bombA: BombState;
  }> {
    const ack = await createSession(facilitator);
    await joinAssign(maya, ack.joinCode, 'Maya', 'A');
    await joinAssign(devon, ack.joinCode, 'Devon', 'B');
    const seeded = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    const mayaId = idOf(seeded, 'Maya');
    const devonId = idOf(seeded, 'Devon');

    // Pad each 1-player team to the min size of 2 (Story 8.9 guard) — synthetic
    // socketless Experts; the Defusers (Maya/Devon) and team rooms are unchanged.
    await padTeamsToMinSize(store, ack.sessionId);

    let bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('PREPARATION_OPEN');
    await bc;
    bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    await bc;

    // The bomb generated for Team A this round (the artefact a retry must reproduce).
    const bombA = JSON.parse(store.data.get(bombKey(ack.sessionId, 'A'))!) as BombState;

    // Seed the between-rounds snapshot a real resolution would leave: A failed,
    // B defused; roundNumber unchanged at 1; the live timer keys cleared.
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    store.data.set(
      sessionKey(ack.sessionId),
      JSON.stringify({
        ...live,
        status: 'between-rounds',
        roundNumber: 1,
        teams: {
          A: { ...live.teams.A!, cumulativeTimeMs: 300_000, roundTimesMs: [300_000] },
          B: { ...live.teams.B!, cumulativeTimeMs: 20_000, roundTimesMs: [20_000] },
        },
      }),
    );
    const round = JSON.parse(store.data.get(roundKey(ack.sessionId, 1))!) as RoundState;
    store.data.set(
      roundKey(ack.sessionId, 1),
      JSON.stringify({ ...round, status: 'time-expired', outcomes: { A: 'time-expired', B: 'defused' } }),
    );
    await store.del(timerKey(ack.sessionId, 'A'));
    await store.del(timerKey(ack.sessionId, 'B'));

    return { sessionId: ack.sessionId, mayaId, devonId, bombA };
  }

  it('retry of a FAILED team re-enters preparation at the SAME roundNumber with retryingTeamId set', async () => {
    const { sessionId } = await setupFailedRoundOne();

    const bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_RETRY', { teamId: 'A' });
    const state = await bc;

    expect(state.status).toBe('preparation');
    expect(state.retryingTeamId).toBe('A');
    expect(state.roundNumber).toBe(1); // SAME round
  });

  it('the retry ROUND_START regenerates the IDENTICAL bomb and arms only the retried team', async () => {
    const { sessionId, mayaId, bombA } = await setupFailedRoundOne();

    let bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_RETRY', { teamId: 'A' });
    await bc;
    bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    const active = await bc;

    // The retrying team is the ACTIVE team — so the client routes ONLY Team B to
    // the resting surface (not both teams). activeTeamId must survive the retry
    // ROUND_START, else every team reads as resting.
    expect(active.activeTeamId).toBe('A');

    // Bit-for-bit identical bomb (same roundNumber → same seeds) — AC-1.
    const bombARetry = JSON.parse(store.data.get(bombKey(sessionId, 'A'))!) as BombState;
    expect(bombARetry).toEqual(bombA);

    // Only Team A is armed; Team B rests (absent from defusers), retry: true.
    const round = JSON.parse(store.data.get(roundKey(sessionId, 1))!) as RoundState;
    expect(round.defusers).toEqual({ A: mayaId });
    expect(round.retry).toBe(true);
    // Resting team B has no live timer; Team A does.
    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(timerKey(sessionId, 'B'))).toBe(false);
  });

  it('retry of a DEFUSED team → ROUND_NOT_FAILED, store byte-identical', async () => {
    const { sessionId } = await setupFailedRoundOne();
    const before = store.data.get(sessionKey(sessionId));

    const err = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_RETRY', { teamId: 'B' }); // B defused
    expect((await err).code).toBe('ROUND_NOT_FAILED');
    expect(store.data.get(sessionKey(sessionId))).toBe(before);
  });

  it('a non-facilitator retry → NOT_FACILITATOR before any round load, store byte-identical', async () => {
    const { sessionId } = await setupFailedRoundOne();
    const before = store.data.get(sessionKey(sessionId));

    const err = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('ROUND_RETRY', { teamId: 'A' });
    expect((await err).code).toBe('NOT_FACILITATOR');
    expect(store.data.get(sessionKey(sessionId))).toBe(before);
  });

  it('retry outside between-rounds → CANNOT_RETRY', async () => {
    const { sessionId } = await setupFailedRoundOne();
    // Flip back to active to violate the phase guard.
    const live = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    store.data.set(sessionKey(sessionId), JSON.stringify({ ...live, status: 'active' }));

    const err = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_RETRY', { teamId: 'A' });
    expect((await err).code).toBe('CANNOT_RETRY');
  });

  it('invalid teamId → INVALID_PAYLOAD', async () => {
    await setupFailedRoundOne();
    const err = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('ROUND_RETRY', { teamId: 'Z' } as unknown as { teamId: 'A' | 'B' });
    expect((await err).code).toBe('INVALID_PAYLOAD');
  });
});

describe('Pause — facilitator & disconnect (Story 8.7)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
        disconnectGraceMs: 500,
      }),
    );
    facilitator = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function nextIdentity(socket: TestClientSocket): Promise<SessionIdentityPayload> {
    return new Promise((resolve) => socket.once('SESSION_IDENTITY', (p) => resolve(p)));
  }
  async function createWithIdentity(): Promise<{ ack: SessionCreatedPayload; identity: SessionIdentityPayload }> {
    const idPromise = nextIdentity(facilitator);
    const ack = await createSession(facilitator);
    return { ack, identity: await idPromise };
  }
  async function joinWithIdentity(
    joinCode: string,
    displayName: string,
  ): Promise<{ socket: TestClientSocket; identity: SessionIdentityPayload }> {
    const socket = await server.connectClient();
    const idPromise = nextIdentity(socket);
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    const facBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    const [identity] = await Promise.all([idPromise, statePromise, facBc]);
    return { socket, identity };
  }
  async function assign(playerId: string, teamId: 'A' | 'B'): Promise<void> {
    const bc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('TEAM_ASSIGN', { playerId, teamId, role: 'defuser' });
    await bc;
  }

  const runningTimer = (): TimerState => ({
    startedAt: 0,
    remainingAtStart: 300_000,
    speedMultiplier: 1,
    pausedAt: null,
  });

  /** Overwrite the live session to a patched snapshot (active by default). */
  function seed(sessionId: string, patch: Partial<SessionState>): SessionState {
    const live = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    const next = { ...live, status: 'active' as const, roundNumber: 1, ...patch };
    store.data.set(sessionKey(sessionId), JSON.stringify(next));
    return next;
  }

  it('FACILITATOR_PAUSE in an active round freezes the live timer (key kept) and broadcasts PAUSED', async () => {
    const { ack } = await createWithIdentity();
    const { identity: maya } = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.playerId, 'A');
    seed(ack.sessionId, {});
    await store.setJSON(timerKey(ack.sessionId, 'A'), runningTimer());

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const pausedPromise = new Promise((r) => facilitator.once('PAUSED', r as never));
    facilitator.emit('FACILITATOR_PAUSE');
    const state = await statePromise;
    await pausedPromise;

    expect(state.pausedAt).not.toBeNull();
    expect(state.pauseKind).toBe('facilitator');
    const timer = JSON.parse(store.data.get(timerKey(ack.sessionId, 'A'))!) as TimerState;
    expect(timer.pausedAt).not.toBeNull(); // frozen
    expect(store.data.get(timerKey(ack.sessionId, 'A'))).toBeDefined(); // NOT deleted
  });

  it('FACILITATOR_PAUSE between rounds sets the flag with no live timer', async () => {
    const { ack } = await createWithIdentity();
    const { identity: maya } = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.playerId, 'A');
    seed(ack.sessionId, { status: 'between-rounds' });

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('FACILITATOR_PAUSE');
    const state = await statePromise;
    expect(state.pausedAt).not.toBeNull();
    expect(state.pauseKind).toBe('facilitator');
    expect(state.status).toBe('between-rounds'); // status untouched (orthogonal)
  });

  it('a non-facilitator pause → NOT_FACILITATOR, store byte-identical', async () => {
    const { ack } = await createWithIdentity();
    const maya = await joinWithIdentity(ack.joinCode, 'Maya');
    seed(ack.sessionId, {});
    const before = store.data.get(sessionKey(ack.sessionId));
    const errorPromise = nextEvent<ErrorPayload>(maya.socket, 'ERROR');
    maya.socket.emit('FACILITATOR_PAUSE');
    expect((await errorPromise).code).toBe('NOT_FACILITATOR');
    expect(store.data.get(sessionKey(ack.sessionId))).toBe(before);
  });

  it('a facilitator-kind pause resumes freely and re-arms the timer', async () => {
    const { ack } = await createWithIdentity();
    const { identity: maya } = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.playerId, 'A');
    seed(ack.sessionId, { pausedAt: 100, pauseKind: 'facilitator' });
    await store.setJSON(timerKey(ack.sessionId, 'A'), { ...runningTimer(), pausedAt: 100 });

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('FACILITATOR_RESUME');
    const state = await statePromise;
    expect(state.pausedAt).toBeNull();
    const timer = JSON.parse(store.data.get(timerKey(ack.sessionId, 'A'))!) as TimerState;
    expect(timer.pausedAt).toBeNull(); // resumed
  });

  it('a disconnect-kind pause refuses resume until all participants are ready', async () => {
    const { ack } = await createWithIdentity();
    const { socket: mayaSock, identity: maya } = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.playerId, 'A');
    // Seed a disconnect pause with Maya NOT ready.
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    store.data.set(
      sessionKey(ack.sessionId),
      JSON.stringify({
        ...live,
        status: 'active',
        roundNumber: 1,
        pausedAt: 100,
        pauseKind: 'disconnect',
        disconnectedPlayerIds: [],
        players: { ...live.players, [maya.playerId]: { ...live.players[maya.playerId], isReady: false } },
      }),
    );

    const errPromise = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('FACILITATOR_RESUME');
    expect((await errPromise).code).toBe('PLAYERS_NOT_READY');

    // Maya readies up (PLAYER_READY widened to the disconnect-paused phase, Task 7).
    const readyBc = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    mayaSock.emit('PLAYER_READY', { isReady: true });
    const readied = await readyBc;
    expect(readied.players[maya.playerId]!.isReady).toBe(true);

    // Now resume succeeds.
    const okPromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('FACILITATOR_RESUME');
    const resumed = await okPromise;
    expect(resumed.pausedAt).toBeNull();
  });

  it('a mid-round participant disconnect auto-pauses the round (amber/who-dropped)', async () => {
    const { ack } = await createWithIdentity();
    const maya = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.identity.playerId, 'A');
    seed(ack.sessionId, {});
    await store.setJSON(timerKey(ack.sessionId, 'A'), runningTimer());

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    maya.socket.disconnect();
    const state = await statePromise;
    expect(state.pausedAt).not.toBeNull();
    expect(state.pauseKind).toBe('disconnect');
    expect(state.disconnectedPlayerIds).toContain(maya.identity.playerId);
    const timer = JSON.parse(store.data.get(timerKey(ack.sessionId, 'A'))!) as TimerState;
    expect(timer.pausedAt).not.toBeNull(); // clock frozen, key kept
  });

  it('a reconnecting mid-round participant is re-sent BOMB_INIT and cleared from the dropped list', async () => {
    const { ack } = await createWithIdentity();
    const maya = await joinWithIdentity(ack.joinCode, 'Maya');
    await assign(maya.identity.playerId, 'A');
    // Seed active+paused-disconnect with Maya dropped, and a stored bomb for Team A.
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    store.data.set(
      sessionKey(ack.sessionId),
      JSON.stringify({
        ...live,
        status: 'active',
        roundNumber: 1,
        pausedAt: 100,
        pauseKind: 'disconnect',
        disconnectedPlayerIds: [maya.identity.playerId],
      }),
    );
    await store.setJSON(bombKey(ack.sessionId, 'A'), { modules: [], strikes: 0 } as never);
    maya.socket.disconnect();

    // The restore broadcasts a cleared SESSION_STATE to the room — assert via the
    // facilitator (reliable, no listener-attach race), and confirm Maya's reconnect
    // socket lands in Team A's room (proves the team-room re-join half of FR13).
    const facCleared = new Promise<SessionState>((resolve) => {
      const onState = (s: SessionState) => {
        if (!s.disconnectedPlayerIds.includes(maya.identity.playerId)) {
          facilitator.off('SESSION_STATE', onState);
          resolve(s);
        }
      };
      facilitator.on('SESSION_STATE', onState);
    });
    const reconnect = await server.connectClient({
      sessionId: ack.sessionId,
      reattachToken: maya.identity.reattachToken,
    });
    const after = await facCleared;
    expect(after.disconnectedPlayerIds).not.toContain(maya.identity.playerId);
    expect(after.pausedAt).not.toBeNull(); // STILL paused — facilitator resumes

    const teamA = await server.io.in(teamRoom(ack.sessionId, 'A')).fetchSockets();
    expect(teamA.map((s) => s.data.playerId)).toContain(maya.identity.playerId);
    expect(reconnect.connected).toBe(true);
  });
});

describe('SESSION_END handler (Story 8.10)', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let archive: SpyArchive;
  let facilitator: TestClientSocket;
  let maya: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    archive = createSpyArchive();
    server = await startTestSocketServer((io) =>
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive,
      }),
    );
    facilitator = await server.connectClient();
    maya = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  function idOf(state: SessionState, displayName: string): string {
    return Object.values(state.players).find((p) => p.displayName === displayName)!.playerId;
  }

  function nextScoreboard(socket: TestClientSocket): Promise<{ winnerTeamId?: TeamId }> {
    return new Promise((resolve) => socket.once('SCOREBOARD', ((p: { winnerTeamId?: TeamId }) => resolve(p)) as never));
  }

  /** Overwrite a session into a between-rounds snapshot. Relay-complete unless
   * `aIndex` leaves Team A a natural slot. A finished faster than B (A wins). */
  async function makeBetween(sessionId: string, { aIndex = 2 }: { aIndex?: number } = {}): Promise<void> {
    const live = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    const next: SessionState = {
      ...live,
      status: 'between-rounds',
      roundNumber: 4,
      teams: {
        A: {
          teamId: 'A',
          relayOrder: ['a0', 'a1'],
          currentDefuserIndex: aIndex,
          cumulativeTimeMs: 80_000,
          roundTimesMs: [40_000, 40_000],
          roundOutcomes: ['defused', 'defused'],
          equalisationRoundsPlayed: 0,
        },
        B: {
          teamId: 'B',
          relayOrder: ['b0', 'b1'],
          currentDefuserIndex: 2,
          cumulativeTimeMs: 120_000,
          roundTimesMs: [60_000, 60_000],
          roundOutcomes: ['defused', 'exploded'],
          equalisationRoundsPlayed: 0,
        },
      },
    };
    await store.setJSON(sessionKey(sessionId), next);
  }

  async function seedComplete(): Promise<string> {
    const ack = await createSession(facilitator, { config: { timerMs: 300_000 } });
    await makeBetween(ack.sessionId);
    return ack.sessionId;
  }

  it('archives once + flips to ended + broadcasts the final scoreboard (winner = lowest cumulative)', async () => {
    const sessionId = await seedComplete();
    expect(archive.archived).toHaveLength(0); // NOTHING written during play

    const stateP = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const scoreP = nextScoreboard(facilitator);
    facilitator.emit('SESSION_END');

    const ended = await stateP;
    expect(ended.status).toBe('ended');
    expect(ended.activeTeamId).toBeUndefined();
    expect((await scoreP).winnerTeamId).toBe('A');

    // Exactly one archive write, carrying the authoritative winner + per-round breakdown.
    expect(archive.archived).toHaveLength(1);
    const rec = archive.archived[0]!;
    expect(rec.sessionId).toBe(sessionId);
    expect(rec.winnerTeamId).toBe('A');
    expect(rec.roundCount).toBe(4);
    const teamB = rec.teams.find((t) => t.teamId === 'B')!;
    expect(teamB.rounds).toEqual([
      { roundIndex: 0, elapsedMs: 60_000, outcome: 'defused' },
      { roundIndex: 1, elapsedMs: 60_000, outcome: 'exploded' },
    ]);
    // Redis reflects the ended status.
    expect((JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState).status).toBe('ended');
  });

  it('integer-coerces fractional ms in the archive record (the INTEGER columns reject floats)', async () => {
    const ack = await createSession(facilitator, { config: { timerMs: 300_000 } });
    const live = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    // A session that accumulated sub-ms drift before the resolveRound rounding fix.
    await store.setJSON(sessionKey(ack.sessionId), {
      ...live,
      status: 'between-rounds',
      roundNumber: 2,
      teams: {
        A: { teamId: 'A', relayOrder: ['a0', 'a1'], currentDefuserIndex: 2, cumulativeTimeMs: 52_543.5, roundTimesMs: [40_000.25, 12_543.25], roundOutcomes: ['defused', 'defused'], equalisationRoundsPlayed: 0 },
        B: { teamId: 'B', relayOrder: ['b0', 'b1'], currentDefuserIndex: 2, cumulativeTimeMs: 120_000, roundTimesMs: [60_000, 60_000], roundOutcomes: ['defused', 'defused'], equalisationRoundsPlayed: 0 },
      },
    });

    const stateP = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('SESSION_END');
    expect((await stateP).status).toBe('ended');

    expect(archive.archived).toHaveLength(1);
    const teamA = archive.archived[0]!.teams.find((t) => t.teamId === 'A')!;
    expect(Number.isInteger(teamA.cumulativeTimeMs)).toBe(true);
    expect(teamA.rounds.every((r) => Number.isInteger(r.elapsedMs))).toBe(true);
  });

  it('a non-facilitator SESSION_END is refused NOT_FACILITATOR and writes nothing', async () => {
    const ack = await createSession(facilitator, { config: { timerMs: 300_000 } });
    const joined = nextEvent<SessionState>(maya, 'SESSION_STATE');
    maya.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    await joined;
    await makeBetween(ack.sessionId);

    const errP = nextEvent<ErrorPayload>(maya, 'ERROR');
    maya.emit('SESSION_END');
    expect((await errP).code).toBe('NOT_FACILITATOR');
    expect(archive.archived).toHaveLength(0);
  });

  it('SESSION_END on an INCOMPLETE relay is refused RELAY_NOT_COMPLETE and writes nothing', async () => {
    const ack = await createSession(facilitator, { config: { timerMs: 300_000 } });
    await makeBetween(ack.sessionId, { aIndex: 1 }); // Team A still owes a natural round

    const errP = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('SESSION_END');
    expect((await errP).code).toBe('RELAY_NOT_COMPLETE');
    expect(archive.archived).toHaveLength(0);
    expect((JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState).status).toBe('between-rounds');
  });

  it('an archive failure surfaces SESSION_END_FAILED and leaves the session between-rounds (no half-end)', async () => {
    const sessionId = await seedComplete();
    archive.failNext = true;

    const errP = nextEvent<ErrorPayload>(facilitator, 'ERROR');
    facilitator.emit('SESSION_END');
    expect((await errP).code).toBe('SESSION_END_FAILED');
    expect(archive.archived).toHaveLength(0); // the failed write recorded nothing
    expect((JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState).status).toBe('between-rounds');
  });

  it('SESSION_END on an already-ended session is an idempotent no-op (no second archive)', async () => {
    const sessionId = await seedComplete();
    // First end → archives + flips.
    const firstP = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('SESSION_END');
    await firstP;
    expect(archive.archived).toHaveLength(1);

    // Second end → silent no-op; no error, no second archive.
    facilitator.emit('SESSION_END');
    await new Promise((r) => setTimeout(r, 30));
    expect(archive.archived).toHaveLength(1);
    expect((JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState).status).toBe('ended');
  });
});
