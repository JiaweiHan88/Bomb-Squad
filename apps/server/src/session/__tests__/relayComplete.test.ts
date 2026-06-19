import { describe, expect, it } from '@jest/globals';
import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';
import {
  equalisationRoundsOwed,
  isRelayComplete,
  maxRelayLength,
  naturalRoundRemains,
} from '../relayComplete.js';
import { createSessionState } from '../createSession.js';

/**
 * Build a between-rounds session from a compact team spec. `index` is the shared
 * rotation pointer (all teams advance together, so in practice it is equal across
 * teams = roundNumber-1); `played` is `equalisationRoundsPlayed`. Pure-state only.
 */
const team = (teamId: TeamId, len: number, index: number, played = 0): TeamState => ({
  teamId,
  relayOrder: Array.from({ length: len }, (_, i) => `${teamId}-p${i}`),
  currentDefuserIndex: index,
  cumulativeTimeMs: 0,
  roundTimesMs: [],
  equalisationRoundsPlayed: played,
});

const session = (...teams: TeamState[]): SessionState => ({
  ...createSessionState({ sessionId: 's', joinCode: 'ABC123', facilitatorId: 'fac' }),
  status: 'between-rounds',
  teams: Object.fromEntries(teams.map((t) => [t.teamId, t])) as SessionState['teams'],
});

describe('maxRelayLength', () => {
  it('is the longer team length (0 when no team)', () => {
    expect(maxRelayLength(session(team('A', 3, 2), team('B', 2, 1)))).toBe(3);
    expect(maxRelayLength(session())).toBe(0);
  });
});

describe('equalisationRoundsOwed', () => {
  it('the shorter team owes max-min; the longer team owes 0', () => {
    // 3v2 fresh: B owes 1.
    expect(equalisationRoundsOwed(session(team('A', 3, 2), team('B', 2, 2)))).toEqual({ A: 0, B: 1 });
  });

  it('decreases as the shorter team plays its equalisation rounds', () => {
    // 4v1: B owes 3 initially, 1 after two played.
    expect(equalisationRoundsOwed(session(team('A', 4, 3), team('B', 1, 3, 2)))).toEqual({ A: 0, B: 1 });
  });

  it('equal-size teams owe nothing', () => {
    expect(equalisationRoundsOwed(session(team('A', 3, 2), team('B', 3, 2)))).toEqual({ A: 0, B: 0 });
  });
});

describe('naturalRoundRemains', () => {
  it('is true while the longest team has an un-played slot', () => {
    // 3v3 after round 2 (index 1): one more natural round (index 2) remains.
    expect(naturalRoundRemains(session(team('A', 3, 1), team('B', 3, 1)))).toBe(true);
  });
  it('is false once every team has committed its last player', () => {
    expect(naturalRoundRemains(session(team('A', 3, 2), team('B', 2, 2)))).toBe(false);
  });
});

describe('isRelayComplete (terminal predicate)', () => {
  it('equal 3v3 — complete after 3 natural rounds, 0 equalisation owed', () => {
    expect(isRelayComplete(session(team('A', 3, 2), team('B', 3, 2)))).toBe(true);
    // Not complete one round earlier (a natural round still remains).
    expect(isRelayComplete(session(team('A', 3, 1), team('B', 3, 1)))).toBe(false);
  });

  it('odd 3v2 — NOT complete until B plays its owed equalisation round', () => {
    // Naturals exhausted (both index 2) but B still owes 1 → not complete.
    expect(isRelayComplete(session(team('A', 3, 2), team('B', 2, 2)))).toBe(false);
    // After B plays its 1 equalisation round → complete.
    expect(isRelayComplete(session(team('A', 3, 2), team('B', 2, 2, 1)))).toBe(true);
  });

  it('odd 4v1 — complete only after all 3 owed equalisation rounds', () => {
    expect(isRelayComplete(session(team('A', 4, 3), team('B', 1, 3, 0)))).toBe(false);
    expect(isRelayComplete(session(team('A', 4, 3), team('B', 1, 3, 2)))).toBe(false);
    expect(isRelayComplete(session(team('A', 4, 3), team('B', 1, 3, 3)))).toBe(true);
  });

  it('1v1 — complete after the single natural round', () => {
    expect(isRelayComplete(session(team('A', 1, 0), team('B', 1, 0)))).toBe(true);
  });

  it('single-team session — complete once that team exhausts its rotation', () => {
    expect(isRelayComplete(session(team('A', 2, 0)))).toBe(false);
    expect(isRelayComplete(session(team('A', 2, 1)))).toBe(true);
  });

  it('empty session (no populated team) is vacuously complete (handler guards with hasPopulatedTeam)', () => {
    expect(isRelayComplete(session())).toBe(true);
  });
});
