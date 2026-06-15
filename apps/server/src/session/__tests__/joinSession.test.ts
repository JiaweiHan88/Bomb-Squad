import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
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

const baseState = (): SessionState =>
  createSessionState({ sessionId: 'sess-1', joinCode: 'ABC123', facilitatorId: 'sock-fac' });

const MAYA = { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' as const };

describe('addPlayerToSession', () => {
  it('adds the player with the given role, isReady false, and no teamId', () => {
    const next = addPlayerToSession(baseState(), MAYA);
    expect(next.players['sock-maya']).toEqual({
      playerId: 'sock-maya',
      displayName: 'Maya',
      role: 'expert',
      isReady: false,
    });
    expect(Object.keys(next.players)).toHaveLength(2);
  });

  it('does not touch session identity, config, teams, status, or round number', () => {
    const state = baseState();
    const next = addPlayerToSession(state, MAYA);
    expect(next.sessionId).toBe(state.sessionId);
    expect(next.joinCode).toBe(state.joinCode);
    expect(next.status).toBe('lobby');
    expect(next.config).toBe(state.config);
    expect(next.teams).toBe(state.teams);
    expect(next.roundNumber).toBe(0);
  });

  it('is immutable: a deep-frozen input does not throw and is left unchanged', () => {
    const state = deepFreeze(baseState());
    const next = addPlayerToSession(state, MAYA);
    expect(next).not.toBe(state);
    expect(state.players['sock-maya']).toBeUndefined();
    expect(next.players['sock-maya']).toBeDefined();
  });

  it('is idempotent: an existing playerId returns the state reference unchanged', () => {
    const once = addPlayerToSession(baseState(), MAYA);
    const twice = addPlayerToSession(once, { ...MAYA, displayName: 'Imposter', role: 'defuser' });
    expect(twice).toBe(once);
    expect(twice.players['sock-maya'].displayName).toBe('Maya');
    expect(twice.players['sock-maya'].role).toBe('expert');
  });

  it('never demotes the facilitator on a duplicate join attempt', () => {
    const state = baseState();
    const next = addPlayerToSession(state, {
      playerId: 'sock-fac',
      displayName: 'Sneaky',
      role: 'spectator',
    });
    expect(next).toBe(state);
    expect(next.players['sock-fac'].role).toBe('facilitator');
  });
});
