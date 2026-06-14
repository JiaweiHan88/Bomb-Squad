import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import Preparation from '../Preparation.js';

let mock: MockSocket;

/** Preparation viewed by the facilitator, with one team whose upcoming defuser is Maya. */
function seedFacilitatorPrep() {
  const session = makeSession({
    status: 'preparation',
    players: {
      fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
    },
    teams: { A: makeTeam('A', ['p1']) },
  });
  useGameStore.setState({ session, myPlayerId: 'fac' });
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
});
