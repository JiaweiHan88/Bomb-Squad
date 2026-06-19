import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { designateEqualisationVolunteer } from '../equalisationVolunteer.js';
import { addPlayerToSession } from '../joinSession.js';
import { assignPlayerToTeam } from '../assignTeam.js';
import { createSessionState } from '../createSession.js';

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
 * Between-rounds session whose naturals are exhausted: Team A=[maya,devon]
 * (index 2), Team B=[ana] (index 2). maxLen 2 ⇒ B owes one equalisation round.
 * Roles after the last natural round: maya/ana hold 'defuser' (last picks).
 */
const owingState = (): SessionState => {
  let state = createSessionState({ sessionId: 's', joinCode: 'ABC123', facilitatorId: 'fac' });
  state = addPlayerToSession(state, { playerId: 'maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'devon', displayName: 'Devon', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'ana', displayName: 'Ana', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'maya', teamId: 'A', role: 'defuser' });
  state = assignPlayerToTeam(state, { playerId: 'devon', teamId: 'A', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'ana', teamId: 'B', role: 'defuser' });
  return {
    ...state,
    status: 'between-rounds',
    roundNumber: 2,
    teams: {
      A: { ...state.teams.A!, currentDefuserIndex: 2 },
      B: { ...state.teams.B!, currentDefuserIndex: 2 },
    },
  };
};

describe('designateEqualisationVolunteer', () => {
  it('records the volunteer and sets their role to defuser', () => {
    const result = designateEqualisationVolunteer(owingState(), { teamId: 'B', playerId: 'ana' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.teams.B!.equalisationVolunteerId).toBe('ana');
    expect(result.state.players['ana']!.role).toBe('defuser');
  });

  it('refuses a team that owes no equalisation round', () => {
    // Team A owes nothing (it is the longer team).
    expect(designateEqualisationVolunteer(owingState(), { teamId: 'A', playerId: 'maya' })).toEqual({
      ok: false,
      reason: 'NO_EQUALISATION_OWED',
    });
  });

  it('refuses a player who is not on the team (must have already defused there)', () => {
    expect(designateEqualisationVolunteer(owingState(), { teamId: 'B', playerId: 'maya' })).toEqual({
      ok: false,
      reason: 'NOT_ON_TEAM',
    });
    expect(designateEqualisationVolunteer(owingState(), { teamId: 'B', playerId: 'ghost' })).toEqual({
      ok: false,
      reason: 'NOT_ON_TEAM',
    });
  });

  it('demotes a stale defuser on the team to expert (single-defuser discipline)', () => {
    // Keep A the longer team (add a 3rd A player) so B still owes a round, then
    // add a 2nd B player who is (wrongly) also holding defuser.
    let state = owingState();
    state = addPlayerToSession(state, { playerId: 'cy', displayName: 'Cy', role: 'expert' });
    state = assignPlayerToTeam(state, { playerId: 'cy', teamId: 'A', role: 'expert' });
    state = addPlayerToSession(state, { playerId: 'bo', displayName: 'Bo', role: 'expert' });
    state = assignPlayerToTeam(state, { playerId: 'bo', teamId: 'B', role: 'defuser' });
    // A=[maya,devon,cy] (len 3), B=[ana,bo] (len 2) ⇒ B owes 1. Both ana and bo
    // hold defuser on B; pick ana as volunteer → bo demoted.
    const result = designateEqualisationVolunteer(state, { teamId: 'B', playerId: 'ana' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['ana']!.role).toBe('defuser');
    expect(result.state.players['bo']!.role).toBe('expert');
  });

  it('is an idempotent no-op when the same volunteer is re-asserted (same reference)', () => {
    const first = designateEqualisationVolunteer(owingState(), { teamId: 'B', playerId: 'ana' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = designateEqualisationVolunteer(first.state, { teamId: 'B', playerId: 'ana' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state).toBe(first.state);
  });

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(owingState());
    const result = designateEqualisationVolunteer(frozen, { teamId: 'B', playerId: 'ana' });
    expect(result.ok).toBe(true);
    expect(frozen.teams.B!.equalisationVolunteerId).toBeUndefined();
  });
});
