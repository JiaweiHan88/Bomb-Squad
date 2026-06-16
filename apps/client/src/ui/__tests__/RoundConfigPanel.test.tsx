import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { makePlayer, makeRoundConfig, makeSession } from '../../test/fixtures.js';
import { useGameStore } from '../../store/gameStore.js';

vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import RoundConfigPanel from '../RoundConfigPanel.js';

let mock: MockSocket;

function seed(opts: {
  role?: 'facilitator' | 'defuser';
  status?: 'lobby' | 'between-rounds' | 'active';
  config?: Parameters<typeof makeRoundConfig>[0];
} = {}) {
  const role = opts.role ?? 'facilitator';
  const session = makeSession({
    status: opts.status ?? 'lobby',
    config: makeRoundConfig(opts.config),
    players: { fac: makePlayer({ playerId: 'fac', displayName: 'Faci', role }) },
  });
  useGameStore.setState({ session, myPlayerId: 'fac' });
}

beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
  useGameStore.setState({ session: null, myPlayerId: null });
});

describe('RoundConfigPanel — visibility', () => {
  it('renders nothing for a non-facilitator', () => {
    seed({ role: 'defuser' });
    const { container } = render(<RoundConfigPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing once a round is active', () => {
    seed({ status: 'active' });
    const { container } = render(<RoundConfigPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the panel for a facilitator in the lobby', () => {
    seed();
    render(<RoundConfigPanel />);
    expect(screen.getByRole('heading', { name: 'Round configuration' })).toBeInTheDocument();
  });
});

describe('RoundConfigPanel — controls reflect the snapshot', () => {
  it('shows the current timer, count, and strike speed-up', () => {
    seed({ config: { moduleCount: 6, timerMs: 360_000, strikeSpeedUpPct: 40 } });
    render(<RoundConfigPanel />);
    expect(screen.getByTestId('timer-value')).toHaveTextContent('6:00');
    expect(screen.getByTestId('module-count-value')).toHaveTextContent('6');
    expect(screen.getByTestId('strike-speedup-value')).toHaveTextContent('40%');
  });

  it('marks the active difficulty tier pressed', () => {
    seed({ config: { difficulty: 'hard' } });
    render(<RoundConfigPanel />);
    expect(screen.getByRole('button', { name: /Hard/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Easy/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('RoundConfigPanel — emits ROUND_CONFIGURE', () => {
  it('tier select applies that tier defaults (count + timer + cleared pool)', async () => {
    const user = userEvent.setup();
    seed(); // easy
    render(<RoundConfigPanel />);
    await user.click(screen.getByRole('button', { name: /Medium/ }));
    expect(mock.emit).toHaveBeenCalledWith('ROUND_CONFIGURE', {
      config: expect.objectContaining({
        difficulty: 'medium',
        moduleCount: 5,
        timerMs: 360_000,
        modulePool: undefined,
      }),
    });
  });

  it('count stepper increments and emits the new count', async () => {
    const user = userEvent.setup();
    seed({ config: { moduleCount: 3 } });
    render(<RoundConfigPanel />);
    await user.click(screen.getByRole('button', { name: 'Increase module count' }));
    expect(mock.emit).toHaveBeenCalledWith('ROUND_CONFIGURE', {
      config: expect.objectContaining({ moduleCount: 4 }),
    });
  });

  it('clamps the count: decrement is disabled at 3, increment disabled at 11', () => {
    seed({ config: { moduleCount: 3 } });
    const { unmount } = render(<RoundConfigPanel />);
    expect(screen.getByRole('button', { name: 'Decrease module count' })).toBeDisabled();
    unmount();

    seed({ config: { moduleCount: 11 } });
    render(<RoundConfigPanel />);
    expect(screen.getByRole('button', { name: 'Increase module count' })).toBeDisabled();
  });

  it('strike speed-up slider emits the new percentage', () => {
    seed({ config: { strikeSpeedUpPct: 25 } });
    render(<RoundConfigPanel />);
    fireEvent.change(screen.getByLabelText('Strike speed-up'), { target: { value: '50' } });
    expect(mock.emit).toHaveBeenCalledWith('ROUND_CONFIGURE', {
      config: expect.objectContaining({ strikeSpeedUpPct: 50 }),
    });
  });

  it('a modifier toggle emits the flipped flag', async () => {
    const user = userEvent.setup();
    seed();
    render(<RoundConfigPanel />);
    await user.click(screen.getByRole('switch', { name: 'Asymmetric Expert roles' }));
    expect(mock.emit).toHaveBeenCalledWith('ROUND_CONFIGURE', {
      config: expect.objectContaining({
        modifiers: { asymmetricExpertRoles: true, spectatorLifelines: false },
      }),
    });
  });
});

describe('RoundConfigPanel — module pool override', () => {
  it('disables un-implemented modules and enables the generatable trio', () => {
    seed({ config: { difficulty: 'medium' } });
    render(<RoundConfigPanel />);
    const pool = screen.getByRole('group', { name: 'Module pool' });
    // Keypads (no generator yet) is present but disabled.
    expect(within(pool).getByRole('button', { name: 'Keypads' })).toBeDisabled();
    // Wires (generatable, in the default pool) is enabled and pressed.
    const wires = within(pool).getByRole('button', { name: 'Wires' });
    expect(wires).toBeEnabled();
    expect(wires).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggling a generatable module off emits an explicit pool without it', async () => {
    const user = userEvent.setup();
    seed(); // easy: pool = wires/the-button/passwords
    render(<RoundConfigPanel />);
    const pool = screen.getByRole('group', { name: 'Module pool' });
    await user.click(within(pool).getByRole('button', { name: 'Wires' }));
    expect(mock.emit).toHaveBeenCalledWith('ROUND_CONFIGURE', {
      config: expect.objectContaining({ modulePool: ['the-button', 'passwords'] }),
    });
  });

  it('will not let the last selected module be removed', async () => {
    const user = userEvent.setup();
    seed({ config: { modulePool: ['wires'] } });
    render(<RoundConfigPanel />);
    const pool = screen.getByRole('group', { name: 'Module pool' });
    await user.click(within(pool).getByRole('button', { name: 'Wires' }));
    expect(mock.emit).not.toHaveBeenCalled();
  });
});
