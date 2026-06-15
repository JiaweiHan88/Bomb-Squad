/**
 * Headless live smoke for Story 2.5 (lobby roster, ready state & mic check).
 *
 * Run against REAL Redis + REAL LiveKit creds (the Docker stack), reusing the
 * 2.6/2.7 pattern: boot the real session + voice handlers on an ephemeral
 * Socket.IO server backed by a real ioredis connection, drive it with headless
 * socket.io-client sockets, and assert the wire + persisted truth. Run with:
 *
 *   pnpm --filter @bomb-squad/server exec tsx ../../scripts/smoke-2-5.ts
 *   (or, from repo root, with the server's tsx)  — NO watch mode.
 *
 * Requires .env (REDIS_URL, LIVEKIT_API_KEY/SECRET/URL, TURN_TTL) and a running
 * Redis. VOICE_TOKEN minting is pure JWT signing — it does NOT dial LiveKit — so
 * a live SFU is not needed for the headless checks (the real two-browser voice
 * pass is Jay's interactive step). Checks:
 *   (a) a joined player's VOICE_TOKEN mints room === lobby:{sessionId} and
 *       identity === the durable playerId (regression fix + lobby scope);
 *   (b) PLAYER_READY{isReady:true} flips that player's isReady in the broadcast
 *       AND in Redis; an idempotent repeat produces no second broadcast;
 *   (c) AR15: the join code never appears in any captured log line.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type {
  SessionState,
  SessionCreatedPayload,
  SessionIdentityPayload,
  VoiceTokenGrantPayload,
  VoiceTokenErrorPayload,
} from '@bomb-squad/shared';
import { connectRedis } from '../apps/server/src/state/index.js';
import { sessionKey } from '../apps/server/src/state/keys.js';
import { registerSessionHandlers, type SessionLog } from '../apps/server/src/handlers/sessionHandlers.js';
import { registerVoiceHandlers, type VoiceConfig } from '../apps/server/src/handlers/voiceHandlers.js';
import { createTimerScheduler } from '../apps/server/src/timer/timerScheduler.js';

const logLines: string[] = [];
const record = (obj: object, msg?: string): void => {
  const line = JSON.stringify(obj) + (msg ? ` ${msg}` : '');
  logLines.push(line);
};
const log: SessionLog = { info: record, error: record };

const failures: string[] = [];
const check = (label: string, cond: boolean): void => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}`);
  if (!cond) failures.push(label);
};

const decodeRoom = (token: string): string | undefined => {
  const [, payload] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    video?: { room?: string };
  };
  return claims.video?.room;
};

async function main(): Promise<void> {
  // Hydrate process.env from the repo .env the same way the server does. A
  // SMOKE_REDIS_URL override (captured BEFORE loadEnvFile, which would otherwise
  // overwrite REDIS_URL) lets a throwaway container on a free port win when the
  // default 6379 is occupied by another stack's passworded Redis.
  const redisOverride = process.env.SMOKE_REDIS_URL;
  // Token minting is pure local JWT signing (no SFU dial), so when .env carries a
  // placeholder LiveKit secret too short for the SDK's signer, a valid-length
  // dummy lets the headless checks exercise the lobby-room + identity logic. The
  // real creds are used by the running stack for Jay's interactive voice pass.
  const lkKeyOverride = process.env.SMOKE_LIVEKIT_API_KEY;
  const lkSecretOverride = process.env.SMOKE_LIVEKIT_API_SECRET;
  const envFile = resolve(process.cwd(), '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const { client, store } = connectRedis(redisOverride ?? process.env.REDIS_URL ?? 'redis://localhost:6379');
  await client.connect();

  const config: VoiceConfig = {
    LIVEKIT_URL: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    LIVEKIT_API_KEY: lkKeyOverride ?? process.env.LIVEKIT_API_KEY ?? '',
    LIVEKIT_API_SECRET: lkSecretOverride ?? process.env.LIVEKIT_API_SECRET ?? '',
    TURN_TTL: Number(process.env.TURN_TTL ?? 3600),
  };

  const httpServer = createServer();
  const io = new SocketIOServer(httpServer);
  registerSessionHandlers(io, {
    redis: store,
    log,
    timer: createTimerScheduler({ redis: store, io, log }),
  });
  registerVoiceHandlers(io, { redis: store, log, config });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;

  const connect = (auth?: Record<string, unknown>): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const s = ioClient(url, { transports: ['websocket'], auth });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  const nextState = (s: ClientSocket): Promise<SessionState> =>
    new Promise((r) => s.once('SESSION_STATE', (st: SessionState) => r(st)));
  const nextIdentity = (s: ClientSocket): Promise<SessionIdentityPayload> =>
    new Promise((r) => s.once('SESSION_IDENTITY', (p: SessionIdentityPayload) => r(p)));

  const fac = await connect();
  const facIdP = nextIdentity(fac);
  const ack = await new Promise<SessionCreatedPayload>((r) => fac.emit('SESSION_CREATE', {}, r));
  await facIdP;

  const joiner = await connect();
  const joinerIdP = nextIdentity(joiner);
  const joinerStateP = nextState(joiner);
  joiner.emit('SESSION_JOIN', { joinCode: ack.joinCode, displayName: 'Maya', role: 'expert' });
  const [{ playerId: joinerId }] = await Promise.all([joinerIdP, joinerStateP]);

  // (a) VOICE_TOKEN — lobby room + durable identity.
  console.log('\n(a) VOICE_TOKEN lobby scope + durable identity');
  const grant = await new Promise<VoiceTokenGrantPayload | VoiceTokenErrorPayload>((r) =>
    joiner.emit('VOICE_TOKEN', {}, r as never),
  );
  const isGrant = 'token' in grant;
  if (!isGrant) console.log(`     (error from server: ${(grant as VoiceTokenErrorPayload).error})`);
  check('mints a grant (not an error)', isGrant);
  if (isGrant) {
    const g = grant;
    check(`room === lobby:${ack.sessionId}`, g.room === `lobby:${ack.sessionId}`);
    check('identity === durable joiner playerId', g.identity === joinerId);
    check('JWT video.room === lobby room', decodeRoom(g.token) === `lobby:${ack.sessionId}`);
  }

  // (b) PLAYER_READY — flips in broadcast + Redis; idempotent repeat is silent.
  console.log('\n(b) PLAYER_READY broadcast + persistence + idempotency');
  const facStateP = nextState(fac);
  joiner.emit('PLAYER_READY', { isReady: true });
  const broadcast = await facStateP;
  check('broadcast shows joiner isReady === true', broadcast.players[joinerId]?.isReady === true);
  const stored = await store.getJSON<SessionState>(sessionKey(ack.sessionId));
  check('Redis persisted isReady === true', stored?.players[joinerId]?.isReady === true);

  let secondBroadcast = false;
  fac.once('SESSION_STATE', () => {
    secondBroadcast = true;
  });
  joiner.emit('PLAYER_READY', { isReady: true }); // idempotent repeat
  await new Promise((r) => setTimeout(r, 300));
  check('idempotent repeat → no second broadcast', !secondBroadcast);

  // (c) AR15 — the join code never appears in any captured log line.
  console.log('\n(c) AR15 secret-leak guard');
  const leaks = logLines.filter((l) => l.includes(ack.joinCode)).length;
  check(`join code in 0 log lines (found ${leaks})`, leaks === 0);

  fac.disconnect();
  joiner.disconnect();
  await new Promise<void>((r) => io.close(() => r()));
  await client.quit();

  console.log(`\n${failures.length === 0 ? '✅ SMOKE PASSED' : `❌ SMOKE FAILED (${failures.length})`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
