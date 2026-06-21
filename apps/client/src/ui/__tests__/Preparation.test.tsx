import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoundConfig } from '@bomb-squad/shared';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeRoundConfig, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';

// PrepBombView mounts the R3F BombStage/BombScene — out of scope for a jsdom
// component test (R3F is rendering-only, covered by visual/smoke). Stub it with
// a DOM sentinel so we can assert the upcoming-Defuser branch routes to it.
vi.mock('../PrepBombView.js', () => ({
  default: () => <div data-testid="prep-bomb-view" />,
}));

import Preparation from '../Preparation.js';
import { PREP_MANUAL_LINE, RESTING_THIS_ROUND } from '../copy.js';

let mock: MockSocket;

/** Preparation viewed by the facilitator, with one team whose upcoming defuser is Maya. */
function seedFacilitatorPrep() {
  const session = makeSession({
    status: 'preparation',
    activeTeamId: 'A',
    players: {
      fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
    },
    teams: { A: makeTeam('A', ['p1']) },
  });
  useGameStore.setState({ session, myPlayerId: 'fac' });
}

/**
 * Preparation seeded with an upcoming Defuser (Maya/p1) and an Expert (Eli/e1)
 * on the same team — the two role surfaces the AC contrasts. `viewer` picks
 * whose eyes we render through.
 */
function seedDefuserVsExpertPrep(viewer: 'p1' | 'e1' | 'spec', overrides: Partial<RoundConfig> = {}) {
  const session = makeSession({
    status: 'preparation',
    activeTeamId: 'A',
    config: makeRoundConfig(overrides),
    players: {
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
      e1: makePlayer({ playerId: 'e1', displayName: 'Eli', role: 'expert', teamId: 'A' }),
      spec: makePlayer({ playerId: 'spec', displayName: 'Sam', role: 'spectator' }),
    },
    // relayOrder defuser at index 0 → upcomingDefuserId(team) === 'p1'.
    teams: { A: makeTeam('A', ['p1', 'e1']) },
  });
  useGameStore.setState({ session, myPlayerId: viewer });
}

beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
  useGameStore.setState({ session: null, myPlayerId: null });
});

describe('Preparation', () => {
  it('renders nothing when there is no session', () => {
    const { container } = render(<Preparation />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the facilitator heading and the upcoming defuser', () => {
    seedFacilitatorPrep();
    render(<Preparation />);
    expect(screen.getByRole('heading', { name: 'Preparation' })).toBeInTheDocument();
    const upcoming = screen.getByTestId('upcoming-defusers');
    expect(within(upcoming).getByText('Maya')).toBeInTheDocument();
  });

  it('emits ROUND_START after the two-step Start confirm', async () => {
    const user = userEvent.setup();
    seedFacilitatorPrep();
    render(<Preparation />);

    // ConfirmButton: first click arms, second (Confirm) fires onConfirm.
    await user.click(screen.getByRole('button', { name: 'Start the round' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(mock.emit).toHaveBeenCalledWith('ROUND_START');
  });

  it('emits PREPARATION_CANCEL when the facilitator goes back to the lobby', async () => {
    const user = userEvent.setup();
    seedFacilitatorPrep();
    render(<Preparation />);

    await user.click(screen.getByRole('button', { name: 'Back to lobby' }));

    expect(mock.emit).toHaveBeenCalledWith('PREPARATION_CANCEL');
  });

  // Story 4.6 — role-gated prep surfaces (AC1 + AC2).
  it('shows the upcoming Defuser the placeholder bomb, not the manual (AC1)', () => {
    seedDefuserVsExpertPrep('p1');
    render(<Preparation />);
    expect(screen.getByTestId('prep-bomb-view')).toBeInTheDocument();
    expect(screen.queryByText(PREP_MANUAL_LINE)).not.toBeInTheDocument();
  });

  it('keeps the Expert on the manual during prep — never the bomb (AC2 regression)', () => {
    seedDefuserVsExpertPrep('e1');
    render(<Preparation />);
    expect(screen.getByText(PREP_MANUAL_LINE)).toBeInTheDocument();
    expect(screen.queryByTestId('prep-bomb-view')).not.toBeInTheDocument();
  });

  it('keeps a Spectator on the manual surface — sees no bomb (AC2)', () => {
    seedDefuserVsExpertPrep('spec');
    render(<Preparation />);
    expect(screen.getByText(PREP_MANUAL_LINE)).toBeInTheDocument();
    expect(screen.queryByTestId('prep-bomb-view')).not.toBeInTheDocument();
  });

  it('shows the facilitator no bomb surface (role gating holds)', () => {
    seedFacilitatorPrep();
    render(<Preparation />);
    expect(screen.queryByTestId('prep-bomb-view')).not.toBeInTheDocument();
  });

  // Story 8.9 — a team with no upcoming Defuser (exhausted / resting this round)
  // is labelled clearly, not a bare em-dash that reads as a bug.
  it('labels a resting team "Resting this round" instead of a bare dash', () => {
    const session = makeSession({
      status: 'preparation',
      roundNumber: 3,
      // A is the active team this round; B rests (Model B — one team at a time).
      activeTeamId: 'A',
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'expert', teamId: 'B' }),
      },
      teams: {
        // A is active with a natural pick at index 2; B is not the active team → it
        // rests this round and is labelled accordingly.
        A: makeTeam('A', ['p1', 'p1', 'p1'], { currentDefuserIndex: 2 }),
        B: makeTeam('B', ['p2'], { currentDefuserIndex: 2 }),
      },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Preparation />);

    const upcoming = screen.getByTestId('upcoming-defusers');
    expect(within(upcoming).getByText(RESTING_THIS_ROUND)).toBeInTheDocument();
  });

  it('REGRESSION (Jay 2026-06-21): a retry shows the FAILED player as the active Defuser, not "Resting" — the other team rests', () => {
    // Model B: Maya (index 0) failed, so Team A's pointer advanced to 1 (exhausted
    // its single-slot rotation). On a retry `upcomingDefuserId` would return null →
    // the ACTIVE team also rendered "Resting", so BOTH teams read as resting. The
    // retry must show `retryDefuserId` (Maya) for the active team instead.
    const session = makeSession({
      status: 'preparation',
      roundNumber: 1,
      activeTeamId: 'A',
      retryingTeamId: 'A',
      retryDefuserId: 'p1',
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'expert', teamId: 'B' }),
      },
      teams: {
        // A's pointer already advanced past Maya (index 1 = exhausted single slot).
        A: makeTeam('A', ['p1'], { currentDefuserIndex: 1 }),
        B: makeTeam('B', ['p2'], { currentDefuserIndex: 0 }),
      },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Preparation />);

    const upcoming = screen.getByTestId('upcoming-defusers');
    // The active (retrying) team shows the FAILED player Maya — NOT resting.
    expect(within(upcoming).getByText('Maya')).toBeInTheDocument();
    // Exactly ONE team rests (Team B), not both.
    expect(within(upcoming).getAllByText(RESTING_THIS_ROUND)).toHaveLength(1);
  });
});
