import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeSession } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import Lobby from '../Lobby.js';

let mock: MockSocket;

/** A session where `fac` is the facilitator viewing the lobby, plus one player. */
function seedFacilitatorLobby() {
  const session = makeSession({
    players: {
      fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser' }),
    },
  });
  useGameStore.setState({ session, myPlayerId: 'fac' });
}

beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
  useGameStore.setState({ session: null, myPlayerId: null });
});

describe('Lobby', () => {
  it('renders nothing when there is no session', () => {
    const { container } = render(<Lobby />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the roster with each player name', () => {
    seedFacilitatorLobby();
    render(<Lobby />);
    expect(screen.getByText('Maya')).toBeInTheDocument();
    expect(screen.getByText('Faci')).toBeInTheDocument();
  });

  it('emits TEAM_ASSIGN when the facilitator assigns a player to a team', async () => {
    const user = userEvent.setup();
    seedFacilitatorLobby();
    render(<Lobby />);

    const assignGroup = screen.getByRole('group', { name: 'Assign Maya to a team' });
    await user.click(within(assignGroup).getByRole('button', { name: 'A' }));

    expect(mock.emit).toHaveBeenCalledWith('TEAM_ASSIGN', {
      playerId: 'p1',
      teamId: 'A',
      role: 'defuser',
    });
  });
});
