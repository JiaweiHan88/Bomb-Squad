import type { TeamId, TimerState } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { timerKey } from '../state/keys.js';
import { teamRoom, type SessionIOServer, type SessionLog } from '../handlers/sessionHandlers.js';
import { pause as pauseTimer, resume as resumeTimer } from './timerCore.js';
import type { TimerScheduler } from './timerScheduler.js';

/**
 * Per-team timer freeze/resume effect for the Story 8.7 pause (active round only).
 * The pure pause math lives in `timerCore` (Story 8.4); this is the thin I/O wrapper
 * the pause/resume handlers run alongside `pauseSession`/`resumeSession`.
 */
export interface PauseTimerDeps {
  redis: RedisStore;
  log: SessionLog;
  /** Only arm/cancel are needed — freeze cancels the wake, resume re-arms it. */
  timer: Pick<TimerScheduler, 'arm' | 'cancel'>;
}

/**
 * FREEZE every live team timer for an active round (Story 8.7 AC-2/AC-4): set
 * `pausedAt` (the LCD freezes — `timerLcd.ts` already respects it), CANCEL the
 * scheduler wake, and emit the frozen `TIMER_UPDATE`.
 *
 * CRITICAL: the timer Redis key is PERSISTED with `pausedAt` set, NEVER deleted —
 * the between-rounds all-teams-resolved gate (`resolveRound.ts`) keys on live
 * timer keys, so deleting one would mis-fire the gate (deferred-work.md). A team
 * with no live timer (resolved / resting this round) is skipped.
 */
export async function freezeRoundTimers(
  io: SessionIOServer,
  deps: PauseTimerDeps,
  sessionId: string,
  teamIds: TeamId[],
  now: number,
): Promise<void> {
  for (const teamId of teamIds) {
    const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
    if (timer === null) continue; // no live timer — nothing to freeze
    // Cancel the wake regardless (a paused timer is non-expirable, but free the handle).
    deps.timer.cancel(sessionId, teamId);
    const paused = pauseTimer(timer, now);
    if (paused === timer) continue; // already paused — wake cancelled above
    await deps.redis.setJSON(timerKey(sessionId, teamId), paused);
    io.to(teamRoom(sessionId, teamId)).emit('TIMER_UPDATE', paused);
    deps.log.info({ sessionId, teamId }, 'timer frozen (pause)');
  }
}

/**
 * RESUME every paused team timer (Story 8.7 AC-4): start a FRESH segment carrying
 * the frozen remaining (the paused span is never subtracted and the strike
 * `speedMultiplier` is preserved — `timerCore.resume`), RE-ARM the scheduler wake
 * at the fresh deadline, and emit the running `TIMER_UPDATE`.
 */
export async function resumeRoundTimers(
  io: SessionIOServer,
  deps: PauseTimerDeps,
  sessionId: string,
  teamIds: TeamId[],
  now: number,
): Promise<void> {
  for (const teamId of teamIds) {
    const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
    if (timer === null) continue;
    const resumed = resumeTimer(timer, now);
    if (resumed === timer) continue; // wasn't paused
    await deps.redis.setJSON(timerKey(sessionId, teamId), resumed);
    deps.timer.arm(sessionId, teamId, resumed);
    io.to(teamRoom(sessionId, teamId)).emit('TIMER_UPDATE', resumed);
    deps.log.info({ sessionId, teamId }, 'timer resumed');
  }
}
