import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import Scoreboard from '../Scoreboard.js';
import { START_NEXT_ROUND, BETWEEN_ROUNDS_WAITING, SCOREBOARD_LEADING } from '../copy.js';

let mock: MockSocket;

/**
 * Between-rounds session: Team A (faster, leading) + Team B, each with one
 * recorded round. `viewer` picks whose eyes we render through. Crucially, the
 * `scoreboard` store field is left NULL — the surface must derive from
 * session.teams (the reconnect-safe path).
 */
function seedBetweenRounds(viewer: 'fac' | 'p1') {
  const session = makeSession({
    status: 'between-rounds',
    roundNumber: 1,
    players: {
      fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
      p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'defuser', teamId: 'B' }),
    },
    teams: {
      // Distinct per-round + total values so each rendered time string is unique.
      A: makeTeam('A', ['p1'], { cumulativeTimeMs: 61_000, roundTimesMs: [40_000, 21_000] }),
      B: makeTeam('B', ['p2'], { cumulativeTimeMs: 130_000, roundTimesMs: [70_000, 60_000] }),
    },
  });
  useGameStore.setState({ session, myPlayerId: viewer, scoreboard: null });
}

beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
  useGameStore.setState({ session: null, myPlayerId: null, scoreboard: null });
});

describe('Scoreboard (Story 8.6)', () => {
  it('renders per-team standings derived from session.teams (no SCOREBOARD event needed)', () => {
    seedBetweenRounds('fac');
    render(<Scoreboard />);

    const teamA = screen.getByTestId('scoreboard-team-A');
    const teamB = screen.getByTestId('scoreboard-team-B');
    // Team A: rounds 0:40 + 0:21, total 1:01. Team B: rounds 1:10 + 1:00, total 2:10.
    expect(within(teamA).getByText('0:40')).toBeInTheDocument();
    expect(within(teamA).getByText('0:21')).toBeInTheDocument();
    expect(within(teamA).getByText('1:01')).toBeInTheDocument();
    expect(within(teamB).getByText('2:10')).toBeInTheDocument();
  });

  it('marks the provisional leader (lowest cumulative time) — Team A', () => {
    seedBetweenRounds('fac');
    render(<Scoreboard />);
    expect(screen.getByTestId('scoreboard-leader-A')).toHaveTextContent(SCOREBOARD_LEADING);
    expect(screen.queryByTestId('scoreboard-leader-B')).not.toBeInTheDocument();
  });

  it('facilitator gets a Start-next-round control; advancing emits PREPARATION_OPEN', async () => {
    seedBetweenRounds('fac');
    render(<Scoreboard />);

    const start = screen.getByRole('button', { name: START_NEXT_ROUND });
    await userEvent.click(start); // arms the two-step confirm
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mock.emit).toHaveBeenCalledWith('PREPARATION_OPEN');
  });

  it('a non-facilitator sees the standby line and no advance control', () => {
    seedBetweenRounds('p1');
    render(<Scoreboard />);
    expect(screen.getByText(BETWEEN_ROUNDS_WAITING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: START_NEXT_ROUND })).not.toBeInTheDocument();
  });

  it('paints an advance-class ERROR as an alert (e.g. NOT_FACILITATOR)', () => {
    seedBetweenRounds('fac');
    render(<Scoreboard />);
    act(() => {
      mock.fire('ERROR', {
        code: 'CANNOT_OPEN_PREP',
        message: 'Assign at least one player to a team first.',
        recoverable: true,
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Assign at least one player to a team first.');
  });
});
