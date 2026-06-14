import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import {
  createVoiceController,
  type TokenResult,
  type VoiceRoom,
} from '../connectVoice.js';
import { useVoiceStore } from '../../store/voiceStore.js';
import { useGameStore } from '../../store/gameStore.js';

/**
 * Story 3.2 voice tests. The load-bearing one (AR12/ADR-007): exercising the
 * voice path — success AND failure — never mutates `gameStore`. Everything is
 * driven through a FAKE `Room` + a stubbed `VOICE_TOKEN` result; no real SFU
 * (AR16 — the real-container check is the human-verify step, not the unit layer).
 */

// ── Fakes ────────────────────────────────────────────────────────────────────

function makeFakeAudioTrack() {
  // Real LiveKit `track.attach()` returns a real HTMLAudioElement, and the
  // controller appends it to `document.body` (jsdom env). Use a real element so
  // `appendChild` works; spy on `remove` so teardown assertions still hold.
  const el = document.createElement('audio');
  vi.spyOn(el, 'remove');
  return {
    el,
    track: {
      kind: Track.Kind.Audio,
      attach: vi.fn(() => el as HTMLMediaElement),
      detach: vi.fn(() => [el as HTMLMediaElement]),
    },
  };
}

/** A fake LiveKit Room: records lifecycle calls and can fire RoomEvents at the
 * controller's registered listeners — no WebRTC, no SFU. */
function makeFakeRoom() {
  const listeners = new Map<string, Set<(arg: unknown) => void>>();
  const setMicrophoneEnabled = vi.fn(async () => undefined);
  const connect = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);
  const startAudio = vi.fn(async () => undefined);

  const room: VoiceRoom & { emit: (e: RoomEvent, arg: unknown) => void } = {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as unknown as (arg: unknown) => void);
      listeners.set(event, set);
      return this;
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener as unknown as (arg: unknown) => void);
      return this;
    },
    connect,
    disconnect,
    startAudio,
    localParticipant: { setMicrophoneEnabled },
    emit(event, arg) {
      for (const l of listeners.get(event) ?? []) l(arg);
    },
  };
  return { room, listeners, connect, disconnect, startAudio, setMicrophoneEnabled };
}

const GRANT = {
  url: 'ws://livekit:7880',
  token: 'SECRET.JWT.VALUE',
  room: 'bomb-room:sess-1:A',
  identity: 'self-1',
};

function okToken(): TokenResult {
  return { ok: true, grant: GRANT };
}

beforeEach(() => {
  // A neutral, non-null gameStore snapshot so "unchanged" is meaningful.
  useGameStore.setState({
    session: { sessionId: 'sess-1' } as never,
    bomb: { strikes: 0 } as never,
    connection: 'connected',
  });
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState({ session: null, bomb: null, timer: null, connection: 'disconnected' });
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined });
});

// ── The load-bearing independence test (AC #3) ───────────────────────────────

describe('voice never mutates gameStore (AR12 / ADR-007)', () => {
  it('walks voiceStore idle→connecting→connected while gameStore stays byte-identical', async () => {
    const before = useGameStore.getState();
    const { room } = makeFakeRoom();
    const controller = createVoiceController({
      createRoom: () => room,
      requestToken: async () => okToken(),
    });

    const pending = controller.connect();
    // `connecting` is set synchronously, before the token await resolves.
    expect(useVoiceStore.getState().status).toBe('connecting');
    await pending;
    expect(useVoiceStore.getState().status).toBe('connected');

    const after = useGameStore.getState();
    expect(after.session).toBe(before.session);
    expect(after.bomb).toBe(before.bomb);
    expect(after.connection).toBe(before.connection);
  });

  it('the FAILURE path resolves to unavailable and still leaves gameStore untouched', async () => {
    const before = useGameStore.getState();
    const controller = createVoiceController({
      createRoom: () => makeFakeRoom().room,
      requestToken: async (): Promise<TokenResult> => ({ ok: false }),
    });

    await controller.connect();

    expect(useVoiceStore.getState().status).toBe('unavailable');
    const after = useGameStore.getState();
    expect(after.session).toBe(before.session);
    expect(after.bomb).toBe(before.bomb);
    expect(after.connection).toBe(before.connection);
  });
});

// ── Status state machine (AC #2/#3) ──────────────────────────────────────────

describe('voiceStore status state machine', () => {
  it('token error → unavailable (with non-secret microcopy, never the token)', async () => {
    const controller = createVoiceController({
      createRoom: () => makeFakeRoom().room,
      requestToken: async (): Promise<TokenResult> => ({ ok: false }),
    });
    await controller.connect();
    const s = useVoiceStore.getState();
    expect(s.status).toBe('unavailable');
    expect(s.error ?? '').not.toContain(GRANT.token);
  });

  it('successful connect → connected and records room + identity', async () => {
    const { room, connect, setMicrophoneEnabled } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();
    expect(connect).toHaveBeenCalledWith(GRANT.url, GRANT.token);
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
    const s = useVoiceStore.getState();
    expect(s.status).toBe('connected');
    expect(s.room).toBe(GRANT.room);
    expect(s.identity).toBe(GRANT.identity);
  });

  it('connect rejection → unavailable and the half-open room is disconnected', async () => {
    const { room, disconnect } = makeFakeRoom();
    room.connect = vi.fn(async () => {
      throw new Error('transport failed');
    });
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();
    expect(useVoiceStore.getState().status).toBe('unavailable');
    expect(disconnect).toHaveBeenCalled();
  });

  it('disconnect() → back to idle', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();
    await controller.disconnect();
    expect(useVoiceStore.getState().status).toBe('idle');
  });

  it('a Disconnected RoomEvent mid-session → unavailable (game keeps running)', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();
    room.emit(RoomEvent.Disconnected, undefined);
    // disconnect() runs async off the event; flush the microtask queue.
    await Promise.resolve();
    expect(useVoiceStore.getState().status).toBe('unavailable');
  });
});

// ── Teardown / no-leak (AC #5) ───────────────────────────────────────────────

describe('teardown leaves no leaked tracks, elements, or listeners', () => {
  it('detaches audio + removes the element + drops every listener on disconnect', async () => {
    const { room, disconnect, setMicrophoneEnabled, listeners } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();

    // A remote participant publishes audio.
    const { track, el } = makeFakeAudioTrack();
    room.emit(RoomEvent.TrackSubscribed, track);
    expect(track.attach).toHaveBeenCalledTimes(1);

    await controller.disconnect();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false); // mic released
    expect(el.remove).toHaveBeenCalled(); // audio element removed from DOM
    // Every RoomEvent listener was unbound.
    for (const set of listeners.values()) expect(set.size).toBe(0);
  });

  it('TrackUnsubscribed detaches that track mid-session', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();
    const { track, el } = makeFakeAudioTrack();
    room.emit(RoomEvent.TrackSubscribed, track);
    room.emit(RoomEvent.TrackUnsubscribed, track);
    expect(track.detach).toHaveBeenCalledTimes(1);
    expect(el.remove).toHaveBeenCalledTimes(1);
  });
});

// ── Teardown DURING an in-flight connect must not orphan a live Room (AC #5) ──
// Regression guard: `connect()` re-checks its epoch after each await, so a
// disconnect()/unmount that races the token request or the room connect aborts
// and disposes the room instead of leaving a live SFU connection + hot mic.

describe('a teardown during an in-flight connect never leaks a live room', () => {
  it('disconnect during the TOKEN request aborts before a room is ever created', async () => {
    let resolveToken!: (r: TokenResult) => void;
    const requestToken = vi.fn(
      () => new Promise<TokenResult>((res) => { resolveToken = res; }),
    );
    const createRoom = vi.fn(() => makeFakeRoom().room);
    const controller = createVoiceController({ createRoom, requestToken });

    const pending = controller.connect();
    expect(useVoiceStore.getState().status).toBe('connecting');

    // Teardown wins the race while the token is still in flight.
    await controller.disconnect();
    resolveToken(okToken());
    await pending;

    expect(createRoom).not.toHaveBeenCalled(); // no room → nothing to leak
    expect(useVoiceStore.getState().status).toBe('idle'); // not resurrected to 'connected'
  });

  it('disconnect during room.connect() disposes the now-live room (no orphan)', async () => {
    const before = useGameStore.getState();
    const { room, disconnect: roomDisconnect, setMicrophoneEnabled } = makeFakeRoom();
    let resolveConnect!: () => void;
    room.connect = vi.fn(() => new Promise<void>((res) => { resolveConnect = res; }));

    const controller = createVoiceController({
      createRoom: () => room,
      requestToken: async () => okToken(),
    });

    const pending = controller.connect();
    // Flush past the token await so we are parked inside room.connect().
    await Promise.resolve();
    await Promise.resolve();

    // Teardown races in while room.connect() is still pending.
    const tearing = controller.disconnect();
    resolveConnect();
    await Promise.all([pending, tearing]);

    expect(roomDisconnect).toHaveBeenCalled(); // the live room was disposed, not leaked
    expect(setMicrophoneEnabled).toHaveBeenLastCalledWith(false); // mic released
    expect(useVoiceStore.getState().status).toBe('idle'); // never flipped to 'connected'
    // gameStore stayed byte-identical throughout the race (AR12 / ADR-007).
    const after = useGameStore.getState();
    expect(after.session).toBe(before.session);
    expect(after.bomb).toBe(before.bomb);
    expect(after.connection).toBe(before.connection);
  });
});

// ── Fresh token per connect (AC #6) ──────────────────────────────────────────

describe('a fresh token is requested per connect (never cached/reused)', () => {
  it('connect → disconnect → connect requests the token twice', async () => {
    const requestToken = vi.fn(async () => okToken());
    const controller = createVoiceController({ createRoom: () => makeFakeRoom().room, requestToken });
    await controller.connect();
    await controller.disconnect();
    await controller.connect();
    expect(requestToken).toHaveBeenCalledTimes(2);
  });

  it('a double-connect while already connecting is ignored (one token request)', async () => {
    const requestToken = vi.fn(async () => okToken());
    const controller = createVoiceController({ createRoom: () => makeFakeRoom().room, requestToken });
    const a = controller.connect();
    const b = controller.connect(); // ignored — already connecting
    await Promise.all([a, b]);
    expect(requestToken).toHaveBeenCalledTimes(1);
  });
});
