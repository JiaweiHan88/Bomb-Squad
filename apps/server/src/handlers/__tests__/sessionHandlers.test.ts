import { jest } from '@jest/globals';
import type {
  SessionState,
  SessionCreatePayload,
  SessionCreatedPayload,
  ErrorPayload,
} from '@bomb-squad/shared';
import { registerSessionHandlers, parseSessionCreatePayload } from '../sessionHandlers.js';
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
