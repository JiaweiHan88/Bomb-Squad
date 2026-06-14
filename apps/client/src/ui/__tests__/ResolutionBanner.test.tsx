import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoundOutcome } from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import ResolutionBanner from '../ResolutionBanner.js';

function seedResolution(outcome: RoundOutcome) {
  useGameStore.setState({ resolution: { outcome, elapsedMs: 0 } });
}

beforeEach(() => {
  vi.useFakeTimers();
  useGameStore.setState({ resolution: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ResolutionBanner', () => {
  it('renders nothing when there is no resolution', () => {
    const { container } = render(<ResolutionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['defused', 'DEFUSED.'],
    ['exploded', 'DETONATED.'],
    ['time-expired', 'TIME EXPIRED.'],
  ] as const)('shows the %s verdict', (outcome, label) => {
    seedResolution(outcome);
    render(<ResolutionBanner />);
    expect(screen.getByTestId('resolution-banner')).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('transitions to the between-rounds surface after the defused hold (2s)', () => {
    seedResolution('defused');
    render(<ResolutionBanner />);
    expect(screen.getByTestId('resolution-banner')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.queryByTestId('resolution-banner')).not.toBeInTheDocument();
    expect(screen.getByText('Round over. Stand by for the next one.')).toBeInTheDocument();
  });

  it('holds a failure verdict longer (3s, not 2s)', () => {
    seedResolution('exploded');
    render(<ResolutionBanner />);

    // Still showing the verdict at the defused-hold boundary...
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('resolution-banner')).toBeInTheDocument();

    // ...and only flips after the full failure hold.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByTestId('resolution-banner')).not.toBeInTheDocument();
  });
});
