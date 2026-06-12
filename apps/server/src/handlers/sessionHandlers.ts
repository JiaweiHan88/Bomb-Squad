import { randomUUID } from 'node:crypto';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoundConfig,
  DifficultyTier,
  PlayerRole,
  SessionState,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, joinCodeKey } from '../state/keys.js';
import { generateJoinCode } from '../session/joinCode.js';
import { createSessionState } from '../session/createSession.js';
import { addPlayerToSession } from '../session/joinSession.js';

/** Typed server alias declared locally to avoid an import cycle with index.ts. */
type SessionIOServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

/**
 * Minimal structural logger (pino/Fastify-compatible). Kept narrow so tests can
 * pass a no-op stub without pulling in pino.
 */
export interface SessionLog {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface SessionHandlerDeps {
  redis: RedisStore;
  log: SessionLog;
}

/** Socket.IO room for all participants of a session (architecture Pattern 1). */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

const DIFFICULTIES: readonly DifficultyTier[] = ['easy', 'medium', 'hard'];

type ParseResult =
  | { ok: true; config?: Partial<RoundConfig> }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted SESSION_CREATE payload. Accepts only
 * known config keys with in-range values and rebuilds a fresh object (never
 * passes the raw client object onward). A missing payload is tolerated.
 */
export function parseSessionCreatePayload(payload: unknown): ParseResult {
  if (payload === undefined || payload === null) return { ok: true };
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { config } = payload as { config?: unknown };
  if (config === undefined) return { ok: true };
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { ok: false, message: 'config must be an object' };
  }

  const out: Partial<RoundConfig> = {};
  for (const [key, value] of Object.entries(config)) {
    // JSON transport cannot carry undefined, but a hand-rolled in-process
    // client can — treat explicitly-undefined keys as absent.
    if (value === undefined) continue;
    switch (key) {
      case 'difficulty':
        if (!DIFFICULTIES.includes(value as DifficultyTier)) {
          return { ok: false, message: 'config.difficulty must be easy|medium|hard' };
        }
        out.difficulty = value as DifficultyTier;
        break;
      case 'moduleCount':
        if (!Number.isInteger(value) || (value as number) < 3 || (value as number) > 11) {
          return { ok: false, message: 'config.moduleCount must be an integer in 3–11' };
        }
        out.moduleCount = value as number;
        break;
      case 'timerMs':
        if (!Number.isInteger(value) || (value as number) <= 0) {
          return { ok: false, message: 'config.timerMs must be a positive integer' };
        }
        out.timerMs = value as number;
        break;
      case 'strikeSpeedUpPct':
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 50) {
          return { ok: false, message: 'config.strikeSpeedUpPct must be an integer in 0–50' };
        }
        out.strikeSpeedUpPct = value;
        break;
      case 'modulePool':
        if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
          return { ok: false, message: 'config.modulePool must be an array of strings' };
        }
        out.modulePool = [...(value as string[])];
        break;
      case 'modifiers': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { ok: false, message: 'config.modifiers must be an object' };
        }
        const modifiers: Partial<RoundConfig['modifiers']> = {};
        for (const [modKey, modValue] of Object.entries(value)) {
          if (modValue === undefined) continue;
          if (modKey !== 'asymmetricExpertRoles' && modKey !== 'spectatorLifelines') {
            return { ok: false, message: `config.modifiers.${modKey} is not a known modifier` };
          }
          if (typeof modValue !== 'boolean') {
            return { ok: false, message: `config.modifiers.${modKey} must be a boolean` };
          }
          modifiers[modKey] = modValue;
        }
        out.modifiers = modifiers as RoundConfig['modifiers'];
        break;
      }
      default:
        return { ok: false, message: `config.${key} is not a known setting` };
    }
  }
  return { ok: true, config: out };
}

/** Session capacity cap (GDD: 2–16 players; the facilitator counts as a player). */
export const MAX_PLAYERS = 16;

/** Roles a joiner may claim. 'facilitator' is mint-only via SESSION_CREATE —
 * accepting it here would let any joiner claim facilitator authority. */
const JOINABLE_ROLES: readonly PlayerRole[] = ['defuser', 'expert', 'spectator'];

type JoinParseResult =
  | { ok: true; joinCode: string; displayName: string; role: PlayerRole }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted SESSION_JOIN payload. Normalizes the
 * code (trim + uppercase) and the name (trim), whitelists the role, and
 * rebuilds a fresh object — unknown extra keys are inert, never forwarded.
 */
export function parseSessionJoinPayload(payload: unknown): JoinParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { joinCode, displayName, role } = payload as {
    joinCode?: unknown;
    displayName?: unknown;
    role?: unknown;
  };

  if (typeof joinCode !== 'string') {
    return { ok: false, message: 'joinCode must be a string' };
  }
  const code = joinCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return { ok: false, message: 'joinCode must be 6 characters (letters and digits)' };
  }

  if (typeof displayName !== 'string') {
    return { ok: false, message: 'displayName must be a string' };
  }
  const name = displayName.trim();
  if (name.length < 1 || name.length > 24) {
    return { ok: false, message: 'displayName must be 1–24 characters' };
  }

  if (typeof role !== 'string' || !JOINABLE_ROLES.includes(role as PlayerRole)) {
    return { ok: false, message: 'role must be defuser, expert, or spectator' };
  }

  return { ok: true, joinCode: code, displayName: name, role: role as PlayerRole };
}

/** Retry cap for join-code collisions (36^6 codes — collisions are theoretical). */
const MAX_CODE_ATTEMPTS = 5;

async function mintJoinCode(redis: RedisStore): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateJoinCode();
    if ((await redis.getJSON<string>(joinCodeKey(code))) === null) return code;
  }
  throw new Error('join-code collision retries exhausted');
}

/**
 * Session lifecycle handlers. Canonical handler pipeline (architecture
 * Pattern 2): parse/validate → build state (pure factory) → persist to Redis →
 * join room → ack + broadcast. No game logic beyond that flow; the process
 * keeps no authoritative in-memory session state.
 */
export function registerSessionHandlers(io: SessionIOServer, deps: SessionHandlerDeps): void {
  io.on('connection', (socket) => {
    socket.on('SESSION_CREATE', async (payload, ack) => {
      // A hand-rolled client can omit the ack — without this guard, calling it throws.
      if (typeof ack !== 'function') {
        deps.log.error({ socketId: socket.id }, 'SESSION_CREATE without ack callback — ignored');
        return;
      }

      const parsed = parseSessionCreatePayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      const sessionId = randomUUID();
      let joinCode: string | null = null;
      try {
        joinCode = await mintJoinCode(deps.redis);
        const state = createSessionState({
          sessionId,
          joinCode,
          facilitatorId: socket.id,
          config: parsed.config,
        });

        // Persist BEFORE emitting; on persist failure emit nothing but ERROR.
        await deps.redis.setJSON(sessionKey(sessionId), state);
        await deps.redis.setJSON(joinCodeKey(joinCode), sessionId);

        await socket.join(sessionRoom(sessionId));
        ack({ sessionId, joinCode });
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', state);
        // AR15: never log the joinCode — it is the session's only secret.
        deps.log.info({ sessionId }, 'session created');
      } catch (err) {
        // Best-effort rollback: the two persists are not atomic, so the session
        // key may have been written before the joincode write failed. Without
        // cleanup that leaves an unreachable session orphaned in Redis.
        try {
          await deps.redis.del(sessionKey(sessionId));
          if (joinCode !== null) await deps.redis.del(joinCodeKey(joinCode));
        } catch {
          // Already in the failure path — swallow so the ERROR still reaches the client.
        }
        deps.log.error({ err, socketId: socket.id }, 'SESSION_CREATE failed');
        socket.emit('ERROR', {
          code: 'SESSION_CREATE_FAILED',
          message: 'Could not create the session. Try again.',
          recoverable: true,
        });
      }
    });

    // No ack on this event (frozen contract): success is the SESSION_STATE
    // broadcast the joiner receives once in the room; failure is a typed ERROR.
    socket.on('SESSION_JOIN', async (payload) => {
      const parsed = parseSessionJoinPayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      // AR15: never log the join code — valid or attempted.
      const notFound = () =>
        socket.emit('ERROR', {
          code: 'SESSION_NOT_FOUND',
          message: "That code doesn't match an open session.",
          recoverable: true,
        });

      try {
        const sessionId = await deps.redis.getJSON<string>(joinCodeKey(parsed.joinCode));
        if (sessionId === null) {
          notFound();
          return;
        }
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          // Dangling joincode key (e.g. partial cleanup) — indistinguishable
          // from a bad code as far as the player should know.
          notFound();
          return;
        }

        // Already in the roster: converge idempotently — re-assert room
        // membership, re-send the snapshot, change nothing, broadcast nothing.
        if (state.players[socket.id] !== undefined) {
          await socket.join(sessionRoom(sessionId));
          socket.emit('SESSION_STATE', state);
          return;
        }

        if (Object.keys(state.players).length >= MAX_PLAYERS) {
          socket.emit('ERROR', {
            code: 'SESSION_FULL',
            message: 'That session is full — 16 is the limit.',
            recoverable: true,
          });
          return;
        }

        // Defensive join-window guard; Story 2.6 refines it (between-rounds admits).
        if (state.status !== 'lobby') {
          socket.emit('ERROR', {
            code: 'SESSION_NOT_JOINABLE',
            message: 'That session has already started.',
            recoverable: true,
          });
          return;
        }

        const next = addPlayerToSession(state, {
          playerId: socket.id,
          displayName: parsed.displayName,
          role: parsed.role,
        });

        // Persist then emit. Single-key write — nothing partial to roll back.
        // Known accepted race (V1 single process): two concurrent joins can
        // interleave load→modify→store and drop one player; human-speed lobby
        // joins make this theoretical. No locks/WATCH for this.
        await deps.redis.setJSON(sessionKey(sessionId), next);

        // Join the room BEFORE broadcasting so the joiner receives their own join.
        await socket.join(sessionRoom(sessionId));
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info({ sessionId, playerId: socket.id, role: parsed.role }, 'player joined');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'SESSION_JOIN failed');
        socket.emit('ERROR', {
          code: 'SESSION_JOIN_FAILED',
          message: 'Could not join the session. Try again.',
          recoverable: true,
        });
      }
    });
  });
}
