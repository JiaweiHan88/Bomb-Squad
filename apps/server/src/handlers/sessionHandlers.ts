import { randomUUID } from 'node:crypto';
import type { Server as SocketIOServer, Socket as SocketIOSocket, DefaultEventsMap } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoundConfig,
  PlayerRole,
  SessionState,
  TeamId,
  BombState,
  TimerState,
  RoundState,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, joinCodeKey, roundKey, timerKey, bombKey } from '../state/keys.js';
import { startSegment } from '../timer/timerCore.js';
import type { TimerScheduler } from '../timer/timerScheduler.js';
import { generateJoinCode } from '../session/joinCode.js';
import { createSessionState } from '../session/createSession.js';
import { parseRoundConfig } from '../session/parseRoundConfig.js';
import { addPlayerToSession } from '../session/joinSession.js';
import { removePlayerFromSession } from '../session/removePlayerFromSession.js';
import {
  mintPlayerIdentity,
  storeReattachRecord,
  deleteReattachRecord,
  resolveReattachRecord,
} from '../session/identity.js';
import { assignPlayerToTeam } from '../session/assignTeam.js';
import { setPlayerReady } from '../session/setPlayerReady.js';
import { openPreparation } from '../session/openPreparation.js';
import { cancelPreparation } from '../session/cancelPreparation.js';
import { startRound, hasPopulatedTeam } from '../session/startRound.js';
import { retryRound } from '../session/retryRound.js';
import { isRelayComplete, pairIndexFor } from '../session/relayComplete.js';
import { undersizedTeams } from '@bomb-squad/shared';
import { designateEqualisationVolunteer } from '../session/equalisationVolunteer.js';
import { pauseSession, resumeSession, canResume, clearDisconnectedPlayer } from '../session/pauseSession.js';
import { freezeRoundTimers, resumeRoundTimers } from '../timer/pauseTimers.js';
import { initializeRoundBombs } from '../round/initializeRoundBombs.js';

/**
 * Server-assigned per-socket bookkeeping (Socket.IO `socket.data`). Pointers
 * only, never authority by themselves: they select which session key to load
 * and which player record this socket *is*; every authority decision is made
 * against the freshly Redis-loaded state, resolved by `playerId`.
 *
 * `playerId` is the **durable** id (Story 2.7) — minted at create/join, or
 * resolved from a reattach token by the reconnect middleware — NOT `socket.id`,
 * which Socket.IO rotates on every (re)connection. Authority gates read
 * `state.players[socket.data.playerId]`. Both fields are transient (die with
 * the socket); the durable identity itself survives in the reattach record.
 */
export interface SessionSocketData {
  sessionId?: string;
  playerId?: string;
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

/** The per-connection socket type carried by {@link SessionIOServer}. */
export type SessionServerSocket = SocketIOSocket<
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
  /** Lobby disconnect grace (Story 2.7): how long to wait before freeing a
   * disconnected player's seat. A refresh reconnects well within this window and
   * cancels the removal, so role/team/relayOrder survive (AC 4). A genuine leave
   * frees the slot after it elapses (AC 3). Default {@link DEFAULT_DISCONNECT_GRACE_MS}. */
  disconnectGraceMs?: number;
}

/** Default lobby disconnect grace — long enough for a page refresh round-trip,
 * short enough that a real departure frees the seat promptly. */
export const DEFAULT_DISCONNECT_GRACE_MS = 8000;

/** Socket.IO room for all participants of a session (architecture Pattern 1). */
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;

/** Socket.IO room for one team's sockets (architecture Pattern 1) — the
 * broadcast target Epic 8.4+ team-scoped bomb/timer events depend on. */
export const teamRoom = (sessionId: string, teamId: TeamId): string =>
  `session:${sessionId}:team:${teamId}`;

type ParseResult =
  | { ok: true; config?: Partial<RoundConfig> }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted SESSION_CREATE payload. Unwraps the
 * `{ config }` envelope (a missing payload/config is tolerated) and delegates
 * the config object to the shared {@link parseRoundConfig} in partial mode, so
 * SESSION_CREATE and ROUND_CONFIGURE share one validator.
 */
export function parseSessionCreatePayload(payload: unknown): ParseResult {
  if (payload === undefined || payload === null) return { ok: true };
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { config } = payload as { config?: unknown };
  if (config === undefined) return { ok: true };
  return parseRoundConfig(config, { full: false });
}

/** Structural equality of two RoundConfigs — the idempotent ROUND_CONFIGURE
 * no-op check (re-asserting the current config must not re-broadcast). */
function roundConfigEqual(a: RoundConfig, b: RoundConfig): boolean {
  if (
    a.difficulty !== b.difficulty ||
    a.moduleCount !== b.moduleCount ||
    a.timerMs !== b.timerMs ||
    a.strikeSpeedUpPct !== b.strikeSpeedUpPct ||
    a.modifiers.asymmetricExpertRoles !== b.modifiers.asymmetricExpertRoles ||
    a.modifiers.spectatorLifelines !== b.modifiers.spectatorLifelines
  ) {
    return false;
  }
  const ap = a.modulePool;
  const bp = b.modulePool;
  if (ap === undefined || bp === undefined) return ap === bp;
  return ap.length === bp.length && ap.every((id, i) => id === bp[i]);
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
 * Outcome of the atomic SESSION_JOIN transaction. The store owns the WATCH/MULTI
 * mechanics; this carries the accept/reject/no-op *meaning* back out (the only
 * side-channel from the pure `mutate`), with the committed snapshot threaded on
 * 'added' so the broadcast uses the post-commit state, never a racy re-read.
 */
type JoinOutcome =
  | { kind: 'vanished' }
  | { kind: 'rejoin' }
  | { kind: 'not-joinable' }
  | { kind: 'full' }
  | { kind: 'added'; state: SessionState };

/**
 * Outcome of a race-safe roster removal (disconnect cleanup / PLAYER_REMOVE).
 * The committed post-removal snapshot rides out on 'removed' so the broadcast
 * uses the post-commit state, not a racy re-read.
 */
type RemoveOutcome =
  | { kind: 'removed'; state: SessionState }
  | { kind: 'noop' };

/**
 * Outcome of the reconnect-restore re-add (Story 2.7, AC 4). Distinct from
 * {@link RemoveOutcome} so the discriminant tells the truth: a successful
 * restore is an *add*, not a removal. 'skipped' covers every can't-restore
 * branch (vanished / non-lobby / raced back in / full).
 */
type RestoreOutcome =
  | { kind: 'restored'; state: SessionState }
  | { kind: 'skipped' };

/**
 * Outcome of a race-safe ready toggle (Story 2.5). 'ready' carries the committed
 * post-toggle snapshot so the broadcast uses the post-commit state, never a racy
 * re-read; 'noop' covers every inert branch (vanished / non-lobby / unknown
 * player / value already set).
 */
type ReadyOutcome =
  | { kind: 'ready'; state: SessionState }
  | { kind: 'noop' };

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

type PlayerRemoveParseResult =
  | { ok: true; playerId: string }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted PLAYER_REMOVE payload (Story 2.7).
 * Bounds the opaque durable playerId (1–128 chars) and rebuilds a fresh object
 * — unknown extra keys are inert. Authority + self-target are the handler's job.
 */
export function parsePlayerRemovePayload(payload: unknown): PlayerRemoveParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { playerId } = payload as { playerId?: unknown };
  if (typeof playerId !== 'string' || playerId.length < 1 || playerId.length > 128) {
    return { ok: false, message: 'playerId must be a 1–128 character string' };
  }
  return { ok: true, playerId };
}

type PlayerReadyParseResult =
  | { ok: true; isReady: boolean }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted PLAYER_READY payload (Story 2.5).
 * `isReady` MUST be a strict boolean; rebuilds a fresh object so unknown extra
 * keys are inert. No playerId on the wire — the handler resolves the caller from
 * socket.data.playerId (a player only sets their own ready).
 */
export function parsePlayerReadyPayload(payload: unknown): PlayerReadyParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { isReady } = payload as { isReady?: unknown };
  if (typeof isReady !== 'boolean') {
    return { ok: false, message: 'isReady must be a boolean' };
  }
  return { ok: true, isReady };
}

type RoundRetryParseResult =
  | { ok: true; teamId: TeamId }
  | { ok: false; message: string };

/**
 * Boundary validation for the untrusted ROUND_RETRY payload (Story 8.8).
 * `teamId` MUST be 'A' or 'B'; rebuilds a fresh object so unknown extra keys are
 * inert. Authority + failed-round eligibility are the handler's job.
 */
export function parseRoundRetryPayload(payload: unknown): RoundRetryParseResult {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { teamId } = payload as { teamId?: unknown };
  if (teamId !== 'A' && teamId !== 'B') {
    return { ok: false, message: 'teamId must be A or B' };
  }
  return { ok: true, teamId };
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
 * Free a disconnected player's lobby seat (Story 2.7, AC 3). Race-safe via the
 * 2.6 updateJSON primitive; a no-op unless the session is still in `lobby` and
 * the player is still rostered (a status change or a reconnect-in-the-grace-
 * window makes it inert). Keeps the reattach record so identity survives.
 * Fired from the disconnect grace timer, never synchronously on disconnect.
 */
async function removeLobbyPlayer(
  io: SessionIOServer,
  deps: SessionHandlerDeps,
  sessionId: string,
  playerId: string,
): Promise<void> {
  try {
    const { result } = await deps.redis.updateJSON<SessionState, RemoveOutcome>(
      sessionKey(sessionId),
      (current) => {
        if (
          current === null ||
          current.status !== 'lobby' ||
          current.players[playerId] === undefined
        ) {
          return { commit: false, result: { kind: 'noop' } };
        }
        const next = removePlayerFromSession(current, playerId);
        return { commit: true, value: next, result: { kind: 'removed', state: next } };
      },
    );
    if (result.kind === 'removed') {
      io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
      deps.log.info({ sessionId, playerId }, 'lobby disconnect cleanup');
    }
  } catch (err) {
    deps.log.error({ err, sessionId }, 'disconnect cleanup failed');
  }
}

/**
 * Reconnect restore (Story 2.7, AC 4): if the handshake middleware resolved a
 * durable identity onto `socket.data`, re-attach this socket to its session
 * without a fresh SESSION_JOIN. Handles the Facilitator (who has no `?join=`
 * re-entry path) and joiners uniformly:
 *  - still in roster → converge (join room + re-emit snapshot, no write);
 *  - absent & lobby → re-add from the reattach record with the SAME durable id
 *    (no duplicate; frees-then-refills the slot, so no false capacity error);
 *  - absent & non-lobby → just resend the snapshot (Epic 8 owns mid-round).
 * Self-guarded (never throws into the connection callback).
 */
async function restoreReattachedSocket(
  io: SessionIOServer,
  deps: SessionHandlerDeps,
  socket: SessionServerSocket,
): Promise<void> {
  const sessionId = socket.data.sessionId;
  const playerId = socket.data.playerId;
  if (sessionId === undefined || playerId === undefined) return; // fresh client
  const auth = socket.handshake.auth as { reattachToken?: unknown };
  const reattachToken = typeof auth?.reattachToken === 'string' ? auth.reattachToken : null;

  try {
    const snapshot = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
    if (snapshot === null) return; // session evicted — nothing to restore

    await socket.join(sessionRoom(sessionId));

    // Track the freshest state we observe; the mid-round replay below decides on
    // this rather than the pre-await `snapshot`, which can go stale across the
    // restore awaits (a team assignment or round resolution landing in between).
    let latest: SessionState = snapshot;
    let restored = false;
    if (snapshot.players[playerId] === undefined && snapshot.status === 'lobby' && reattachToken !== null) {
      const record = await resolveReattachRecord(deps.redis, sessionId, reattachToken);
      if (record !== null) {
        const { result } = await deps.redis.updateJSON<SessionState, RestoreOutcome>(
          sessionKey(sessionId),
          (current) => {
            if (
              current === null ||
              current.status !== 'lobby' ||
              current.players[playerId] !== undefined || // raced back in
              Object.keys(current.players).length >= MAX_PLAYERS // full → can't restore
            ) {
              return { commit: false, result: { kind: 'skipped' } };
            }
            const next = addPlayerToSession(current, {
              playerId,
              displayName: record.displayName,
              role: record.role,
            });
            return { commit: true, value: next, result: { kind: 'restored', state: next } };
          },
        );
        if (result.kind === 'restored') {
          io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
          latest = result.state;
          restored = true;
        }
      }
    }

    if (!restored) {
      let fresh = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
      if (fresh !== null) {
        // DISCONNECT-PAUSE CLEAR (Story 8.7, FR13): a reconnecting participant who
        // was on the dropped list comes off it (the amber strip updates + the
        // resume-ready gate re-counts), broadcast to all. The session STAYS paused
        // until the facilitator resumes (AC-2). Otherwise just unicast the snapshot.
        // The live bomb/timer replay is handled by the mid-round replay block below
        // (timer-key-gated — only the ACTIVE team has a live timer under Model B, so
        // a resting reconnect is never re-sent a stale bomb).
        if (fresh.disconnectedPlayerIds.includes(playerId)) {
          const { result } = await deps.redis.updateJSON<SessionState, SessionState | null>(
            sessionKey(sessionId),
            (current) => {
              if (current === null) return { commit: false, result: null };
              const cleared = clearDisconnectedPlayer(current, playerId);
              return cleared === current
                ? { commit: false, result: current }
                : { commit: true, value: cleared, result: cleared };
            },
          );
          if (result !== null) fresh = result;
          io.to(sessionRoom(sessionId)).emit('SESSION_STATE', fresh);
        } else {
          socket.emit('SESSION_STATE', fresh);
        }
        latest = fresh;
      }
    }
    // Re-emit the identity (token unchanged) so the client refreshes its store.
    if (reattachToken !== null) {
      socket.emit('SESSION_IDENTITY', { sessionId, playerId, reattachToken });
    }

    // Mid-round replay: a socket reattaching during an active round (a browser
    // refresh) is only in the session room — it was never re-joined to its team
    // room nor re-sent the bomb. Without this it renders the DEV placeholder
    // modules and then goes stale on the next team-scoped MODULE_UPDATE/
    // TIMER_UPDATE. Re-join the team room and unicast the live bomb + timer
    // snapshot straight from Redis (read-only; ROUND_START remains the authority
    // that first armed them).
    //
    // The replay is gated on the timer key still existing. resolveRound deletes a
    // team's timer the instant it defuses/explodes/times out but keeps the session
    // 'active' while another team plays, and it never deletes the bomb key — so a
    // resolved-team refresh would otherwise replay a stale, still-playable-looking
    // bomb and (via the client's setBomb) wipe its result banner. A live timer ⟺
    // the team is still playing this round. Replaying the resolution banner itself
    // on a resolved-team refresh is mid-round sync (Epic 8), out of scope here.
    //
    // Bomb and timer are replayed both-or-neither: a live timer with no bomb
    // snapshot (e.g. only the bomb key evicted) would leave the client ticking
    // over the DEV placeholder modules — the very desync this fix prevents. The
    // reads are self-guarded so a missing OR corrupt key just skips the replay and
    // never fails the already-emitted SESSION_STATE/identity restore.
    if (latest.status === 'active') {
      const teamId = latest.players[playerId]?.teamId;
      if (teamId !== undefined) {
        await socket.join(teamRoom(sessionId, teamId));
        try {
          const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
          const bomb =
            timer !== null
              ? await deps.redis.getJSON<BombState>(bombKey(sessionId, teamId))
              : null;
          if (timer !== null && bomb !== null) {
            socket.emit('BOMB_INIT', bomb);
            socket.emit('TIMER_UPDATE', timer);
          }
        } catch (replayErr) {
          deps.log.info(
            { replayErr, sessionId, playerId, teamId },
            'mid-round bomb/timer replay skipped',
          );
        }
      }
    }

    deps.log.info({ sessionId, playerId, restored }, 'socket reattached');
  } catch (err) {
    deps.log.error({ err, socketId: socket.id }, 'reattach restore failed');
  }
}

/**
 * Mid-round disconnect auto-pause (Story 8.7, AC-2, FR13). Fired from the
 * `disconnect` handler when a participant (a player on a team) drops during an
 * ACTIVE round: freezes the clock IMMEDIATELY so no time is unfairly burned, names
 * the dropper for the amber strip, and resets the resume-ready gate. Race-safe via
 * the 2.6 `updateJSON` primitive (a team can be resolving concurrently). Only acts
 * on an `active` round with the player still on a team; every other phase is a
 * no-op (lobby cleanup is the grace-window path; between-rounds/ended don't pause).
 */
async function autoPauseOnDisconnect(
  io: SessionIOServer,
  deps: SessionHandlerDeps,
  sessionId: string,
  playerId: string,
): Promise<void> {
  try {
    const { result } = await deps.redis.updateJSON<SessionState, SessionState | null>(
      sessionKey(sessionId),
      (current) => {
        if (
          current === null ||
          current.status !== 'active' ||
          current.players[playerId]?.teamId === undefined
        ) {
          return { commit: false, result: null };
        }
        const next = pauseSession(current, {
          kind: 'disconnect',
          now: deps.timer.now(),
          droppedPlayerId: playerId,
        });
        if (next === current) return { commit: false, result: null };
        return { commit: true, value: next, result: next };
      },
    );
    if (result === null) return;

    // Freeze the live per-team timers (persists pausedAt, NEVER deletes the key).
    await freezeRoundTimers(io, deps, sessionId, Object.keys(result.teams) as TeamId[], deps.timer.now());
    io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result);
    const name = result.players[playerId]?.displayName ?? 'A player';
    io.to(sessionRoom(sessionId)).emit('PAUSED', { reason: `Player dropped: ${name}` });
    deps.log.info({ sessionId, playerId }, 'auto-paused (mid-round disconnect)');
  } catch (err) {
    deps.log.error({ err, sessionId, playerId }, 'auto-pause on disconnect failed');
  }
}

/**
 * Session lifecycle handlers. Canonical handler pipeline (architecture
 * Pattern 2): parse/validate → build state (pure factory) → persist to Redis →
 * join room → ack + broadcast. No game logic beyond that flow; the process
 * keeps no authoritative in-memory session state.
 */
export function registerSessionHandlers(io: SessionIOServer, deps: SessionHandlerDeps): void {
  const graceMs = deps.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  // Pending lobby-disconnect removals, keyed `${sessionId}:${playerId}`. A
  // disconnect schedules one; a reconnect (or a PLAYER_REMOVE) within the grace
  // cancels it — so a refresh never tears down the player's seat (AC 4) while a
  // genuine departure still frees it after the grace (AC 3).
  const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelPendingRemoval = (sessionId: string, playerId: string): void => {
    const key = `${sessionId}:${playerId}`;
    const timer = pendingRemovals.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingRemovals.delete(key);
    }
  };

  // Identity resolution middleware (Story 2.7): resolve a presented reattach
  // token into socket.data.playerId BEFORE any handler or the connection event
  // runs. Optional identity, NEVER access control — a bad/absent/expired token
  // leaves socket.data unset (a fresh client); the readiness gate owns access.
  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth as { sessionId?: unknown; reattachToken?: unknown };
      if (typeof auth?.sessionId === 'string' && typeof auth?.reattachToken === 'string') {
        const record = await resolveReattachRecord(deps.redis, auth.sessionId, auth.reattachToken);
        if (record !== null) {
          socket.data.sessionId = auth.sessionId;
          socket.data.playerId = record.playerId;
        }
      }
    } catch (err) {
      // Never block the handshake on a resolution error — treat as a fresh client.
      deps.log.error({ err }, 'reattach resolution failed');
    }
    next();
  });

  io.on('connection', (socket) => {
    // A reconnect within the grace window cancels the pending seat removal, so
    // the player's role/team/relayOrder are never torn down by a refresh (AC 4).
    if (socket.data.sessionId !== undefined && socket.data.playerId !== undefined) {
      cancelPendingRemoval(socket.data.sessionId, socket.data.playerId);
    }
    // Re-attach a reconnecting socket whose token the middleware resolved.
    void restoreReattachedSocket(io, deps, socket);

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
      // Mint the facilitator's durable identity (Story 2.7): the public playerId
      // becomes the roster + authority key; the secret reattachToken is returned
      // only to this socket via SESSION_IDENTITY and stored server-side.
      const { playerId, reattachToken } = mintPlayerIdentity();
      let joinCode: string | null = null;
      try {
        joinCode = await mintJoinCode(deps.redis);
        const state = createSessionState({
          sessionId,
          joinCode,
          facilitatorId: playerId,
          config: parsed.config,
        });

        // Persist BEFORE emitting; on persist failure emit nothing but ERROR.
        await deps.redis.setJSON(sessionKey(sessionId), state);
        await deps.redis.setJSON(joinCodeKey(joinCode), sessionId);
        await storeReattachRecord(deps.redis, sessionId, reattachToken, {
          playerId,
          displayName: 'Facilitator',
          role: 'facilitator',
        });

        await socket.join(sessionRoom(sessionId));
        socket.data.sessionId = sessionId;
        socket.data.playerId = playerId;
        ack({ sessionId, joinCode });
        // Private identity packet to the creator only — before the broadcast, so
        // the client has it when SESSION_STATE lands. AR15: never log the token.
        socket.emit('SESSION_IDENTITY', { sessionId, playerId, reattachToken });
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', state);
        // AR15: never log the joinCode or reattachToken — the session's secrets.
        deps.log.info({ sessionId, playerId }, 'session created');
      } catch (err) {
        // Best-effort rollback: the persists are not atomic, so the session/
        // joincode/reattach keys may be partially written. Without cleanup that
        // leaves an unreachable session orphaned in Redis.
        try {
          await deps.redis.del(sessionKey(sessionId));
          if (joinCode !== null) await deps.redis.del(joinCodeKey(joinCode));
          await deleteReattachRecord(deps.redis, sessionId, playerId);
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

      // Durable identity (Story 2.7): reuse an id already resolved from a
      // reattach token (set by the reconnect middleware), else mint a fresh one.
      // Only a fresh identity gets a new token + reattach record + SESSION_IDENTITY.
      const existingPlayerId = socket.data.playerId;
      const playerId = existingPlayerId ?? randomUUID();
      const mintedToken = existingPlayerId === undefined ? randomUUID() : null;

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

        // Already in the roster (by durable id): converge idempotently — re-assert
        // room membership, re-send the snapshot, change nothing, broadcast nothing.
        if (state.players[playerId] !== undefined) {
          await socket.join(sessionRoom(sessionId));
          socket.data.sessionId = sessionId;
          socket.data.playerId = playerId;
          socket.emit('SESSION_STATE', state);
          return;
        }

        // Capacity (AC 1) and the join-window (AC 2/3) are evaluated ATOMICALLY
        // against the WATCHed state inside updateJSON — a plain read-check ahead
        // of a separate write let two joins at 15 occupancy both pass and reach
        // 17 (deferred-work.md:65). The mutate is pure and may run once per retry;
        // per-attempt meaning rides out on `result`. 'between-rounds' admits;
        // Epic 8 owns relay eligibility for a late joiner. The roster is keyed by
        // the durable playerId (Story 2.7), never socket.id.
        const { result } = await deps.redis.updateJSON<SessionState, JoinOutcome>(
          sessionKey(sessionId),
          (current) => {
            if (current === null) return { commit: false, result: { kind: 'vanished' } };
            if (current.players[playerId] !== undefined) {
              return { commit: false, result: { kind: 'rejoin' } };
            }
            if (current.status !== 'lobby' && current.status !== 'between-rounds') {
              return { commit: false, result: { kind: 'not-joinable' } };
            }
            if (Object.keys(current.players).length >= MAX_PLAYERS) {
              return { commit: false, result: { kind: 'full' } };
            }
            const next = addPlayerToSession(current, {
              playerId,
              displayName: parsed.displayName,
              role: parsed.role,
            });
            return { commit: true, value: next, result: { kind: 'added', state: next } };
          },
        );

        if (result.kind === 'vanished') {
          // Session evicted between the pre-read and the transaction.
          notFound();
          return;
        }
        if (result.kind === 'rejoin') {
          // Became a rejoin between the fast-path read and the transaction —
          // converge as the fast path would; reload for the freshest snapshot.
          const fresh = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
          await socket.join(sessionRoom(sessionId));
          socket.data.sessionId = sessionId;
          socket.data.playerId = playerId;
          if (fresh !== null) socket.emit('SESSION_STATE', fresh);
          return;
        }
        if (result.kind === 'not-joinable') {
          socket.emit('ERROR', {
            code: 'SESSION_NOT_JOINABLE',
            message: 'That session has already started.',
            recoverable: true,
          });
          return;
        }
        if (result.kind === 'full') {
          socket.emit('ERROR', {
            code: 'SESSION_FULL',
            message: 'That session is full — 16 is the limit.',
            recoverable: true,
          });
          return;
        }

        // result.kind === 'added' — broadcast the committed snapshot the store
        // threaded back (not a re-read), so the broadcast can't reflect a later
        // interleaving write. Join the room BEFORE broadcasting so the joiner
        // receives their own join. Broadcast FIRST (before the reattach-record
        // write) so the roster update isn't delayed behind a Redis round-trip.
        await socket.join(sessionRoom(sessionId));
        socket.data.sessionId = sessionId;
        socket.data.playerId = playerId;
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
        if (mintedToken !== null) {
          await storeReattachRecord(deps.redis, sessionId, mintedToken, {
            playerId,
            displayName: parsed.displayName,
            role: parsed.role,
          });
          // Private identity packet to the joiner only. AR15: never log the token.
          socket.emit('SESSION_IDENTITY', { sessionId, playerId, reattachToken: mintedToken });
        }
        deps.log.info({ sessionId, playerId, role: parsed.role }, 'player joined');
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
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
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

        // EQUALISATION VOLUNTEER (Story 8.9, AC-2): TEAM_ASSIGN is REUSED to
        // designate the Facilitator's volunteer Defuser for an owed equalisation
        // round (no new socket event — Task 1). Permitted between rounds and in
        // preparation (the documented exception to "rotation is the sole Defuser
        // authority"); deliberately NARROW — a role-only designation of a player
        // already on the team, never a team move or relayOrder mutation. A round
        // that is actually running ('active'/'ended') stays locked.
        if (state.status === 'between-rounds' || state.status === 'preparation') {
          const result = designateEqualisationVolunteer(state, {
            teamId: parsed.teamId,
            playerId: parsed.playerId,
          });
          if (!result.ok) {
            socket.emit('ERROR', {
              code: result.reason === 'NO_EQUALISATION_OWED' ? 'NO_EQUALISATION_ROUND' : 'INVALID_VOLUNTEER',
              message:
                result.reason === 'NO_EQUALISATION_OWED'
                  ? 'That team has no equalisation round to staff.'
                  : 'The volunteer must be a player who already defused on that team.',
              recoverable: true,
            });
            return;
          }
          // Idempotent no-op (same volunteer re-asserted): no persist, no broadcast.
          if (result.state === state) return;
          await deps.redis.setJSON(sessionKey(sessionId), result.state);
          io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
          deps.log.info(
            { sessionId, teamId: parsed.teamId, volunteerId: parsed.playerId, by: socket.data.playerId },
            'equalisation volunteer designated',
          );
          return;
        }

        // Defensive phase guard: team composition is otherwise locked once a
        // round is active (and after the session ends).
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
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
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

        // RELAY-COMPLETE gate (Story 8.9, AC-4): advancing FROM 'between-rounds'
        // once every team has finished its rotation (incl. owed equalisation
        // rounds) must NOT silently wrap the rotation back to player 0 (the old
        // uncapped behaviour). Refuse with a typed RELAY_COMPLETE instead — Story
        // 8.10 owns the actual session-end transition. While the relay is NOT
        // complete the open proceeds: `openPreparation` advances the pointer and
        // `startRound` routes natural-vs-equalisation-vs-rest per team. The
        // volunteer for an owed equalisation round may still be undesignated here
        // — that is fine; the facilitator designates it (TEAM_ASSIGN) during the
        // preparation it is about to open, and ROUND_START enforces it.
        if (state.status === 'between-rounds' && isRelayComplete(state)) {
          socket.emit('ERROR', {
            code: 'RELAY_COMPLETE',
            message: 'The relay is complete — end the session.',
            recoverable: true,
          });
          return;
        }

        // Population guard (round 1 only): opening prep from the LOBBY with no
        // defuser-able player on any team strands the facilitator — ROUND_START
        // would then refuse with NO_POPULATED_TEAM. (Between-rounds is gated by
        // the relay-complete check above; a not-complete relay always has an
        // openable natural or equalisation round.) Same error code the Lobby
        // banner already owns; the message differs.
        if (state.status === 'lobby' && !hasPopulatedTeam(state)) {
          socket.emit('ERROR', {
            code: 'CANNOT_OPEN_PREP',
            message: 'Assign at least one player to a team first.',
            recoverable: true,
          });
          return;
        }

        // Minimum-team-size guard (Story 8.9 follow-up): a populated team of 1 is a
        // lone Defuser with no Expert to read the manual — it can never solve a
        // bomb (the Defuser↔Expert split IS the game). Refuse the round; a
        // single-team session is fine as long as that team has ≥2. Lobby-phase
        // only — team membership is locked once the relay starts, so round 2+
        // cannot regress below the minimum.
        if (state.status === 'lobby') {
          const tooSmall = undersizedTeams(state);
          if (tooSmall.length > 0) {
            socket.emit('ERROR', {
              code: 'TEAM_TOO_SMALL',
              message: 'Each team needs at least 2 players — one defuses while the rest read the manual.',
              recoverable: true,
            });
            return;
          }
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

    // Facilitator (re)configures the upcoming round (Story 8.1, FR8). Allowed
    // only in the pre-round windows (lobby / between-rounds) — once a round is
    // active the layout is fixed; round 2+ reuses the persisted config. Same
    // load → authority → guard → persist → broadcast pipeline as TEAM_ASSIGN.
    // No ack (frozen contract): success is the SESSION_STATE broadcast.
    socket.on('ROUND_CONFIGURE', async (payload) => {
      // The payload is server-untrusted; widen to validate the inner config.
      const raw = payload as unknown as { config?: unknown } | null | undefined;
      const parsed = parseRoundConfig(raw?.config, { full: true });
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
          return;
        }

        // Authority gate FIRST (a non-facilitator probe learns nothing).
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator configures the round.',
            recoverable: true,
          });
          return;
        }

        // Phase guard: config only lands before a round starts.
        if (state.status !== 'lobby' && state.status !== 'between-rounds') {
          socket.emit('ERROR', {
            code: 'NOT_IN_CONFIGURABLE_PHASE',
            message: 'The round can only be configured before it starts.',
            recoverable: true,
          });
          return;
        }

        // Idempotent no-op: re-asserting the current config changes nothing.
        if (roundConfigEqual(state.config, parsed.config)) return;

        const next: SessionState = { ...state, config: parsed.config };
        // Persist then emit. Single-key write — nothing partial to roll back.
        await deps.redis.setJSON(sessionKey(sessionId), next);
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info(
          {
            sessionId,
            difficulty: parsed.config.difficulty,
            moduleCount: parsed.config.moduleCount,
            by: socket.data.playerId,
          },
          'round configured',
        );
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'ROUND_CONFIGURE failed');
        socket.emit('ERROR', {
          code: 'ROUND_CONFIGURE_FAILED',
          message: 'Could not save the configuration. Try again.',
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
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
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
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator starts the round.',
            recoverable: true,
          });
          return;
        }

        const result = startRound(state);
        if (!result.ok) {
          const message =
            result.reason === 'NOT_IN_PREPARATION'
              ? 'Open preparation before starting the round.'
              : result.reason === 'EQUALISATION_VOLUNTEER_REQUIRED'
                ? 'Assign a volunteer Defuser for the equalisation round first.'
                : 'Assign at least one player to a team first.';
          socket.emit('ERROR', {
            // Story 8.9: a missing equalisation volunteer is its own recoverable
            // code so the client can prompt the Facilitator to designate one.
            code:
              result.reason === 'EQUALISATION_VOLUNTEER_REQUIRED'
                ? 'EQUALISATION_VOLUNTEER_REQUIRED'
                : 'CANNOT_START_ROUND',
            message,
            recoverable: true,
          });
          return;
        }

        // The active team (Story 8.11: exactly one in Model B) — the single set
        // the bomb generation and timer mint below both iterate.
        const teamIds = Object.keys(result.round.defusers) as TeamId[];

        // SEED BY PAIR, NOT TURN (Story 8.11, AC-2 — identical layout per pair).
        // Each `roundNumber` is one team's turn; keying the layout by the raw turn
        // would give the two teams DIFFERENT layouts and break FR19. The pair's two
        // matched turns share `pairIndex = ceil(roundNumber/2)`, so feeding it as
        // the round identifier reproduces an IDENTICAL layout for the pair while
        // `deriveTeamSeed` still diverges per team (independent values). A retry
        // reuses the same `roundNumber`, so `pairIndexFor` returns the same value →
        // the identical bomb regenerates (Story 8.8 reused-seed guarantee intact).
        const pairIndex = pairIndexFor(result.round.roundNumber);

        // Story 4.7 (closes the 8.2 seam): generate + persist every team's bomb
        // FIRST — before the session/round persist and before ANY broadcast.
        // Generation runs in one synchronous pass inside initializeRoundBombs and
        // validates the whole module pool up front, throwing on a bad config
        // (unregistered/empty pool, out-of-range moduleCount) BEFORE any write.
        // Doing it here means a bad round rejects into the catch below while the
        // session is still 'preparation' (and therefore retryable) and NO client
        // is ever flipped to an active round it has no bomb for. The bomb is
        // team-private; it is broadcast (BOMB_INIT) only after the timer is armed,
        // below. Same accepted non-atomic multi-key posture (single-process V1).
        const bombs = await initializeRoundBombs(
          deps.redis,
          sessionId,
          pairIndex,
          result.state.config,
          teamIds,
        );

        // Persist session + round. The writes are not atomic; accepted (same
        // posture as SESSION_CREATE's two-key write). Bomb generation already
        // succeeded above, so the failures left here are catastrophic Redis errors;
        // the catch cancels any armed timers and emits ROUND_START_FAILED. (Note:
        // once the session write lands the session is 'active' and ROUND_START is
        // no longer retryable — but generation, the one input-driven failure, has
        // already passed by this point.)
        await deps.redis.setJSON(sessionKey(sessionId), result.state);
        await deps.redis.setJSON(roundKey(sessionId, result.round.roundNumber), result.round);

        // Route every roster socket into its team room (architecture
        // Pattern 1) so 8.4+ team-scoped broadcasts have a target.
        // Epic 3: voice tokens are re-minted here on role change.
        const sockets = await io.in(sessionRoom(sessionId)).fetchSockets();
        for (const member of sockets) {
          // Resolve the roster entry by the durable playerId (Story 2.7), not the
          // rotating socket.id — players is keyed by the durable id now.
          const teamId = result.state.players[member.data.playerId ?? '']?.teamId;
          if (teamId !== undefined) member.join(teamRoom(sessionId, teamId));
        }

        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);

        // Story 8.4: mint + ARM a server-authoritative timer per populated team
        // BEFORE broadcasting BOMB_INIT. A defuser acts on the bomb snapshot, and
        // a strike (including the terminal 3rd) reads the live timer key — so the
        // key must already exist by the time the client can interact. One `now` for
        // the whole round so every team's segment shares a startedAt. Same accepted
        // non-atomic multi-key posture as the writes above.
        const now = deps.timer.now();
        for (const teamId of teamIds) {
          const timer = startSegment(result.state.config.timerMs, now);
          await deps.redis.setJSON(timerKey(sessionId, teamId), timer);
          deps.timer.arm(sessionId, teamId, timer);
          io.to(teamRoom(sessionId, teamId)).emit('TIMER_UPDATE', timer);
          deps.log.info(
            { sessionId, roundNumber: result.round.roundNumber, teamId, timerMs: result.state.config.timerMs },
            'timer started',
          );
        }

        // Now broadcast each team's PRIVATE bomb snapshot — after its timer is
        // armed (above) and the team rooms are joined, so the snapshot and its
        // clock are both ready when the client renders the bomb.
        for (const teamId of teamIds) {
          io.to(teamRoom(sessionId, teamId)).emit('BOMB_INIT', bombs[teamId]);
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

    // Facilitator retries a FAILED round (Story 8.8, FR14). No ack (frozen
    // contract): success is the SESSION_STATE broadcast (re-entering preparation
    // at the SAME roundNumber), failure a typed ERROR. Two-click flow symmetric
    // with the normal advance: ROUND_RETRY re-enters preparation, then the
    // facilitator's ROUND_START regenerates the IDENTICAL bomb (same roundNumber →
    // same seeds) and arms only the retried team. Same authority-gate-first →
    // phase guard → eligibility gate → pure transition → persist → broadcast
    // pipeline as every other facilitator action.
    socket.on('ROUND_RETRY', async (payload) => {
      const parsed = parseRoundRetryPayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
          return;
        }

        // Authority gate FIRST (a non-facilitator probe learns nothing — not even
        // whether the round failed). Resolve by durable playerId, never socket.id.
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', { code: 'NOT_FACILITATOR', message: 'Only the facilitator retries a round.', recoverable: true });
          return;
        }

        // Phase guard: retry is offered only between rounds (the round fully
        // resolved). A duplicate while already in preparation falls through to the
        // pure function's same-reference no-op.
        if (state.status !== 'between-rounds') {
          socket.emit('ERROR', {
            code: 'CANNOT_RETRY',
            message: 'You can only retry between rounds.',
            recoverable: true,
          });
          return;
        }

        // Eligibility gate (AC-3): only a team whose most-recent round outcome was
        // a FAILURE may retry. Load the persisted RoundState and read the
        // authoritative per-team outcome (Story 8.8 `outcomes`).
        const round = await deps.redis.getJSON<RoundState>(roundKey(sessionId, state.roundNumber));
        const outcome = round?.outcomes[parsed.teamId];
        if (outcome !== 'exploded' && outcome !== 'time-expired') {
          socket.emit('ERROR', {
            code: 'ROUND_NOT_FAILED',
            message: "That round wasn't failed — there's nothing to retry.",
            recoverable: true,
          });
          return;
        }

        const next = retryRound(state, parsed.teamId);
        if (next === state) return; // guard no-op

        // Persist then emit. Single-key write — nothing partial to roll back. The
        // identical-bomb regeneration + timer arm happen on the subsequent
        // ROUND_START (startRound routes to its retry branch via retryingTeamId).
        await deps.redis.setJSON(sessionKey(sessionId), next);
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        deps.log.info(
          { sessionId, roundNumber: state.roundNumber, teamId: parsed.teamId, by: socket.data.playerId },
          'round retry — re-entered preparation',
        );
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'ROUND_RETRY failed');
        socket.emit('ERROR', { code: 'ROUND_RETRY_FAILED', message: 'Could not retry the round. Try again.', recoverable: true });
      }
    });

    // Facilitator pauses the session (Story 8.7, AC-1, FR13). Payloadless; no ack:
    // success is the SESSION_STATE broadcast (+ frozen TIMER_UPDATEs for an active
    // round) + a PAUSED notification, failure a typed ERROR. Same authority-gate-
    // first → phase guard → pure transition → persist → broadcast pipeline as the
    // other facilitator actions. Pause is ORTHOGONAL to `status` (it freezes on top
    // of active/between-rounds), so the session resumes into the same phase.
    socket.on('FACILITATOR_PAUSE', async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
        return;
      }
      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
          return;
        }
        // Authority gate FIRST (a non-facilitator probe learns nothing).
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', { code: 'NOT_FACILITATOR', message: 'Only the facilitator pauses.', recoverable: true });
          return;
        }
        // Phase guard: pause only holds a live round or the between-rounds gap.
        if (state.status !== 'active' && state.status !== 'between-rounds') {
          socket.emit('ERROR', {
            code: 'CANNOT_PAUSE',
            message: 'There is nothing to pause right now.',
            recoverable: true,
          });
          return;
        }

        const now = deps.timer.now();
        const next = pauseSession(state, { kind: 'facilitator', now });
        if (next === state) return; // already paused — idempotent no-op

        await deps.redis.setJSON(sessionKey(sessionId), next);
        // Freeze the live per-team countdown (active round only; between-rounds has
        // no live timer). Persists the paused TimerState — NEVER deletes the key.
        if (state.status === 'active') {
          await freezeRoundTimers(io, deps, sessionId, Object.keys(next.teams) as TeamId[], now);
        }
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        io.to(sessionRoom(sessionId)).emit('PAUSED', { reason: 'Facilitator paused' });
        deps.log.info({ sessionId, from: state.status }, 'session paused (facilitator)');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'FACILITATOR_PAUSE failed');
        socket.emit('ERROR', { code: 'PAUSE_FAILED', message: 'Could not pause. Try again.', recoverable: true });
      }
    });

    // Facilitator resumes the session (Story 8.7, AC-1/AC-2, FR13). A
    // facilitator-kind pause resumes freely; a disconnect-kind pause requires every
    // participant ready (canResume). Re-arms the frozen per-team timers for an
    // active round.
    socket.on('FACILITATOR_RESUME', async () => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
        return;
      }
      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true });
          return;
        }
        // Authority gate FIRST.
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', { code: 'NOT_FACILITATOR', message: 'Only the facilitator resumes.', recoverable: true });
          return;
        }
        if (state.pausedAt === null) {
          socket.emit('ERROR', { code: 'NOT_PAUSED', message: 'The session is not paused.', recoverable: true });
          return;
        }
        // Disconnect-pause resume gate: every participant must be ready (AC-2).
        if (!canResume(state)) {
          socket.emit('ERROR', {
            code: 'PLAYERS_NOT_READY',
            message: 'All players must be ready to resume.',
            recoverable: true,
          });
          return;
        }

        const now = deps.timer.now();
        const pausedPhase = state.status; // pause is orthogonal; status is the pre-pause phase
        const next = resumeSession(state);
        await deps.redis.setJSON(sessionKey(sessionId), next);
        // Re-arm the per-team timers for an active round (fresh segment, preserved
        // strike speed-up). Between-rounds had no live timer to resume.
        if (pausedPhase === 'active') {
          await resumeRoundTimers(io, deps, sessionId, Object.keys(next.teams) as TeamId[], now);
        }
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next);
        io.to(sessionRoom(sessionId)).emit('RESUMED', { reason: 'Resumed' });
        deps.log.info({ sessionId, phase: pausedPhase }, 'session resumed');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'FACILITATOR_RESUME failed');
        socket.emit('ERROR', { code: 'RESUME_FAILED', message: 'Could not resume. Try again.', recoverable: true });
      }
    });

    // Facilitator removes a player from the lobby roster (Story 2.7, AC 1/2).
    // Modelled on TEAM_ASSIGN: load → facilitator-gate → race-safe mutate →
    // persist → broadcast. No ack (frozen mutation convention): success is the
    // SESSION_STATE broadcast + a SESSION_REMOVED notice to the target; failure
    // is a typed ERROR to the caller.
    socket.on('PLAYER_REMOVE', async (payload) => {
      const parsed = parsePlayerRemovePayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: 'You are not in a session.',
          recoverable: true,
        });
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          socket.emit('ERROR', {
            code: 'NOT_IN_SESSION',
            message: 'You are not in a session.',
            recoverable: true,
          });
          return;
        }

        // Authority: only the Facilitator may remove (resolved by durable id).
        if (state.players[socket.data.playerId ?? '']?.role !== 'facilitator') {
          socket.emit('ERROR', {
            code: 'NOT_FACILITATOR',
            message: 'Only the facilitator can remove players.',
            recoverable: true,
          });
          return;
        }

        // Self-target + unknown-target guard (AC 2): no writes.
        if (parsed.playerId === socket.data.playerId || state.players[parsed.playerId] === undefined) {
          socket.emit('ERROR', {
            code: 'INVALID_REMOVAL',
            message: "You can't remove that player.",
            recoverable: true,
          });
          return;
        }

        const { result } = await deps.redis.updateJSON<SessionState, RemoveOutcome>(
          sessionKey(sessionId),
          (current) => {
            if (current === null || current.players[parsed.playerId] === undefined) {
              return { commit: false, result: { kind: 'noop' } };
            }
            const next = removePlayerFromSession(current, parsed.playerId);
            return { commit: true, value: next, result: { kind: 'removed', state: next } };
          },
        );

        if (result.kind === 'noop') {
          // Target vanished between the guard and the transaction — nothing to do.
          return;
        }

        // A kick supersedes any pending disconnect-grace removal for this player.
        cancelPendingRemoval(sessionId, parsed.playerId);
        // Invalidate the kicked player's reattach token so they cannot re-attach
        // (a kick is permanent for this session, unlike a disconnect).
        await deleteReattachRecord(deps.redis, sessionId, parsed.playerId);

        // Notify the removed player's live socket(s), then broadcast the new roster.
        const room = io.sockets.adapter.rooms.get(sessionRoom(sessionId));
        if (room !== undefined) {
          for (const socketId of room) {
            const member = io.sockets.sockets.get(socketId);
            if (member?.data.playerId === parsed.playerId) {
              member.emit('SESSION_REMOVED', {
                message: 'The facilitator removed you from the session.',
              });
              member.leave(sessionRoom(sessionId));
            }
          }
        }
        io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
        deps.log.info({ sessionId, removedPlayerId: parsed.playerId }, 'player removed');
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'PLAYER_REMOVE failed');
        socket.emit('ERROR', {
          code: 'PLAYER_REMOVE_FAILED',
          message: 'Could not remove the player. Try again.',
          recoverable: true,
        });
      }
    });

    // A player toggles their OWN ready state (Story 2.5). The first self-service
    // mutation in the codebase: no facilitator gate (any player sets their own
    // ready), and no playerId on the wire — the caller is resolved from
    // socket.data.playerId, the same "never trust a client-supplied identity"
    // rule every other mutation follows. No ack (frozen mutation convention):
    // success is the SESSION_STATE broadcast, failure a typed ERROR to the caller.
    socket.on('PLAYER_READY', async (payload) => {
      const parsed = parsePlayerReadyPayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message: parsed.message, recoverable: true });
        return;
      }

      const sessionId = socket.data.sessionId;
      const playerId = socket.data.playerId;
      const notInSession = () =>
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: 'You are not in a session.',
          recoverable: true,
        });
      // A resolved player always has both pointers; defend the unresolved socket.
      if (sessionId === undefined || playerId === undefined) {
        notInSession();
        return;
      }

      try {
        // Race-safe via the 2.6 updateJSON primitive (same posture as the 2.7
        // removals) — never a hand-rolled load-modify-store. The mutate is pure
        // and may run once per retry; per-attempt meaning rides out on `result`.
        const { result } = await deps.redis.updateJSON<SessionState, ReadyOutcome>(
          sessionKey(sessionId),
          (current) => {
            // Ready is a pre-round affordance in the LOBBY (EXPERIENCE.md — ready
            // buttons are gone once the round starts), so a stray PLAYER_READY mid-
            // round is inert. Story 8.7 ADDS one more window: while the session is
            // paused for a mid-round DISCONNECT, participants ready up to satisfy the
            // resume gate (AC-2). Unknown/absent player → noop.
            const readyWindowOpen =
              current !== null &&
              (current.status === 'lobby' ||
                (current.pausedAt !== null && current.pauseKind === 'disconnect'));
            if (current === null || !readyWindowOpen || current.players[playerId] === undefined) {
              return { commit: false, result: { kind: 'noop' } };
            }
            const next = setPlayerReady(current, playerId, parsed.isReady);
            // Idempotent same-value toggle → same reference → nothing to commit.
            return next === current
              ? { commit: false, result: { kind: 'noop' } }
              : { commit: true, value: next, result: { kind: 'ready', state: next } };
          },
        );

        // 'noop' → return silently; the roster already shows the truth.
        if (result.kind === 'ready') {
          io.to(sessionRoom(sessionId)).emit('SESSION_STATE', result.state);
          deps.log.info({ sessionId, playerId, isReady: parsed.isReady }, 'player ready set');
        }
      } catch (err) {
        deps.log.error({ err, socketId: socket.id }, 'PLAYER_READY failed');
        socket.emit('ERROR', {
          code: 'PLAYER_READY_FAILED',
          message: 'Could not update ready state. Try again.',
          recoverable: true,
        });
      }
    });

    // Lobby-phase disconnect cleanup (Story 2.7, AC 3): a tab-close / network
    // drop must not leave a ghost roster entry that counts toward capacity. But
    // a refresh is also a disconnect, so removal is DEFERRED by a grace window —
    // a reconnect within it cancels the removal (AC 4: role/team/seat survive a
    // refresh). Only the lobby phase is ever cleaned; preparation/active/
    // between-rounds/ended disconnects are Epic 8 / FR13's pause concern. The
    // reattach record is always KEPT — disconnect frees the seat, not identity.
    socket.on('disconnect', () => {
      const sessionId = socket.data.sessionId;
      const playerId = socket.data.playerId;
      if (sessionId === undefined || playerId === undefined) return;
      // Refresh race: a page reload's NEW socket can connect (and cancel any
      // pending removal) BEFORE this OLD socket's disconnect fires. If another
      // live socket already holds this durable identity, the seat is still
      // occupied — scheduling a removal here would free an actively-connected
      // player's seat once the grace elapses (AC 4). Skip if any other connected
      // socket maps to the same player in this session.
      for (const other of io.sockets.sockets.values()) {
        if (
          other.id !== socket.id &&
          other.data.playerId === playerId &&
          other.data.sessionId === sessionId
        ) {
          return;
        }
      }
      const key = `${sessionId}:${playerId}`;
      // Lobby grace-window seat removal (Story 2.7) — scheduled regardless of phase
      // but `removeLobbyPlayer` no-ops unless the live session is in the lobby, so
      // it is harmless mid-round (a reconnect cancels it via cancelPendingRemoval).
      if (!pendingRemovals.has(key)) {
        const timer = setTimeout(() => {
          pendingRemovals.delete(key);
          void removeLobbyPlayer(io, deps, sessionId, playerId);
        }, graceMs);
        // Don't let a pending grace timer keep the process alive (clean shutdown/tests).
        if (typeof timer.unref === 'function') timer.unref();
        pendingRemovals.set(key, timer);
      }
      // Story 8.7 (FR13): a mid-round (active) participant disconnect ALSO auto-
      // pauses the round immediately (the lobby removal above no-ops there).
      void autoPauseOnDisconnect(io, deps, sessionId, playerId);
    });
  });
}
