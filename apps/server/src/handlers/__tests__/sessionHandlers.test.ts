import { jest } from '@jest/globals';
import type {
  SessionState,
  SessionCreatePayload,
  SessionCreatedPayload,
  ErrorPayload,
  RoundState,
  TimerState,
} from '@bomb-squad/shared';
import {
  registerSessionHandlers,
  parseSessionCreatePayload,
  parseSessionJoinPayload,
  parseTeamAssignPayload,
  teamRoom,
  MAX_PLAYERS,
} from '../sessionHandlers.js';
import { createSessionState } from '../../session/createSession.js';
import { sessionKey, joinCodeKey, roundKey, timerKey } from '../../state/keys.js';
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

  it('non-lobby session → SESSION_NOT_JOINABLE', async () => {
    const state = createSessionState({
      sessionId: 'sess-live',
      joinCode: 'LIVE99',
      facilitatorId: 'sock-fac',
    });
    await seedSession({ ...state, status: 'active' });

    const errorPromise = nextEvent<ErrorPayload>(joiner, 'ERROR');
    joiner.emit('SESSION_JOIN', { joinCode: 'LIVE99', displayName: 'Maya', role: 'expert' });
    const error = await errorPromise;
    expect(error.code).toBe('SESSION_NOT_JOINABLE');
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

  it('persist failure → SESSION_JOIN_FAILED to joiner, no broadcast to the room', async () => {
    const ack = await createSession(facilitator);
    // Fail only the join's session write — reads keep working.
    const realSet = store.setJSON.bind(store);
    store.setJSON = async (key, value) => {
      if (key === sessionKey(ack.sessionId)) throw new Error('redis down');
      return realSet(key, value);
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

  /** Join a socket into the session and resolve with that socket's broadcast snapshot. */
  async function joinAs(
    socket: TestClientSocket,
    joinCode: string,
    displayName: string,
    role: 'defuser' | 'expert' | 'spectator',
  ): Promise<SessionState> {
    const statePromise = nextEvent<SessionState>(socket, 'SESSION_STATE');
    socket.emit('SESSION_JOIN', { joinCode, displayName, role });
    return statePromise;
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
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    return statePromise;
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
    socket.emit('SESSION_JOIN', { joinCode, displayName, role: 'expert' });
    return statePromise;
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
    expect(teamA.map((s) => s.id)).toEqual([mayaId]);
    expect(teamB.map((s) => s.id)).toEqual([devonId]);
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

  it('authoritative expiry: scheduler fire → BOMB_EXPLODED, timerKey cleared, status stays active (8.5 fence)', async () => {
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
    // 8.5 fence: 8.4 declares the timeout but does NOT flip session status.
    const session = JSON.parse(store.data.get(sessionKey(sessionId))!) as SessionState;
    expect(session.status).toBe('active');
  });
});

interface RoundEndPayloadLike {
  teamId: 'A' | 'B';
  elapsedMs: number;
}
