import { describe, expect, it } from '@jest/globals';
import type { SessionState } from '@bomb-squad/shared';
import {
  pauseSession,
  resumeSession,
  canResume,
  clearDisconnectedPlayer,
} from '../pauseSession.js';
import { createSessionState } from '../createSession.js';
import { addPlayerToSession } from '../joinSession.js';
import { assignPlayerToTeam } from '../assignTeam.js';

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
 * An active session with Team A = Maya (defuser) + Devon (expert), Team B = Ana,
 * plus Sam (unassigned spectator). All participants start ready.
 */
const activeState = (): SessionState => {
  let state = createSessionState({ sessionId: 's', joinCode: 'ABC123', facilitatorId: 'fac' });
  state = addPlayerToSession(state, { playerId: 'maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'devon', displayName: 'Devon', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'ana', displayName: 'Ana', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sam', displayName: 'Sam', role: 'spectator' });
  state = assignPlayerToTeam(state, { playerId: 'maya', teamId: 'A', role: 'defuser' });
  state = assignPlayerToTeam(state, { playerId: 'devon', teamId: 'A', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'ana', teamId: 'B', role: 'expert' });
  const ready = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => [id, { ...p, isReady: true }]),
  );
  return { ...state, status: 'active', roundNumber: 1, players: ready };
};

describe('pauseSession', () => {
  it('facilitator pause sets pausedAt/pauseKind and leaves isReady untouched', () => {
    const next = pauseSession(activeState(), { kind: 'facilitator', now: 1000 });
    expect(next.pausedAt).toBe(1000);
    expect(next.pauseKind).toBe('facilitator');
    expect(next.disconnectedPlayerIds).toEqual([]);
    expect(next.players['maya']!.isReady).toBe(true); // not reset
    expect(next.status).toBe('active'); // status untouched (orthogonal)
  });

  it('facilitator pause is idempotent (already paused → same reference)', () => {
    const first = pauseSession(activeState(), { kind: 'facilitator', now: 1000 });
    expect(pauseSession(first, { kind: 'facilitator', now: 2000 })).toBe(first);
  });

  it('disconnect pause records the dropper and resets every participant isReady', () => {
    const next = pauseSession(activeState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    expect(next.pausedAt).toBe(1000);
    expect(next.pauseKind).toBe('disconnect');
    expect(next.disconnectedPlayerIds).toEqual(['maya']);
    expect(next.players['maya']!.isReady).toBe(false);
    expect(next.players['devon']!.isReady).toBe(false);
    expect(next.players['ana']!.isReady).toBe(false);
    // The facilitator and the unassigned spectator are NOT participants — their
    // ready state is left untouched (they don't gate the resume).
    expect(next.players['fac']!.isReady).toBe(true);
    expect(next.players['sam']!.isReady).toBe(true);
  });

  it('a second disconnect appends (deduped) and preserves the original freeze instant', () => {
    const first = pauseSession(activeState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    const second = pauseSession(first, { kind: 'disconnect', now: 5000, droppedPlayerId: 'ana' });
    expect(second.disconnectedPlayerIds).toEqual(['maya', 'ana']);
    expect(second.pausedAt).toBe(1000); // original instant kept
    // Re-dropping an already-listed player is a no-op (same reference).
    expect(pauseSession(second, { kind: 'disconnect', now: 9000, droppedPlayerId: 'ana' })).toBe(second);
  });

  it('does not mutate the input (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(activeState());
    const next = pauseSession(frozen, { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    expect(next.pauseKind).toBe('disconnect');
    expect(frozen.pausedAt).toBeNull();
  });
});

describe('resumeSession', () => {
  it('clears all pause fields and leaves status/round/teams untouched', () => {
    const paused = pauseSession(activeState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    const resumed = resumeSession(paused);
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.pauseKind).toBeNull();
    expect(resumed.disconnectedPlayerIds).toEqual([]);
    expect(resumed.status).toBe('active');
    expect(resumed.roundNumber).toBe(1);
    expect(resumed.teams).toBe(paused.teams);
  });

  it('is idempotent on a running session (same reference)', () => {
    const running = activeState();
    expect(resumeSession(running)).toBe(running);
  });
});

describe('canResume', () => {
  it('a facilitator pause is always resumable', () => {
    const paused = pauseSession(activeState(), { kind: 'facilitator', now: 1000 });
    expect(canResume(paused)).toBe(true);
  });

  it('a disconnect pause is blocked until every participant is ready', () => {
    let paused = pauseSession(activeState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    expect(canResume(paused)).toBe(false); // all participants reset to not-ready

    // Ready up the three participants (maya, devon, ana) one at a time.
    for (const id of ['maya', 'devon']) {
      paused = { ...paused, players: { ...paused.players, [id]: { ...paused.players[id]!, isReady: true } } };
      expect(canResume(paused)).toBe(false); // still one short
    }
    paused = { ...paused, players: { ...paused.players, ana: { ...paused.players['ana']!, isReady: true } } };
    expect(canResume(paused)).toBe(true); // all three ready (spectator/facilitator excluded)
  });
});

describe('active-team scoping (Model B, Story 8.11)', () => {
  // Same roster, but Team A is the team currently playing the round.
  const activeTeamAState = (): SessionState => ({ ...activeState(), activeTeamId: 'A' });

  it('disconnect pause resets ONLY the active team — a resting-team drop leaves the rest untouched', () => {
    const next = pauseSession(activeTeamAState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'ana' });
    // Team A is playing: its participants reset to not-ready for the resume gate.
    expect(next.players['maya']!.isReady).toBe(false);
    expect(next.players['devon']!.isReady).toBe(false);
    // Ana is on the RESTING team B — not a participant this round, ready untouched.
    expect(next.players['ana']!.isReady).toBe(true);
    expect(next.players['fac']!.isReady).toBe(true);
    expect(next.players['sam']!.isReady).toBe(true);
  });

  it('canResume ignores a resting-team player — only the active team must be ready', () => {
    // A resting-team (B / ana) drop pauses; ana is NOT required to come back.
    let paused = pauseSession(activeTeamAState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'ana' });
    expect(canResume(paused)).toBe(false); // active team (maya, devon) was reset
    // ana stays not-ready (or absent) and must NOT block resume.
    paused = { ...paused, players: { ...paused.players, ana: { ...paused.players['ana']!, isReady: false } } };
    paused = { ...paused, players: { ...paused.players, maya: { ...paused.players['maya']!, isReady: true } } };
    expect(canResume(paused)).toBe(false); // devon still short
    paused = { ...paused, players: { ...paused.players, devon: { ...paused.players['devon']!, isReady: true } } };
    expect(canResume(paused)).toBe(true); // active team ready; resting ana irrelevant
  });
});

describe('clearDisconnectedPlayer', () => {
  it('removes a reconnected player; same reference when absent', () => {
    const paused = pauseSession(activeState(), { kind: 'disconnect', now: 1000, droppedPlayerId: 'maya' });
    const cleared = clearDisconnectedPlayer(paused, 'maya');
    expect(cleared.disconnectedPlayerIds).toEqual([]);
    expect(clearDisconnectedPlayer(paused, 'devon')).toBe(paused);
  });
});
