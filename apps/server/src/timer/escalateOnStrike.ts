/**
 * Strike → timer escalation coupling (Story 8.4, AC-2).
 *
 * CALLER CONTRACT: this is the named server entry point the future server-side
 * MODULE_INTERACT handler (Story 8.2 / Epic-5 interaction wiring) calls AFTER
 * `bombReducer` increments `BombState.strikes`. Pass the NEW absolute team strike
 * total. There is no caller in this worktree yet (no bomb, no interaction
 * handler) — the coupling is exercised directly by tests.
 *
 * The rebased TimerState rides INSIDE the STRIKE payload (StrikePayload.timer);
 * a strike-driven rebase does NOT also emit a separate TIMER_UPDATE — STRIKE is
 * the single source of truth for that change.
 *
 * THIRD STRIKE: strike 3 is terminal (the explosion, owned by Story 8.5). The
 * timer therefore never escalates past ×1.56 (default): this function
 * early-returns at `strikes >= 3` and the timer math never runs on a 3rd strike.
 */
import type { SessionState, StrikeCount, TeamId, TimerState } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, timerKey } from '../state/keys.js';
import { teamRoom, type SessionIOServer, type SessionLog } from '../handlers/sessionHandlers.js';
import { rebaseForStrike } from './timerCore.js';
import type { TimerScheduler } from './timerScheduler.js';

export interface EscalateOnStrikeDeps {
  redis: RedisStore;
  io: SessionIOServer;
  log: SessionLog;
  timer: TimerScheduler;
}

export async function escalateOnStrike(
  deps: EscalateOnStrikeDeps,
  sessionId: string,
  teamId: TeamId,
  strikes: StrikeCount,
  now: number,
): Promise<void> {
  // 3rd strike ends the round (Story 8.5) — no timer escalation.
  if (strikes >= 3) return;
  // Sub-1 strike totals (0, or a desync/duplicate delivery) are not real strikes:
  // rebasing the segment and broadcasting STRIKE { strikes: 0 } would be spurious.
  if (strikes < 1) return;

  const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
  if (timer === null) {
    // A strike with no live timer is a desync (round already resolved, or never
    // started). Surface it, but never throw — the strike is a no-op for the clock.
    deps.log.error({ sessionId, teamId, strikes }, 'strike with no live timer — dropped');
    return;
  }

  const session = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
  if (session === null) {
    // No session but a live timer is a desync too — do not silently rebase at 0%
    // and broadcast STRIKE into a session that no longer exists. Logged no-op.
    deps.log.error({ sessionId, teamId, strikes }, 'strike with no session — dropped');
    return;
  }
  const strikeSpeedUpPct = session.config.strikeSpeedUpPct;

  const rebased = rebaseForStrike(timer, strikeSpeedUpPct, now);
  await deps.redis.setJSON(timerKey(sessionId, teamId), rebased);
  // The deadline moved earlier — re-arm the authoritative expiry wake.
  deps.timer.arm(sessionId, teamId, rebased);

  // STRIKE carries the NEW absolute strike total (not a delta) + the rebased
  // timer. The 4.5 strike HUD and 4.4 LCD render directly from this.
  deps.io.to(teamRoom(sessionId, teamId)).emit('STRIKE', { teamId, strikes, timer: rebased });

  deps.log.info({ sessionId, teamId, strikes, speedMultiplier: rebased.speedMultiplier }, 'strike escalated');
}
