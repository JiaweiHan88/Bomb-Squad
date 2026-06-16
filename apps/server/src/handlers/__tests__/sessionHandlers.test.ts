import { jest } from '@jest/globals';
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
        A: { teamId: 'A', relayOrder: ['sock-d1'], currentDefuserIndex: 0, cumulativeTimeMs: 12_000, roundTimesMs: [12_000] },
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

  /** Create a session, join Maya, assign her to Team A — all broadcasts drained. */
  async function sessionWithTeam(): Promise<{ sessionId: string; joinCode: string }> {
    const ack = await createSession(facilitator);
    let bc = everyone();
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    const [, joined] = await bc;
    bc = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(joined, 'Maya'), teamId: 'A', role: 'expert' });
    await bc;
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

  /** Create a session, join + team-assign Maya, then open prep. Returns the ack. */
  async function openedPrep(): Promise<{ sessionId: string; joinCode: string }> {
    const ack = await createSession(facilitator);
    let bc = everyone();
    joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
    const [, joined] = await bc;
    bc = everyone();
    facilitator.emit('TEAM_ASSIGN', { playerId: idOf(joined, 'Maya'), teamId: 'A', role: 'expert' });
    await bc;
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
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;
    return { sessionId: ack.sessionId, mayaId, devonId };
  }

  it('happy path: activates the round, commits rotation picks, persists RoundState, joins team rooms', async () => {
    const { sessionId, mayaId, devonId } = await setupPrepared();

    const facStatePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    const mayaStatePromise = nextEvent<SessionState>(maya, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    const [facState, mayaState] = await Promise.all([facStatePromise, mayaStatePromise]);

    for (const state of [facState, mayaState]) {
      expect(state.status).toBe('active');
      expect(state.players[mayaId]).toMatchObject({ role: 'defuser', teamId: 'A' });
      expect(state.players[devonId]).toMatchObject({ role: 'defuser', teamId: 'B' });
      expect(Object.values(state.players).find((p) => p.role === 'facilitator')).toBeDefined();
    }

    const round = JSON.parse(store.data.get(roundKey(sessionId, 1))!) as RoundState;
    expect(round).toEqual({
      roundNumber: 1,
      status: 'active',
      defusers: { A: mayaId, B: devonId },
      retry: false,
    });

    const teamA = await server.io.in(teamRoom(sessionId, 'A')).fetchSockets();
    const teamB = await server.io.in(teamRoom(sessionId, 'B')).fetchSockets();
    // Story 2.7: team-room membership resolves by the durable playerId, not socket.id.
    expect(teamA.map((s) => s.data.playerId)).toEqual([mayaId]);
    expect(teamB.map((s) => s.data.playerId)).toEqual([devonId]);
  });

  it('between-rounds advance → ROUND_START commits the NEXT rotation Defuser (AC-3 end-to-end)', async () => {
    // Two players relay on Team A. After the facilitator's between-rounds advance
    // (PREPARATION_OPEN → currentDefuserIndex +1), the next ROUND_START must
    // commit relayOrder[1], not round 1's relayOrder[0] pick — proving the
    // rotation moved end-to-end through the handler, not just the openPreparation
    // unit. The expected picks are derived from the committed relayOrder so the
    // assertion is robust to assignment ordering.
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

    // Flip into between-rounds at round 1, index 0 — as the resolution ceremony
    // leaves the session after round 1 completes.
    await store.setJSON(sessionKey(ack.sessionId), {
      ...seeded,
      status: 'between-rounds',
      roundNumber: 1,
      teams: {
        ...seeded.teams,
        A: { ...seeded.teams.A!, currentDefuserIndex: 0, cumulativeTimeMs: 9_000, roundTimesMs: [9_000] },
      },
    });

    // Facilitator advances → preparation, roundNumber 2, index +1.
    done = everyone();
    facilitator.emit('PREPARATION_OPEN');
    await done;
    const advanced = JSON.parse(store.data.get(sessionKey(ack.sessionId))!) as SessionState;
    expect(advanced.status).toBe('preparation');
    expect(advanced.roundNumber).toBe(2);
    expect(advanced.teams.A!.currentDefuserIndex).toBe(1);

    // ROUND_START commits the NEXT defuser (relayOrder[1] = devon), not round 1's.
    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    await statePromise;

    const round2 = JSON.parse(store.data.get(roundKey(ack.sessionId, 2))!) as RoundState;
    expect(round2.defusers.A).toBe(relayOrder[1]);
    expect(round2.defusers.A).not.toBe(relayOrder[0]);
  });

  it('generates + persists a bomb per populated team and broadcasts BOMB_INIT to each team room (Story 4.7)', async () => {
    const { sessionId } = await setupPrepared();

    const mayaBomb = new Promise<BombState>((res) => maya.once('BOMB_INIT', (b) => res(b as BombState)));
    const devonBomb = new Promise<BombState>((res) => devon.once('BOMB_INIT', (b) => res(b as BombState)));
    // The bomb is team-private: Maya (Team A) must receive exactly one BOMB_INIT
    // (hers), never Team B's.
    const mayaBombSpy = jest.fn();
    maya.on('BOMB_INIT', mayaBombSpy);

    facilitator.emit('ROUND_START');
    const [a, b] = await Promise.all([mayaBomb, devonBomb]);

    // Same shared layout (template seed), distinct team seeds.
    expect(a.modules.length).toBeGreaterThan(0);
    expect(b.modules.length).toBe(a.modules.length);

    // Persisted under each team's private bomb key, matching the broadcast.
    expect(store.data.has(bombKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(bombKey(sessionId, 'B'))).toBe(true);
    const persistedA = JSON.parse(store.data.get(bombKey(sessionId, 'A'))!) as BombState;
    expect(persistedA).toEqual(a);

    await new Promise((r) => setTimeout(r, 100));
    expect(mayaBombSpy).toHaveBeenCalledTimes(1);
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

  it('out-of-range currentDefuserIndex seeded in the store → modulo pick, no throw', async () => {
    const { sessionId, mayaId } = await setupPrepared();
    const stored = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    await store.setJSON(sessionKey(sessionId), {
      ...stored,
      teams: { ...stored.teams, A: { ...stored.teams.A!, currentDefuserIndex: 7 } },
    });

    const statePromise = nextEvent<SessionState>(facilitator, 'SESSION_STATE');
    facilitator.emit('ROUND_START');
    const state = await statePromise;

    // Team A relayOrder = [maya] → 7 % 1 = 0 → Maya still picked.
    expect(state.players[mayaId]).toMatchObject({ role: 'defuser' });
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
      registerSessionHandlers(io, { redis: store, log: noopLog, timer: scheduler });
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

  it('two populated teams → independent timers, each only to its own team room', async () => {
    const { sessionId } = await prep();

    const mayaTimer = onceEvent<TimerState>(maya, 'TIMER_UPDATE');
    const devonTimer = onceEvent<TimerState>(devon, 'TIMER_UPDATE');
    // Maya (Team A) must NOT receive Team B's timer.
    const mayaSawB = jest.fn();
    let mayaCount = 0;
    maya.on('TIMER_UPDATE', () => {
      mayaCount += 1;
      if (mayaCount > 1) mayaSawB();
    });

    facilitator.emit('ROUND_START');
    await Promise.all([mayaTimer, devonTimer]);
    // Give any stray cross-team broadcast a window to (not) arrive.
    await new Promise((r) => setTimeout(r, 150));

    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(true);
    expect(store.data.has(timerKey(sessionId, 'B'))).toBe(true);
    expect(scheduler.armCalls.map((c) => c.teamId).sort()).toEqual(['A', 'B']);
    expect(mayaSawB).not.toHaveBeenCalled();
  });

  it('authoritative expiry: scheduler fire → BOMB_EXPLODED, timerKey cleared, time recorded + status flipped (8.5 ceremony)', async () => {
    const { sessionId } = await prep();

    const started = onceEvent<TimerState>(maya, 'TIMER_UPDATE');
    facilitator.emit('ROUND_START');
    await started;

    const explodedPromise = onceEvent<RoundEndPayloadLike>(maya, 'BOMB_EXPLODED');
    scheduler.setNow(TIMER_MS + 1); // advance the server clock past the deadline
    await scheduler.fireNow(sessionId, 'A');
    const exploded = await explodedPromise;

    expect(exploded).toEqual({ teamId: 'A', elapsedMs: TIMER_MS });
    expect(store.data.has(timerKey(sessionId, 'A'))).toBe(false);
    // Story 8.5: the timeout path runs the full resolution ceremony — records
    // displayed elapsed into cumulativeTimeMs and (Story 8.6) keeps the shared
    // session 'active' because Team B is still playing. Between-rounds entry waits
    // for the LAST team to resolve so B is never routed off its bomb mid-round.
    const afterA = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(afterA.teams.A!.cumulativeTimeMs).toBe(TIMER_MS);
    expect(afterA.teams.A!.roundTimesMs).toEqual([TIMER_MS]);
    expect(afterA.status).toBe('active');

    // Now Team B expires too → last team → between-rounds entry: session flips and
    // a SCOREBOARD preview is broadcast to the whole session (Story 8.6).
    const scoreboardPromise = onceEvent<unknown>(maya, 'SCOREBOARD');
    scheduler.setNow(TIMER_MS + 2);
    await scheduler.fireNow(sessionId, 'B');
    await scoreboardPromise;

    const afterB = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(afterB.teams.B!.cumulativeTimeMs).toBe(TIMER_MS);
    expect(afterB.status).toBe('between-rounds');
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
