import { create } from 'zustand';
import type {
  SessionState,
  BombState,
  TimerState,
  ModuleUpdate,
  StrikePayload,
} from '@bomb-squad/shared';

interface GameState {
  session: SessionState | null;
  bomb: BombState | null;
  timer: TimerState | null;
  connection: 'disconnected' | 'connecting' | 'connected';
  setSession: (session: SessionState) => void;
  setBomb: (bomb: BombState) => void;
  setTimer: (timer: TimerState) => void;
  /**
   * Immutably replaces one module in the bomb's modules array.
   * Non-integer or out-of-range moduleIndex is dropped with a console warning
   * (defensive against malformed payloads; the warning surfaces desync).
   * Does NOT touch strikes or timer — those arrive via STRIKE / TIMER_UPDATE events.
   */
  applyModuleUpdate: (update: ModuleUpdate) => void;
  setStrike: (payload: StrikePayload) => void;
  setConnection: (connection: 'disconnected' | 'connecting' | 'connected') => void;
}

/**
 * Render-only, NON-authoritative snapshot of the last server-sent game state.
 * The server owns all game truth — never derive strikes, solved-state, or
 * timer expiry on the client.
 *
 * ACCESS PATTERN: Inside a render loop (useFrame / RAF), read state via:
 *   useGameStore.getState()
 * NOT the reactive selector hook. Reactive selectors are fine in React display components
 * that are not on a per-frame render loop.
 */
export const useGameStore = create<GameState>((set) => ({
  session: null,
  bomb: null,
  timer: null,
  connection: 'disconnected',

  setSession: (session) => set({ session }),
  setBomb: (bomb) => set({ bomb }),
  setTimer: (timer) => set({ timer }),

  applyModuleUpdate: ({ moduleIndex, state }) =>
    set((s) => {
      if (!s.bomb) {
        console.warn('[gameStore] MODULE_UPDATE dropped: no bomb in store', { moduleIndex });
        return {};
      }
      // Number.isInteger also rejects NaN/fractional indices, which would
      // corrupt the array via slice(0, NaN).
      if (!Number.isInteger(moduleIndex) || moduleIndex < 0 || moduleIndex >= s.bomb.modules.length) {
        console.warn('[gameStore] MODULE_UPDATE dropped: moduleIndex out of range', { moduleIndex });
        return {};
      }
      const modules = [
        ...s.bomb.modules.slice(0, moduleIndex),
        state,
        ...s.bomb.modules.slice(moduleIndex + 1),
      ];
      return { bomb: { ...s.bomb, modules } };
    }),

  setStrike: ({ strikes, timer }) =>
    set((s) => {
      if (!s.bomb) {
        console.warn('[gameStore] STRIKE before BOMB_INIT: strike count dropped', { strikes });
        return { timer };
      }
      return { bomb: { ...s.bomb, strikes }, timer };
    }),

  setConnection: (connection) => set({ connection }),
}));
