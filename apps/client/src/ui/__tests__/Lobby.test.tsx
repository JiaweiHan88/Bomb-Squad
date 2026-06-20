import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { OPEN_PREPARATION, PREP_TEAM_TOO_SMALL } from '../copy.js';
import { useGameStore } from '../../store/gameStore.js';
import { useVoiceStore } from '../../store/voiceStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
// LobbyMicCheck (rendered inside Lobby) drives the voice controller; mock the
// module so the component test asserts the affordance, not connect internals
// (those are covered by connectVoice.test.ts).
vi.mock('../../voice/connectVoice.js', () => ({
  connectVoice: vi.fn(() => Promise.resolve()),
  disconnectVoice: vi.fn(() => Promise.resolve()),
}));
import { getSocket } from '../../net/socket.js';
import { connectVoice } from '../../voice/connectVoice.js';
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
  vi.mocked(connectVoice).mockClear();
  useGameStore.setState({ session: null, myPlayerId: null });
  useVoiceStore.setState({ status: 'idle', activeSpeakers: [] });
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

describe('Lobby — min-team-size gate (Story 8.9 follow-up)', () => {
  it('a 1-player team disables Open Preparation and shows the min-size hint', () => {
    const session = makeSession({
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
      },
      teams: { A: makeTeam('A', ['p1']) },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Lobby />);

    expect(screen.getByText(PREP_TEAM_TOO_SMALL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: OPEN_PREPARATION })).toBeDisabled();
  });

  it('a 2-player team enables Open Preparation (a single-team session is allowed)', () => {
    const session = makeSession({
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Mara', role: 'expert', teamId: 'A' }),
      },
      teams: { A: makeTeam('A', ['p1', 'p2']) },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Lobby />);

    expect(screen.queryByText(PREP_TEAM_TOO_SMALL)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: OPEN_PREPARATION })).toBeEnabled();
  });
});

describe('Lobby — ready state (AC 1)', () => {
  it("the viewer's own row shows a Ready toggle with aria-pressed from isReady", () => {
    seedFacilitatorLobby(); // self (fac) starts isReady:false
    render(<Lobby />);
    const toggle = screen.getByRole('button', { name: 'Mark ready' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking the Ready toggle emits PLAYER_READY with the toggled value', async () => {
    const user = userEvent.setup();
    seedFacilitatorLobby();
    render(<Lobby />);
    await user.click(screen.getByRole('button', { name: 'Mark ready' }));
    expect(mock.emit).toHaveBeenCalledWith('PLAYER_READY', { isReady: true });
  });

  it('a self row that is already ready shows the pressed toggle and emits false next', async () => {
    const user = userEvent.setup();
    const session = makeSession({
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator', isReady: true }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser' }),
      },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Lobby />);
    const toggle = screen.getByRole('button', { name: 'Ready' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(mock.emit).toHaveBeenCalledWith('PLAYER_READY', { isReady: false });
  });

  it('ready indicators reflect the snapshot on other rows', () => {
    const session = makeSession({
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', isReady: true }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'expert', isReady: false }),
      },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Lobby />);

    // Self (fac) is not ready → shows the "Mark ready" toggle, not a "Ready" badge.
    // Only Maya (p1) is ready → exactly one read-only "Ready" indicator.
    expect(screen.getByText('Ready')).toBeInTheDocument();
    const mayaRow = screen.getByText('Maya').closest('li')!;
    expect(within(mayaRow).getByText('Ready')).toBeInTheDocument();
    const devonRow = screen.getByText('Devon').closest('li')!;
    expect(within(devonRow).queryByText('Ready')).not.toBeInTheDocument();
  });
});

describe('Lobby — speaker dots (AC 2)', () => {
  it("lights the active speaker's dot and leaves others quiet; name shown beside it", () => {
    seedFacilitatorLobby();
    useVoiceStore.setState({ status: 'connected', activeSpeakers: ['p1'] });
    render(<Lobby />);

    expect(screen.getByLabelText('Maya speaking')).toBeInTheDocument();
    expect(screen.getByLabelText('Faci quiet')).toBeInTheDocument();
    // Name is present alongside the dot (colorblind floor — never icon-only).
    expect(screen.getByText('Maya')).toBeInTheDocument();
  });

  it('shows all dots quiet when the viewer has not joined the mic check', () => {
    seedFacilitatorLobby();
    useVoiceStore.setState({ status: 'idle', activeSpeakers: [] });
    render(<Lobby />);
    expect(screen.getByLabelText('Maya quiet')).toBeInTheDocument();
    expect(screen.getByLabelText('Faci quiet')).toBeInTheDocument();
  });
});

describe('Lobby — empty state (AC 3)', () => {
  it('a single-player session shows "Waiting for your team." and no roster row', () => {
    const session = makeSession({
      players: { fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }) },
    });
    useGameStore.setState({ session, myPlayerId: 'fac' });
    render(<Lobby />);

    expect(screen.getByText('Waiting for your team.')).toBeInTheDocument();
    expect(screen.queryByTestId('roster')).not.toBeInTheDocument();
    // The share panel stays so they can invite the team.
    expect(screen.getByTestId('join-code')).toBeInTheDocument();
  });

  it('a two-player session renders the roster and not the empty-state message', () => {
    seedFacilitatorLobby();
    render(<Lobby />);
    expect(screen.getByTestId('roster')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for your team.')).not.toBeInTheDocument();
  });
});

describe('Lobby — mic-check affordance', () => {
  it('renders "Join mic check" when voice is idle and clicking it drives connectVoice', async () => {
    const user = userEvent.setup();
    seedFacilitatorLobby();
    useVoiceStore.setState({ status: 'idle', activeSpeakers: [] });
    render(<Lobby />);

    await user.click(screen.getByRole('button', { name: 'Join mic check' }));
    expect(connectVoice).toHaveBeenCalledTimes(1);
  });

  it('mirrors voiceStore status into the connect microcopy', () => {
    seedFacilitatorLobby();

    useVoiceStore.setState({ status: 'connecting' });
    const { rerender } = render(<Lobby />);
    expect(screen.getByText('Joining mic check…')).toBeInTheDocument();

    useVoiceStore.setState({ status: 'connected' });
    rerender(<Lobby />);
    expect(screen.getByText('Mic check connected.')).toBeInTheDocument();

    useVoiceStore.setState({ status: 'unavailable' });
    rerender(<Lobby />);
    expect(screen.getByText('Voice unavailable — game continues without it')).toBeInTheDocument();
  });
});
