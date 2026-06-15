import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { setPlayerReady } from '../setPlayerReady.js';
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

/** A lobby with the facilitator plus Maya on Team A as a defuser. */
const baseState = (): SessionState => {
  let state = createSessionState({
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    facilitatorId: 'sock-fac',
  });
  state = addPlayerToSession(state, { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
  return state;
};

describe('setPlayerReady', () => {
  it('sets isReady true, preserving displayName, role, and teamId', () => {
    const next = setPlayerReady(baseState(), 'sock-maya', true);
    expect(next.players['sock-maya']).toEqual({
      playerId: 'sock-maya',
      displayName: 'Maya',
      role: 'defuser',
      teamId: 'A',
      isReady: true,
    });
  });

  it('toggles back to false', () => {
    const ready = setPlayerReady(baseState(), 'sock-maya', true);
    const notReady = setPlayerReady(ready, 'sock-maya', false);
    expect(notReady.players['sock-maya'].isReady).toBe(false);
    expect(notReady.players['sock-maya'].teamId).toBe('A');
  });

  it('guards: an unknown playerId returns the state reference unchanged', () => {
    const state = baseState();
    expect(setPlayerReady(state, 'sock-ghost', true)).toBe(state);
  });

  it('is idempotent: setting the same value returns the state reference unchanged', () => {
    const state = baseState(); // Maya starts isReady:false
    expect(setPlayerReady(state, 'sock-maya', false)).toBe(state);
    const ready = setPlayerReady(state, 'sock-maya', true);
    expect(setPlayerReady(ready, 'sock-maya', true)).toBe(ready);
  });

  it('is immutable: a deep-frozen input does not throw and is left unchanged', () => {
    const state = deepFreeze(baseState());
    const next = setPlayerReady(state, 'sock-maya', true);
    expect(next).not.toBe(state);
    expect(state.players['sock-maya'].isReady).toBe(false);
    expect(next.players['sock-maya'].isReady).toBe(true);
  });

  it('does not touch config, status, teams, joinCode, or round number', () => {
    const state = baseState();
    const next = setPlayerReady(state, 'sock-maya', true);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.joinCode).toBe(state.joinCode);
    expect(next.status).toBe('lobby');
    expect(next.config).toBe(state.config);
    expect(next.teams).toBe(state.teams);
    expect(next.roundNumber).toBe(0);
  });
});
