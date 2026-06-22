import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PlayerInfo, PlayerRole, SessionState, TeamId } from '@bomb-squad/shared';
import { useVoiceStore } from '../../store/voiceStore.js';
import { useVoiceScopeSync } from '../useVoiceScopeSync.js';

/**
 * Hook tests for the re-mint reconciler (Story 3.5). The pure decision is tested
 * in computeVoiceAction.test.ts; here we pin that the hook drives `reconnectVoice`
 * (FRESH token, no gesture) exactly when an effective-scope change warrants it,
 * and is inert otherwise. `reconnectVoice` is mocked — the real teardown→connect
 * + failure→unavailable semantics are covered in connectVoice.test.ts.
 */
const reconnectVoice = vi.fn(async (_opts?: { publish?: boolean }) => undefined);
vi.mock('../connectVoice.js', () => ({
  connectVoice: async () => undefined,
  reconnectVoice: (opts?: { publish?: boolean }) => reconnectVoice(opts),
  disconnectVoice: async () => undefined,
}));

const SID = 'sess1';

function player(role: PlayerRole, teamId?: TeamId): PlayerInfo {
  return { playerId: 'self', displayName: 'Ada', role, teamId, isReady: false };
}
function session(role: PlayerRole, teamId?: TeamId): SessionState {
  return {
    sessionId: SID,
    status: 'active',
    players: { self: player(role, teamId) },
  } as unknown as SessionState;
}

/** Put the store into a connected state with a known room + publish intent. */
function setConnected(room: string, publishing: boolean) {
  useVoiceStore.setState({ status: 'connected', room, publishing });
}

beforeEach(() => {
  reconnectVoice.mockClear();
  useVoiceStore.setState({ status: 'idle', room: undefined, publishing: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  useVoiceStore.setState({ status: 'idle', room: undefined, publishing: false });
});

describe('useVoiceScopeSync', () => {
  it('connected Bomb Room → reassigned Spectator: reconnects listen-only (AC #1/#2)', () => {
    setConnected('bomb-room:sess1:A', true);
    renderHook(() => useVoiceScopeSync(session('spectator'), 'self'));
    expect(reconnectVoice).toHaveBeenCalledWith({ publish: false });
  });

  it('connected Spectator → reassigned Defuser: reconnects publishing into the Bomb Room', () => {
    setConnected('spectator-lounge:sess1', false);
    renderHook(() => useVoiceScopeSync(session('defuser', 'A'), 'self'));
    expect(reconnectVoice).toHaveBeenCalledWith({ publish: true });
  });

  it('Defuser→Expert on the same team: NO reconnect (AC #3, same effective scope)', () => {
    setConnected('bomb-room:sess1:A', true);
    renderHook(() => useVoiceScopeSync(session('expert', 'A'), 'self'));
    expect(reconnectVoice).not.toHaveBeenCalled();
  });

  it('does not reconnect when the connected scope already matches the desired one', () => {
    setConnected('bomb-room:sess1:A', true);
    renderHook(() => useVoiceScopeSync(session('defuser', 'A'), 'self'));
    expect(reconnectVoice).not.toHaveBeenCalled();
  });

  it('never auto-connects from idle even on a scope change (AC #5)', () => {
    // status stays idle (never connected) — a scope that WOULD differ if connected.
    renderHook(() => useVoiceScopeSync(session('spectator'), 'self'));
    expect(reconnectVoice).not.toHaveBeenCalled();
  });

  it('is inert for an unmanaged role (facilitator) while connected', () => {
    setConnected('bomb-room:sess1:A', true);
    renderHook(() => useVoiceScopeSync(session('facilitator'), 'self'));
    expect(reconnectVoice).not.toHaveBeenCalled();
  });

  it('collapses to the latest desired scope across successive updates (no storm)', () => {
    setConnected('bomb-room:sess1:A', true);
    const { rerender } = renderHook(({ s }: { s: SessionState }) => useVoiceScopeSync(s, 'self'), {
      initialProps: { s: session('defuser', 'A') }, // identical scope → no reconnect
    });
    expect(reconnectVoice).not.toHaveBeenCalled();

    // Now a real scope change → exactly one reconnect to the new (spectator) scope.
    rerender({ s: session('spectator') });
    expect(reconnectVoice).toHaveBeenCalledTimes(1);
    expect(reconnectVoice).toHaveBeenLastCalledWith({ publish: false });

    // A rerender that does NOT change the desired scope must not re-fire.
    rerender({ s: session('spectator') });
    expect(reconnectVoice).toHaveBeenCalledTimes(1);
  });
});
