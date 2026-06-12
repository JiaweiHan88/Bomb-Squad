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
   * Out-of-range moduleIndex is silently ignored (defensive against malformed payloads).
   * Does NOT touch strikes or timer — those arrive via STRIKE / TIMER_UPDATE events.
   */
  applyModuleUpdate: (update: ModuleUpdate) => void;
  setStrike: (payload: StrikePayload) => void;
  setConnection: (connection: 'disconnected' | 'connecting' | 'connected') => void;
}

/**
 * Authoritative client game state — render-only, non-authoritative snapshot of last server state.
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
      if (!s.bomb) return {};
      if (moduleIndex < 0 || moduleIndex >= s.bomb.modules.length) return {};
      const modules = [
        ...s.bomb.modules.slice(0, moduleIndex),
        state,
        ...s.bomb.modules.slice(moduleIndex + 1),
      ];
      return { bomb: { ...s.bomb, modules } };
    }),

  setStrike: ({ strikes, timer }) =>
    set((s) => ({
      bomb: s.bomb ? { ...s.bomb, strikes } : null,
      timer,
    })),

  setConnection: (connection) => set({ connection }),
}));
