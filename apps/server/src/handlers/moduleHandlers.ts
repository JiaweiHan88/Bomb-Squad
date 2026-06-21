import type { BombState, SessionState, TeamId, TimerState } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { bombKey, sessionKey, timerKey } from '../state/keys.js';
import { bombReducer } from '../reducers/bombReducer.js';
import { escalateOnStrike } from '../timer/escalateOnStrike.js';
import { onBombDefused, onThirdStrike } from '../round/resolveRound.js';
import {
  teamRoom,
  type SessionIOServer,
  type SessionHandlerDeps,
} from './sessionHandlers.js';

/**
 * Untrusted MODULE_INTERACT payload, shaped at the boundary (project security
 * rule: never trust client input). Only the structural shape is checked here —
 * `teamId` authority (does this socket belong to that team as its defuser) is
 * decided against freshly-loaded session state in the handler, and `moduleIndex`
 * is range-checked against the loaded bomb. The module-specific `action` body is
 * validated by the module's own pure reducer (total: malformed → no-op, never
 * throws), so this layer only proves it is an object before it reaches there.
 */
type ModuleInteractParse =
  | { ok: true; teamId: TeamId; moduleIndex: number; action: object }
  | { ok: false; message: string };

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export function parseModuleInteractPayload(payload: unknown): ModuleInteractParse {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'payload must be an object' };
  }
  const { teamId, moduleIndex, action } = payload as {
    teamId?: unknown;
    moduleIndex?: unknown;
    action?: unknown;
  };
  if (typeof teamId !== 'string' || !TEAM_IDS.includes(teamId as TeamId)) {
    return { ok: false, message: 'teamId must be a valid team' };
  }
  // Number.isInteger rejects NaN/fractional indices; the range check happens
  // against the loaded bomb (the length isn't known until then).
  if (!Number.isInteger(moduleIndex) || (moduleIndex as number) < 0) {
    return { ok: false, message: 'moduleIndex must be a non-negative integer' };
  }
  if (action === null || typeof action !== 'object' || Array.isArray(action)) {
    return { ok: false, message: 'action must be an object' };
  }
  return { ok: true, teamId: teamId as TeamId, moduleIndex: moduleIndex as number, action };
}

/**
 * MODULE_INTERACT handler (Story 4.7) — the production reduce/persist/broadcast
 * path the client's dispatch backend targets. Thin I/O over the pure bomb
 * reducer (architecture: parse → load → reduce → persist → emit; reducers never
 * touch sockets/Redis):
 *
 *   1. Validate the untrusted payload shape, then resolve authority against
 *      fresh session state — the socket must be the committed Defuser of the
 *      claimed team (role-gated; a teammate Expert/Spectator must not interact).
 *   2. Load the team's private bomb, range-check moduleIndex against it.
 *   3. Reduce with the pure bombReducer (never mocked). A guard no-op (solved
 *      module, malformed action, out-of-contract module output) returns the same
 *      state ref → nothing is persisted or broadcast.
 *   4. Persist the new BombState, then broadcast MODULE_UPDATE (post-rollup
 *      module state — 'struck' is already rolled up to 'armed' by the reducer;
 *      the STRIKE travels separately) to the team room only (bomb is private).
 *   5. Couple bomb-level transitions to the round machinery:
 *      - strikes 1–2 → escalateOnStrike (rebases the timer, emits STRIKE).
 *      - strike 3    → onThirdStrike (8.5 explosion; escalateOnStrike
 *        early-returns at ≥3, so it must NOT be used for the terminal strike).
 *      - solved false→true → onBombDefused (8.5 defuse ceremony).
 *
 * Invalid input is rejected with a typed recoverable ERROR; the handler never
 * throws (the catch is a backstop for unexpected Redis failures).
 */
export function registerModuleHandlers(io: SessionIOServer, deps: SessionHandlerDeps): void {
  io.on('connection', (socket) => {
    socket.on('MODULE_INTERACT', async (payload) => {
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        socket.emit('ERROR', {
          code: 'NOT_IN_SESSION',
          message: "You're not in a session.",
          recoverable: true,
        });
        return;
      }

      const parsed = parseModuleInteractPayload(payload);
      if (!parsed.ok) {
        socket.emit('ERROR', {
          code: 'INVALID_MODULE_INTERACT',
          message: parsed.message,
          recoverable: true,
        });
        return;
      }
      const { teamId, moduleIndex, action } = parsed;

      try {
        const session = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (session === null) {
          socket.emit('ERROR', {
            code: 'NOT_IN_SESSION',
            message: "You're not in a session.",
            recoverable: true,
          });
          return;
        }

        // PAUSE GATE (Story 8.7): while the session is paused the clock is frozen,
        // so a bomb interaction must be refused — otherwise the Defuser could keep
        // cutting (and even detonate / resolve the round) during a hold, which the
        // frozen timer was meant to prevent. `pausedAt` is orthogonal to `status`
        // (a pause sits on top of an 'active' round), so this is the authoritative
        // check. Found in 8.11 interactive verification (bug ticket 2026-06-21).
        if (session.pausedAt !== null) {
          socket.emit('ERROR', {
            code: 'SESSION_PAUSED',
            message: 'The round is paused.',
            recoverable: true,
          });
          return;
        }

        // Authority: only the committed Defuser of the claimed team may interact
        // with that team's bomb (the bomb is team-private; a teammate Expert or a
        // foreign socket must be refused). Role is committed to 'defuser' at
        // ROUND_START, so session state alone settles this — no extra round read.
        const self = session.players[socket.data.playerId ?? ''];
        if (self === undefined || self.role !== 'defuser' || self.teamId !== teamId) {
          socket.emit('ERROR', {
            code: 'NOT_TEAM_DEFUSER',
            message: 'Only your own bomb can be touched.',
            recoverable: true,
          });
          return;
        }

        const bomb = await deps.redis.getJSON<BombState>(bombKey(sessionId, teamId));
        if (bomb === null) {
          socket.emit('ERROR', {
            code: 'NO_ACTIVE_BOMB',
            message: 'No bomb is active for your team.',
            recoverable: true,
          });
          return;
        }
        // Range-check against the loaded bomb (parse only proved >= 0).
        if (moduleIndex >= bomb.modules.length) {
          socket.emit('ERROR', {
            code: 'INVALID_MODULE_INTERACT',
            message: 'moduleIndex out of range',
            recoverable: true,
          });
          return;
        }
        // Round already detonated → reject. resolveRound deletes only the timer
        // key, not the bombKey, and a 3rd-strike (exploded) bomb keeps its modules
        // 'armed', so without this gate a late/queued cut would reduce, persist,
        // and broadcast a stray MODULE_UPDATE into an already-resolved round. (A
        // DEFUSED bomb needs no gate here: solved modules are inert in bombReducer,
        // so the no-op detection below already drops further interaction silently.)
        if (bomb.strikes >= 3) {
          socket.emit('ERROR', {
            code: 'NO_ACTIVE_BOMB',
            message: 'No bomb is active for your team.',
            recoverable: true,
          });
          return;
        }

        const next = bombReducer(bomb, { type: 'MODULE_ACTION', moduleIndex, payload: action });
        // No-op detection by the targeted module's referential identity. A guard
        // no-op (solved-inert module, malformed/out-of-bounds action, out-of-
        // contract output) leaves that module slot unchanged — and strikes/solved
        // only ever move as a consequence of the module changing, so an unchanged
        // slot means nothing to persist or broadcast. (Note `next === bomb` is
        // insufficient: bombReducer rebuilds a fresh BombState even when the
        // module reducer returns its input unchanged.) A legitimate no-op, not an
        // error.
        if (next.modules[moduleIndex] === bomb.modules[moduleIndex]) return;

        await deps.redis.setJSON(bombKey(sessionId, teamId), next);

        // Persist-then-emit: the post-rollup module snapshot is the authoritative
        // truth the client applies (it flips the solve LED). Bomb-private → team
        // room only.
        io.to(teamRoom(sessionId, teamId)).emit('MODULE_UPDATE', {
          moduleIndex,
          state: next.modules[moduleIndex],
        });

        // Couple bomb-level transitions to the round machinery. One server `now`
        // for the whole resolution so timer math is consistent.
        const now = deps.timer.now();
        const resolveDeps = { redis: deps.redis, io, log: deps.log, timer: deps.timer };

        if (next.strikes > bomb.strikes) {
          if (next.strikes >= 3) {
            // 3rd strike is terminal — the explosion ceremony, NOT a timer rebase
            // (escalateOnStrike deliberately early-returns at >= 3). But the
            // client still needs the strike-3 COUNT: the resolution banner labels
            // a loss DETONATED vs TIME EXPIRED purely from bomb.strikes, and the
            // strike HUD lights its 3rd dot from the STRIKE event. escalateOnStrike
            // (the usual STRIKE emitter) is skipped here, so broadcast the count
            // ourselves with the live (un-rebased) timer BEFORE the explosion, so
            // it lands before BOMB_EXPLODED. If the live timer is gone the round
            // already resolved — resolveRound's fence will no-op the explosion too,
            // so emitting nothing is correct.
            const liveTimer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
            if (liveTimer !== null) {
              io.to(teamRoom(sessionId, teamId)).emit('STRIKE', {
                teamId,
                strikes: next.strikes,
                timer: liveTimer,
              });
            }
            await onThirdStrike(resolveDeps, sessionId, teamId, now);
          } else {
            await escalateOnStrike(resolveDeps, sessionId, teamId, next.strikes, now);
          }
        }

        if (!bomb.solved && next.solved) {
          await onBombDefused(resolveDeps, sessionId, teamId, now);
        }
      } catch (err) {
        deps.log.error({ err, socketId: socket.id, teamId, moduleIndex }, 'MODULE_INTERACT failed');
        socket.emit('ERROR', {
          code: 'MODULE_INTERACT_FAILED',
          message: 'Could not apply your action. Try again.',
          recoverable: true,
        });
      }
    });
  });
}
