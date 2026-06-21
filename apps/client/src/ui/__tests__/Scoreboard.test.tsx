import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import Scoreboard from '../Scoreboard.js';
import { START_NEXT_ROUND, BETWEEN_ROUNDS_WAITING, SCOREBOARD_LEADING, RETRY_ROUND, END_SESSION } from '../copy.js';

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
      p1b: makePlayer({ playerId: 'p1b', displayName: 'Mara', role: 'expert', teamId: 'A' }),
      p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'defuser', teamId: 'B' }),
      p2b: makePlayer({ playerId: 'p2b', displayName: 'Dana', role: 'expert', teamId: 'B' }),
    },
    teams: {
      // 2-player teams at index 0 → a natural round still remains (NOT relay-complete),
      // so the facilitator's "Start next round" advance shows. Distinct time values
      // keep each rendered string unique.
      A: makeTeam('A', ['p1', 'p1b'], { cumulativeTimeMs: 61_000, roundTimesMs: [40_000, 21_000] }),
      B: makeTeam('B', ['p2', 'p2b'], { cumulativeTimeMs: 130_000, roundTimesMs: [70_000, 60_000] }),
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

describe('Scoreboard — retry a failed round (Story 8.8)', () => {
  /** Seed between-rounds and set the SCOREBOARD payload's failedTeams. */
  function seedWithFailedTeams(viewer: 'fac' | 'p1', failedTeams: ('A' | 'B')[]) {
    seedBetweenRounds(viewer);
    const teams = useGameStore.getState().scoreboard?.teams ?? {};
    useGameStore.setState({ scoreboard: { teams, failedTeams } });
  }

  it('facilitator sees a Retry-round control for a failed team; confirming emits ROUND_RETRY', async () => {
    seedWithFailedTeams('fac', ['A']);
    render(<Scoreboard />);

    const retry = screen.getByRole('button', { name: RETRY_ROUND });
    await userEvent.click(retry); // arm the two-step confirm
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mock.emit).toHaveBeenCalledWith('ROUND_RETRY', { teamId: 'A' });
  });

  it('no Retry control when no team failed (a defused round)', () => {
    seedWithFailedTeams('fac', []);
    render(<Scoreboard />);
    expect(screen.queryByRole('button', { name: RETRY_ROUND })).not.toBeInTheDocument();
  });

  it('a non-facilitator never sees the Retry control', () => {
    seedWithFailedTeams('p1', ['A']);
    render(<Scoreboard />);
    expect(screen.queryByRole('button', { name: RETRY_ROUND })).not.toBeInTheDocument();
  });

  it('both teams failed → a per-team Retry control each', () => {
    seedWithFailedTeams('fac', ['A', 'B']);
    render(<Scoreboard />);
    // Two labelled retry buttons (the single-team unlabelled form is not used).
    expect(screen.getByRole('button', { name: /retry round — team a/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry round — team b/i })).toBeInTheDocument();
  });
});

describe('Scoreboard — relay completion & odd-team equalisation (Story 8.9)', () => {
  /**
   * A 1v1 after both teams have played (Model B: index 1 = one natural round
   * played) → both exhausted, nothing owed → relay complete. (Under Model B the
   * index is the count of natural rounds played, not the last-played slot.)
   */
  function seedRelayComplete(viewer: 'fac' | 'p1') {
    const session = makeSession({
      status: 'between-rounds',
      roundNumber: 2,
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'defuser', teamId: 'B' }),
      },
      teams: {
        A: makeTeam('A', ['p1'], { currentDefuserIndex: 1, cumulativeTimeMs: 40_000, roundTimesMs: [40_000] }),
        B: makeTeam('B', ['p2'], { currentDefuserIndex: 1, cumulativeTimeMs: 70_000, roundTimesMs: [70_000] }),
      },
    });
    useGameStore.setState({ session, myPlayerId: viewer, scoreboard: null });
  }

  /**
   * An odd 2v1 with naturals exhausted (index 1): A=[p1,p1b] len2 (done), B=[p2]
   * len1 → B owes 1 equalisation round. `volunteer` optionally pre-designates B's pick.
   */
  function seedEqualisation(viewer: 'fac' | 'p1', volunteer?: string) {
    const session = makeSession({
      status: 'between-rounds',
      roundNumber: 2,
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'expert', teamId: 'A' }),
        p1b: makePlayer({ playerId: 'p1b', displayName: 'Mara', role: 'expert', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'expert', teamId: 'B' }),
      },
      teams: {
        A: makeTeam('A', ['p1', 'p1b'], { currentDefuserIndex: 1, roundTimesMs: [40_000, 21_000], cumulativeTimeMs: 61_000 }),
        B: makeTeam('B', ['p2'], { currentDefuserIndex: 1, roundTimesMs: [70_000], cumulativeTimeMs: 70_000, equalisationVolunteerId: volunteer }),
      },
    });
    useGameStore.setState({ session, myPlayerId: viewer, scoreboard: null });
  }

  it('relay complete → shows the completion notice and NO Start-next-round button', () => {
    seedRelayComplete('fac');
    render(<Scoreboard />);
    expect(screen.getByTestId('relay-complete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: START_NEXT_ROUND })).not.toBeInTheDocument();
  });

  it('between rounds → surfaces "Up next" with the snake-selected next active team (Story 8.11)', () => {
    // 2v2 after round 1 (A played, index 1; B at 0): the snake's next turn is B.
    const session = makeSession({
      status: 'between-rounds',
      roundNumber: 1,
      players: {
        fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
        p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'expert', teamId: 'A' }),
        p2: makePlayer({ playerId: 'p2', displayName: 'Devon', role: 'expert', teamId: 'B' }),
      },
      teams: {
        A: makeTeam('A', ['p1', 'pa2'], { currentDefuserIndex: 1, roundTimesMs: [40_000], cumulativeTimeMs: 40_000 }),
        B: makeTeam('B', ['p2', 'pb2'], { currentDefuserIndex: 0 }),
      },
    });
    useGameStore.setState({ session, myPlayerId: 'fac', scoreboard: null });
    render(<Scoreboard />);
    expect(screen.getByTestId('up-next')).toHaveTextContent('Team B');
  });

  it('surfaces a RELAY_COMPLETE server refusal as an alert', () => {
    seedBetweenRounds('fac');
    render(<Scoreboard />);
    act(() => {
      mock.fire('ERROR', { code: 'RELAY_COMPLETE', message: 'The relay is complete — end the session.', recoverable: true });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('The relay is complete');
  });

  it('equalisation phase → shows the volunteer picker; Start is gated until a volunteer is chosen', () => {
    seedEqualisation('fac'); // no volunteer yet
    render(<Scoreboard />);
    expect(screen.getByTestId('equalisation-B')).toBeInTheDocument();
    // Start is disabled until the facilitator picks a volunteer.
    expect(screen.getByRole('button', { name: START_NEXT_ROUND })).toBeDisabled();
  });

  it('clicking a volunteer emits TEAM_ASSIGN(role: defuser) for the owing team', async () => {
    seedEqualisation('fac');
    render(<Scoreboard />);
    await userEvent.click(screen.getByRole('button', { name: 'Devon' }));
    expect(mock.emit).toHaveBeenCalledWith('TEAM_ASSIGN', { playerId: 'p2', teamId: 'B', role: 'defuser' });
  });

  it('once a volunteer is designated, Start is enabled', () => {
    seedEqualisation('fac', 'p2'); // Devon pre-designated
    render(<Scoreboard />);
    expect(screen.getByRole('button', { name: START_NEXT_ROUND })).toBeEnabled();
  });

  it('a non-facilitator sees neither the equalisation picker nor Start', () => {
    seedEqualisation('p1');
    render(<Scoreboard />);
    expect(screen.queryByTestId('equalisation-B')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: START_NEXT_ROUND })).not.toBeInTheDocument();
  });

  // Session end (Story 8.10): the relay-complete notice gains a facilitator
  // "End session" action that emits SESSION_END.
  it('relay complete → facilitator sees the End-session button and clicking emits SESSION_END', async () => {
    seedRelayComplete('fac');
    render(<Scoreboard />);
    const end = screen.getByRole('button', { name: END_SESSION });
    await userEvent.click(end); // arm the two-step confirm
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(mock.emit).toHaveBeenCalledWith('SESSION_END');
  });

  it('relay complete → a non-facilitator gets NO End-session button (facilitator-only action)', () => {
    seedRelayComplete('p1');
    render(<Scoreboard />);
    expect(screen.queryByRole('button', { name: END_SESSION })).not.toBeInTheDocument();
    expect(screen.queryByTestId('relay-complete')).not.toBeInTheDocument();
  });

  it('surfaces a SESSION_END_FAILED server refusal as an alert', () => {
    seedRelayComplete('fac');
    render(<Scoreboard />);
    act(() => {
      mock.fire('ERROR', { code: 'SESSION_END_FAILED', message: 'Could not save the session results. Try again.', recoverable: true });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the session results');
  });
});
