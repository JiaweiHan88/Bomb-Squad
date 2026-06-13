import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { RoundEndPayload } from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import { bindServerEvents } from '../bindServerEvents.js';
import type { AppClientSocket } from '../socket.js';

/**
 * Story 8.5 (Task 6): the resolution store + the BOMB_DEFUSED/BOMB_EXPLODED
 * bindings are the only client-side LOGIC (the banner is rendering-only and
 * covered visually). These assert the binding sets the non-authoritative
 * resolution snapshot, and that nothing scoreboard-y happens mid-round (AC-3).
 */

/** Fake socket that records the handlers bindServerEvents registers, so a test
 *  can invoke a server event by name. */
function fakeSocket(): { socket: AppClientSocket; emit: (event: string, payload: unknown) => void } {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: () => {},
    io: { on: () => {}, off: () => {} },
  } as unknown as AppClientSocket;
  return {
    socket,
    emit: (event, payload) => handlers.get(event)?.(payload),
  };
}

const resetStore = () =>
  useGameStore.setState({ session: null, bomb: null, timer: null, resolution: null, connection: 'disconnected' });

describe('bindServerEvents — round resolution (Story 8.5)', () => {
  beforeEach(resetStore);

  it('resolution is null while the round is active (no banner, AC-3)', () => {
    const { socket } = fakeSocket();
    bindServerEvents(socket);
    expect(useGameStore.getState().resolution).toBeNull();
  });

  it('BOMB_DEFUSED → resolution outcome "defused" with the recorded elapsedMs', () => {
    const { socket, emit } = fakeSocket();
    bindServerEvents(socket);
    emit('BOMB_DEFUSED', { teamId: 'A', elapsedMs: 142_000 } satisfies RoundEndPayload);
    expect(useGameStore.getState().resolution).toEqual({ outcome: 'defused', elapsedMs: 142_000 });
  });

  it('BOMB_EXPLODED with 3 strikes in the snapshot → "exploded" (DETONATED label)', () => {
    const { socket, emit } = fakeSocket();
    bindServerEvents(socket);
    useGameStore.setState({ bomb: { strikes: 3 } as never });
    emit('BOMB_EXPLODED', { teamId: 'A', elapsedMs: 300_000 } satisfies RoundEndPayload);
    expect(useGameStore.getState().resolution).toEqual({ outcome: 'exploded', elapsedMs: 300_000 });
  });

  it('BOMB_EXPLODED with fewer than 3 strikes → "time-expired" (TIME EXPIRED label)', () => {
    const { socket, emit } = fakeSocket();
    bindServerEvents(socket);
    useGameStore.setState({ bomb: { strikes: 1 } as never });
    emit('BOMB_EXPLODED', { teamId: 'A', elapsedMs: 300_000 } satisfies RoundEndPayload);
    expect(useGameStore.getState().resolution).toEqual({ outcome: 'time-expired', elapsedMs: 300_000 });
  });

  it('BOMB_EXPLODED with no bomb snapshot → falls back to "time-expired"', () => {
    const { socket, emit } = fakeSocket();
    bindServerEvents(socket);
    emit('BOMB_EXPLODED', { teamId: 'A', elapsedMs: 300_000 } satisfies RoundEndPayload);
    expect(useGameStore.getState().resolution).toEqual({ outcome: 'time-expired', elapsedMs: 300_000 });
  });

  it('SCOREBOARD never touches the resolution snapshot (Story 8.6 owns the scoreboard)', () => {
    const { socket, emit } = fakeSocket();
    bindServerEvents(socket);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    emit('SCOREBOARD', { teams: {} });
    expect(useGameStore.getState().resolution).toBeNull();
    infoSpy.mockRestore();
  });
});

describe('gameStore.setBomb — new round clears a stale resolution', () => {
  beforeEach(resetStore);

  it('a fresh BOMB_INIT snapshot resets resolution to null', () => {
    useGameStore.getState().setResolution({ outcome: 'defused', elapsedMs: 1_000 });
    useGameStore.getState().setBomb({ strikes: 0, modules: [] } as never);
    expect(useGameStore.getState().resolution).toBeNull();
  });
});
