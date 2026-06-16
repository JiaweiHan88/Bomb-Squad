import type { ScoreboardPayload, SessionState, TeamId } from '@bomb-squad/shared';

/**
 * Pure projection of a session's standings into a `ScoreboardPayload` (Story 8.6).
 * No I/O, no clock — derived entirely from `session.teams`, which now carries the
 * per-round breakdown (`roundTimesMs`) and the running total (`cumulativeTimeMs`).
 *
 * `winnerTeamId` here is the PROVISIONAL leader for the between-rounds preview —
 * the team with the strictly-lowest cumulative time (GDD: lowest cumulative time
 * wins). It is left undefined on a tie or when no team has played. The session
 * winner is authoritative only at session end (Story 8.10); the preview copy must
 * read "leading"/"standings", never "winner".
 */
export function buildScoreboard(session: SessionState): ScoreboardPayload {
  const teams: ScoreboardPayload['teams'] = {};

  let leader: TeamId | undefined;
  let leaderTimeMs = Infinity;
  let tied = false;

  for (const team of Object.values(session.teams)) {
    teams[team.teamId] = {
      cumulativeTimeMs: team.cumulativeTimeMs,
      rounds: [...team.roundTimesMs],
    };

    // Provisional leader = strictly-lowest cumulative time. A team that has not
    // recorded a round (roundTimesMs empty) cannot lead the preview.
    if (team.roundTimesMs.length === 0) continue;
    if (team.cumulativeTimeMs < leaderTimeMs) {
      leaderTimeMs = team.cumulativeTimeMs;
      leader = team.teamId;
      tied = false;
    } else if (team.cumulativeTimeMs === leaderTimeMs) {
      tied = true;
    }
  }

  return tied || leader === undefined ? { teams } : { teams, winnerTeamId: leader };
}
