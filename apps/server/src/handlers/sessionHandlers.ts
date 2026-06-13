import { randomUUID } from 'node:crypto';
import type { Server as SocketIOServer, DefaultEventsMap } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoundConfig,
  DifficultyTier,
  PlayerRole,
  SessionState,
  TeamId,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, joinCodeKey, roundKey, timerKey } from '../state/keys.js';
import { startSegment } from '../timer/timerCore.js';
import type { TimerScheduler } from '../timer/timerScheduler.js';
import { generateJoinCode } from '../session/joinCode.js';
import { createSessionState } from '../session/createSession.js';
import { addPlayerToSession } from '../session/joinSession.js';
import { assignPlayerToTeam } from '../session/assignTeam.js';
import { openPreparation } from '../session/openPreparation.js';
import { cancelPreparation } from '../session/cancelPreparation.js';
import { startRound, hasPopulatedTeam } from '../session/startRound.js';

/**
 * Server-assigned per-socket bookkeeping (Socket.IO `socket.data`). A pointer
 * only, never authority: it selects which session key to load; every authority
 * decision is made against the freshly Redis-loaded state. Transient by design
 * (Pattern 1) — it dies with the socket, same lifetime as the socket.id
 * identity this codebase already accepts (deferred-work.md).
 */
export interface SessionSocketData {
  sessionId?: string;
}

/** Typed server alias declared locally to avoid an import cycle with index.ts.
 * Exported (type-only consumers) so the timer effect modules can type their
 * `io` parameter without re-deriving the 4-generic form. */
export type SessionIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SessionSocketData
>;

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
  /** Server-authoritative expiry scheduler (Story 8.4). Owns the wall clock the
   * handlers stamp timers with, and the setTimeout-backed expiry wakes. */
  timer: TimerScheduler;
}

/** Socket.IO room for all participants of a session (architecture Pattern 1). */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

/** Socket.IO room for one team's sockets (architecture Pattern 1) — the
 * broadcast target Epic 8.4+ team-scoped bomb/timer events depend on. */
export const teamRoom = (sessionId: string, teamId: TeamId): string =>
  `session:${sessionId}:team:${teamId}`;

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

type TeamAssignParseResult =
  | { ok: true; playerId: string; teamId: TeamId; role: PlayerRole }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted TEAM_ASSIGN payload. Whitelists the
 * team and role (the facilitator seat stays mint-only — a facilitator must not
 * be able to mint a second facilitator or demote themselves into an
 * authority-less session), bounds the opaque playerId, and rebuilds a fresh
 * object — unknown extra keys are inert, never forwarded.
 */
export function parseTeamAssignPayload(payload: unknown): TeamAssignParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { playerId, teamId, role } = payload as {
    playerId?: unknown;
    teamId?: unknown;
    role?: unknown;
  };

  // socket.ids are opaque (~20 chars); the bound is a sanity fence, not a format check.
  if (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 128) {
    return { ok: false, message: 'playerId must be a 1–128 character string' };
  }

  if (teamId !== 'A' && teamId !== 'B') {
    return { ok: false, message: 'teamId must be A or B' };
  }

  if (typeof role !== 'string' || !JOINABLE_ROLES.includes(role as PlayerRole)) {
    return { ok: false, message: 'role must be defuser, expert, or spectator' };
  }

  return { ok: true, playerId, teamId, role: role as PlayerRole };
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
        socket.data.sessionId = sessionId;
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
          socket.data.sessionId = sessionId;
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
        socket.data.sessionId = sessionId;
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

    // No ack on this event (frozen contract): success is the SESSION_STATE
    // broadcast, failure a typed ERROR. First facilitator-authority gate in
    // the codebase — the pattern every Epic-8 facilitator action copies.
    socket.on('TEAM_ASSIGN', async (payload) => {
      const parsed = parseTeamAssignPayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      // socket.data.sessionId is a server-assigned pointer to which session to
      // load — never authority. Authority is the facilitator check against the
      // freshly Redis-loaded state below.
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

        // Authority gate FIRST: a non-facilitator probe must learn nothing
        // about session contents (e.g. whether a playerId exists).
        if (state.players[socket.id]?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator assigns teams.',
            recoverable: true,
          });
          return;
        }

        const target = state.players[parsed.playerId];
        if (target === undefined) {
          socket.emit('ERROR', {
            code: 'PLAYER_NOT_FOUND',
            message: "That player isn't in this session.",
            recoverable: true,
          });
          return;
        }
        if (target.role === 'facilitator') {
          socket.emit('ERROR', {
            code: 'INVALID_ASSIGNMENT',
            message: "The facilitator doesn't sit on a team.",
            recoverable: true,
          });
          return;
        }

        // Defensive phase guard; Epic 8 (between-rounds flow) widens it deliberately.
        if (state.status !== 'lobby') {
          socket.emit('ERROR', {
            code: 'NOT_IN_LOBBY',
            message: 'Teams are locked once the round starts.',
            recoverable: true,
          });
          return;
        }

        const next = assignPlayerToTeam(state, parsed);
        // Idempotent no-op (same team + role re-asserted): the roster already
        // shows the truth — no persist, no broadcast, no error.
        if (next === state) return;

        // Persist then emit. Single-key write — nothing partial to roll back.
        // Same accepted load-modify-store race as SESSION_JOIN (V1 single
        // process, human-speed lobby actions). No locks/WATCH for this.
        await deps.redis.setJSON(sessionKey(sessionId), next);
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info(
          {
            sessionId,
            playerId: parsed.playerId,
            teamId: parsed.teamId,
            role: parsed.role,
            by: socket.id,
          },
          'player assigned',
        );
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'TEAM_ASSIGN failed');
        socket.emit('ERROR', {
          code: 'TEAM_ASSIGN_FAILED',
          message: 'Could not assign. Try again.',
          recoverable: true,
        });
      }
    });

    // Facilitator opens the Preparation phase (Story 8.3, FR8). Payload-less;
    // no ack (frozen contract): success is the SESSION_STATE broadcast,
    // failure a typed ERROR. Same pipeline as TEAM_ASSIGN.
    socket.on('PREPARATION_OPEN', async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: "You're not in a session.",
          recoverable: true,
        });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', {
            code: 'NOT_IN_SESSION',
            message: "You're not in a session.",
            recoverable: true,
          });
          return;
        }

        // Authority gate FIRST (a non-facilitator probe learns nothing).
        if (state.players[socket.id]?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator opens preparation.',
            recoverable: true,
          });
          return;
        }

        // Phase guard: mid-round / ended sessions refuse loudly. A duplicate
        // open while already in preparation falls through to the pure
        // function's same-reference return — a silent idempotent no-op.
        if (state.status === 'active' || state.status === 'ended') {
          socket.emit('ERROR', {
            code: 'CANNOT_OPEN_PREP',
            message: 'Preparation only opens between rounds.',
            recoverable: true,
          });
          return;
        }

        // Population guard: opening prep with no defuser-able player on any
        // team strands the facilitator — ROUND_START would then refuse with
        // NO_POPULATED_TEAM and (before PREPARATION_CANCEL) prep had no exit.
        // Same error code the Lobby banner already owns; the message differs.
        if (!hasPopulatedTeam(state)) {
          socket.emit('ERROR', {
            code: 'CANNOT_OPEN_PREP',
            message: 'Assign at least one player to a team first.',
            recoverable: true,
          });
          return;
        }

        const next = openPreparation(state);
        if (next === state) return;

        // Persist then emit. Single-key write — nothing partial to roll back.
        await deps.redis.setJSON(sessionKey(sessionId), next);
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info({ sessionId, roundNumber: next.roundNumber }, 'preparation opened');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'PREPARATION_OPEN failed');
        socket.emit('ERROR', {
          code: 'PREPARATION_OPEN_FAILED',
          message: 'Could not open preparation. Try again.',
          recoverable: true,
        });
      }
    });

    // Facilitator returns Preparation to the lobby (Story 8.3): the inverse of
    // PREPARATION_OPEN. Payload-less; success is the SESSION_STATE broadcast.
    socket.on('PREPARATION_CANCEL', async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: "You're not in a session.",
          recoverable: true,
        });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', {
            code: 'NOT_IN_SESSION',
            message: "You're not in a session.",
            recoverable: true,
          });
          return;
        }

        // Authority gate FIRST (a non-facilitator probe learns nothing).
        if (state.players[socket.id]?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator cancels preparation.',
            recoverable: true,
          });
          return;
        }

        // Phase guard: only a session in preparation can be cancelled back to
        // the lobby. Any other status refuses loudly.
        if (state.status !== 'preparation') {
          socket.emit('ERROR', {
            code: 'CANNOT_CANCEL_PREP',
            message: 'Preparation is not open.',
            recoverable: true,
          });
          return;
        }

        const next = cancelPreparation(state);
        if (next === state) return;

        await deps.redis.setJSON(sessionKey(sessionId), next);
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info({ sessionId, roundNumber: next.roundNumber }, 'preparation cancelled');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'PREPARATION_CANCEL failed');
        socket.emit('ERROR', {
          code: 'PREPARATION_CANCEL_FAILED',
          message: 'Could not cancel preparation. Try again.',
          recoverable: true,
        });
      }
    });

    // Facilitator starts the round (Story 8.3, FR11): commits the rotation
    // pick per team, activates the session, persists the RoundState, and
    // routes sockets into their team rooms. Payload-less; no ack.
    socket.on('ROUND_START', async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: "You're not in a session.",
          recoverable: true,
        });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', {
            code: 'NOT_IN_SESSION',
            message: "You're not in a session.",
            recoverable: true,
          });
          return;
        }

        // Authority gate FIRST.
        if (state.players[socket.id]?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator starts the round.',
            recoverable: true,
          });
          return;
        }

        const result = startRound(state);
        if (!result.ok) {
          socket.emit('ERROR', {
            code: 'CANNOT_START_ROUND',
            message:
              result.reason === 'NOT_IN_PREPARATION'
                ? 'Open preparation before starting the round.'
                : 'Assign at least one player to a team first.',
            recoverable: true,
          });
          return;
        }

        // Story 8.2: per-team bomb generation slots in here — seeds derive
        // from (sessionId, roundNumber, teamId); BOMB_INIT broadcasts to the
        // team rooms joined below.

        // Persist BOTH keys before any emit. The two writes are not atomic;
        // accepted (same posture as SESSION_CREATE's two-key write). If the
        // first write succeeds and the second fails, the catch emits
        // ROUND_START_FAILED — but the session is already 'active' in Redis
        // and cannot be retried (ROUND_START requires 'preparation';
        // PREPARATION_OPEN refuses 'active'). Redis failure here is
        // considered catastrophic and extremely unlikely; no recovery path
        // is wired. Nothing is broadcast on failure.
        await deps.redis.setJSON(sessionKey(sessionId), result.state);
        await deps.redis.setJSON(roundKey(sessionId, result.round.roundNumber), result.round);

        // Route every roster socket into its team room (architecture
        // Pattern 1) so 8.4+ team-scoped broadcasts have a target.
        // Epic 3: voice tokens are re-minted here on role change.
        const sockets = await io.in(sessionRoom(sessionId)).fetchSockets();
        for (const member of sockets) {
          const teamId = result.state.players[member.id]?.teamId;
          if (teamId !== undefined) member.join(teamRoom(sessionId, teamId));
        }

        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);

        // Story 8.4: mint a server-authoritative timer per populated team
        // (those with a committed defuser). One `now` for the whole round so
        // every team's segment shares a startedAt. Each timerKey write is part
        // of the same accepted non-atomic multi-key posture as the session/round
        // writes above (single-process V1; no locks/WATCH). Team rooms are
        // already joined above, so the team-scoped TIMER_UPDATE reaches its
        // sockets. The timer runs independently of any bomb (Story 8.2 backlog).
        const now = deps.timer.now();
        for (const teamId of Object.keys(result.round.defusers) as TeamId[]) {
          const timer = startSegment(result.state.config.timerMs, now);
          await deps.redis.setJSON(timerKey(sessionId, teamId), timer);
          deps.timer.arm(sessionId, teamId, timer);
          io.to(teamRoom(sessionId, teamId)).emit('TIMER_UPDATE', timer);
          deps.log.info(
            { sessionId, roundNumber: result.round.roundNumber, teamId, timerMs: result.state.config.timerMs },
            'timer started',
          );
        }

        deps.log.info(
          {
            sessionId,
            roundNumber: result.round.roundNumber,
            defusers: result.round.defusers,
          },
          'round started',
        );
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'ROUND_START failed');
        // The per-team timer mint is non-atomic: an earlier team may already be
        // persisted, broadcast, AND armed when a later team's write throws. Cancel
        // every armed wake for this session so an orphan timer can't autonomously
        // fire BOMB_EXPLODED into a round the facilitator was just told failed.
        deps.timer.cancelSession(sessionId);
        socket.emit('ERROR', {
          code: 'ROUND_START_FAILED',
          message: 'Could not start the round. Try again.',
          recoverable: true,
        });
      }
    });
  });
}
