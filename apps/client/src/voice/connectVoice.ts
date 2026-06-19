import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import type {
  VoiceTokenRequestPayload,
  VoiceTokenGrantPayload,
  VoiceTokenErrorPayload,
} from '@bomb-squad/shared';
import { getSocket } from '../net/socket.js';
import { useVoiceStore } from '../store/voiceStore.js';

/**
 * Imperative LiveKit voice connection controller — the client consumer half of
 * the voice subsystem (Story 3.2). This is the ONLY module that imports
 * `livekit-client`; the React/R3F layers stay dumb renderers and only read
 * `voiceStore`.
 *
 * Invariant (AR12 / ADR-007 / Architecture Pattern 7): this module writes ONLY
 * `voiceStore`. It must never import or write `gameStore`, never throw into the
 * game UI, and never gate a game-state transition. A failure resolves to
 * `voiceStore.status = 'unavailable'` and the game keeps running.
 *
 * Resource hygiene (AC #5): the browser does not GC LiveKit `Room` objects or
 * attached `<audio>` elements — every connect must be matched by an explicit
 * teardown that detaches tracks, removes audio elements, releases the mic, and
 * `disconnect()`s the room.
 */

/** Per-connect token request timeout — NFR3 connect-within-10s budget. */
const TOKEN_TIMEOUT_MS = 10_000;

/**
 * Stop-grace for the speaker indicator (EXPERIENCE.md: "150ms grace to suppress
 * flicker on stop"). A newly-speaking identity lights immediately; only its STOP
 * is deferred, so a brief pause between syllables doesn't blink the dot.
 */
const SPEAKER_STOP_GRACE_MS = 150;

/** The shape of a LiveKit participant this controller reads — just the identity
 * (which IS the durable roster playerId, per the server's identity minting). */
interface SpeakingParticipant {
  identity: string;
}

/** Structural view of the bits of a LiveKit `Room` this controller drives. The
 * real `Room` satisfies it; tests supply a fake so no real SFU is needed. The
 * `on`/`off` surface carries every RoomEvent this controller binds —
 * TrackSubscribed/TrackUnsubscribed/Disconnected and (Story 2.5)
 * ActiveSpeakersChanged + ParticipantDisconnected. */
export interface VoiceRoom {
  on(event: RoomEvent, listener: (...args: never[]) => void): this;
  off(event: RoomEvent, listener: (...args: never[]) => void): this;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  startAudio(): Promise<void>;
  readonly localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
}

/** Outcome of a token request — never carries the raw token to callers that log. */
export type TokenResult =
  | { ok: true; grant: VoiceTokenGrantPayload }
  | { ok: false };

export interface VoiceControllerDeps {
  /** Factory for a fresh room per connect. Default: `() => new Room()`. */
  createRoom: () => VoiceRoom;
  /** Requests a FRESH voice token (AC #6 — never cached/reused). Default: `requestVoiceToken`. */
  requestToken: () => Promise<TokenResult>;
}

/**
 * Default token request: spends the `VOICE_TOKEN` socket event (Story 3.1).
 * Empty payload by contract — the server derives room + grants from session
 * state. Mirrors the `.timeout(ms).emit(EVENT, payload, errFirstAck)` pattern
 * from `Landing.tsx`. Any error/timeout resolves to `{ ok: false }` — never a
 * throw. NEVER logs the token.
 */
export function requestVoiceToken(): Promise<TokenResult> {
  const payload: VoiceTokenRequestPayload = {};
  return new Promise((resolve) => {
    getSocket()
      .timeout(TOKEN_TIMEOUT_MS)
      .emit(
        'VOICE_TOKEN',
        payload,
        (err: Error | null, result?: VoiceTokenGrantPayload | VoiceTokenErrorPayload) => {
          // Timeout (err set), missing ack, or an explicit error payload → unavailable.
          if (err || !result || 'error' in result) {
            resolve({ ok: false });
            return;
          }
          resolve({ ok: true, grant: result });
        },
      );
  });
}

/** Attach a remote audio track to a hidden, DOM-mounted element so it actually
 * plays. Returns the element (tracked for teardown). Skips DOM work in non-DOM
 * environments (e.g. the Vitest node runner) but still attaches via the SDK. */
function playRemoteAudio(track: RemoteTrack): HTMLMediaElement {
  const el = track.attach();
  if (typeof document !== 'undefined') {
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

export function createVoiceController(deps: VoiceControllerDeps) {
  // Single in-flight room at a time. `null` ⇒ idle/disconnected.
  let room: VoiceRoom | null = null;
  // Guards re-entrant connect/disconnect (double-click, unmount-during-connect).
  let phase: 'idle' | 'connecting' | 'connected' = 'idle';
  // Whether the CURRENT connect published the mic (Story 3.3 `publish` flag). A
  // listen-only spectator (`publish: false`) has no local mic track, so mute is a
  // safe no-op for them (Story 3.4) — `setMuted` only touches the mic when this is
  // `true`. Reset on every teardown so a stale value can't leak across reconnects.
  let published = false;
  // Bumped by every disconnect/teardown (and superseded by any newer connect) so
  // an in-flight connect can detect, after each await, that it was torn down and
  // abort+dispose its room instead of leaking a live SFU connection + hot mic.
  let connectEpoch = 0;
  // Every audio element we appended, so teardown can detach + remove them all.
  const audioEls = new Set<HTMLMediaElement>();
  // Listener handles kept so teardown can remove exactly what it added.
  let onSubscribed: ((track: RemoteTrack) => void) | null = null;
  let onUnsubscribed: ((track: RemoteTrack) => void) | null = null;
  let onDisconnected: (() => void) | null = null;
  let onActiveSpeakers: ((participants: SpeakingParticipant[]) => void) | null = null;
  let onParticipantDisconnected: ((participant: SpeakingParticipant) => void) | null = null;

  // Speaker-presence bookkeeping (Story 2.5). `displayed` is the set the roster
  // dots reflect (mirrored into voiceStore.activeSpeakers); per-identity timers
  // hold a stopped speaker's dot for the 150ms grace before clearing it.
  const displayedSpeakers = new Set<string>();
  const speakerClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function publishSpeakers(): void {
    useVoiceStore.getState().setActiveSpeakers([...displayedSpeakers]);
  }

  /** Cancel every pending stop-grace timer and forget the displayed set, so a
   * stopped-speaker timer can never fire after teardown / a later connect. */
  function clearSpeakerState(): void {
    for (const timer of speakerClearTimers.values()) clearTimeout(timer);
    speakerClearTimers.clear();
    displayedSpeakers.clear();
  }

  function detachAll(): void {
    for (const el of audioEls) el.remove();
    audioEls.clear();
  }

  /** Remove listeners + media from a room without (necessarily) disconnecting. */
  function clearRoomBindings(r: VoiceRoom): void {
    if (onSubscribed) r.off(RoomEvent.TrackSubscribed, onSubscribed as (...args: never[]) => void);
    if (onUnsubscribed) r.off(RoomEvent.TrackUnsubscribed, onUnsubscribed as (...args: never[]) => void);
    if (onDisconnected) r.off(RoomEvent.Disconnected, onDisconnected as (...args: never[]) => void);
    if (onActiveSpeakers)
      r.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers as (...args: never[]) => void);
    if (onParticipantDisconnected)
      r.off(
        RoomEvent.ParticipantDisconnected,
        onParticipantDisconnected as (...args: never[]) => void,
      );
    onSubscribed = null;
    onUnsubscribed = null;
    onDisconnected = null;
    onActiveSpeakers = null;
    onParticipantDisconnected = null;
    clearSpeakerState();
    detachAll();
  }

  /** Dispose a room we brought up but must NOT keep (superseded by a teardown
   * mid-connect): drop listeners + media, release the mic, disconnect. Never
   * touches the store — the disconnect() that superseded us already set it. */
  async function abandonRoom(r: VoiceRoom): Promise<void> {
    clearRoomBindings(r);
    try {
      await r.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Mic may never have been acquired; teardown must not throw.
    }
    await r.disconnect().catch(() => undefined);
  }

  /**
   * Connect the local participant to their server-assigned voice room.
   *
   * `publish` (default `true`) decides whether we acquire + publish the mic:
   * - Bomb Room (Defuser/Expert) → `true`: publish the mic so they can talk.
   * - Spectator Lounge (Story 3.3) → `false`: LISTEN-ONLY. We skip
   *   `setMicrophoneEnabled(true)` entirely, so `getUserMedia` is never invoked
   *   and no mic-permission prompt appears (AC #2). The participant still
   *   subscribes to + plays every remote audio track — they HEAR the room.
   *
   * The controller stays role-agnostic: the caller picks `publish`, and we trust
   * whatever `room` the token returns (the server routes a spectator to the
   * lounge with a `canPublish: false` grant — listen-only is also enforced there).
   */
  async function connect(publish = true): Promise<void> {
    // Double-connect guard (AC #5): ignore while already connecting/connected.
    if (phase !== 'idle') return;
    phase = 'connecting';
    const epoch = ++connectEpoch;
    useVoiceStore.getState().setConnecting();

    // Fresh token per connect — never cached/reused (AC #6, sets up 3.5).
    const result = await deps.requestToken();
    // A disconnect/unmount (or newer connect) ran during the token request — it
    // owns the store state now; abort silently so we don't resurrect a torn-down
    // connect. No room exists yet, so nothing to dispose.
    if (epoch !== connectEpoch) return;
    if (!result.ok) {
      phase = 'idle';
      useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
      return;
    }
    const { url, token, room: roomName, identity } = result.grant;

    const r = deps.createRoom();
    onSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) audioEls.add(playRemoteAudio(track));
    };
    onUnsubscribed = (track: RemoteTrack) => {
      for (const el of track.detach()) {
        el.remove();
        audioEls.delete(el);
      }
    };
    onDisconnected = () => {
      // Transport dropped mid-session → unavailable, game keeps running (AC #4).
      void disconnect('unavailable');
    };
    // Speaker presence (Story 2.5): LiveKit delivers the CURRENT speaking set on
    // each change. Map to durable playerId (== participant.identity, set by the
    // server) and mirror into voiceStore. New speakers light immediately; a
    // speaker that drops out is held for SPEAKER_STOP_GRACE_MS before its dot
    // clears (flicker suppression). The dot is the lobby's only green (DESIGN.md).
    onActiveSpeakers = (participants: SpeakingParticipant[]) => {
      const speaking = new Set(participants.map((p) => p.identity));
      let changed = false;
      // Newly (or still) speaking → light immediately + cancel any pending clear.
      for (const id of speaking) {
        const pending = speakerClearTimers.get(id);
        if (pending !== undefined) {
          clearTimeout(pending);
          speakerClearTimers.delete(id);
        }
        if (!displayedSpeakers.has(id)) {
          displayedSpeakers.add(id);
          changed = true;
        }
      }
      // Stopped speaking → schedule a graced clear (only the stop is graced).
      for (const id of displayedSpeakers) {
        if (!speaking.has(id) && !speakerClearTimers.has(id)) {
          const timer = setTimeout(() => {
            speakerClearTimers.delete(id);
            displayedSpeakers.delete(id);
            publishSpeakers();
          }, SPEAKER_STOP_GRACE_MS);
          speakerClearTimers.set(id, timer);
        }
      }
      if (changed) publishSpeakers();
    };
    // A participant who drops ungracefully (crash / network loss) may never emit
    // a fresh ActiveSpeakersChanged that excludes them — so a green dot could
    // stick forever. Evict them immediately on ParticipantDisconnected (and drop
    // any pending stop-grace timer for them — they're gone, no flicker to grace).
    onParticipantDisconnected = (participant: SpeakingParticipant) => {
      const { identity } = participant;
      const pending = speakerClearTimers.get(identity);
      if (pending !== undefined) {
        clearTimeout(pending);
        speakerClearTimers.delete(identity);
      }
      if (displayedSpeakers.delete(identity)) publishSpeakers();
    };
    r.on(RoomEvent.TrackSubscribed, onSubscribed as (...args: never[]) => void);
    r.on(RoomEvent.TrackUnsubscribed, onUnsubscribed as (...args: never[]) => void);
    r.on(RoomEvent.Disconnected, onDisconnected as (...args: never[]) => void);
    r.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers as (...args: never[]) => void);
    r.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected as (...args: never[]) => void);

    try {
      // url + token from the ack; never logged.
      await r.connect(url, token);
      // Publish the mic ONLY for a Bomb Room participant — needs the user gesture
      // + permission (Task 4 calls connect() from a click handler). A listen-only
      // spectator (publish === false) skips this entirely: getUserMedia is never
      // invoked, so no mic prompt appears (Story 3.3 AC #2).
      if (publish) await r.localParticipant.setMicrophoneEnabled(true);
    } catch {
      // Connect/publish rejected → clean up the half-open room, go unavailable.
      // (Floating disconnect is .catch()-guarded so a rejected teardown of an
      // already-dead transport never becomes an unhandled rejection.)
      clearRoomBindings(r);
      void r.disconnect().catch(() => undefined);
      // Only own the store state if no teardown/newer connect superseded us.
      if (epoch === connectEpoch) {
        phase = 'idle';
        useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
      }
      return;
    }

    // A disconnect()/unmount ran while we were connecting (it saw room === null
    // and could not tear this room down). Dispose the now-live room ourselves so
    // we never leak an SFU connection + published mic. The teardown already set
    // the store, so abandonRoom() leaves it untouched.
    if (epoch !== connectEpoch) {
      await abandonRoom(r);
      return;
    }

    room = r;
    phase = 'connected';
    // Remember whether THIS connect published, so a later setMuted() no-ops for a
    // listen-only spectator (no mic to toggle) — belt-and-suspenders with the
    // MuteControl's own render gate (Story 3.4).
    published = publish;
    useVoiceStore.getState().setConnected({ room: roomName, identity });

    // Best-effort autoplay recovery (Task 2 autoplay note): we are inside the
    // connect gesture chain, so resuming the AudioContext here unblocks remote
    // playback. Blocked playback must NOT fail the connection — the participant
    // is still connected and publishing, so a startAudio() rejection is ignored.
    void r.startAudio().catch(() => undefined);
  }

  /**
   * Teardown (AC #5): detach all tracks, remove audio elements, drop listeners,
   * release the mic, and `disconnect()` the room. Idempotent and double-call
   * safe. `reason` decides the resulting store state: an explicit user
   * disconnect → `idle`; a dropped transport → `unavailable`.
   */
  async function disconnect(reason: 'idle' | 'unavailable' = 'idle'): Promise<void> {
    // Supersede any in-flight connect: after its next await it will see the
    // epoch changed and abort+dispose its room instead of going `connected`.
    connectEpoch++;
    const r = room;
    room = null;
    phase = 'idle';
    published = false;
    if (reason === 'unavailable') {
      useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
    } else {
      useVoiceStore.getState().reset();
    }
    if (!r) {
      // No live room (e.g. disconnect during a token request) — still scrub any
      // stray media to keep the no-leak guarantee.
      detachAll();
      return;
    }
    clearRoomBindings(r);
    try {
      await r.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Mic may already be released; teardown must not throw into the UI.
    }
    // Swallow a rejected disconnect (already-dead transport) — teardown often
    // runs from a fire-and-forget `void disconnectVoice()` on unmount, so it must
    // never produce an unhandled rejection.
    await r.disconnect().catch(() => undefined);
  }

  /**
   * Toggle the local mic publish (Story 3.4 self-mute). A thin wrapper over
   * `setMicrophoneEnabled`: mute ⇒ `setMicrophoneEnabled(false)`, unmute ⇒
   * `setMicrophoneEnabled(true)`. Other clients observe the change naturally — a
   * muted self drops out of their `ActiveSpeakersChanged`, no extra signaling.
   *
   * Guarded two ways: it only acts when `phase === 'connected'` AND this connect
   * published a mic (a listen-only spectator has no local track — muting it is
   * meaningless, so this is a no-op for them). The SDK call is try/catch-wrapped
   * like teardown: a failed toggle must NOT throw into the UI, and on failure we
   * leave the store flag untouched (no optimistic flip). Writes ONLY voiceStore.
   */
  async function setMuted(muted: boolean): Promise<void> {
    if (phase !== 'connected' || !published || !room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!muted);
    } catch {
      // A failed mic toggle must never throw into the UI — leave the flag as-is
      // so the control reflects the real (unchanged) publish state.
      return;
    }
    useVoiceStore.getState().setMuted(muted);
  }

  return { connect, disconnect, setMuted };
}

// App-wide singleton: the real LiveKit Room + the real VOICE_TOKEN request.
const controller = createVoiceController({
  createRoom: () => new Room(),
  requestToken: requestVoiceToken,
});

/** Connect the local participant to their server-assigned voice room. MUST be
 * called from a user-gesture handler (autoplay + getUserMedia need a gesture).
 * `publish` defaults to `true` (Bomb Room talk); pass `{ publish: false }` for a
 * listen-only spectator so no mic is acquired and no mic prompt shows (Story 3.3). */
export const connectVoice = (opts: { publish?: boolean } = {}): Promise<void> =>
  controller.connect(opts.publish ?? true);

/** Disconnect + full teardown. Safe to call on unmount or repeatedly. */
export const disconnectVoice = (): Promise<void> => controller.disconnect();

/** Toggle the local self-mute (Story 3.4). `setVoiceMuted(true)` mutes the mic,
 * `false` unmutes. A no-op unless connected as a publisher — safe to call from a
 * non-publishing / not-connected client (it simply does nothing). The caller (the
 * publisher-only MuteControl) owns the decision; no role branching here. */
export const setVoiceMuted = (muted: boolean): Promise<void> => controller.setMuted(muted);
