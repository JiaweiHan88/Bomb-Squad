import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSocket, type MockSocket } from '../../test/mockSocket.js';
import { useGameStore } from '../../store/gameStore.js';

// getSocket() throws unless createSocket() ran; mock the module, inject a fake.
vi.mock('../../net/socket.js', () => ({ getSocket: vi.fn(), createSocket: vi.fn() }));
import { getSocket } from '../../net/socket.js';
import Landing from '../Landing.js';

let mock: MockSocket;

beforeEach(() => {
  mock = createMockSocket();
  vi.mocked(getSocket).mockReturnValue(mock.socket);
  // Reset the shared store singleton so a prior test's notice can't leak in.
  useGameStore.setState({ removalNotice: null });
});

describe('Landing', () => {
  it('renders the join + host surface', () => {
    render(<Landing />);
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Choose a role' })).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Join code character/i)).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Host a session' })).toBeInTheDocument();
  });

  it('emits SESSION_CREATE (ack-style) when hosting a session', async () => {
    const user = userEvent.setup();
    render(<Landing />);
    await user.click(screen.getByRole('button', { name: 'Host a session' }));
    // hostSession uses getSocket().timeout(ms).emit('SESSION_CREATE', {}, ack)
    expect(mock.timeoutEmit).toHaveBeenCalledWith('SESSION_CREATE', {}, expect.any(Function));
    expect(mock.emit).not.toHaveBeenCalled();
  });

  it('emits SESSION_JOIN once a name, role, and full code are entered', async () => {
    const user = userEvent.setup();
    render(<Landing />);

    await user.type(screen.getByLabelText('Your name'), 'Maya');
    await user.click(screen.getByRole('button', { name: 'Defuser' }));

    // Typing the 6th character auto-submits (no Join button needed).
    const cells = screen.getAllByLabelText(/Join code character/i);
    for (let i = 0; i < cells.length; i++) {
      await user.type(cells[i]!, 'ABCDEF'[i]!);
    }

    expect(mock.emit).toHaveBeenCalledWith(
      'SESSION_JOIN',
      expect.objectContaining({ joinCode: 'ABCDEF', displayName: 'Maya', role: 'defuser' }),
    );
  });

  it('does not emit SESSION_JOIN when the role is missing', async () => {
    const user = userEvent.setup();
    render(<Landing />);

    await user.type(screen.getByLabelText('Your name'), 'Maya');
    const cells = screen.getAllByLabelText(/Join code character/i);
    for (let i = 0; i < cells.length; i++) {
      await user.type(cells[i]!, 'ABCDEF'[i]!);
    }

    // Complete code + name but no role → tryJoin shows a hint, never emits.
    // Assert the hint positively so the test can't pass vacuously (e.g. if the
    // handler silently never emitted under any condition).
    expect(screen.getByText(/then it sends itself/i)).toBeInTheDocument();
    expect(mock.emit).not.toHaveBeenCalledWith('SESSION_JOIN', expect.anything());
  });
});
