import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo } from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import { useVoiceStore } from '../../store/voiceStore.js';
import SpeakerIndicator from '../SpeakerIndicator.js';

/**
 * SpeakerIndicator render tests (Story 3.4). The component is a pure reflection of
 * `voiceStore.activeSpeakers` × the roster: one pill per speaking id, self in
 * cool-blue (`speaker-self`), others in LED-green (`speaker-active`), name always
 * shown, and nothing at all when no one is talking. The 150ms grace lives in
 * connectVoice (covered there) — not here.
 */
function player(id: string, displayName: string): PlayerInfo {
  return { playerId: id, displayName, role: 'defuser', teamId: 'A', isReady: false };
}

function seedRoster() {
  useGameStore.setState({
    session: {
      players: {
        self: player('self', 'Ada'),
        other: player('other', 'Grace'),
      },
    } as never,
    myPlayerId: 'self',
  });
}

beforeEach(() => {
  useVoiceStore.setState({ status: 'connected', activeSpeakers: [], muted: false });
  seedRoster();
});

afterEach(() => {
  useGameStore.setState({ session: null, myPlayerId: null });
  useVoiceStore.setState({ status: 'idle', activeSpeakers: [], muted: false });
});

describe('SpeakerIndicator', () => {
  it('renders nothing when no one is speaking', () => {
    useVoiceStore.setState({ activeSpeakers: [] });
    const { container } = render(<SpeakerIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a named pill per active speaker', () => {
    useVoiceStore.setState({ activeSpeakers: ['self', 'other'] });
    render(<SpeakerIndicator />);
    // Names are ALWAYS visible (never icon-only).
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  it('colors the self pill cool-blue and others LED-green', () => {
    useVoiceStore.setState({ activeSpeakers: ['self', 'other'] });
    render(<SpeakerIndicator />);
    expect(screen.getByTestId('speaker-pill-self').className).toContain('text-speaker-self');
    expect(screen.getByTestId('speaker-pill-other').className).toContain('text-speaker-active');
  });

  it('gates the pulse behind motion-safe (reduced-motion → static, AC #5)', () => {
    useVoiceStore.setState({ activeSpeakers: ['other'] });
    render(<SpeakerIndicator />);
    // The animated dot lives inside the pill; the pulse must be motion-safe-gated.
    expect(screen.getByTestId('speaker-pill-other').innerHTML).toContain('motion-safe:animate-pulse');
  });
});
