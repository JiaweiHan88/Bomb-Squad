/**
 * Server-authoritative expiry scheduler (Story 8.4, AC-1/AC-3).
 *
 * This is the ONE place in the server where `setTimeout` is legitimately used:
 * temporal authority is inherently I/O, not pure logic. It owns NO timer math —
 * every calculation delegates to `timerCore`. It only schedules wakeups and, on
 * fire, reloads + revalidates the stored timer before declaring expiry.
 *
 * SINGLE-PROCESS V1: wakes live in process memory; they do not survive a restart
 * and are not shared across instances. Accepted posture (same as the in-memory
 * load-modify-store race the handlers already document). No Redis-backed durable
 * scheduling.
 */
import type { TeamId, TimerState } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { timerKey } from '../state/keys.js';
import type { SessionIOServer, SessionLog } from '../handlers/sessionHandlers.js';
import { expiryInstant, isExpired } from './timerCore.js';
import { onTimerExpired, type TimerEffectDeps } from './onTimerExpired.js';

/** Opaque handle returned by the (injectable) timer primitive. */
export type TimerHandle = unknown;

export interface TimerSchedulerDeps {
  redis: RedisStore;
  io: SessionIOServer;
  log: SessionLog;
  /** Wall clock. Injected for deterministic tests; defaults to Date.now. */
  clock?: () => number;
  /** Schedule a one-shot wake. Injected for tests; defaults to setTimeout. */
  setTimer?: (cb: () => void, ms: number) => TimerHandle;
  /** Cancel a scheduled wake. Injected for tests; defaults to clearTimeout. */
  clearTimer?: (handle: TimerHandle) => void;
}

export interface TimerScheduler {
  /** Current server wall-clock (epoch ms). Handlers stamp timers via this. */
  now(): number;
  /** (Re)schedule the authoritative expiry wake for one team's timer. */
  arm(sessionId: string, teamId: TeamId, timer: TimerState): void;
  /** Cancel a team's pending wake (defuse / round-end / pause). */
  cancel(sessionId: string, teamId: TeamId): void;
  /** Cancel every pending wake for a session. */
  cancelSession(sessionId: string): void;
  /** Clear all pending wakes (server shutdown). */
  dispose(): void;
  /**
   * Run the fire path for a key NOW (reload → revalidate → resolve-if-expired).
   * This is exactly what a scheduled wake invokes; exposed so the expiry path is
   * testable without real timers and reusable for an already-past deadline.
   */
  fireNow(sessionId: string, teamId: TeamId): Promise<void>;
}

export function createTimerScheduler(deps: TimerSchedulerDeps): TimerScheduler {
  const clock = deps.clock ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const handles = new Map<string, TimerHandle>();
  const keyOf = (sessionId: string, teamId: TeamId): string => `${sessionId}:${teamId}`;

  function clearHandle(key: string): void {
    const existing = handles.get(key);
    if (existing !== undefined) {
      clearTimer(existing);
      handles.delete(key);
    }
  }

  function armTimer(sessionId: string, teamId: TeamId, timer: TimerState): void {
    const key = keyOf(sessionId, teamId);
    clearHandle(key); // replace any prior wake for this team
    const instant = expiryInstant(timer);
    if (instant === null) return; // paused → no live deadline, no wake
    // Round UP: a fractional expiryInstant (any multiplier that doesn't divide
    // remaining evenly, e.g. ×1.25) truncated by setTimeout could fire just
    // BEFORE the deadline, leaving the reloaded timer not-yet-expired. Ceil
    // guarantees the wake never fires early, so the revalidation in `fire`
    // sees a genuinely-expired timer.
    const delay = Math.max(0, Math.ceil(instant - clock()));
    const handle = setTimer(() => {
      void fire(sessionId, teamId);
    }, delay);
    handles.set(key, handle);
  }

  async function fire(sessionId: string, teamId: TeamId): Promise<void> {
    // The wake fired (or was fired manually); drop its handle first.
    handles.delete(keyOf(sessionId, teamId));

    // CRITICAL: reload + revalidate against the authoritative clock. Never
    // explode off the in-memory timer the wake was scheduled from — it may have
    // been rebased later (resume), paused (isExpired false), or the round may
    // have already resolved and the key been deleted.
    //
    // This runs on a bare setTimeout callback (no caller to await it), so any
    // rejection here would be an unhandledRejection — guard the whole body and
    // log, never let a Redis blip at expiry crash the process or silently lose
    // the round declaration.
    try {
      const now = clock();
      const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
      if (timer === null) return; // already resolved / cleared → no-op
      if (!isExpired(timer, now)) {
        // Not yet expired: a future deadline (resume) or a sub-ms-early wake
        // (the truncated setTimeout firing just before a fractional
        // expiryInstant). Re-arm at the true deadline rather than dropping the
        // wake — otherwise a running timer would silently never expire.
        if (timer.pausedAt === null) armTimer(sessionId, teamId, timer);
        return;
      }

      await onTimerExpired(effectDeps, sessionId, teamId, now);
    } catch (err) {
      deps.log.error({ err, sessionId, teamId }, 'timer expiry fire failed');
    }
  }

  const scheduler: TimerScheduler = {
    now: () => clock(),

    arm: armTimer,

    cancel(sessionId, teamId) {
      clearHandle(keyOf(sessionId, teamId));
    },

    cancelSession(sessionId) {
      const prefix = `${sessionId}:`;
      for (const key of [...handles.keys()]) {
        if (key.startsWith(prefix)) clearHandle(key);
      }
    },

    dispose() {
      for (const handle of handles.values()) clearTimer(handle);
      handles.clear();
    },

    fireNow: fire,
  };

  // The timeout ceremony cancels the resolving team's wake — its `timer` dep is
  // this scheduler. `fire` already dropped the handle, so the cancel is a no-op
  // on this path, but resolveRound's defuse/strike-3 callers rely on it.
  const effectDeps: TimerEffectDeps = {
    redis: deps.redis,
    io: deps.io,
    log: deps.log,
    timer: scheduler,
  };

  return scheduler;
}
