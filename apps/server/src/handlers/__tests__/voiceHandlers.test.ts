/**
 * Integration tests for the VOICE_TOKEN handler (Story 3.1), driven through a
 * real socket round-trip against an in-memory RedisStore (AR16). We register
 * the session handlers too so a real SESSION_CREATE sets `socket.data.sessionId`
 * exactly as production does; the player's role/team is then crafted directly in
 * the store to exercise each scope. Tokens are decoded (never asserted as opaque
 * strings) and a log-leak guard enforces that the JWT is never logged.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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
  type TestSocketServer,
  type TestClientSocket,
  type MemoryRedisStore,
} from './testSocketServer.js';

const CONFIG: VoiceConfig = {
  LIVEKIT_URL: 'ws://livekit.test:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret-at-least-32-chars-long!!',
  TURN_TTL: 3600,
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

/** Overwrite the player row for `playerId` in the stored session state. */
async function setPlayer(
  store: MemoryRedisStore,
  sessionId: string,
  playerId: string,
  role: PlayerRole,
  teamId?: TeamId,
): Promise<void> {
  const state = await store.getJSON<SessionState>(sessionKey(sessionId));
  if (state === null) throw new Error('session not found in test store');
  state.players[playerId] = { playerId, displayName: 'tester', role, teamId, isReady: false };
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
      registerSessionHandlers(io, { redis: store, log: cap.log });
      registerVoiceHandlers(io, { redis: store, log: cap.log, config: CONFIG });
    });
    client = await server.connectClient();
  });

  afterEach(async () => {
    await server.close();
  });

  it('mints a Bomb Room token for a defuser with a team', async () => {
    const { sessionId } = await createSession(client);
    await setPlayer(store, sessionId, client.id as string, 'defuser', 'A');

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.url).toBe(CONFIG.LIVEKIT_URL);
    expect(res.room).toBe(`bomb-room:${sessionId}:A`);
    expect(res.identity).toBe(client.id);

    const claims = decodeJwt(res.token);
    expect(claims.sub).toBe(client.id);
    expect(claims.video?.room).toBe(`bomb-room:${sessionId}:A`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('mints a listen-only Spectator Lounge token (canPublish:false)', async () => {
    const { sessionId } = await createSession(client);
    await setPlayer(store, sessionId, client.id as string, 'spectator');

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(res.room).toBe(`spectator-lounge:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.room).toBe(`spectator-lounge:${sessionId}`);
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('mints a Spectator Lounge token with publish for a facilitator (no team needed)', async () => {
    const { sessionId } = await createSession(client);
    await setPlayer(store, sessionId, client.id as string, 'facilitator'); // no teamId

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    // Facilitator baselines into the lounge alongside spectators, but may publish
    // (host narration); the on-demand Bomb Room PTT bridge is a later story.
    expect(res.room).toBe(`spectator-lounge:${sessionId}`);
    const claims = decodeJwt(res.token);
    expect(claims.video?.room).toBe(`spectator-lounge:${sessionId}`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('denies a socket with no session (never created/joined)', async () => {
    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('NOT_IN_SESSION');
  });

  it('denies a socket whose player row is absent from session state', async () => {
    const { sessionId } = await createSession(client);
    const state = await store.getJSON<SessionState>(sessionKey(sessionId));
    delete state!.players[client.id as string];
    await store.setJSON(sessionKey(sessionId), state);

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('NOT_IN_SESSION');
  });

  it('denies a Bomb Room role with no team assigned (no token minted)', async () => {
    const { sessionId } = await createSession(client);
    await setPlayer(store, sessionId, client.id as string, 'defuser'); // no teamId

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(false);
    expect((res as VoiceTokenErrorPayload).error).toBe('VOICE_SCOPE_UNAVAILABLE');
  });

  it('never trusts the client: an empty payload still yields the server-derived scope', async () => {
    const { sessionId } = await createSession(client);
    await setPlayer(store, sessionId, client.id as string, 'spectator');

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
    await setPlayer(store, sessionId, client.id as string, 'defuser', 'A');

    const res = await requestVoiceToken(client);
    expect(isGrant(res)).toBe(true);
    if (!isGrant(res)) return;

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(res.token);
    }
  });
});
