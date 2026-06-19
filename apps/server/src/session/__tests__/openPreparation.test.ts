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
    A: { teamId: 'A', relayOrder: ['p1', 'p2'], currentDefuserIndex: 0, cumulativeTimeMs: 1_000, roundTimesMs: [1_000], equalisationRoundsPlayed: 0 },
    B: { teamId: 'B', relayOrder: ['p3', 'p4'], currentDefuserIndex: 1, cumulativeTimeMs: 2_000, roundTimesMs: [2_000], equalisationRoundsPlayed: 0 },
  },
});

describe('openPreparation', () => {
  it('moves a lobby to preparation and increments roundNumber (0 → 1)', () => {
    const next = openPreparation(lobbyState());
    expect(next.status).toBe('preparation');
    expect(next.roundNumber).toBe(1);
  });

  it('moves between-rounds to preparation and increments roundNumber', () => {
    const between: SessionState = { ...lobbyState(), status: 'between-rounds', roundNumber: 2 };
    const next = openPreparation(between);
    expect(next.status).toBe('preparation');
    expect(next.roundNumber).toBe(3);
  });

  it('advances every team currentDefuserIndex by 1 when opened from between-rounds (Story 8.6)', () => {
    const next = openPreparation(withTeams('between-rounds', 1));
    expect(next.teams.A!.currentDefuserIndex).toBe(1);
    expect(next.teams.B!.currentDefuserIndex).toBe(2);
    // Times/relay order untouched by the advance.
    expect(next.teams.A!.cumulativeTimeMs).toBe(1_000);
    expect(next.teams.A!.relayOrder).toEqual(['p1', 'p2']);
  });

  it('leaves currentDefuserIndex untouched when opened from the lobby (round 1)', () => {
    const state = withTeams('lobby', 0);
    const next = openPreparation(state);
    expect(next.teams.A!.currentDefuserIndex).toBe(0);
    expect(next.teams.B!.currentDefuserIndex).toBe(1);
    // Lobby path does not rebuild the teams map (same reference, no advance).
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

  it('preserves players, teams, and config untouched (same references)', () => {
    const state = lobbyState();
    const next = openPreparation(state);
    expect(next.players).toBe(state.players);
    expect(next.teams).toBe(state.teams);
    expect(next.config).toBe(state.config);
  });

  // Story 8.9 decision: the pointer advance stays UNIFORM (every team +1 on the
  // between-rounds path) — `openPreparation` does NOT special-case equalisation
  // rounds. The wrap-around bug is capped at the source (`startRound` reads the
  // index raw, no modulo), so advancing an already-exhausted team's index past
  // its relayOrder is harmless (it just marks exhaustion); the equalisation pick
  // is the explicit Facilitator volunteer, never `relayOrder[index]`. This keeps
  // openPreparation/cancelPreparation symmetric.
  it('advances every team uniformly even when a team is already exhausted (8.9 — cap lives in startRound)', () => {
    const exhausted: SessionState = {
      ...withTeams('between-rounds', 2),
      teams: {
        A: { teamId: 'A', relayOrder: ['p1', 'p2'], currentDefuserIndex: 1, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
        B: { teamId: 'B', relayOrder: ['p3'], currentDefuserIndex: 1, cumulativeTimeMs: 0, roundTimesMs: [], equalisationRoundsPlayed: 0 },
      },
    };
    const next = openPreparation(exhausted);
    expect(next.teams.A!.currentDefuserIndex).toBe(2);
    expect(next.teams.B!.currentDefuserIndex).toBe(2); // exhausted B advances too — no special case
  });
});
