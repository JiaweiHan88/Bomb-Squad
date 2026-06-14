import type { Server as SocketIOServer, DefaultEventsMap } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ExpertManualPositionPayload,
  SessionState,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, manualPositionKey } from '../state/keys.js';
import { sessionRoom, type SessionLog, type SessionSocketData } from './sessionHandlers.js';

/** Typed server alias declared locally to avoid an import cycle with index.ts. */
type ManualIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SessionSocketData
>;

export interface ManualHandlerDeps {
  redis: RedisStore;
  log: SessionLog;
}

type ManualNavigateParseResult =
  | { ok: true; chapterId: string }
  | { ok: false; message: string };

/**
 * Chapter ids are module ids by convention: kebab-case, e.g. "wire-sequences".
 * The bound is a validation fence on untrusted input, not a registry check —
 * the server does not need to know the chapter list to relay a position.
 */
const CHAPTER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Boundary validation for the untrusted MANUAL_NAVIGATE payload. */
export function parseManualNavigatePayload(payload: unknown): ManualNavigateParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { chapterId } = payload as { chapterId?: unknown };
  if (typeof chapterId !== 'string' || !CHAPTER_ID_RE.test(chapterId)) {
    return { ok: false, message: 'chapterId must be a kebab-case id of at most 64 characters' };
  }
  return { ok: true, chapterId };
}

/**
 * Expert manual position relay (Story 5.2; consumed by the Spectator Lounge in
 * Story 9.4). Presence-style metadata, NOT game state: no reducer is involved
 * and the handler owns the whole flow — parse/validate → load session →
 * persist position to Redis (single key, last write wins = GDD A3
 * locked-mirror) → broadcast to the session room.
 *
 * Every role may read the manual, but only Expert navigation is published:
 * non-expert MANUAL_NAVIGATE is a silent no-op (not an error — nothing is
 * wrong, their position is simply not the one spectators mirror).
 */
export function registerManualHandlers(io: ManualIOServer, deps: ManualHandlerDeps): void {
  io.on('connection', (socket) => {
    socket.on('MANUAL_NAVIGATE', async (payload) => {
      const parsed = parseManualNavigatePayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      // socket.data.sessionId is a pointer to which session to load — never
      // authority. Authority is the role check against freshly loaded state.
      const sessionId = socket.data.sessionId;
      const notInSession = () =>
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: "You're not in a session.",
          recoverable: true,
        });
      if (sessionId === undefined) {
        notInSession();
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          // Stale pointer (session evicted) — same answer as never having one.
          notInSession();
          return;
        }

        // Authority resolves against the durable playerId (Story 2.7), never the
        // rotating socket.id — an Expert who reconnects keeps publishing.
        const playerId = socket.data.playerId;
        if (playerId === undefined || state.players[playerId]?.role !== 'expert') return;

        const position: ExpertManualPositionPayload = {
          chapterId: parsed.chapterId,
          playerId,
        };
        // Persist then emit (handler pipeline order). Single-key write —
        // nothing partial to roll back.
        await deps.redis.setJSON(manualPositionKey(sessionId), position);
        io.to(sessionRoom(sessionId)).emit('EXPERT_MANUAL_POSITION', position);
        deps.log.info({ sessionId, playerId, chapterId: parsed.chapterId }, 'manual navigate');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'MANUAL_NAVIGATE failed');
        socket.emit('ERROR', {
          code: 'MANUAL_NAVIGATE_FAILED',
          message: 'Could not share your manual position. Try again.',
          recoverable: true,
        });
      }
    });
  });
}
