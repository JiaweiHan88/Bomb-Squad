import { create } from 'zustand';

interface UiState {
  manualOpen: boolean;
  activeModuleIndex: number | null;
  setManualOpen: (open: boolean) => void;
  setActiveModuleIndex: (index: number | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  manualOpen: false,
  activeModuleIndex: null,
  setManualOpen: (manualOpen) => set({ manualOpen }),
  setActiveModuleIndex: (activeModuleIndex) => set({ activeModuleIndex }),
}));
