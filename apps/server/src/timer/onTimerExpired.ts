/**
 * Authoritative round-failure declaration on timer expiry (Story 8.4 AC-3 →
 * Story 8.5 ceremony).
 *
 * This is the function the expiry scheduler invokes ONLY after a reload +
 * revalidate has confirmed the server-authoritative clock genuinely reached 0.
 * A bomb fails by time when the SERVER says so — never a client's local clock.
 *
 * Story 8.5: the timeout path now delegates to `resolveRound('time-expired')`,
 * the single ceremony shared with the defuse and 3rd-strike paths. That ceremony
 * owns the `del` of the timer key, recording `cumulativeTimeMs`, flipping
 * `SessionState.status`, setting `RoundState.status`, and emitting
 * `BOMB_EXPLODED` — preserving the persist-then-emit / del-before-emit ordering
 * this file previously documented (now centralised in `resolveRound`).
 */
import type { TeamId } from '@bomb-squad/shared';
import { resolveRound, type ResolveRoundDeps } from '../round/resolveRound.js';

/** Deps the timeout path needs — identical to the shared ceremony's deps. */
export type TimerEffectDeps = ResolveRoundDeps;

export async function onTimerExpired(
  deps: TimerEffectDeps,
  sessionId: string,
  teamId: TeamId,
  now: number,
): Promise<void> {
  await resolveRound(deps, sessionId, teamId, 'time-expired', now);
}
