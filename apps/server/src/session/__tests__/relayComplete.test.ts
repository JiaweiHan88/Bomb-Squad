import { describe, expect, it } from '@jest/globals';
import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';
import {
  equalisationRoundsOwed,
  isRelayComplete,
  maxRelayLength,
  naturalRoundRemains,
  selectActiveTeam,
  pairIndexFor,
} from '../relayComplete.js';
import { undersizedTeams, MIN_TEAM_SIZE } from '@bomb-squad/shared';
import { createSessionState } from '../createSession.js';

/**
 * Build a between-rounds session from a compact team spec. MODEL B (Story 8.11):
 * `played` is `currentDefuserIndex` = the count of NATURAL rounds the team has
 * played (= its next un-played slot); `eq` is `equalisationRoundsPlayed`. Pointers
 * are PER-TEAM now (no all-advance-together / index===roundNumber-1 invariant).
 */
const team = (teamId: TeamId, len: number, played: number, eq = 0): TeamState => ({
  teamId,
  relayOrder: Array.from({ length: len }, (_, i) => `${teamId}-p${i}`),
  currentDefuserIndex: played,
  cumulativeTimeMs: 0,
  roundTimesMs: [],
  roundOutcomes: [],
  equalisationRoundsPlayed: eq,
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

describe('undersizedTeams (min-team-size guard, Story 8.9 follow-up)', () => {
  it('flags a populated team of 1 (a lone Defuser with no Expert)', () => {
    expect(MIN_TEAM_SIZE).toBe(2);
    expect(undersizedTeams(session(team('A', 1, 0)))).toEqual(['A']);
    expect(undersizedTeams(session(team('A', 2, 0), team('B', 1, 0)))).toEqual(['B']);
  });

  it('does NOT flag teams of 2+ or empty teams (single-team session is allowed)', () => {
    expect(undersizedTeams(session(team('A', 2, 0), team('B', 3, 0)))).toEqual([]);
    expect(undersizedTeams(session(team('A', 3, 0)))).toEqual([]);
    expect(undersizedTeams(session())).toEqual([]);
  });
});

describe('equalisationRoundsOwed (depends on relayOrder.length + played, not the index)', () => {
  it('the shorter team owes max-min; the longer team owes 0', () => {
    expect(equalisationRoundsOwed(session(team('A', 3, 3), team('B', 2, 2)))).toEqual({ A: 0, B: 1 });
  });

  it('decreases as the shorter team plays its equalisation rounds', () => {
    // 4v1: B owes 3 initially, 1 after two played.
    expect(equalisationRoundsOwed(session(team('A', 4, 4), team('B', 1, 1, 2)))).toEqual({ A: 0, B: 1 });
  });

  it('equal-size teams owe nothing', () => {
    expect(equalisationRoundsOwed(session(team('A', 3, 3), team('B', 3, 3)))).toEqual({ A: 0, B: 0 });
  });
});

describe('naturalRoundRemains (Model B: index < len)', () => {
  it('is true while some team has an un-played slot', () => {
    // 3v3 after 1 natural round each (index 1): two more natural rounds remain.
    expect(naturalRoundRemains(session(team('A', 3, 1), team('B', 3, 1)))).toBe(true);
  });
  it('is false once every team has played its last natural slot (index === len)', () => {
    expect(naturalRoundRemains(session(team('A', 3, 3), team('B', 2, 2)))).toBe(false);
  });
});

describe('isRelayComplete (terminal predicate, Model B semantics)', () => {
  it('equal 3v3 — complete after 3 natural rounds each, 0 equalisation owed', () => {
    expect(isRelayComplete(session(team('A', 3, 3), team('B', 3, 3)))).toBe(true);
    // Not complete one round earlier (a natural round still remains).
    expect(isRelayComplete(session(team('A', 3, 2), team('B', 3, 2)))).toBe(false);
  });

  it('odd 3v2 — NOT complete until B plays its owed equalisation round', () => {
    expect(isRelayComplete(session(team('A', 3, 3), team('B', 2, 2)))).toBe(false);
    expect(isRelayComplete(session(team('A', 3, 3), team('B', 2, 2, 1)))).toBe(true);
  });

  it('odd 4v1 — complete only after all 3 owed equalisation rounds', () => {
    expect(isRelayComplete(session(team('A', 4, 4), team('B', 1, 1, 0)))).toBe(false);
    expect(isRelayComplete(session(team('A', 4, 4), team('B', 1, 1, 2)))).toBe(false);
    expect(isRelayComplete(session(team('A', 4, 4), team('B', 1, 1, 3)))).toBe(true);
  });

  it('1v1 — complete after the single natural round each', () => {
    expect(isRelayComplete(session(team('A', 1, 1), team('B', 1, 1)))).toBe(true);
  });

  it('single-team session — complete once that team exhausts its rotation', () => {
    expect(isRelayComplete(session(team('A', 2, 0)))).toBe(false);
    expect(isRelayComplete(session(team('A', 2, 2)))).toBe(true);
  });

  it('empty session (no populated team) is vacuously complete (handler guards with hasPopulatedTeam)', () => {
    expect(isRelayComplete(session())).toBe(true);
  });
});

describe('pairIndexFor (layout pair = ceil(roundNumber / 2))', () => {
  it('groups consecutive turns into shared layout pairs', () => {
    expect(pairIndexFor(1)).toBe(1);
    expect(pairIndexFor(2)).toBe(1);
    expect(pairIndexFor(3)).toBe(2);
    expect(pairIndexFor(4)).toBe(2);
    expect(pairIndexFor(5)).toBe(3);
    expect(pairIndexFor(6)).toBe(3);
  });
});

describe('selectActiveTeam (snake turn order, Model B)', () => {
  /**
   * Simulate the full relay by repeatedly selecting the active team and applying
   * the same pointer advance `resolveRound` does. Returns the played sequence
   * (a bare team id for a natural round, `X(eq)` for an equalisation round).
   */
  const walk = (specs: Partial<Record<TeamId, number>>): string[] => {
    const teams = (Object.entries(specs) as [TeamId, number][]).map(([id, len]) => team(id, len, 0));
    let state = session(...teams);
    state = { ...state, roundNumber: 0 };
    const seq: string[] = [];
    for (let guard = 0; guard < 50; guard++) {
      const active = selectActiveTeam(state);
      if (active === undefined) break;
      const t = state.teams[active]!;
      const isNatural = t.currentDefuserIndex < t.relayOrder.length;
      seq.push(isNatural ? active : `${active}(eq)`);
      const advanced: TeamState = isNatural
        ? { ...t, currentDefuserIndex: t.currentDefuserIndex + 1 }
        : { ...t, equalisationRoundsPlayed: t.equalisationRoundsPlayed + 1 };
      state = {
        ...state,
        roundNumber: state.roundNumber + 1,
        teams: { ...state.teams, [active]: advanced },
      };
    }
    return seq;
  };

  it('equal 2v2 → A,B,B,A (snake, no equalisation)', () => {
    expect(walk({ A: 2, B: 2 })).toEqual(['A', 'B', 'B', 'A']);
  });

  it('equal 3v3 → A,B,B,A,A,B (snake)', () => {
    expect(walk({ A: 3, B: 3 })).toEqual(['A', 'B', 'B', 'A', 'A', 'B']);
  });

  it('odd 2v1 → A,B then B equalisation then A tail', () => {
    expect(walk({ A: 2, B: 1 })).toEqual(['A', 'B', 'B(eq)', 'A']);
  });

  it('odd 3v2 → A,B,B,A,A then B equalisation', () => {
    expect(walk({ A: 3, B: 2 })).toEqual(['A', 'B', 'B', 'A', 'A', 'B(eq)']);
  });

  it('odd 4v1 → interleaved equalisation, both end on 4 turns', () => {
    expect(walk({ A: 4, B: 1 })).toEqual(['A', 'B', 'B(eq)', 'A', 'A', 'B(eq)', 'B(eq)', 'A']);
  });

  it('single-team A=2 → A,A (no snake, no second team)', () => {
    expect(walk({ A: 2 })).toEqual(['A', 'A']);
  });

  it('empty session → no active team (undefined)', () => {
    expect(selectActiveTeam(session())).toBeUndefined();
  });

  it('returns undefined exactly when the relay is complete', () => {
    const complete = session(team('A', 2, 2), team('B', 2, 2));
    expect(isRelayComplete(complete)).toBe(true);
    expect(selectActiveTeam(complete)).toBeUndefined();
  });

  it('lobby round 1 (roundNumber 0) selects A (pair 1, first turn)', () => {
    const lobby = { ...session(team('A', 2, 0), team('B', 2, 0)), status: 'lobby' as const, roundNumber: 0 };
    expect(selectActiveTeam(lobby)).toBe('A');
  });
});
