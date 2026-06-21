import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makePlayer, makeSession, makeTeam } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';
import FinalScoreboard from '../FinalScoreboard.js';
import { FINAL_WINNER, FINAL_DRAW, FINAL_COMPLETE } from '../copy.js';

/** An ended session. A finished faster than B; B detonated its 2nd round. */
function seedEnded(overrides?: { tie?: boolean; singleTeam?: boolean }) {
  const teams = overrides?.singleTeam
    ? {
        A: makeTeam('A', ['p1', 'p1b'], {
          currentDefuserIndex: 2,
          cumulativeTimeMs: 80_000,
          roundTimesMs: [40_000, 40_000],
          roundOutcomes: ['defused', 'defused'],
        }),
      }
    : {
        A: makeTeam('A', ['p1', 'p1b'], {
          currentDefuserIndex: 2,
          cumulativeTimeMs: overrides?.tie ? 120_000 : 80_000,
          roundTimesMs: overrides?.tie ? [60_000, 60_000] : [40_000, 40_000],
          roundOutcomes: ['defused', 'defused'],
        }),
        B: makeTeam('B', ['p2', 'p2b'], {
          currentDefuserIndex: 2,
          cumulativeTimeMs: 120_000,
          roundTimesMs: [60_000, 60_000],
          roundOutcomes: ['defused', 'exploded'],
        }),
      };
  const session = makeSession({
    status: 'ended',
    roundNumber: 4,
    players: {
      fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role: 'facilitator' }),
      p1: makePlayer({ playerId: 'p1', displayName: 'Maya', role: 'defuser', teamId: 'A' }),
    },
    teams,
  });
  useGameStore.setState({ session, myPlayerId: 'fac', scoreboard: null });
}

beforeEach(() => {
  useGameStore.setState({ session: null, myPlayerId: null, scoreboard: null });
});

describe('FinalScoreboard (Story 8.10)', () => {
  it('headlines the winner (lowest cumulative time) in the display font', () => {
    seedEnded();
    render(<FinalScoreboard />);
    expect(screen.getByTestId('final-headline')).toHaveTextContent(FINAL_WINNER('Team A'));
    expect(screen.getByTestId('final-winner-A')).toBeInTheDocument();
    expect(screen.queryByTestId('final-winner-B')).not.toBeInTheDocument();
  });

  it('renders the round-by-round breakdown with defused ✓ / detonated ✗ icons', () => {
    seedEnded();
    render(<FinalScoreboard />);
    const teamB = screen.getByTestId('final-team-B');
    // B: round 1 defused (✓), round 2 detonated (✗).
    expect(within(screen.getByTestId('final-round-B-0')).getByText('✓')).toBeInTheDocument();
    expect(within(screen.getByTestId('final-round-B-1')).getByText('✗')).toBeInTheDocument();
    expect(within(teamB).getByText('2:00')).toBeInTheDocument(); // cumulative 120s
  });

  it('a tie declares a draw (no winner badge)', () => {
    seedEnded({ tie: true });
    render(<FinalScoreboard />);
    expect(screen.getByTestId('final-headline')).toHaveTextContent(FINAL_DRAW);
    expect(screen.queryByTestId('final-winner-A')).not.toBeInTheDocument();
    expect(screen.queryByTestId('final-winner-B')).not.toBeInTheDocument();
  });

  it('a single-team session reads "session complete", not a win', () => {
    seedEnded({ singleTeam: true });
    render(<FinalScoreboard />);
    expect(screen.getByTestId('final-headline')).toHaveTextContent(FINAL_COMPLETE);
    expect(screen.queryByTestId('final-winner-A')).not.toBeInTheDocument();
  });
});
