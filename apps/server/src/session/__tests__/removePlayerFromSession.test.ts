import type { PlayerInfo, SessionState, TeamState } from '@bomb-squad/shared';
import { removePlayerFromSession } from '../removePlayerFromSession.js';
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

function player(id: string, role: PlayerInfo['role'], teamId?: 'A' | 'B'): PlayerInfo {
  return { playerId: id, displayName: id, role, isReady: false, ...(teamId ? { teamId } : {}) };
}

function team(relayOrder: string[]): TeamState {
  return { teamId: 'A', relayOrder, currentDefuserIndex: 0, cumulativeTimeMs: 0, roundTimesMs: [] };
}

const baseState = (): SessionState =>
  createSessionState({ sessionId: 'sess-1', joinCode: 'ABC123', facilitatorId: 'fac-id' });

describe('removePlayerFromSession', () => {
  it('removes the player from the roster', () => {
    const state = { ...baseState(), players: { ...baseState().players, maya: player('maya', 'expert') } };
    const next = removePlayerFromSession(deepFreeze(state), 'maya');
    expect(next.players.maya).toBeUndefined();
    expect(Object.keys(next.players)).toEqual(['fac-id']);
  });

  it('prunes the id from a team relayOrder, keeping the team if others remain', () => {
    const state: SessionState = {
      ...baseState(),
      players: { ...baseState().players, maya: player('maya', 'defuser', 'A'), devon: player('devon', 'expert', 'A') },
      teams: { A: team(['maya', 'devon']) },
    };
    const next = removePlayerFromSession(deepFreeze(state), 'maya');
    expect(next.teams.A?.relayOrder).toEqual(['devon']);
  });

  it('deletes a team whose relayOrder empties after the prune', () => {
    const state: SessionState = {
      ...baseState(),
      players: { ...baseState().players, maya: player('maya', 'defuser', 'A') },
      teams: { A: team(['maya']) },
    };
    const next = removePlayerFromSession(deepFreeze(state), 'maya');
    expect(next.teams.A).toBeUndefined();
    expect(Object.keys(next.teams)).toHaveLength(0);
  });

  it('returns the same reference when the playerId is absent (no-op)', () => {
    const state = deepFreeze(baseState());
    expect(removePlayerFromSession(state, 'ghost')).toBe(state);
  });

  it('does not mutate the input (pure)', () => {
    const state: SessionState = {
      ...baseState(),
      players: { ...baseState().players, maya: player('maya', 'defuser', 'A') },
      teams: { A: team(['maya']) },
    };
    deepFreeze(state);
    expect(() => removePlayerFromSession(state, 'maya')).not.toThrow();
    // Original is intact.
    expect(state.players.maya).toBeDefined();
    expect(state.teams.A?.relayOrder).toEqual(['maya']);
  });

  it('leaves an untouched team object referentially identical', () => {
    const teamB = team(['someone']);
    const state: SessionState = {
      ...baseState(),
      players: { ...baseState().players, maya: player('maya', 'defuser', 'A') },
      teams: { A: team(['maya']), B: { ...teamB, teamId: 'B' } },
    };
    const next = removePlayerFromSession(deepFreeze(state), 'maya');
    expect(next.teams.B).toBe(state.teams.B); // B never had maya — same ref
  });
});
