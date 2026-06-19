/**
 * verify.ts — self-contained end-to-end check, runnable with no Docker.
 *
 * Boots an IN-PROCESS Socket.IO server wired with the REAL session + module
 * handlers (imported from @bomb-squad/server) over an in-memory Redis, then runs
 * the autonomous swarm to prove the bots drive the real reducers correctly:
 *   1. DEFUSE   — wires + passwords, 2 teams → both teams BOMB_DEFUSED
 *   2. BUTTON   — the-button only → exercises the PRESS/RELEASE + timer-digit
 *                 HOLD loop over real sockets
 *   3. STRIKE   — wires, one wrong cut → a STRIKE is observed
 *
 * This is the AC-6 smoke run made Docker-free and repeatable (`pnpm verify`).
 * @bomb-squad/server is a DEV dependency used only here; nothing in the shipped
 * tool (main.ts / swarm.ts / BotClient.ts) imports it.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as SocketIOServer } from 'socket.io';
import {
  registerSessionHandlers,
  type SessionIOServer,
  type SessionLog,
} from '@bomb-squad/server/src/handlers/sessionHandlers.js';
import { registerModuleHandlers } from '@bomb-squad/server/src/handlers/moduleHandlers.js';
import { createTimerScheduler } from '@bomb-squad/server/src/timer/index.js';
import type { RedisStore, UpdateDecision } from '@bomb-squad/server/src/state/redis.js';
import { buildAutonomousSwarm, playRound, teardown } from './swarm.js';

const noopLog: SessionLog = { info: () => {}, error: () => {} };

/** Single-process Map-backed RedisStore (mirrors the server test harness). */
function memoryRedis(): RedisStore {
  const data = new Map<string, string>();
  return {
    async getJSON<T>(key: string): Promise<T | null> {
      const raw = data.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async setJSON<T>(key: string, value: T): Promise<void> {
      data.set(key, JSON.stringify(value));
    },
    async del(key: string): Promise<void> {
      data.delete(key);
    },
    async updateJSON<T, R>(
      key: string,
      mutate: (current: T | null) => UpdateDecision<T, R>,
    ): Promise<{ committed: boolean; result: R }> {
      const before = data.get(key);
      const current = before === undefined ? null : (JSON.parse(before) as T);
      const decision = mutate(current);
      if (!decision.commit) return { committed: false, result: decision.result };
      data.set(key, JSON.stringify(decision.value));
      return { committed: true, result: decision.result };
    },
    async ping(): Promise<boolean> {
      return true;
    },
    isReady(): boolean {
      return true;
    },
  };
}

async function boot(): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer) as unknown as SessionIOServer;
  const redis = memoryRedis();
  const timer = createTimerScheduler({
    redis,
    io,
    log: noopLog,
    // unref so an armed wake never keeps the verify process alive.
    setTimer: (cb, ms) => setTimeout(cb, ms).unref(),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  registerSessionHandlers(io, { redis, log: noopLog, timer });
  registerModuleHandlers(io, { redis, log: noopLog, timer });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}

let failures = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'} — ${label}`);
  if (!ok) failures++;
}

async function run(): Promise<void> {
  const server = await boot();
  const log = (m: string): void => console.log(`   ${m}`);
  console.log(`In-process server at ${server.url}\n`);

  try {
    // 1. DEFUSE — wires + passwords across two teams.
    {
      const swarm = await buildAutonomousSwarm(
        { url: server.url, teams: 2, perTeam: 2, outcome: 'defuse', pacingMs: 40, log },
        { modulePool: ['wires', 'passwords'], moduleCount: 3, timerMs: 300_000 },
      );
      await playRound(swarm);
      // Every bot is in its team room, so all of them observe the team's
      // resolution; assert no team exploded (all DEFUSED) and the round closed.
      const resolutions = swarm.players.map((b) => b.resolved);
      check('defuse: both teams reached between-rounds', swarm.facilitator!.session?.status === 'between-rounds');
      check('defuse: every bot observed DEFUSED (no team exploded)', resolutions.every((r) => r === 'defused'));
      teardown(swarm);
    }

    // 1b. MULTI-ROUND — two rounds resolve back-to-back and the Defuser rotates
    //     (the heart of the 8.6 between-round flow). per-team 2 so rotation has
    //     a distinct round-2 Defuser; assert currentDefuserIndex advanced.
    {
      const swarm = await buildAutonomousSwarm(
        { url: server.url, teams: 2, perTeam: 2, outcome: 'defuse', pacingMs: 40, log },
        { modulePool: ['wires'], moduleCount: 3, timerMs: 300_000 },
      );
      await playRound(swarm);
      await playRound(swarm); // between-rounds → preparation advances the rotation
      const teamA = swarm.facilitator!.session?.teams.A;
      check('multi-round: round 2 resolved', swarm.facilitator!.session?.status === 'between-rounds');
      check('multi-round: Defuser rotation advanced (currentDefuserIndex ≥ 1)', (teamA?.currentDefuserIndex ?? 0) >= 1);
      teardown(swarm);
    }

    // 2. BUTTON — exercises PRESS/RELEASE + the timer-digit HOLD loop over sockets.
    {
      const swarm = await buildAutonomousSwarm(
        { url: server.url, teams: 1, perTeam: 1, outcome: 'defuse', pacingMs: 40, log },
        { modulePool: ['the-button'], moduleCount: 3, timerMs: 300_000 },
      );
      await playRound(swarm);
      check('button: round defused (press/hold + timer-digit release works)', swarm.players[0].resolved === 'defused');
      teardown(swarm);
    }

    // 3. STRIKE — one deliberately-wrong wire cut.
    {
      const swarm = await buildAutonomousSwarm(
        { url: server.url, teams: 1, perTeam: 1, outcome: 'strike', pacingMs: 40, log },
        { modulePool: ['wires'], moduleCount: 3, timerMs: 300_000 },
      );
      swarm.facilitator!.openPreparation();
      await swarm.facilitator!.waitUntil(() => swarm.facilitator!.session?.status === 'preparation');
      swarm.facilitator!.startRound();
      await swarm.players[0].waitUntil(() => swarm.players[0].strikes >= 1, 15_000).catch(() => {});
      check('strike: a STRIKE was registered for the team', swarm.players[0].strikes >= 1);
      teardown(swarm);
    }
  } finally {
    await server.close();
  }

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
