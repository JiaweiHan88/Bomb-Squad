import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, PlayerRole, TeamId } from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import { useVoiceStore } from '../../store/voiceStore.js';
import MuteControl from '../MuteControl.js';
import { MUTE_SELF, MUTED_STATUS } from '../copy.js';

/**
 * MuteControl render-gating tests (Story 3.4). The control shows ONLY for a
 * connected Bomb Room publisher (Defuser/Expert with a team) and reflects
 * `voiceStore.muted` in its own glyph/label. A spectator (no mic) and any
 * non-`connected` state render nothing. Toggle logic lives in connectVoice
 * (covered there) — here we pin only the role/connection gate + the muted visual.
 */
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
  useVoiceStore.setState({ status: 'connected', muted: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState({ session: null, myPlayerId: null });
  useVoiceStore.setState({ status: 'idle', muted: false });
});

describe('MuteControl', () => {
  it('shows for a connected Bomb Room publisher (defuser with team)', () => {
    seedSelf('defuser', 'A');
    render(<MuteControl />);
    expect(screen.getByRole('button', { name: MUTE_SELF })).toBeInTheDocument();
  });

  it('reflects the muted flag: aria-pressed + the muted glyph/label', () => {
    seedSelf('expert', 'B');
    useVoiceStore.setState({ status: 'connected', muted: true });
    render(<MuteControl />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    // The muted state surfaces the Muted status label + a strike-through glyph.
    expect(screen.getByText(MUTED_STATUS)).toBeInTheDocument();
  });

  it('un-muted state is not pressed', () => {
    seedSelf('defuser', 'A');
    render(<MuteControl />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders nothing for a spectator (no mic to mute)', () => {
    seedSelf('spectator');
    const { container } = render(<MuteControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when voice is not connected', () => {
    seedSelf('defuser', 'A');
    useVoiceStore.setState({ status: 'connecting', muted: false });
    const { container } = render(<MuteControl />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a defuser without a team (not a Bomb Room seat)', () => {
    seedSelf('defuser', undefined);
    const { container } = render(<MuteControl />);
    expect(container).toBeEmptyDOMElement();
  });
});
