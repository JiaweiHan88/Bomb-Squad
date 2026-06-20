import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { startRound, hasPopulatedTeam } from '../startRound.js';
import { addPlayerToSession } from '../joinSession.js';
import { assignPlayerToTeam } from '../assignTeam.js';
import { createSessionState } from '../createSession.js';
import { openPreparation } from '../openPreparation.js';

/** Recursively freezes an object so any mutation attempt throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * A preparation-phase session (roundNumber 1) with:
 *  Team A: Maya (defuser), Devon (expert)  — relayOrder [maya, devon]
 *  Team B: Ana (expert)                    — relayOrder [ana]
 *  Sam: unassigned spectator.
 */
const prepState = (): SessionState => {
  let state = createSessionState({
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    facilitatorId: 'sock-fac',
  });
  state = addPlayerToSession(state, { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-devon', displayName: 'Devon', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-ana', displayName: 'Ana', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-sam', displayName: 'Sam', role: 'spectator' });
  state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
  state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'sock-ana', teamId: 'B', role: 'expert' });
  return openPreparation(state);
};

describe('startRound', () => {
  it('activates the round and commits the rotation pick per team', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.round).toEqual({
      roundNumber: 1,
      status: 'active',
      defusers: { A: 'sock-maya', B: 'sock-ana' },
      outcomes: {},
      retry: false,
    });
  });

  it('flips the selected players to defuser; previous defuser-role holders become expert', () => {
    // Move the defuser role onto Devon pre-start so rotation (Maya, index 0) displaces him.
    let state = prepState();
    state = {
      ...state,
      players: {
        ...state.players,
        'sock-maya': { ...state.players['sock-maya']!, role: 'expert' },
        'sock-devon': { ...state.players['sock-devon']!, role: 'defuser' },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-maya']!.role).toBe('defuser');
    expect(result.state.players['sock-devon']!.role).toBe('expert');
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('a spectator in relayOrder who comes up in rotation becomes defuser (relay order is the authority)', () => {
    let state = prepState();
    state = {
      ...state,
      players: {
        ...state.players,
        'sock-ana': { ...state.players['sock-ana']!, role: 'spectator' },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('never touches the facilitator or off-team spectators', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-fac']!.role).toBe('facilitator');
    expect(result.state.players['sock-sam']!.role).toBe('spectator');
  });

  it('Story 8.9: an out-of-range index NO LONGER wraps — the team is exhausted and rests', () => {
    // Old behaviour wrapped via modulo (5 % 2 = 1 → Devon); 8.9 reads the index
    // raw, so an index past relayOrder means the team has exhausted its rotation
    // and gets no natural pick. Team B still has a natural slot (the natural
    // phase), so exhausted Team A simply rests (absent from defusers).
    let state = prepState();
    state = {
      ...state,
      teams: { ...state.teams, A: { ...state.teams.A!, currentDefuserIndex: 5 } },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers.A).toBeUndefined(); // exhausted → rests, no wrap
    expect(result.round.defusers.B).toBe('sock-ana'); // B's natural pick
    // A resting team's stale 'defuser' (Maya, set in the lobby) is demoted to
    // expert so its players are not stranded on the bomb surface (Task 6).
    expect(result.state.players['sock-maya']!.role).toBe('expert');
  });

  it.each(['lobby', 'active', 'between-rounds', 'ended'] as const)(
    'rejects when status is %s',
    (status) => {
      const state: SessionState = { ...prepState(), status };
      const result = startRound(state);
      expect(result).toEqual({ ok: false, reason: 'NOT_IN_PREPARATION' });
    },
  );

  it('rejects when no team has a populated relayOrder', () => {
    const state: SessionState = { ...prepState(), teams: {} };
    const result = startRound(state);
    expect(result).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('skips a team whose selected relayOrder entry is missing from players (integrity guard)', () => {
    let state = prepState();
    state = {
      ...state,
      teams: {
        ...state.teams,
        B: { ...state.teams.B!, relayOrder: ['sock-ghost'] },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ A: 'sock-maya' });
  });

  it('rejects when every populated team resolves to a missing player', () => {
    let state = prepState();
    state = {
      ...state,
      teams: {
        A: { ...state.teams.A!, relayOrder: ['sock-ghost-a'] },
        B: { ...state.teams.B!, relayOrder: ['sock-ghost-b'] },
      },
    };
    const result = startRound(state);
    expect(result).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(prepState());
    const result = startRound(frozen);
    expect(result.ok).toBe(true);
    expect(frozen.status).toBe('preparation');
    expect(frozen.players['sock-ana']!.role).toBe('expert');
  });

  it('leaves rotation bookkeeping and scores untouched (8.6/8.9 own advancement)', () => {
    const state = prepState();
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.teams.A!.currentDefuserIndex).toBe(0);
    expect(result.state.teams.A!.cumulativeTimeMs).toBe(0);
    expect(result.state.roundNumber).toBe(1);
    expect(result.state.config).toBe(state.config);
  });
});

describe('startRound — odd-team equalisation round (Story 8.9)', () => {
  /**
   * A preparation-phase session whose natural rotation is EXHAUSTED for both
   * teams (indices past relayOrder): A=[maya,devon] (len 2), B=[ana] (len 1),
   * both at index 2. maxLen 2 ⇒ B owes 1 equalisation round, A owes 0.
   */
  const equalisationPrep = (volunteerForB: string | undefined): SessionState => {
    const state = prepState();
    return {
      ...state,
      teams: {
        A: { ...state.teams.A!, currentDefuserIndex: 2 },
        B: { ...state.teams.B!, currentDefuserIndex: 2, equalisationVolunteerId: volunteerForB },
      },
    };
  };

  it('commits the Facilitator volunteer for the owing team; the longer team rests', () => {
    const result = startRound(equalisationPrep('sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only B plays (its volunteer); A has no owed round → absent from defusers.
    expect(result.round.defusers).toEqual({ B: 'sock-ana' });
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('bumps equalisationRoundsPlayed and clears the consumed volunteer', () => {
    const result = startRound(equalisationPrep('sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.teams.B!.equalisationRoundsPlayed).toBe(1);
    expect(result.state.teams.B!.equalisationVolunteerId).toBeUndefined();
    // The longer team's bookkeeping is untouched.
    expect(result.state.teams.A!.equalisationRoundsPlayed).toBe(0);
  });

  it('a resting team is absent from defusers and its stale defuser is demoted (Task 6)', () => {
    // Maya holds 'defuser' from the lobby; Team A rests this equalisation round.
    const result = startRound(equalisationPrep('sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers.A).toBeUndefined();
    expect(result.state.players['sock-maya']!.role).toBe('expert');
  });

  it('refuses an equalisation round with no designated volunteer (server never auto-picks)', () => {
    expect(startRound(equalisationPrep(undefined))).toEqual({
      ok: false,
      reason: 'EQUALISATION_VOLUNTEER_REQUIRED',
    });
  });

  it('refuses a volunteer who is not on the team / not on the roster', () => {
    expect(startRound(equalisationPrep('sock-ghost'))).toEqual({
      ok: false,
      reason: 'EQUALISATION_VOLUNTEER_REQUIRED',
    });
  });
});

describe('startRound — retry round (Story 8.8)', () => {
  /** A retry prep: preparation with the retryingTeamId marker set (via retryRound). */
  const retryPrep = (teamId: 'A' | 'B'): SessionState => ({ ...prepState(), retryingTeamId: teamId });

  it('arms ONLY the retried team with its SAME Defuser, retry: true, outcomes: {}', () => {
    const result = startRound(retryPrep('A'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ A: 'sock-maya' }); // same Defuser, B absent
    expect(result.round.retry).toBe(true);
    expect(result.round.outcomes).toEqual({});
    expect(result.round.roundNumber).toBe(1); // unchanged
  });

  it('rests the other team (absent from defusers) and demotes its stale defuser', () => {
    // Retry Team B → Team A rests; Maya (lobby defuser on A) is demoted to expert.
    const result = startRound(retryPrep('B'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ B: 'sock-ana' });
    expect(result.round.defusers.A).toBeUndefined();
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
    expect(result.state.players['sock-maya']!.role).toBe('expert');
  });

  it('clears the retryingTeamId marker and leaves pointers + counters UNCHANGED', () => {
    const result = startRound(retryPrep('A'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.retryingTeamId).toBeUndefined();
    expect(result.state.teams.A!.currentDefuserIndex).toBe(0);
    expect(result.state.teams.A!.equalisationRoundsPlayed).toBe(0);
    expect(result.state.roundNumber).toBe(1);
  });

  it('refuses when the retried team is exhausted (failed equalisation round — V1 limitation)', () => {
    // An exhausted index (the original was an equalisation/volunteer round) yields
    // no natural same-Defuser pick → NO_POPULATED_TEAM (documented V1 limitation).
    const exhausted: SessionState = {
      ...prepState(),
      retryingTeamId: 'B',
      teams: { ...prepState().teams, B: { ...prepState().teams.B!, currentDefuserIndex: 2 } },
    };
    expect(startRound(exhausted)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('does not mutate the input (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(retryPrep('A'));
    const result = startRound(frozen);
    expect(result.ok).toBe(true);
    expect(frozen.status).toBe('preparation');
    expect(frozen.retryingTeamId).toBe('A');
  });
});

describe('hasPopulatedTeam', () => {
  it('is true when a team holds a rostered player', () => {
    expect(hasPopulatedTeam(prepState())).toBe(true);
  });

  it('is false when no team exists', () => {
    expect(hasPopulatedTeam({ ...prepState(), teams: {} })).toBe(false);
  });

  it('is false when every relayOrder entry is missing from players (matches startRound)', () => {
    const state: SessionState = {
      ...prepState(),
      teams: {
        A: { ...prepState().teams.A!, relayOrder: ['sock-ghost-a'] },
        B: { ...prepState().teams.B!, relayOrder: ['sock-ghost-b'] },
      },
    };
    expect(hasPopulatedTeam(state)).toBe(false);
    // The precondition mirrors startRound's success condition exactly.
    expect(startRound(state)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });
});
