import { describe, expect, it } from '@jest/globals';
import type { SessionState, TeamId } from '@bomb-squad/shared';
import { endSession } from '../endSession.js';
import { createSessionState } from '../createSession.js';

/** A between-rounds session with two exhausted (relay-complete) equal-size teams. */
function complete(): SessionState {
  const base = createSessionState({ sessionId: 's', joinCode: 'ABC123', facilitatorId: 'fac' });
  return {
    ...base,
    status: 'between-rounds',
    roundNumber: 4,
    activeTeamId: 'A' as TeamId,
    retryingTeamId: 'B' as TeamId,
    teams: {
      A: {
        teamId: 'A',
        relayOrder: ['a0', 'a1'],
        currentDefuserIndex: 2,
        cumulativeTimeMs: 80_000,
        roundTimesMs: [40_000, 40_000],
        roundOutcomes: ['defused', 'defused'],
        equalisationRoundsPlayed: 0,
      },
      B: {
        teamId: 'B',
        relayOrder: ['b0', 'b1'],
        currentDefuserIndex: 2,
        cumulativeTimeMs: 120_000,
        roundTimesMs: [60_000, 60_000],
        roundOutcomes: ['defused', 'exploded'],
        equalisationRoundsPlayed: 0,
      },
    },
  };
}

describe('endSession (Story 8.10)', () => {
  it('between-rounds + relay-complete → ended, clearing transient per-round intent', () => {
    const next = endSession(complete());
    expect(next.status).toBe('ended');
    expect(next.activeTeamId).toBeUndefined();
    expect(next.retryingTeamId).toBeUndefined();
    // Standings data is untouched — the final scoreboard reads it.
    expect(next.teams.A!.roundOutcomes).toEqual(['defused', 'defused']);
  });

  it('an INCOMPLETE relay is a same-reference no-op', () => {
    const state = complete();
    // Team A still owes a natural round → not complete.
    state.teams.A!.currentDefuserIndex = 1;
    expect(endSession(state)).toBe(state);
  });

  it('a non-between-rounds status is a same-reference no-op', () => {
    const state = { ...complete(), status: 'active' as const };
    expect(endSession(state)).toBe(state);
  });

  it('an already-ended session is a same-reference no-op', () => {
    const state = { ...complete(), status: 'ended' as const };
    expect(endSession(state)).toBe(state);
  });
});
