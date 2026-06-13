/**
 * Authoritative round-failure declaration on timer expiry (Story 8.4, AC-3).
 *
 * This is the function the expiry scheduler invokes ONLY after a reload +
 * revalidate has confirmed the server-authoritative clock genuinely reached 0.
 * A bomb fails by time when the SERVER says so — never a client's local clock.
 *
 * SCOPE FENCE (8.5 owns the ceremony): this declares the timeout and clears the
 * team's live clock — nothing more. It does NOT record `cumulativeTimeMs`, flip
 * `SessionState.status`, play the explosion scene, emit `SCOREBOARD`, or write
 * Postgres. Story 8.5 (Round Resolution) hooks the full ceremony where marked.
 */
import type { SessionState, TeamId } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey, timerKey } from '../state/keys.js';
import { teamRoom, type SessionIOServer, type SessionLog } from '../handlers/sessionHandlers.js';

export interface TimerEffectDeps {
  redis: RedisStore;
  io: SessionIOServer;
  log: SessionLog;
}

export async function onTimerExpired(
  deps: TimerEffectDeps,
  sessionId: string,
  teamId: TeamId,
): Promise<void> {
  // The displayed clock reached 0 by definition, so the elapsed display time at
  // timeout is the configured round duration. (Real wall-clock elapsed differs
  // once strikes rebase the segment; the honest "displayed elapsed" is timerMs.)
  const session = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
  const elapsedMs = session?.config.timerMs ?? 0;

  // Declare the authoritative timeout to the team. BOMB_EXPLODED already exists
  // (ServerToClientEvents); RoundEndPayload = { teamId, elapsedMs }.
  deps.io.to(teamRoom(sessionId, teamId)).emit('BOMB_EXPLODED', { teamId, elapsedMs });

  // A resolved round has no live clock — drop the team timer key.
  await deps.redis.del(timerKey(sessionId, teamId));

  // Story 8.5: round-resolution ceremony hooks here — record time into
  // cumulativeTimeMs, flip status to 'between-rounds', explosion scene + hold,
  // SCOREBOARD. 8.4 only declares the authoritative timeout.

  deps.log.info({ sessionId, teamId, reason: 'timeout' }, 'round failed');
}
