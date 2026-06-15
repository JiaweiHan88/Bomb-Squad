import { create } from 'zustand';

/**
 * Voice connection presentation state — and ONLY presentation state.
 *
 * Per AR12 / ADR-007 / Architecture Pattern 7, voice is an independent
 * subsystem that never blocks game state. This store is the SOLE home for
 * voice connection status: `connectVoice` writes here and nowhere else, and no
 * game reducer/handler may read it. It must never carry anything
 * game-authoritative (no session, no bomb, no phase) — that lives in
 * `gameStore`, which voice may read for role/team but never write.
 *
 * Status machine: idle → connecting → connected, with any failure (token
 * error, connect rejection, timeout, transport drop) resolving to
 * `unavailable`. `unavailable` surfaces as dismissible microcopy only — the
 * game keeps running (AC #3/#4).
 */
export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'unavailable';

interface VoiceState {
  status: VoiceStatus;
  /** The LiveKit room we connected to (e.g. `bomb-room:{sessionId}:{teamId}`). Set on `connected`; handy for 3.4's speaker pill. */
  room?: string;
  /** The participant identity baked into the token (the local socket id). Set on `connected`. */
  identity?: string;
  /** Optional failure detail for microcopy. Never holds a secret (never the token). */
  error?: string;
  /**
   * Durable player ids currently transmitting audio (Story 2.5). Written ONLY by
   * `connectVoice` from LiveKit `ActiveSpeakersChanged`; read by the lobby roster
   * to light per-row speaker dots. The speaker-presence primitive Story 3.4 will
   * reuse for the in-round pill. Still voice-only presentation state — never
   * game-authoritative. Cleared to `[]` on any non-connected transition so no
   * stale dots survive a drop.
   */
  activeSpeakers: string[];

  /** idle/unavailable → connecting. Clears any prior room/identity/error + speakers. */
  setConnecting: () => void;
  /** connecting → connected. Records the room + identity from the token grant. */
  setConnected: (info: { room: string; identity: string }) => void;
  /** any → unavailable. Drops room/identity/speakers; keeps an optional non-secret error string. */
  setUnavailable: (error?: string) => void;
  /** Replace the set of currently-speaking durable player ids. */
  setActiveSpeakers: (ids: string[]) => void;
  /** back to idle (clean disconnect / teardown). */
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: 'idle',
  room: undefined,
  identity: undefined,
  error: undefined,
  activeSpeakers: [],

  setConnecting: () =>
    set({ status: 'connecting', room: undefined, identity: undefined, error: undefined, activeSpeakers: [] }),
  setConnected: ({ room, identity }) => set({ status: 'connected', room, identity, error: undefined }),
  setUnavailable: (error) =>
    set({ status: 'unavailable', room: undefined, identity: undefined, error, activeSpeakers: [] }),
  setActiveSpeakers: (ids) => set({ activeSpeakers: ids }),
  reset: () => set({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [] }),
}));
