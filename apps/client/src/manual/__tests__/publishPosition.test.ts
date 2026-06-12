import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '@bomb-squad/shared';

const emit = vi.fn();
vi.mock('../../net/socket.js', () => ({
  getSocket: () => ({ emit }),
}));

import { publishManualPosition } from '../publishPosition.js';
import { useUiStore } from '../../store/uiStore.js';
import { useGameStore } from '../../store/gameStore.js';

const FAKE_SESSION = { sessionId: 's1' } as SessionState;

beforeEach(() => {
  emit.mockClear();
  useUiStore.setState({ manualChapterId: null });
  useGameStore.setState({ connection: 'disconnected', session: null });
});

describe('publishManualPosition', () => {
  it('always updates the observable uiStore position', () => {
    publishManualPosition('wires');
    expect(useUiStore.getState().manualChapterId).toBe('wires');
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit when connected but not in a session (dev harness case)', () => {
    useGameStore.setState({ connection: 'connected', session: null });
    publishManualPosition('wires');
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not emit when in a session but the socket is not connected', () => {
    useGameStore.setState({ connection: 'connecting', session: FAKE_SESSION });
    publishManualPosition('wires');
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits the typed MANUAL_NAVIGATE event when connected and in a session', () => {
    useGameStore.setState({ connection: 'connected', session: FAKE_SESSION });
    publishManualPosition('memory');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('MANUAL_NAVIGATE', { chapterId: 'memory' });
    expect(useUiStore.getState().manualChapterId).toBe('memory');
  });
});
