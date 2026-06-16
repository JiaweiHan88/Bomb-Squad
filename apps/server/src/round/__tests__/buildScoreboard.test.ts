import { describe, expect, it } from '@jest/globals';
import type { SessionState, TeamState } from '@bomb-squad/shared';
import { createSessionState } from '../../session/createSession.js';
import { buildScoreboard } from '../buildScoreboard.js';

const team = (overrides: Partial<TeamState> & Pick<TeamState, 'teamId'>): TeamState => ({
  relayOrder: [],
  currentDefuserIndex: 0,
  cumulativeTimeMs: 0,
  roundTimesMs: [],
  ...overrides,
});

const sessionWith = (teams: SessionState['teams']): SessionState => ({
  ...createSessionState({ sessionId: 's', joinCode: 'ABC123', facilitatorId: 'fac' }),
  status: 'between-rounds',
  teams,
});

describe('buildScoreboard (Story 8.6)', () => {
  it('projects per-team cumulative + per-round breakdown', () => {
    const sb = buildScoreboard(
      sessionWith({
        A: team({ teamId: 'A', cumulativeTimeMs: 90_000, roundTimesMs: [40_000, 50_000] }),
        B: team({ teamId: 'B', cumulativeTimeMs: 120_000, roundTimesMs: [60_000, 60_000] }),
      }),
    );
    expect(sb.teams.A).toEqual({ cumulativeTimeMs: 90_000, rounds: [40_000, 50_000] });
    expect(sb.teams.B).toEqual({ cumulativeTimeMs: 120_000, rounds: [60_000, 60_000] });
  });

  it('provisional leader is the strictly-lowest cumulative time', () => {
    const sb = buildScoreboard(
      sessionWith({
        A: team({ teamId: 'A', cumulativeTimeMs: 90_000, roundTimesMs: [90_000] }),
        B: team({ teamId: 'B', cumulativeTimeMs: 120_000, roundTimesMs: [120_000] }),
      }),
    );
    expect(sb.winnerTeamId).toBe('A');
  });

  it('a tie leaves winnerTeamId undefined', () => {
    const sb = buildScoreboard(
      sessionWith({
        A: team({ teamId: 'A', cumulativeTimeMs: 100_000, roundTimesMs: [100_000] }),
        B: team({ teamId: 'B', cumulativeTimeMs: 100_000, roundTimesMs: [100_000] }),
      }),
    );
    expect(sb.winnerTeamId).toBeUndefined();
  });

  it('a team that has not played a round cannot lead', () => {
    const sb = buildScoreboard(
      sessionWith({
        A: team({ teamId: 'A', cumulativeTimeMs: 0, roundTimesMs: [] }),
        B: team({ teamId: 'B', cumulativeTimeMs: 120_000, roundTimesMs: [120_000] }),
      }),
    );
    // A's 0 is "unplayed", so B (the only team with a recorded round) leads.
    expect(sb.winnerTeamId).toBe('B');
  });

  it('omits an absent team (Partial map)', () => {
    const sb = buildScoreboard(
      sessionWith({ A: team({ teamId: 'A', cumulativeTimeMs: 50_000, roundTimesMs: [50_000] }) }),
    );
    expect(sb.teams.A).toBeDefined();
    expect(sb.teams.B).toBeUndefined();
    expect(sb.winnerTeamId).toBe('A');
  });

  it('no teams played → empty board, no leader', () => {
    const sb = buildScoreboard(sessionWith({}));
    expect(sb.teams).toEqual({});
    expect(sb.winnerTeamId).toBeUndefined();
  });
});
