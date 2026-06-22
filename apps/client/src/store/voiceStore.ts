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
  /**
   * Whether the CURRENT connection published the mic (Story 3.5). `true` for a
   * Bomb Room participant, `false` for a listen-only spectator. Set on
   * `connected`; reset to `false` on every non-connected transition. The
   * re-mint reconciler compares the FULL `{ room, publishing }` tuple against the
   * server-derived desired scope — because Spectator and Facilitator share the
   * lounge ROOM but differ on publish, room alone cannot decide a re-mint.
   */
  publishing: boolean;
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
  /**
   * Local self-mute flag (Story 3.4). `true` ⇒ this client has toggled its own
   * mic off via the LiveKit publish toggle (`setMicrophoneEnabled(false)`).
   * Written ONLY by `connectVoice.setMuted` — voice-only presentation state, never
   * game-authoritative and never sent over the game socket. Other clients observe
   * a muted self naturally (it drops out of `ActiveSpeakersChanged`). Reset to
   * `false` on every non-connected transition so a stale mute can't survive a
   * reconnect (a fresh connect always starts un-muted).
   */
  muted: boolean;
  /**
   * Remote-audio autoplay was blocked by the browser (Story 3.6). A participant
   * can be genuinely `connected` (transport up, tracks subscribed) yet silent
   * because `room.startAudio()` was rejected without a user gesture. This is NOT
   * a failure state — it composes WITH `connected` and never trips the
   * `unavailable` banner; the in-round `AudioUnblockPrompt` surfaces a
   * click-to-resume affordance while it is `true`. Written ONLY by `connectVoice`
   * (set on a blocked `startAudio`, cleared on a successful resume). Cleared on
   * every non-connected transition so a stale flag can't survive a reconnect.
   */
  audioBlocked: boolean;

  /** idle/unavailable → connecting. Clears any prior room/identity/error + speakers + mute + audioBlocked + publishing. */
  setConnecting: () => void;
  /** connecting → connected. Records the room + identity + publish intent from the connect. */
  setConnected: (info: { room: string; identity: string; publish: boolean }) => void;
  /** any → unavailable. Drops room/identity/speakers/mute/audioBlocked; keeps an optional non-secret error string. */
  setUnavailable: (error?: string) => void;
  /** Replace the set of currently-speaking durable player ids. */
  setActiveSpeakers: (ids: string[]) => void;
  /** Set the local self-mute flag (Story 3.4). */
  setMuted: (muted: boolean) => void;
  /** Set the blocked-autoplay flag (Story 3.6). */
  setAudioBlocked: (blocked: boolean) => void;
  /** back to idle (clean disconnect / teardown). */
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  status: 'idle',
  room: undefined,
  identity: undefined,
  error: undefined,
  activeSpeakers: [],
  muted: false,
  audioBlocked: false,
  publishing: false,

  setConnecting: () =>
    set({ status: 'connecting', room: undefined, identity: undefined, error: undefined, activeSpeakers: [], muted: false, audioBlocked: false, publishing: false }),
  setConnected: ({ room, identity, publish }) => set({ status: 'connected', room, identity, publishing: publish, error: undefined }),
  setUnavailable: (error) =>
    set({ status: 'unavailable', room: undefined, identity: undefined, error, activeSpeakers: [], muted: false, audioBlocked: false, publishing: false }),
  setActiveSpeakers: (ids) => set({ activeSpeakers: ids }),
  setMuted: (muted) => set({ muted }),
  setAudioBlocked: (audioBlocked) => set({ audioBlocked }),
  reset: () => set({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [], muted: false, audioBlocked: false, publishing: false }),
}));
