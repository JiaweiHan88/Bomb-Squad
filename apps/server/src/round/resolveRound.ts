/**
 * Round-resolution ceremony (Story 8.5). The single code path all three outcomes
 * — defuse, 3rd strike, timeout — funnel through. The server RECORDS and
 * ANNOUNCES the result; it does not block on the cinematic (the 2s/3s scene holds
 * are client-side presentation, Task 5).
 *
 * IDEMPOTENCY FENCE (AC-4, per-team): a single `RoundState` is shared by both
 * racing teams, so its round-level `status` cannot express per-team resolution.
 * The authoritative per-team once-only fence is therefore the team's LIVE TIMER
 * KEY: it exists exactly once per active team and is deleted the first time that
 * team resolves. A second trigger for an already-resolved team (a late strike
 * after a defuse, a timer wake firing after an early defuse) finds no timer key
 * and is a logged no-op — never a second BOMB_DEFUSED/BOMB_EXPLODED, never a
 * double time entry. This is the same desync posture `onTimerExpired`'s fire path
 * and `escalateOnStrike` already use (timer-key-null → no-op). RoundState.status
 * is still recorded as the round-level outcome (last-writer-wins across teams);
 * the per-team result is carried by which event fired + that team's
 * cumulativeTimeMs (matching the ScoreboardPayload contract).
 *
 * ELAPSED-TIME CONVENTION (AC-5): the recorded `elapsedMs` is the *displayed*
 * elapsed = `config.timerMs - displayedRemaining(timer, now)`, computed once here
 * from the live `TimerState` via `timerCore.remainingMs` (the only timer math).
 * This is consistent across all three outcomes — at timeout `remainingMs` is 0 by
 * definition so displayed elapsed = `timerMs` (preserves 8.4 decision 6), and
 * under strikes the accelerated countdown is already baked into `remainingMs`, so
 * per-round time never over-counts. Story 8.10 sums this single definition.
 */
import type { RoundOutcome, RoundState, SessionState, TeamId, TimerState } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { roundKey, sessionKey, timerKey } from '../state/keys.js';
import { teamRoom, type SessionIOServer, type SessionLog } from '../handlers/sessionHandlers.js';
import { remainingMs } from '../timer/timerCore.js';
import type { TimerScheduler } from '../timer/timerScheduler.js';

export interface ResolveRoundDeps {
  redis: RedisStore;
  io: SessionIOServer;
  log: SessionLog;
  /** Only `cancel` is needed — the ceremony cancels the resolving team's wake. */
  timer: Pick<TimerScheduler, 'cancel'>;
}

/**
 * Resolve one team's round to a terminal `outcome`. `now` is the
 * server-authoritative instant the resolution fires (injected wall clock — never
 * `Date.now()`); it dates the displayed-elapsed computation.
 */
export async function resolveRound(
  deps: ResolveRoundDeps,
  sessionId: string,
  teamId: TeamId,
  outcome: RoundOutcome,
  now: number,
): Promise<void> {
  // FENCE: the live timer key is the per-team once-only gate. Null means this
  // team already resolved (key deleted below) or never had a live clock — either
  // way a no-op, never a second announcement.
  const timer = await deps.redis.getJSON<TimerState>(timerKey(sessionId, teamId));
  if (timer === null) {
    deps.log.info({ sessionId, teamId, outcome }, 'round already resolved (no live timer) — no-op');
    return;
  }

  const session = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
  if (session === null) {
    // Live timer but no session is a desync — surface it, never throw.
    deps.log.error({ sessionId, teamId, outcome }, 'resolve with no session — dropped');
    return;
  }

  const roundNumber = session.roundNumber;
  const round = await deps.redis.getJSON<RoundState>(roundKey(sessionId, roundNumber));
  if (round === null) {
    deps.log.error({ sessionId, teamId, outcome, roundNumber }, 'resolve with no round state — dropped');
    return;
  }

  const team = session.teams[teamId];
  if (team === undefined) {
    // Cannot record cumulativeTimeMs for a team that does not exist (Partial map).
    deps.log.error({ sessionId, teamId, outcome }, 'resolve for unknown team — dropped');
    return;
  }

  // Displayed elapsed (AC-5): one definition for all outcomes. remainingMs clamps
  // at 0, so this is bounded to [0, timerMs] — a strike-accelerated round cannot
  // over-count, and a timeout (remaining 0) records the full timerMs.
  const elapsedMs = Math.max(0, session.config.timerMs - remainingMs(timer, now));

  // (a) Clear the live clock BEFORE announcing. This trips the per-team fence
  // (so a stray re-arm/strike can no longer find a "live" timer and double-fire)
  // and cancels the pending wake — the same del-before-emit reasoning as
  // onTimerExpired. cancel() is a harmless no-op on the timeout path (the wake
  // already fired and dropped its own handle).
  deps.timer.cancel(sessionId, teamId);
  await deps.redis.del(timerKey(sessionId, teamId));

  // (b) Record elapsed into this team's cumulativeTimeMs and flip the session
  // toward the next phase. Immutable: spread new TeamState/SessionState, never
  // mutate in place (project rule).
  //
  // Story 8.6: between-rounds entry (scoreboard preview + ready gate) is owned by
  // 8.6 and is not yet merged, so we flip status → 'between-rounds' here as the
  // correct next phase for 8.6 to build on. We only flip from 'active' (never
  // regress a later phase). CAVEAT for 8.6: with two racing teams sharing one
  // session, the FIRST team to resolve flips the shared status; proper
  // both-teams-resolved gating belongs to 8.6's between-rounds entry. We never
  // emit SCOREBOARD here (AC-3). Also reconcile deferred-work: cancelPreparation
  // hard-codes a return to 'lobby' — once 'between-rounds' → preparation becomes
  // reachable it must restore the originating phase (8.6 follow-up).
  const updatedSession: SessionState = {
    ...session,
    status: session.status === 'active' ? 'between-rounds' : session.status,
    teams: {
      ...session.teams,
      [teamId]: { ...team, cumulativeTimeMs: team.cumulativeTimeMs + elapsedMs },
    },
  };
  await deps.redis.setJSON(sessionKey(sessionId), updatedSession);

  // (c) Record the round-level outcome (last-writer-wins across teams; see header).
  await deps.redis.setJSON(roundKey(sessionId, roundNumber), { ...round, status: outcome });

  // (d) Announce. BOMB_DEFUSED for a defuse; BOMB_EXPLODED for both failure
  // outcomes (DETONATED vs TIME EXPIRED is a client-side label, not a 3rd event).
  const event = outcome === 'defused' ? 'BOMB_DEFUSED' : 'BOMB_EXPLODED';
  deps.io.to(teamRoom(sessionId, teamId)).emit(event, { teamId, elapsedMs });

  deps.log.info({ sessionId, teamId, outcome, elapsedMs }, 'round resolved');
}

/**
 * Defuse trigger (AC-1). The future server-side MODULE_INTERACT handler (Story
 * 4.7) calls this AFTER `bombReducer` produces `BombState.solved` transitioning
 * false→true. There is no live caller in the repo yet (no interaction handler) —
 * exercised directly by tests, exactly as 8.4 did with `escalateOnStrike`.
 */
export async function onBombDefused(
  deps: ResolveRoundDeps,
  sessionId: string,
  teamId: TeamId,
  now: number,
): Promise<void> {
  await resolveRound(deps, sessionId, teamId, 'defused', now);
}

/**
 * 3rd-strike trigger (AC-2). `escalateOnStrike` deliberately early-returns at
 * `strikes >= 3` (the terminal strike escalates nothing); the interaction handler
 * (Story 4.7) calls THIS instead when the post-reduce strike total reaches 3.
 * Exercised directly by tests until that handler exists.
 */
export async function onThirdStrike(
  deps: ResolveRoundDeps,
  sessionId: string,
  teamId: TeamId,
  now: number,
): Promise<void> {
  await resolveRound(deps, sessionId, teamId, 'exploded', now);
}
