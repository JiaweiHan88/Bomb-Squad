import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type {
  ErrorPayload,
  ExpertManualPositionPayload,
  SessionCreatedPayload,
} from '@bomb-squad/shared';
import { registerSessionHandlers } from '../sessionHandlers.js';
import { registerManualHandlers, parseManualNavigatePayload } from '../manualHandlers.js';
import { manualPositionKey } from '../../state/keys.js';
import {
  startTestSocketServer,
  createMemoryRedisStore,
  createTestScheduler,
  noopLog,
  fakeArchive,  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
} from './testSocketServer.js';

/** Promise for the next emission of a server event on a client socket. */
function nextEvent<T>(
  socket: TestClientSocket,
  event: 'EXPERT_MANUAL_POSITION' | 'ERROR',
): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(event, ((payload: T) => resolve(payload)) as never);
  });
}

/** Resolves true if the event fires within ms, false otherwise (absence assert). */
function eventWithin(socket: TestClientSocket, event: 'EXPERT_MANUAL_POSITION', ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    socket.once(event, (() => {
      clearTimeout(timer);
      resolve(true);
    }) as never);
  });
}

function createSession(socket: TestClientSocket): Promise<SessionCreatedPayload> {
  return new Promise((resolve) => {
    socket.emit('SESSION_CREATE', {}, resolve);
  });
}

/** Joins and resolves with the joiner's durable playerId (from SESSION_IDENTITY,
 * Story 2.7) once the post-join SESSION_STATE has also arrived. */
function joinSession(
  socket: TestClientSocket,
  joinCode: string,
  displayName: string,
  role: 'defuser' | 'expert' | 'spectator',
): Promise<string> {
  return new Promise((resolve) => {
    let playerId: string | null = null;
    let gotState = false;
    const maybeDone = () => {
      if (playerId !== null && gotState) resolve(playerId);
    };
    socket.once('SESSION_IDENTITY', (p) => {
      playerId = p.playerId;
      maybeDone();
    });
    socket.once('SESSION_STATE', () => {
      gotState = true;
      maybeDone();
    });
    socket.emit('SESSION_JOIN', { joinCode, displayName, role });
  });
}

describe('parseManualNavigatePayload', () => {
  it('accepts a kebab-case chapterId', () => {
    expect(parseManualNavigatePayload({ chapterId: 'wire-sequences' })).toEqual({
      ok: true,
      chapterId: 'wire-sequences',
    });
  });

  it.each([
    ['null payload', null],
    ['array payload', ['wires']],
    ['missing chapterId', {}],
    ['non-string chapterId', { chapterId: 7 }],
    ['empty chapterId', { chapterId: '' }],
    ['whitespace / illegal characters', { chapterId: 'Wires Module!' }],
    ['oversized chapterId', { chapterId: 'a'.repeat(65) }],
  ])('rejects %s', (_label, payload) => {
    expect(parseManualNavigatePayload(payload).ok).toBe(false);
  });
});

describe('MANUAL_NAVIGATE handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let facilitator: TestClientSocket;

  beforeEach(async () => {
    store = createMemoryRedisStore();
    server = await startTestSocketServer((io) => {
      registerSessionHandlers(io, {
        redis: store,
        log: noopLog,
        timer: createTestScheduler({ redis: store, io, log: noopLog }),
        archive: fakeArchive,
      });
      registerManualHandlers(io, { redis: store, log: noopLog });
    });
    facilitator = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  it('expert navigation broadcasts EXPERT_MANUAL_POSITION to the session room and persists it', async () => {
    const { sessionId, joinCode } = await createSession(facilitator);
    const expert = await server.connectClient();
    const expertId = await joinSession(expert, joinCode, 'Devon', 'expert');

    const seenByFacilitator = nextEvent<ExpertManualPositionPayload>(
      facilitator,
      'EXPERT_MANUAL_POSITION',
    );
    expert.emit('MANUAL_NAVIGATE', { chapterId: 'wires' });

    const payload = await seenByFacilitator;
    // Story 2.7: the payload carries the durable playerId, not the rotating socket.id.
    expect(payload).toEqual({ chapterId: 'wires', playerId: expertId });

    expect(JSON.parse(store.data.get(manualPositionKey(sessionId))!)).toEqual({
      chapterId: 'wires',
      playerId: expertId,
    });
  });

  it('last navigation wins on the persisted position (locked-mirror, GDD A3)', async () => {
    const { sessionId, joinCode } = await createSession(facilitator);
    const expert = await server.connectClient();
    const expertId = await joinSession(expert, joinCode, 'Devon', 'expert');

    const first = nextEvent<ExpertManualPositionPayload>(facilitator, 'EXPERT_MANUAL_POSITION');
    expert.emit('MANUAL_NAVIGATE', { chapterId: 'wires' });
    await first;
    const second = nextEvent<ExpertManualPositionPayload>(facilitator, 'EXPERT_MANUAL_POSITION');
    expert.emit('MANUAL_NAVIGATE', { chapterId: 'memory' });
    await second;

    expect(JSON.parse(store.data.get(manualPositionKey(sessionId))!)).toEqual({
      chapterId: 'memory',
      playerId: expertId,
    });
  });

  it('rejects an invalid payload with INVALID_PAYLOAD and broadcasts nothing', async () => {
    const { joinCode } = await createSession(facilitator);
    const expert = await server.connectClient();
    await joinSession(expert, joinCode, 'Devon', 'expert');

    const errorPromise = nextEvent<ErrorPayload>(expert, 'ERROR');
    const broadcastSeen = eventWithin(facilitator, 'EXPERT_MANUAL_POSITION', 150);
    expert.emit('MANUAL_NAVIGATE', { chapterId: '' });

    const error = await errorPromise;
    expect(error.code).toBe('INVALID_PAYLOAD');
    expect(error.recoverable).toBe(true);
    expect(await broadcastSeen).toBe(false);
  });

  it('rejects a socket that is not in a session with NOT_IN_SESSION', async () => {
    const outsider = await server.connectClient();
    const errorPromise = nextEvent<ErrorPayload>(outsider, 'ERROR');
    outsider.emit('MANUAL_NAVIGATE', { chapterId: 'wires' });

    const error = await errorPromise;
    expect(error.code).toBe('NOT_IN_SESSION');
  });

  it('non-expert navigation is a silent no-op: no broadcast, no persist, no error', async () => {
    const { sessionId, joinCode } = await createSession(facilitator);
    const defuser = await server.connectClient();
    await joinSession(defuser, joinCode, 'Maya', 'defuser');

    let errored = false;
    defuser.on('ERROR', () => {
      errored = true;
    });
    const broadcastSeen = eventWithin(facilitator, 'EXPERT_MANUAL_POSITION', 150);
    defuser.emit('MANUAL_NAVIGATE', { chapterId: 'wires' });

    expect(await broadcastSeen).toBe(false);
    expect(errored).toBe(false);
    expect(store.data.has(manualPositionKey(sessionId))).toBe(false);
  });

  it('persist failure emits a recoverable error and broadcasts nothing', async () => {
    // Build the failing store via overrides, but only fail manual-position writes —
    // session create/join must still work.
    const failing = createMemoryRedisStore();
    const baseSet = failing.setJSON.bind(failing);
    failing.setJSON = async (key, value) => {
      if (key.endsWith(':manualPosition')) throw new Error('redis down');
      await baseSet(key, value);
    };
    const failServer = await startTestSocketServer((io) => {
      registerSessionHandlers(io, {
        redis: failing,
        log: noopLog,
        timer: createTestScheduler({ redis: failing, io, log: noopLog }),
        archive: fakeArchive,
      });
      registerManualHandlers(io, { redis: failing, log: noopLog });
    });
    try {
      const fac = await failServer.connectClient();
      const { joinCode } = await createSession(fac);
      const expert = await failServer.connectClient();
      await joinSession(expert, joinCode, 'Devon', 'expert');

      const errorPromise = nextEvent<ErrorPayload>(expert, 'ERROR');
      const broadcastSeen = eventWithin(fac, 'EXPERT_MANUAL_POSITION', 150);
      expert.emit('MANUAL_NAVIGATE', { chapterId: 'wires' });

      const error = await errorPromise;
      expect(error.code).toBe('MANUAL_NAVIGATE_FAILED');
      expect(error.recoverable).toBe(true);
      expect(await broadcastSeen).toBe(false);
    } finally {
      await failServer.close();
    }
  });
});
