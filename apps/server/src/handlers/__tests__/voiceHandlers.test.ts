import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
/**
 * Integration tests for the VOICE_TOKEN handler (Story 3.1, migrated to the
 * durable-id model in Story 2.5). Driven through a real socket round-trip
 * against an in-memory RedisStore (AR16). A real SESSION_CREATE sets
 * `socket.data.playerId` to the durable id and keys `state.players` by it —
 * exactly as production does — so we resolve that durable id from the store and
 * craft each player's role/team/status against it. The pre-2.5 suite seeded
 * `players` keyed by `socket.id`, which masked the production bug where
 * `state.players[socket.id]` is always undefined (the roster key is a UUID, not
 * socket.id) → NOT_IN_SESSION for everyone. Tokens are decoded (never asserted
 * as opaque strings) and a log-leak guard enforces that the JWT is never logged.
 */
import type {
  SessionState,
  SessionCreatePayload,
  SessionCreatedPayload,
  PlayerRole,
  TeamId,
  VoiceTokenGrantPayload,
  VoiceTokenErrorPayload,
} from '@bomb-squad/shared';
import { registerSessionHandlers, type SessionLog } from '../sessionHandlers.js';
import { registerVoiceHandlers, type VoiceConfig } from '../voiceHandlers.js';
import { sessionKey } from '../../state/keys.js';
import {
  startTestSocketServer,
  createMemoryRedisStore,
  createTestScheduler,
  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
} from './testSocketServer.js';

const CONFIG: VoiceConfig = {
  LIVEKIT_URL: 'ws://livekit.test:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret-at-least-32-chars-long!!',
  TURN_TTL: 3600,
  TURN_SECRET: 'turn-secret-test',
  // No TURN_URL by default → grant must omit iceServers (pre-3.6 behavior).
};

type VoiceAck = VoiceTokenGrantPayload | VoiceTokenErrorPayload;
const isGrant = (r: VoiceAck): r is VoiceTokenGrantPayload =>
  (r as VoiceTokenGrantPayload).token !== undefined;

/** Capturing logger: records every argument string for the leak guard. */
function captureLog(): { log: SessionLog; lines: string[] } {
  const lines: string[] = [];
  const record = (obj: object, msg?: string): void => {
    lines.push(JSON.stringify(obj) + (msg ? ` ${msg}` : ''));
  };
  return { log: { info: record, error: record }, lines };
}

function createSession(
  socket: TestClientSocket,
  payload: SessionCreatePayload = {},
): Promise<SessionCreatedPayload> {
  return new Promise((resolve) => socket.emit('SESSION_CREATE', payload, resolve));
}

function requestVoiceToken(socket: TestClientSocket): Promise<VoiceAck> {
  return new Promise((resolve) => socket.emit('VOICE_TOKEN', {}, resolve as never));
}

/** The durable playerId the server minted for the (sole) facilitator on create —
 * the production roster key (a UUID), NOT socket.id. */
async function facilitatorId(store: MemoryRedisStore, sessionId: string): Promise<string> {
  const state = await store.getJSON<SessionState>(sessionKey(sessionId));
  if (state === null) throw new Error('session not found in test store');
  const ids = Object.keys(state.players);
  if (ids.length !== 1) throw new Error(`expected exactly one player, got ${ids.length}`);
  return ids[0] as string;
}

/** Overwrite a player row (keyed by the DURABLE playerId) and optionally the
 * session status, so each test exercises the desired role/phase scope. */
async function setPlayer(
  store: MemoryRedisStore,
  sessionId: string,
  playerId: string,
  role: PlayerRole,
  opts: { teamId?: TeamId; status?: SessionState['status'] } = {},
): Promise<void> {
  const state = await store.getJSON<SessionState>(sessionKey(sessionId));
  if (state === null) throw new Error('session not found in test store');
  state.players[playerId] = { playerId, displayName: 'tester', role, teamId: opts.teamId, isReady: false };
  if (opts.status !== undefined) state.status = opts.status;
  await store.setJSON(sessionKey(sessionId), state);
}

interface DecodedClaims {
  sub?: string;
  video?: { room?: string; canPublish?: boolean; canSubscribe?: boolean };
}
function decodeJwt(token: string): DecodedClaims {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DecodedClaims;
}

describe('VOICE_TOKEN handler', () => {
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let client: TestClientSocket;
  let lines: string[];

  beforeEach(async () => {
    store = createMemoryRedisStore();
    const cap = captureLog();
    lines = cap.lines;
    server = await startTestSocketServer((io) => {
      // Voice never touches the timer; session handlers now require one (Story
      // 8.4), so supply the test scheduler purely to satisfy the dep.
      registerSessionHandlers(io, {
        redis: store,
        log: cap.log,
        timer: createTestScheduler({ redis: store, io, log: cap.log }),
      });
      registerVoiceHandlers(io, { redis: store, log: cap.log, config: CONFIG });
    });
    client = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  it('mints a Bomb Room token for a defuser with a team (active phase)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.url).toBe(CONFIG.LIVEKIT_URL);
    expect(res.room).toBe(`bomb-room:${sessionId}:A`);
    // Identity is the DURABLE playerId, never socket.id (Story 2.5 regression fix).
    expect(res.identity).toBe(playerId);
    expect(res.identity).not.toBe(client.id);

    const claims = decodeJwt(res.token);
    expect(claims.sub).toBe(playerId);
    expect(claims.video?.room).toBe(`bomb-room:${sessionId}:A`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  // The exact production case the pre-2.5 socket.id-keyed seeding masked: a
  // socket whose durable playerId IS a roster key but whose socket.id is NOT.
  it('regression: a player keyed by durable id (not socket.id) gets a grant', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    // Sanity: the roster key is the durable id, and socket.id is absent from it.
    const state = await store.getJSON<SessionState>(sessionKey(sessionId));
    expect(Object.keys(state!.players)).toContain(playerId);
    expect(Object.keys(state!.players)).not.toContain(client.id);

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true); // pre-fix this was NOT_IN_SESSION for everyone
    if (!isGrant(res)) return;
    expect(res.identity).toBe(playerId);
  });

  it('mints a listen-only Spectator Lounge token (canPublish:false) in a non-lobby phase', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'spectator', { status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.room).toBe(`spectator-lounge:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.room).toBe(`spectator-lounge:${sessionId}`);
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('mints a Spectator Lounge token with publish for a facilitator in a non-lobby phase', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    // Already a facilitator on create; just move out of lobby phase.
    await setPlayer(store, sessionId, playerId, 'facilitator', { status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.room).toBe(`spectator-lounge:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.room).toBe(`spectator-lounge:${sessionId}`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  // ── Lobby mic-check scope (Story 2.5) ──────────────────────────────────────

  it('scopes a teamless defuser in the LOBBY to the shared lobby room (no scope error)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    // Status stays 'lobby' (create default); a Bomb Room role with NO team.
    await setPlayer(store, sessionId, playerId, 'defuser');

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true); // would be VOICE_SCOPE_UNAVAILABLE outside the lobby
    if (!isGrant(res)) return;

    expect(res.room).toBe(`lobby:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.room).toBe(`lobby:${sessionId}`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('scopes a spectator in the LOBBY to the shared lobby room with publish (mic-check exception)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'spectator'); // lobby phase

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.room).toBe(`lobby:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.canPublish).toBe(true); // lobby-only FR39 exception
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('denies a socket with no session (never created/joined)', async () => {
    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('NOT_IN_SESSION');
  });

  it('denies a socket whose player row is absent from session state', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    const state = await store.getJSON<SessionState>(sessionKey(sessionId));
    delete state!.players[playerId];
    await store.setJSON(sessionKey(sessionId), state);

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('NOT_IN_SESSION');
  });

  it('denies a Bomb Room role with no team in a non-lobby phase (no token minted)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { status: 'active' }); // no teamId, not lobby

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('VOICE_SCOPE_UNAVAILABLE');
  });

  it('never trusts the client: an empty payload still yields the server-derived scope', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'spectator', { status: 'active' });

    // Even if a client tried to smuggle fields, the handler ignores the payload.
    const res = await new Promise<VoiceAck>((resolve) =>
      client.emit('VOICE_TOKEN', { room: 'bomb-room:hacked:A', canPublish: true } as never, resolve as never),
    );
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;
    expect(res.room).toBe(`spectator-lounge:${sessionId}`);
    expect(decodeJwt(res.token).video?.canPublish).toBe(false);
  });

  it('never logs the minted token (AC #2 secret-leak guard)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(res.token);
    }
  });

  // ── TURN relay path (Story 3.6, AC #3) ─────────────────────────────────────

  it('omits iceServers when no TURN_URL is configured (no regression)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;
    expect(res.iceServers).toBeUndefined();
  });
});

describe('VOICE_TOKEN handler — TURN relay configured (Story 3.6)', () => {
  const TURN_CONFIG: VoiceConfig = { ...CONFIG, TURN_URL: 'turn:localhost:3478' };
  let server: TestSocketServer;
  let store: MemoryRedisStore;
  let client: TestClientSocket;
  let lines: string[];

  beforeEach(async () => {
    store = createMemoryRedisStore();
    const cap = captureLog();
    lines = cap.lines;
    server = await startTestSocketServer((io) => {
      registerSessionHandlers(io, {
        redis: store,
        log: cap.log,
        timer: createTestScheduler({ redis: store, io, log: cap.log }),
      });
      registerVoiceHandlers(io, { redis: store, log: cap.log, config: TURN_CONFIG });
    });
    client = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  it('advertises the coturn relay (udp+tcp) with a TURN-REST credential', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.iceServers).toBeDefined();
    expect(res.iceServers).toHaveLength(1);
    const [ice] = res.iceServers!;
    expect(ice.urls).toEqual([
      'turn:localhost:3478?transport=udp',
      'turn:localhost:3478?transport=tcp',
    ]);
    // username binds the durable identity (not socket.id); credential is present.
    expect(ice.username).toMatch(new RegExp(`:${playerId}$`));
    expect(ice.credential).toBeTruthy();
  });

  it('never logs the TURN credential (secret-leak guard)', async () => {
    const { sessionId } = await createSession(client);
    const playerId = await facilitatorId(store, sessionId);
    await setPlayer(store, sessionId, playerId, 'defuser', { teamId: 'A', status: 'active' });

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    const credential = res.iceServers![0].credential!;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(credential);
      expect(line).not.toContain(res.token);
    }
  });
});
