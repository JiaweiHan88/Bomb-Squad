import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { assignPlayerToTeam } from '../assignTeam.js';
import { addPlayerToSession } from '../joinSession.js';
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

/** A lobby with the facilitator plus two unassigned joiners (Maya, Devon). */
const baseState = (): SessionState => {
  let state = createSessionState({
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    facilitatorId: 'sock-fac',
  });
  state = addPlayerToSession(state, { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-devon', displayName: 'Devon', role: 'expert' });
  return state;
};

describe('assignPlayerToTeam', () => {
  it('assigns teamId and role, preserving displayName and isReady', () => {
    const next = assignPlayerToTeam(baseState(), {
      playerId: 'sock-maya',
      teamId: 'A',
      role: 'defuser',
    });
    expect(next.players['sock-maya']).toEqual({
      playerId: 'sock-maya',
      displayName: 'Maya',
      role: 'defuser',
      teamId: 'A',
      isReady: false,
    });
  });

  it('lazily creates the TeamState with the empty-team shape on first assignment', () => {
    const next = assignPlayerToTeam(baseState(), {
      playerId: 'sock-maya',
      teamId: 'A',
      role: 'defuser',
    });
    expect(next.teams.A).toEqual({
      teamId: 'A',
      relayOrder: ['sock-maya'],
      currentDefuserIndex: 0,
      cumulativeTimeMs: 0,
      roundTimesMs: [],
      equalisationRoundsPlayed: 0,
    });
    expect(next.teams.B).toBeUndefined();
  });

  it('appends to relayOrder in assignment order (GDD default rotation = join order)', () => {
    let state = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
    expect(state.teams.A?.relayOrder).toEqual(['sock-maya', 'sock-devon']);
  });

  it('moving A→B removes from the old relayOrder and deletes the emptied team', () => {
    let state = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'B', role: 'defuser' });
    expect(state.teams.A).toBeUndefined();
    expect(state.teams.B?.relayOrder).toEqual(['sock-maya']);
    expect(state.players['sock-maya'].teamId).toBe('B');
  });

  it('moving one player keeps the remaining teammates and their order intact', () => {
    let state = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
    state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'B', role: 'defuser' });
    expect(state.teams.A?.relayOrder).toEqual(['sock-devon']);
    expect(state.teams.B?.relayOrder).toEqual(['sock-maya']);
  });

  it('a role-only change keeps the relayOrder position', () => {
    let state = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
    state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'spectator' });
    expect(state.teams.A?.relayOrder).toEqual(['sock-maya', 'sock-devon']);
    expect(state.players['sock-maya'].role).toBe('spectator');
  });

  it('is idempotent: the exact same assignment returns the state reference unchanged', () => {
    const once = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    const twice = assignPlayerToTeam(once, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    expect(twice).toBe(once);
  });

  it('guards: an unknown playerId returns the state reference unchanged', () => {
    const state = baseState();
    expect(assignPlayerToTeam(state, { playerId: 'sock-ghost', teamId: 'A', role: 'defuser' })).toBe(
      state,
    );
  });

  it('guards: targeting the facilitator returns the state reference unchanged', () => {
    const state = baseState();
    const next = assignPlayerToTeam(state, { playerId: 'sock-fac', teamId: 'A', role: 'defuser' });
    expect(next).toBe(state);
    expect(state.players['sock-fac'].role).toBe('facilitator');
  });

  it('is immutable: a deep-frozen input does not throw and is left unchanged', () => {
    const state = deepFreeze(baseState());
    const next = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    expect(next).not.toBe(state);
    expect(state.players['sock-maya'].teamId).toBeUndefined();
    expect(state.teams.A).toBeUndefined();
    expect(next.players['sock-maya'].teamId).toBe('A');
  });

  it('is immutable when moving between teams (frozen teams record)', () => {
    let state = assignPlayerToTeam(baseState(), { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
    const frozen = deepFreeze(state);
    const next = assignPlayerToTeam(frozen, { playerId: 'sock-maya', teamId: 'B', role: 'defuser' });
    expect(frozen.teams.A?.relayOrder).toEqual(['sock-maya', 'sock-devon']);
    expect(next.teams.A?.relayOrder).toEqual(['sock-devon']);
  });

  it('does not touch session identity, config, status, joinCode, or round number', () => {
    const state = baseState();
    const next = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.joinCode).toBe(state.joinCode);
    expect(next.status).toBe('lobby');
    expect(next.config).toBe(state.config);
    expect(next.roundNumber).toBe(0);
  });
});
