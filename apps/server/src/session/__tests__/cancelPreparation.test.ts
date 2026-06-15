import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { cancelPreparation } from '../cancelPreparation.js';
import { openPreparation } from '../openPreparation.js';
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

const lobbyState = (): SessionState =>
  createSessionState({
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    facilitatorId: 'sock-fac',
  });

describe('cancelPreparation', () => {
  it('returns preparation to lobby and decrements roundNumber (inverse of open)', () => {
    const prep = openPreparation(lobbyState());
    expect(prep.status).toBe('preparation');
    expect(prep.roundNumber).toBe(1);

    const next = cancelPreparation(prep);
    expect(next.status).toBe('lobby');
    expect(next.roundNumber).toBe(0);
  });

  it('open → cancel → open lands on the same roundNumber (no skipped round)', () => {
    const first = openPreparation(lobbyState());
    const cancelled = cancelPreparation(first);
    const reopened = openPreparation(cancelled);
    expect(reopened.roundNumber).toBe(first.roundNumber);
  });

  it.each(['lobby', 'active', 'ended', 'between-rounds'] as const)(
    'returns the same reference when status is %s (guard, no throw)',
    (status) => {
      const state: SessionState = { ...lobbyState(), status };
      expect(cancelPreparation(state)).toBe(state);
    },
  );

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(openPreparation(lobbyState()));
    const next = cancelPreparation(frozen);
    expect(next.status).toBe('lobby');
    expect(frozen.status).toBe('preparation');
    expect(frozen.roundNumber).toBe(1);
  });

  it('preserves players, teams, and config untouched (same references)', () => {
    const prep = openPreparation(lobbyState());
    const next = cancelPreparation(prep);
    expect(next.players).toBe(prep.players);
    expect(next.teams).toBe(prep.teams);
    expect(next.config).toBe(prep.config);
  });
});
