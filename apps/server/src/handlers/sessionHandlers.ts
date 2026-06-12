import { randomUUID } from 'node:crypto';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoundConfig,
  DifficultyTier,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, joinCodeKey } from '../state/keys.js';
import { generateJoinCode } from '../session/joinCode.js';
import { createSessionState } from '../session/createSession.js';

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
  });
}
