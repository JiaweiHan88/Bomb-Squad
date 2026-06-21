import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import { retryRound } from '../retryRound.js';
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
  createSessionState({ sessionId: 'sess-1', joinCode: 'ABC123', facilitatorId: 'sock-fac' });

/** A between-rounds session after a resolved round 2 (pointer at index 1). */
const betweenRounds = (): SessionState => ({
  ...lobbyState(),
  status: 'between-rounds',
  roundNumber: 2,
  teams: {
    A: { teamId: 'A', relayOrder: ['p1', 'p2'], currentDefuserIndex: 1, cumulativeTimeMs: 3_000, roundTimesMs: [1_000, 2_000], roundOutcomes: ['defused', 'defused'], equalisationRoundsPlayed: 0 },
    B: { teamId: 'B', relayOrder: ['p3', 'p4'], currentDefuserIndex: 1, cumulativeTimeMs: 4_000, roundTimesMs: [2_000, 2_000], roundOutcomes: ['defused', 'defused'], equalisationRoundsPlayed: 0 },
  },
});

describe('retryRound (Story 8.8)', () => {
  it('flips between-rounds → preparation, sets retryingTeamId, leaves roundNumber + pointers UNCHANGED', () => {
    const before = betweenRounds();
    const next = retryRound(before, 'B');

    expect(next.status).toBe('preparation');
    expect(next.retryingTeamId).toBe('B');
    // Crucially NOT advanced (a retry is the same round, same Defuser).
    expect(next.roundNumber).toBe(2);
    expect(next.teams.A!.currentDefuserIndex).toBe(1);
    expect(next.teams.B!.currentDefuserIndex).toBe(1);
    // Bookkeeping untouched.
    expect(next.teams.A!.equalisationRoundsPlayed).toBe(0);
    expect(next.teams).toEqual(before.teams);
  });

  it.each(['lobby', 'preparation', 'active', 'ended'] as const)(
    'returns the same reference when status is %s (guard, no throw)',
    (status) => {
      const state: SessionState = { ...lobbyState(), status };
      expect(retryRound(state, 'A')).toBe(state);
    },
  );

  it('does not mutate the input (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(betweenRounds());
    const next = retryRound(frozen, 'A');
    expect(next.retryingTeamId).toBe('A');
    expect(frozen.status).toBe('between-rounds');
    expect((frozen as SessionState).retryingTeamId).toBeUndefined();
  });

  it('preserves players, teams, config references (only status + marker change)', () => {
    const before = betweenRounds();
    const next = retryRound(before, 'A');
    expect(next.players).toBe(before.players);
    expect(next.teams).toBe(before.teams);
    expect(next.config).toBe(before.config);
  });
});
