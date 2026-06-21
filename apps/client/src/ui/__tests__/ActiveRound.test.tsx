import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

// R3F-heavy children are rendering-only — stub them with DOM sentinels so a jsdom
// component test can assert the active-team-first routing (Story 8.11).
vi.mock('../../scenes/BombStage.js', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="bomb-stage">{children}</div>,
}));
vi.mock('../../scenes/BombScene.js', () => ({ default: () => <div data-testid="bomb-scene" /> }));
vi.mock('../../manual/ManualViewer.js', () => ({ default: () => <div data-testid="manual" /> }));
vi.mock('../../manual/chapters.js', () => ({ buildChapters: () => [] }));
vi.mock('../../modules/index.js', () => ({ SANDBOX_MODULES: [] }));
vi.mock('../ResolutionBanner.js', () => ({ default: () => null }));
vi.mock('../PauseOverlay.js', () => ({ default: () => null }));
vi.mock('../VoiceController.js', () => ({ default: () => null }));

import ActiveRound from '../ActiveRound.js';
import { RESTING_SPECTATE } from '../copy.js';

/** An active round where Team A is active; viewer is one of the seeded players. */
function seed(viewer: string) {
  const session = makeSession({
    status: 'active',
    activeTeamId: 'A',
    players: {
      // Team A (active): a defuser + an expert.
      ad: makePlayer({ playerId: 'ad', displayName: 'Ada', role: 'defuser', teamId: 'A' }),
      ae: makePlayer({ playerId: 'ae', displayName: 'Aki', role: 'expert', teamId: 'A' }),
      // Team B (resting): a defuser-that-was + an expert.
      bd: makePlayer({ playerId: 'bd', displayName: 'Bex', role: 'defuser', teamId: 'B' }),
      be: makePlayer({ playerId: 'be', displayName: 'Ben', role: 'expert', teamId: 'B' }),
    },
    teams: { A: makeTeam('A', ['ad', 'ae']), B: makeTeam('B', ['bd', 'be']) },
  });
  useGameStore.setState({ session, myPlayerId: viewer });
}

beforeEach(() => {
  useGameStore.setState({ session: null, myPlayerId: null });
});

describe('ActiveRound — Model B active-team-first routing (Story 8.11)', () => {
  it('renders nothing when there is no session', () => {
    const { container } = render(<ActiveRound />);
    expect(container).toBeEmptyDOMElement();
  });

  it('active-team defuser sees the bomb', () => {
    seed('ad');
    render(<ActiveRound />);
    expect(screen.getByTestId('bomb-stage')).toBeInTheDocument();
    expect(screen.queryByTestId('resting-standby')).not.toBeInTheDocument();
  });

  it('active-team expert sees the manual', () => {
    seed('ae');
    render(<ActiveRound />);
    expect(screen.getByTestId('manual')).toBeInTheDocument();
    expect(screen.queryByTestId('resting-standby')).not.toBeInTheDocument();
  });

  it('a RESTING-team defuser (their team is not active) is routed to standby, NOT the bomb', () => {
    seed('bd');
    render(<ActiveRound />);
    expect(screen.getByTestId('resting-standby')).toHaveTextContent(RESTING_SPECTATE);
    expect(screen.queryByTestId('bomb-stage')).not.toBeInTheDocument();
  });

  it('a RESTING-team expert is routed to standby, NOT the manual', () => {
    seed('be');
    render(<ActiveRound />);
    expect(screen.getByTestId('resting-standby')).toBeInTheDocument();
    expect(screen.queryByTestId('manual')).not.toBeInTheDocument();
  });
});
