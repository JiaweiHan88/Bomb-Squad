import { describe, expect, it } from '@jest/globals';
import { buildFinalScoreboard } from '../finalScoreboard.js';
import type { RoundOutcome, SessionState, TeamId, TeamState } from '../../types/index.js';

/** A team with explicit per-round (time, outcome) history. cumulativeTimeMs = sum(times). */
function team(
  teamId: TeamId,
  rounds: { t: number; o: RoundOutcome }[],
): TeamState {
  return {
    teamId,
    relayOrder: rounds.map((_, i) => `${teamId}-p${i}`),
    currentDefuserIndex: rounds.length,
    cumulativeTimeMs: rounds.reduce((sum, r) => sum + r.t, 0),
    roundTimesMs: rounds.map((r) => r.t),
    roundOutcomes: rounds.map((r) => r.o),
    equalisationRoundsPlayed: 0,
  };
}

function session(...teams: TeamState[]): SessionState {
  const map: SessionState['teams'] = {};
  for (const t of teams) map[t.teamId] = t;
  return {
    sessionId: 's',
    joinCode: 'ABC123',
    status: 'between-rounds',
    config: { timerMs: 300_000 } as SessionState['config'],
    players: {},
    teams: map,
    roundNumber: teams.reduce((n, t) => n + t.roundTimesMs.length, 0),
    pausedAt: null,
    pauseKind: null,
    disconnectedPlayerIds: [],
  };
}

describe('buildFinalScoreboard (Story 8.10, FR45)', () => {
  it('the strictly-lowest cumulative time wins', () => {
    const fb = buildFinalScoreboard(
      session(
        team('A', [{ t: 40_000, o: 'defused' }, { t: 50_000, o: 'defused' }]), // 90k
        team('B', [{ t: 60_000, o: 'defused' }, { t: 60_000, o: 'defused' }]), // 120k
      ),
    );
    expect(fb.winnerTeamId).toBe('A');
    expect(fb.isDraw).toBe(false);
    // Standings sorted ascending by cumulative time.
    expect(fb.teams.map((t) => t.teamId)).toEqual(['A', 'B']);
    expect(fb.teams[0]!.cumulativeTimeMs).toBe(90_000);
  });

  it('a failed round (full-timer penalty already in the totals) can lose the session', () => {
    // B defused fast but A detonated once → A carries a 300k penalty round and loses.
    const fb = buildFinalScoreboard(
      session(
        team('A', [{ t: 300_000, o: 'exploded' }, { t: 20_000, o: 'defused' }]), // 320k
        team('B', [{ t: 50_000, o: 'defused' }, { t: 50_000, o: 'defused' }]), // 100k
      ),
    );
    expect(fb.winnerTeamId).toBe('B');
    // Round-by-round breakdown carries the per-turn outcome icons.
    expect(fb.teams.find((t) => t.teamId === 'A')!.rounds).toEqual([
      { elapsedMs: 300_000, outcome: 'exploded' },
      { elapsedMs: 20_000, outcome: 'defused' },
    ]);
  });

  it('a tie (equal lowest cumulative across two teams) declares NO winner — a draw', () => {
    const fb = buildFinalScoreboard(
      session(
        team('A', [{ t: 50_000, o: 'defused' }]),
        team('B', [{ t: 50_000, o: 'defused' }]),
      ),
    );
    expect(fb.winnerTeamId).toBeUndefined();
    expect(fb.isDraw).toBe(true);
  });

  it('a single-team session has no winner and is NOT a draw (session complete)', () => {
    const fb = buildFinalScoreboard(session(team('A', [{ t: 50_000, o: 'defused' }])));
    expect(fb.winnerTeamId).toBeUndefined();
    expect(fb.isDraw).toBe(false);
    expect(fb.teams).toHaveLength(1);
  });

  it('teams that never recorded a round are excluded; no winner when nobody played', () => {
    const fb = buildFinalScoreboard(session(team('A', []), team('B', [])));
    expect(fb.teams).toHaveLength(0);
    expect(fb.winnerTeamId).toBeUndefined();
    expect(fb.isDraw).toBe(false);
  });
});
