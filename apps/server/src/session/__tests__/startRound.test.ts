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

/** A lobby session with both teams populated (Maya+Devon on A, Ana+Bo on B). */
const lobbyWithTeams = (): SessionState => {
  let state = createSessionState({ sessionId: 'sess-1', joinCode: 'ABC123', facilitatorId: 'sock-fac' });
  state = addPlayerToSession(state, { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-devon', displayName: 'Devon', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-ana', displayName: 'Ana', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-bo', displayName: 'Bo', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-sam', displayName: 'Sam', role: 'spectator' });
  state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
  state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'sock-ana', teamId: 'B', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'sock-bo', teamId: 'B', role: 'expert' });
  return state;
};

/**
 * Round-1 preparation (Model B): openPreparation selects the active team via the
 * snake — round 1 (pair 1, first turn) → Team A. relayOrder A=[maya,devon],
 * B=[ana,bo]. So ONLY Team A is armed; Team B rests.
 */
const prepState = (): SessionState => openPreparation(lobbyWithTeams());

describe('startRound (Model B — exactly one active team)', () => {
  it('activates the round and commits ONLY the active team (A) — B rests', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.round).toEqual({
      roundNumber: 1,
      status: 'active',
      defusers: { A: 'sock-maya' }, // single entry — the resting team is absent
      outcomes: {},
      retry: false,
    });
  });

  it('flips the active team pick to defuser; a prior defuser-role holder becomes expert', () => {
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
  });

  it('a spectator who comes up in the active team rotation becomes defuser (relay order is authority)', () => {
    let state = prepState();
    state = {
      ...state,
      players: { ...state.players, 'sock-maya': { ...state.players['sock-maya']!, role: 'spectator' } },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-maya']!.role).toBe('defuser');
  });

  it('never touches the facilitator or off-team spectators', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-fac']!.role).toBe('facilitator');
    expect(result.state.players['sock-sam']!.role).toBe('spectator');
  });

  it('the RESTING team is absent from defusers and its stale defuser is demoted (AC-1)', () => {
    // Give Team B (resting in round 1) a stale defuser; it must be demoted so its
    // players are not stranded on a bomb surface.
    let state = prepState();
    state = {
      ...state,
      players: { ...state.players, 'sock-ana': { ...state.players['sock-ana']!, role: 'defuser' } },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers.B).toBeUndefined(); // B rests
    expect(result.state.players['sock-ana']!.role).toBe('expert'); // demoted
  });

  it.each(['lobby', 'active', 'between-rounds', 'ended'] as const)(
    'rejects when status is %s',
    (status) => {
      const state: SessionState = { ...prepState(), status };
      const result = startRound(state);
      expect(result).toEqual({ ok: false, reason: 'NOT_IN_PREPARATION' });
    },
  );

  it('rejects when no active team is selected (activeTeamId undefined)', () => {
    const state: SessionState = { ...prepState(), activeTeamId: undefined };
    expect(startRound(state)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('rejects when the active team pick is missing from players (integrity guard)', () => {
    let state = prepState();
    state = {
      ...state,
      teams: { ...state.teams, A: { ...state.teams.A!, relayOrder: ['sock-ghost'] } },
    };
    expect(startRound(state)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(prepState());
    const result = startRound(frozen);
    expect(result.ok).toBe(true);
    expect(frozen.status).toBe('preparation');
  });

  it('leaves pointers, counters, roundNumber, and config UNTOUCHED (resolve owns advancement)', () => {
    const state = prepState();
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.teams.A!.currentDefuserIndex).toBe(0); // advance is at resolve now
    expect(result.state.teams.A!.equalisationRoundsPlayed).toBe(0);
    expect(result.state.teams).toBe(state.teams); // no team rebuild
    expect(result.state.roundNumber).toBe(1);
    expect(result.state.config).toBe(state.config);
  });
});

describe('startRound — odd-team equalisation round (Story 8.9 / 8.11)', () => {
  /**
   * A preparation session whose active team (B) plays an EQUALISATION round: both
   * teams exhausted their naturals (A=[maya,devon] index 2; B=[ana] index 1),
   * maxLen 2 ⇒ B owes 1. `activeTeamId` = B (the snake would pick B for this turn).
   */
  const equalisationPrep = (volunteerForB: string | undefined): SessionState => {
    const state = prepState();
    return {
      ...state,
      activeTeamId: 'B',
      teams: {
        A: { ...state.teams.A!, currentDefuserIndex: 2 },
        B: { ...state.teams.B!, relayOrder: ['sock-ana'], currentDefuserIndex: 1, equalisationVolunteerId: volunteerForB },
      },
    };
  };

  it('commits the Facilitator volunteer for the active owing team; the longer team rests', () => {
    const result = startRound(equalisationPrep('sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ B: 'sock-ana' });
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('does NOT bump equalisationRoundsPlayed or clear the volunteer (resolveRound owns that)', () => {
    const result = startRound(equalisationPrep('sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Under Model B the bump + clear happen at resolve (single advance site).
    expect(result.state.teams.B!.equalisationRoundsPlayed).toBe(0);
    expect(result.state.teams.B!.equalisationVolunteerId).toBe('sock-ana');
  });

  it('the resting longer team is absent from defusers and its stale defuser is demoted', () => {
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
  /**
   * A retry prep: preparation with the retry markers set (via retryRound). The
   * Defuser is carried EXPLICITLY (`retryDefuserId`) — the player who played the
   * failed round, NOT recomputed from the rotation pointer.
   */
  const retryPrep = (teamId: 'A' | 'B', defuserId: string): SessionState => ({
    ...prepState(),
    retryingTeamId: teamId,
    retryDefuserId: defuserId,
    activeTeamId: teamId,
  });

  it('arms ONLY the retried team with its SAME Defuser, retry: true, outcomes: {}', () => {
    const result = startRound(retryPrep('A', 'sock-maya'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ A: 'sock-maya' }); // same Defuser, B absent
    expect(result.round.retry).toBe(true);
    expect(result.round.outcomes).toEqual({});
    expect(result.round.roundNumber).toBe(1); // unchanged
  });

  it('REGRESSION (Jay 2026-06-21): arms the player who FAILED, even though the pointer already advanced past them', () => {
    // Model B: when Maya (index 0) failed round 1, resolveRound advanced Team A's
    // currentDefuserIndex to 1 (→ Devon). The retry must STILL arm Maya — the old
    // index-based pick armed relayOrder[1] = Devon (the bug). retryDefuserId fixes it.
    const advanced: SessionState = {
      ...retryPrep('A', 'sock-maya'),
      teams: { ...prepState().teams, A: { ...prepState().teams.A!, currentDefuserIndex: 1 } },
    };
    const result = startRound(advanced);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ A: 'sock-maya' }); // the FAILED player, not Devon
    expect(result.state.players['sock-maya']!.role).toBe('defuser');
    expect(result.state.players['sock-devon']!.role).toBe('expert'); // NOT armed
  });

  it('rests the other team (absent from defusers) and demotes its stale defuser', () => {
    // Retry Team B → Team A rests; Maya (lobby defuser on A) is demoted to expert.
    const result = startRound(retryPrep('B', 'sock-ana'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ B: 'sock-ana' });
    expect(result.round.defusers.A).toBeUndefined();
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
    expect(result.state.players['sock-maya']!.role).toBe('expert');
  });

  it('clears BOTH retry markers and leaves pointers + counters UNCHANGED', () => {
    const result = startRound(retryPrep('A', 'sock-maya'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.retryingTeamId).toBeUndefined();
    expect(result.state.retryDefuserId).toBeUndefined();
    expect(result.state.teams.A!.currentDefuserIndex).toBe(0);
    expect(result.state.teams.A!.equalisationRoundsPlayed).toBe(0);
    expect(result.state.roundNumber).toBe(1);
  });

  it('refuses when retryDefuserId is missing (desync) or names an off-team / unknown player', () => {
    const noDefuser: SessionState = { ...prepState(), retryingTeamId: 'A', activeTeamId: 'A' };
    expect(startRound(noDefuser)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });

    const offTeam = retryPrep('A', 'sock-ana'); // Ana is on B, not A
    expect(startRound(offTeam)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('does not mutate the input (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(retryPrep('A', 'sock-maya'));
    const result = startRound(frozen);
    expect(result.ok).toBe(true);
    expect(frozen.status).toBe('preparation');
    expect(frozen.retryingTeamId).toBe('A');
  });
});

describe('hasPopulatedTeam (precondition for opening prep — checks the NEXT active team)', () => {
  it('is true for a lobby with a rostered active team', () => {
    expect(hasPopulatedTeam(lobbyWithTeams())).toBe(true);
  });

  it('is false when no team exists (relay complete / nothing to play)', () => {
    expect(hasPopulatedTeam({ ...lobbyWithTeams(), teams: {} })).toBe(false);
  });

  it('is false when the active team pick is missing from players (matches startRound)', () => {
    const state: SessionState = {
      ...lobbyWithTeams(),
      teams: {
        A: { ...lobbyWithTeams().teams.A!, relayOrder: ['sock-ghost-a'] },
        B: { ...lobbyWithTeams().teams.B!, relayOrder: ['sock-ghost-b'] },
      },
    };
    expect(hasPopulatedTeam(state)).toBe(false);
    // The selected active team (A, round 1) maps to a ghost → startRound refuses too.
    const prep = openPreparation(state);
    expect(startRound(prep)).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });
});
