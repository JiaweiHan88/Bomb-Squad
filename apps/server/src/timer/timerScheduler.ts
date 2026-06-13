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

  const effectDeps: TimerEffectDeps = { redis: deps.redis, io: deps.io, log: deps.log };
  const handles = new Map<string, TimerHandle>();
  const keyOf = (sessionId: string, teamId: TeamId): string => `${sessionId}:${teamId}`;

  function clearHandle(key: string): void {
    const existing = handles.get(key);
    if (existing !== undefined) {
      clearTimer(existing);
      handles.delete(key);
    }
  }

  async function fire(sessionId: string, teamId: TeamId): Promise<void> {
    // The wake fired (or was fired manually); drop its handle first.
    handles.delete(keyOf(sessionId, teamId));

    // CRITICAL: reload + revalidate against the authoritative clock. Never
    // explode off the in-memory timer the wake was scheduled from — it may have
    // been rebased later (resume), paused (isExpired false), or the round may
    // have already resolved and the key been deleted.
    const now = clock();
    const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
    if (timer === null) return; // already resolved / cleared → no-op
    if (!isExpired(timer, now)) return; // paused or deadline moved later → no-op

    await onTimerExpired(effectDeps, sessionId, teamId);
  }

  return {
    now: () => clock(),

    arm(sessionId, teamId, timer) {
      const key = keyOf(sessionId, teamId);
      clearHandle(key); // replace any prior wake for this team
      const instant = expiryInstant(timer);
      if (instant === null) return; // paused → no live deadline, no wake
      const delay = Math.max(0, instant - clock());
      const handle = setTimer(() => {
        void fire(sessionId, teamId);
      }, delay);
      handles.set(key, handle);
    },

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
}
