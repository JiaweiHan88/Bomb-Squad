import { jest } from '@jest/globals';
import type {
  SessionState,
  SessionCreatePayload,
  SessionCreatedPayload,
  ErrorPayload,
} from '@bomb-squad/shared';
import {
  registerSessionHandlers,
  parseSessionCreatePayload,
  parseSessionJoinPayload,
  MAX_PLAYERS,
} from '../sessionHandlers.js';
import { createSessionState } from '../../session/createSession.js';
import { sessionKey, joinCodeKey } from '../../state/keys.js';
import {
  startTestSocketServer,
  createMemoryRedisStore,
  noopLog,
  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
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
      registerSessionHandlers(io, { redis: store, log: noopLog }),
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
      registerSessionHandlers(io, { redis: store, log: noopLog }),
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
      registerSessionHandlers(io, { redis: store, log: noopLog }),
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
      registerSessionHandlers(io, { redis: store, log: noopLog }),
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
