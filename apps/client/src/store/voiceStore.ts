import { create } from 'zustand';

// Voice connection presentation state only — per ADR-007, voice is independent
// from the game socket. No LiveKit SDK calls in this story; store shape only.
interface VoiceState {
  status: 'idle' | 'connecting' | 'connected' | 'unavailable';
  setStatus: (status: VoiceState['status']) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: 'idle',
  setStatus: (status) => set({ status }),
}));
