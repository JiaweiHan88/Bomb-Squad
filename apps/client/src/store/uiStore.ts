import { create } from 'zustand';

interface UiState {
  manualOpen: boolean;
  /**
   * Current manual chapter (observable position, Story 5.2 AC5 — what the
   * Spectator Lounge mirrors in 9.4). null = viewer not yet positioned.
   * Write via publishManualPosition(), which also emits the typed event;
   * per-chapter scroll offsets are presentation state and stay in refs.
   */
  manualChapterId: string | null;
  activeModuleIndex: number | null;
  setManualOpen: (open: boolean) => void;
  setManualChapterId: (chapterId: string | null) => void;
  setActiveModuleIndex: (index: number | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  manualOpen: false,
  manualChapterId: null,
  activeModuleIndex: null,
  setManualOpen: (manualOpen) => set({ manualOpen }),
  setManualChapterId: (manualChapterId) => set({ manualChapterId }),
  setActiveModuleIndex: (activeModuleIndex) => set({ activeModuleIndex }),
}));
