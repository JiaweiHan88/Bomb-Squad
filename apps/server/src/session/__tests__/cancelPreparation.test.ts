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

/** A between-rounds session with two populated teams (after round 1). */
const betweenRoundsWithTeams = (): SessionState => ({
  ...lobbyState(),
  status: 'between-rounds',
  roundNumber: 1,
  teams: {
    A: { teamId: 'A', relayOrder: ['p1', 'p2'], currentDefuserIndex: 0, cumulativeTimeMs: 1_000, roundTimesMs: [1_000] },
    B: { teamId: 'B', relayOrder: ['p3', 'p4'], currentDefuserIndex: 0, cumulativeTimeMs: 2_000, roundTimesMs: [2_000] },
  },
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

  it('returns preparation to BETWEEN-ROUNDS for round 2+ and reverses the rotation advance (Story 8.6)', () => {
    // Facilitator advanced from between-rounds → prep (round 2), then changed mind.
    const prep = openPreparation(betweenRoundsWithTeams());
    expect(prep.status).toBe('preparation');
    expect(prep.roundNumber).toBe(2);
    expect(prep.teams.A!.currentDefuserIndex).toBe(1); // advanced

    const next = cancelPreparation(prep);
    expect(next.status).toBe('between-rounds'); // NOT lobby
    expect(next.roundNumber).toBe(1);
    expect(next.teams.A!.currentDefuserIndex).toBe(0); // reversed
    expect(next.teams.B!.currentDefuserIndex).toBe(0);
  });

  it('open ∘ cancel is the identity on the between-rounds path (round 2+)', () => {
    const before = betweenRoundsWithTeams();
    const roundTrip = cancelPreparation(openPreparation(before));
    expect(roundTrip.status).toBe(before.status);
    expect(roundTrip.roundNumber).toBe(before.roundNumber);
    expect(roundTrip.teams).toEqual(before.teams);
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
