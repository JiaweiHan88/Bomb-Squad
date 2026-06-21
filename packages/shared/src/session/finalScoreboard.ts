import type { RoundOutcome, SessionState, TeamId, TeamState } from '../types/index.js';

/**
 * Authoritative final scoring (Story 8.10, FR45). Pure projection of `SessionState`
 * — no I/O, no clock, no randomness. SHARED so the server (the archive writer + the
 * session-end SCOREBOARD emit) and the client (the final-scoreboard surface) compute
 * the SAME winner from the SAME per-team data and can never drift — the same
 * discipline `relay.ts` / `buildScoreboard.ts` follow.
 *
 * ── Scoring model ──────────────────────────────────────────────────────────
 * Time-only (no per-module points). Each team's `cumulativeTimeMs` is the sum of
 * its `roundTimesMs`, already maintained by `resolveRound` (a FAILED round
 * contributes a full-timer penalty — Story 8.10 Task 0; a defuse its real elapsed).
 * The WINNER is the team with the STRICTLY-lowest cumulative time among teams that
 * played ≥1 round. A tie (two teams equal-lowest) or a single-team session yields
 * NO winner — `winnerTeamId` undefined; `isDraw` distinguishes a genuine two-team
 * tie ("It's a draw") from a one-team / no-rounds session ("session complete").
 *
 * `roundOutcomes[i]` pairs with `roundTimesMs[i]` (lock-step, Story 8.10) so the
 * round-by-round breakdown carries each turn's defused ✓ / detonated ✗ result.
 */

/** One team's final result: cumulative time + the per-round (time, outcome) breakdown. */
export interface FinalTeamResult {
  teamId: TeamId;
  cumulativeTimeMs: number;
  /** Per-round breakdown in turn order. `elapsedMs[i]` is the SCORED time (penalty
   * already applied for a failed round); `outcome[i]` its result. */
  rounds: { elapsedMs: number; outcome: RoundOutcome }[];
}

export interface FinalScoreboard {
  /** Present teams, sorted by `cumulativeTimeMs` ascending (the standings order). */
  teams: FinalTeamResult[];
  /** The strictly-lowest-cumulative team; undefined on a tie or a single-team/no-rounds session. */
  winnerTeamId?: TeamId;
  /** True only when ≥2 teams played and the lowest cumulative is shared (a genuine draw). */
  isDraw: boolean;
}

/** A team counts toward scoring once it has recorded at least one round. */
function hasPlayed(team: TeamState): boolean {
  return team.roundTimesMs.length > 0;
}

function teamResult(team: TeamState): FinalTeamResult {
  return {
    teamId: team.teamId,
    cumulativeTimeMs: team.cumulativeTimeMs,
    rounds: team.roundTimesMs.map((elapsedMs, i) => ({
      elapsedMs,
      // Lock-step invariant; fall back defensively to a defuse label if an older
      // session ever lacked the outcome at index i (never expected post-8.10).
      outcome: team.roundOutcomes[i] ?? 'defused',
    })),
  };
}

/**
 * Project the session's authoritative final scoreboard. Winner = strictly-lowest
 * cumulative time among teams that played; undefined on a tie or single-team session.
 */
export function buildFinalScoreboard(session: SessionState): FinalScoreboard {
  const played = (Object.values(session.teams) as TeamState[]).filter(hasPlayed);
  const teams = played
    .map(teamResult)
    .sort((a, b) => a.cumulativeTimeMs - b.cumulativeTimeMs);

  if (teams.length === 0) {
    return { teams, winnerTeamId: undefined, isDraw: false };
  }

  const lowest = teams[0]!.cumulativeTimeMs;
  const lowestCount = teams.filter((t) => t.cumulativeTimeMs === lowest).length;

  // Strict winner only: a single team at the lowest time AND at least two teams in
  // contention. One team that played alone is "session complete", not a win.
  if (teams.length >= 2 && lowestCount === 1) {
    return { teams, winnerTeamId: teams[0]!.teamId, isDraw: false };
  }
  // Two-or-more teams sharing the lowest time → a draw. Otherwise (single team) no winner.
  return { teams, winnerTeamId: undefined, isDraw: teams.length >= 2 };
}
