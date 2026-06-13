import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@bomb-squad/shared';
import { createProductionModuleDispatch } from '../productionDispatch.js';
import { useGameStore } from '../../store/gameStore.js';

/**
 * Production module-action backend (Story 4.7): a DefuserView dispatch must emit
 * MODULE_INTERACT with the self player's team. teamId is resolved lazily from the
 * store at emit time, so these drive it through the real gameStore.
 */

const emit = vi.fn();
let socketId: string | undefined = 'self-1';

vi.mock('../socket.js', () => ({
  getSocket: () => ({ id: socketId, emit }),
}));

/** Minimal session with `self-1` committed as Team A's defuser. */
function sessionWithSelf(teamId: 'A' | 'B' | undefined): SessionState {
  return {
    players: {
      'self-1': { playerId: 'self-1', displayName: 'Me', role: 'defuser', teamId },
    },
  } as unknown as SessionState;
}

beforeEach(() => {
  socketId = 'self-1';
  useGameStore.setState({ session: sessionWithSelf('A') });
});

afterEach(() => {
  emit.mockClear();
  useGameStore.setState({ session: null });
  vi.restoreAllMocks();
});

describe('createProductionModuleDispatch', () => {
  it('emits MODULE_INTERACT with the self player team, the index, and the action', () => {
    const dispatch = createProductionModuleDispatch();
    dispatch(2, { type: 'CUT', wireIndex: 1 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('MODULE_INTERACT', {
      teamId: 'A',
      moduleIndex: 2,
      action: { type: 'CUT', wireIndex: 1 },
    });
  });

  it('drops (with a warning) when self has no team yet — never emits a malformed payload', () => {
    useGameStore.setState({ session: sessionWithSelf(undefined) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = createProductionModuleDispatch();
    dispatch(0, { type: 'CUT', wireIndex: 0 });
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('drops when there is no session at all (pre-round)', () => {
    useGameStore.setState({ session: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = createProductionModuleDispatch();
    dispatch(0, { type: 'CUT', wireIndex: 0 });
    expect(emit).not.toHaveBeenCalled();
  });
});
