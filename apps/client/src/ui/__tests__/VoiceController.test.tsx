import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, PlayerRole, TeamId } from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import { useVoiceStore } from '../../store/voiceStore.js';
import VoiceController from '../VoiceController.js';
import { VOICE_UNAVAILABLE, VOICE_DISMISS, VOICE_RECONNECT } from '../copy.js';

/**
 * VoiceController graceful-degradation tests (Story 3.6, AC #1/#2). The
 * `unavailable` state shows the dismissible banner AND a "Reconnect voice"
 * affordance; the reconnect re-runs connectVoice in the player's role mode, and
 * it stays reachable even after the banner is dismissed. Connection logic is
 * mocked (covered in connectVoice tests) — here we pin the affordance + gate.
 */
const reconnectVoice = vi.fn(async (_opts?: { publish?: boolean }) => undefined);
vi.mock('../../voice/connectVoice.js', () => ({
  connectVoice: async () => undefined,
  reconnectVoice: (opts?: { publish?: boolean }) => reconnectVoice(opts),
  disconnectVoice: async () => undefined,
}));

function selfPlayer(role: PlayerRole, teamId?: TeamId): PlayerInfo {
  return { playerId: 'self', displayName: 'Ada', role, teamId, isReady: false };
}
function seedSelf(role: PlayerRole, teamId?: TeamId) {
  useGameStore.setState({
    session: { players: { self: selfPlayer(role, teamId) } } as never,
    myPlayerId: 'self',
  });
}

beforeEach(() => {
  reconnectVoice.mockClear();
  useVoiceStore.setState({ status: 'unavailable' });
});

afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState({ session: null, myPlayerId: null });
  useVoiceStore.setState({ status: 'idle' });
});

describe('VoiceController graceful degradation', () => {
  it('shows the dismissible banner and a Reconnect control when unavailable', () => {
    seedSelf('defuser', 'A');
    render(<VoiceController />);
    expect(screen.getByText(VOICE_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VOICE_DISMISS })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VOICE_RECONNECT })).toBeInTheDocument();
  });

  it('Reconnect re-runs reconnectVoice in the publisher mode (publish: true)', () => {
    seedSelf('defuser', 'A');
    render(<VoiceController />);
    fireEvent.click(screen.getByRole('button', { name: VOICE_RECONNECT }));
    expect(reconnectVoice).toHaveBeenCalledWith({ publish: true });
  });

  it('a spectator reconnects listen-only (publish: false)', () => {
    seedSelf('spectator');
    render(<VoiceController />);
    fireEvent.click(screen.getByRole('button', { name: VOICE_RECONNECT }));
    expect(reconnectVoice).toHaveBeenCalledWith({ publish: false });
  });

  it('dismissing hides the banner message but KEEPS Reconnect reachable (AC #1/#2)', () => {
    seedSelf('defuser', 'A');
    render(<VoiceController />);
    fireEvent.click(screen.getByRole('button', { name: VOICE_DISMISS }));
    // The message + Dismiss are gone…
    expect(screen.queryByText(VOICE_UNAVAILABLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: VOICE_DISMISS })).not.toBeInTheDocument();
    // …but the ability to re-attempt voice must survive the dismiss.
    expect(screen.getByRole('button', { name: VOICE_RECONNECT })).toBeInTheDocument();
  });
});
