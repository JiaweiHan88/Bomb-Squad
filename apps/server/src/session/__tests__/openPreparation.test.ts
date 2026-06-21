import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
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

/** A session with two populated teams at the given status/roundNumber. */
const withTeams = (status: SessionState['status'], roundNumber: number): SessionState => ({
  ...lobbyState(),
  status,
  roundNumber,
  teams: {
    A: { teamId: 'A', relayOrder: ['p1', 'p2'], currentDefuserIndex: 0, cumulativeTimeMs: 1_000, roundTimesMs: [1_000], roundOutcomes: ['defused'], equalisationRoundsPlayed: 0 },
    B: { teamId: 'B', relayOrder: ['p3', 'p4'], currentDefuserIndex: 1, cumulativeTimeMs: 2_000, roundTimesMs: [2_000], roundOutcomes: ['defused'], equalisationRoundsPlayed: 0 },
  },
});

describe('openPreparation (Model B, Story 8.11)', () => {
  it('moves a lobby to preparation and increments roundNumber (0 → 1)', () => {
    const next = openPreparation(lobbyState());
    expect(next.status).toBe('preparation');
    expect(next.roundNumber).toBe(1);
  });

  it('moves between-rounds to preparation and increments roundNumber', () => {
    const between: SessionState = { ...withTeams('between-rounds', 2) };
    const next = openPreparation(between);
    expect(next.status).toBe('preparation');
    expect(next.roundNumber).toBe(3);
  });

  it('selects the active team (snake) and does NOT advance any pointer (between-rounds)', () => {
    // roundNumber 1 → next round 2 → pair 1, second turn → B (snake A,B,B,A).
    const state = withTeams('between-rounds', 1);
    const next = openPreparation(state);
    expect(next.activeTeamId).toBe('B');
    // Pointers are UNCHANGED — under Model B a pointer advances only at resolve.
    expect(next.teams.A!.currentDefuserIndex).toBe(0);
    expect(next.teams.B!.currentDefuserIndex).toBe(1);
    // No pointer write — the teams map is the same reference.
    expect(next.teams).toBe(state.teams);
  });

  it('round 1 from the lobby selects A and leaves pointers at their current value', () => {
    const state = withTeams('lobby', 0);
    const next = openPreparation(state);
    expect(next.activeTeamId).toBe('A');
    expect(next.teams.A!.currentDefuserIndex).toBe(0);
    expect(next.teams.B!.currentDefuserIndex).toBe(1);
    // No pointer write at all — the teams map is the same reference.
    expect(next.teams).toBe(state.teams);
  });

  it.each(['preparation', 'active', 'ended'] as const)(
    'returns the same reference when status is %s (guard, no throw)',
    (status) => {
      const state: SessionState = { ...lobbyState(), status };
      expect(openPreparation(state)).toBe(state);
    },
  );

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(lobbyState());
    const next = openPreparation(frozen);
    expect(next.status).toBe('preparation');
    expect(frozen.status).toBe('lobby');
    expect(frozen.roundNumber).toBe(0);
  });

  it('preserves players, teams, and config untouched (same references — no pointer rebuild)', () => {
    const state = lobbyState();
    const next = openPreparation(state);
    expect(next.players).toBe(state.players);
    expect(next.teams).toBe(state.teams);
    expect(next.config).toBe(state.config);
  });
});
