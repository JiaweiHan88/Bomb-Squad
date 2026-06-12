import type { SessionState } from '@bomb-squad/shared';
import { startRound } from '../startRound.js';
import { addPlayerToSession } from '../joinSession.js';
import { assignPlayerToTeam } from '../assignTeam.js';
import { createSessionState } from '../createSession.js';
import { openPreparation } from '../openPreparation.js';

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
 * A preparation-phase session (roundNumber 1) with:
 *  Team A: Maya (defuser), Devon (expert)  — relayOrder [maya, devon]
 *  Team B: Ana (expert)                    — relayOrder [ana]
 *  Sam: unassigned spectator.
 */
const prepState = (): SessionState => {
  let state = createSessionState({
    sessionId: 'sess-1',
    joinCode: 'ABC123',
    facilitatorId: 'sock-fac',
  });
  state = addPlayerToSession(state, { playerId: 'sock-maya', displayName: 'Maya', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-devon', displayName: 'Devon', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-ana', displayName: 'Ana', role: 'expert' });
  state = addPlayerToSession(state, { playerId: 'sock-sam', displayName: 'Sam', role: 'spectator' });
  state = assignPlayerToTeam(state, { playerId: 'sock-maya', teamId: 'A', role: 'defuser' });
  state = assignPlayerToTeam(state, { playerId: 'sock-devon', teamId: 'A', role: 'expert' });
  state = assignPlayerToTeam(state, { playerId: 'sock-ana', teamId: 'B', role: 'expert' });
  return openPreparation(state);
};

describe('startRound', () => {
  it('activates the round and commits the rotation pick per team', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('active');
    expect(result.round).toEqual({
      roundNumber: 1,
      status: 'active',
      defusers: { A: 'sock-maya', B: 'sock-ana' },
      retry: false,
    });
  });

  it('flips the selected players to defuser; previous defuser-role holders become expert', () => {
    // Move the defuser role onto Devon pre-start so rotation (Maya, index 0) displaces him.
    let state = prepState();
    state = {
      ...state,
      players: {
        ...state.players,
        'sock-maya': { ...state.players['sock-maya']!, role: 'expert' },
        'sock-devon': { ...state.players['sock-devon']!, role: 'defuser' },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-maya']!.role).toBe('defuser');
    expect(result.state.players['sock-devon']!.role).toBe('expert');
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('a spectator in relayOrder who comes up in rotation becomes defuser (relay order is the authority)', () => {
    let state = prepState();
    state = {
      ...state,
      players: {
        ...state.players,
        'sock-ana': { ...state.players['sock-ana']!, role: 'spectator' },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-ana']!.role).toBe('defuser');
  });

  it('never touches the facilitator or off-team spectators', () => {
    const result = startRound(prepState());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['sock-fac']!.role).toBe('facilitator');
    expect(result.state.players['sock-sam']!.role).toBe('spectator');
  });

  it('normalizes an out-of-range currentDefuserIndex via modulo (deferred 2.4 clamp, read side)', () => {
    let state = prepState();
    state = {
      ...state,
      teams: { ...state.teams, A: { ...state.teams.A!, currentDefuserIndex: 5 } },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // relayOrder [maya, devon], 5 % 2 = 1 → Devon.
    expect(result.round.defusers.A).toBe('sock-devon');
    expect(result.state.players['sock-devon']!.role).toBe('defuser');
    // Maya held the defuser role pre-start → displaced to expert.
    expect(result.state.players['sock-maya']!.role).toBe('expert');
  });

  it.each(['lobby', 'active', 'between-rounds', 'ended'] as const)(
    'rejects when status is %s',
    (status) => {
      const state: SessionState = { ...prepState(), status };
      const result = startRound(state);
      expect(result).toEqual({ ok: false, reason: 'NOT_IN_PREPARATION' });
    },
  );

  it('rejects when no team has a populated relayOrder', () => {
    const state: SessionState = { ...prepState(), teams: {} };
    const result = startRound(state);
    expect(result).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('skips a team whose selected relayOrder entry is missing from players (integrity guard)', () => {
    let state = prepState();
    state = {
      ...state,
      teams: {
        ...state.teams,
        B: { ...state.teams.B!, relayOrder: ['sock-ghost'] },
      },
    };
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.defusers).toEqual({ A: 'sock-maya' });
  });

  it('rejects when every populated team resolves to a missing player', () => {
    let state = prepState();
    state = {
      ...state,
      teams: {
        A: { ...state.teams.A!, relayOrder: ['sock-ghost-a'] },
        B: { ...state.teams.B!, relayOrder: ['sock-ghost-b'] },
      },
    };
    const result = startRound(state);
    expect(result).toEqual({ ok: false, reason: 'NO_POPULATED_TEAM' });
  });

  it('does not mutate the input state (deep-frozen input must not throw)', () => {
    const frozen = deepFreeze(prepState());
    const result = startRound(frozen);
    expect(result.ok).toBe(true);
    expect(frozen.status).toBe('preparation');
    expect(frozen.players['sock-ana']!.role).toBe('expert');
  });

  it('leaves rotation bookkeeping and scores untouched (8.6/8.9 own advancement)', () => {
    const state = prepState();
    const result = startRound(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.teams.A!.currentDefuserIndex).toBe(0);
    expect(result.state.teams.A!.cumulativeTimeMs).toBe(0);
    expect(result.state.roundNumber).toBe(1);
    expect(result.state.config).toBe(state.config);
  });
});
