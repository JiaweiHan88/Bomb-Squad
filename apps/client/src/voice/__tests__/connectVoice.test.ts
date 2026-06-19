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
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState({ session: null, bomb: null, timer: null, connection: 'disconnected' });
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [] });
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

// ── Active-speaker presence (Story 2.5) ──────────────────────────────────────
// LiveKit ActiveSpeakersChanged → voiceStore.activeSpeakers, mapped by the
// participant identity (== durable playerId). New speakers light immediately;
// a stop is held for the 150ms grace before the dot clears; teardown cancels
// every pending grace timer and clears the set.

describe('active-speaker tracking', () => {
  it('writes speaking participant identities to voiceStore.activeSpeakers', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();

    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'p2' }]);
    expect(useVoiceStore.getState().activeSpeakers.sort()).toEqual(['p1', 'p2']);
  });

  it('lights a newly-speaking identity immediately', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();

    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]);
    expect(useVoiceStore.getState().activeSpeakers).toEqual(['p1']);
    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'p2' }]);
    expect(useVoiceStore.getState().activeSpeakers.sort()).toEqual(['p1', 'p2']);
  });

  it('holds a stopped speaker for the 150ms grace, then clears it', async () => {
    vi.useFakeTimers();
    try {
      const { room } = makeFakeRoom();
      const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
      await controller.connect();

      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'p2' }]);
      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]); // p2 stops

      // Still shown during the grace.
      vi.advanceTimersByTime(149);
      expect(useVoiceStore.getState().activeSpeakers.sort()).toEqual(['p1', 'p2']);

      // Cleared once the grace elapses.
      vi.advanceTimersByTime(1);
      expect(useVoiceStore.getState().activeSpeakers).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a speaker that resumes within the grace keeps its dot (timer cancelled)', async () => {
    vi.useFakeTimers();
    try {
      const { room } = makeFakeRoom();
      const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
      await controller.connect();

      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]);
      room.emit(RoomEvent.ActiveSpeakersChanged, []); // stops
      vi.advanceTimersByTime(100);
      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]); // resumes
      vi.advanceTimersByTime(100); // past where the original clear would have fired
      expect(useVoiceStore.getState().activeSpeakers).toEqual(['p1']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts a speaker immediately when they disconnect ungracefully (no fresh ActiveSpeakers)', async () => {
    const { room } = makeFakeRoom();
    const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
    await controller.connect();

    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'p2' }]);
    expect(useVoiceStore.getState().activeSpeakers.sort()).toEqual(['p1', 'p2']);

    // p2 crashes/drops — LiveKit may never emit a fresh ActiveSpeakers excluding
    // them, so the dot would stick. ParticipantDisconnected clears it at once.
    room.emit(RoomEvent.ParticipantDisconnected, { identity: 'p2' });
    expect(useVoiceStore.getState().activeSpeakers).toEqual(['p1']);
  });

  it('a participant disconnect cancels that identity’s pending stop-grace timer', async () => {
    vi.useFakeTimers();
    try {
      const { room } = makeFakeRoom();
      const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
      await controller.connect();

      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]);
      room.emit(RoomEvent.ActiveSpeakersChanged, []); // p1 stops → grace timer scheduled
      room.emit(RoomEvent.ParticipantDisconnected, { identity: 'p1' }); // gone before grace fires
      expect(useVoiceStore.getState().activeSpeakers).toEqual([]);

      // The cancelled grace timer must not fire a redundant clear later.
      vi.advanceTimersByTime(500);
      expect(useVoiceStore.getState().activeSpeakers).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('teardown clears activeSpeakers and cancels pending grace timers', async () => {
    vi.useFakeTimers();
    try {
      const { room } = makeFakeRoom();
      const controller = createVoiceController({ createRoom: () => room, requestToken: async () => okToken() });
      await controller.connect();

      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'p2' }]);
      room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]); // schedule p2 clear

      await controller.disconnect();
      expect(useVoiceStore.getState().activeSpeakers).toEqual([]); // reset cleared it

      // The pending grace timer must not fire after teardown.
      vi.advanceTimersByTime(500);
      expect(useVoiceStore.getState().activeSpeakers).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Listen-only / spectator connect (Story 3.3, AC #1/#2/#4/#5) ──────────────
// A spectator connects with `publish: false`: we must NEVER call
// setMicrophoneEnabled (no getUserMedia → no mic prompt — AC #2) while still
// subscribing to + playing every remote audio track (the spectator HEARS the
// lounge — AC #1). The independence + teardown invariants hold for this path too.

const LOUNGE_GRANT = {
  url: 'ws://livekit:7880',
  token: 'LOUNGE.JWT.VALUE',
  room: 'spectator-lounge:sess-1',
  identity: 'spec-1',
};

function okLoungeToken(): TokenResult {
  return { ok: true, grant: LOUNGE_GRANT };
}

describe('listen-only (publish:false) spectator connect', () => {
  it('NEVER acquires the mic yet still subscribes/plays remote audio and reaches connected', async () => {
    const { room, connect, setMicrophoneEnabled } = makeFakeRoom();
    const controller = createVoiceController({
      createRoom: () => room,
      requestToken: async () => okLoungeToken(),
    });

    const pending = controller.connect(false); // listen-only
    expect(useVoiceStore.getState().status).toBe('connecting');
    await pending;

    // The load-bearing AC #2 assertion: no mic was ever requested.
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
    // Still connected to the room the token named (lounge) + identity recorded.
    expect(connect).toHaveBeenCalledWith(LOUNGE_GRANT.url, LOUNGE_GRANT.token);
    const s = useVoiceStore.getState();
    expect(s.status).toBe('connected');
    expect(s.room).toBe(LOUNGE_GRANT.room);
    expect(s.identity).toBe(LOUNGE_GRANT.identity);

    // Remote audio is still subscribed + attached — the spectator HEARS it (AC #1).
    const { track } = makeFakeAudioTrack();
    room.emit(RoomEvent.TrackSubscribed, track);
    expect(track.attach).toHaveBeenCalledTimes(1);
  });

  it('the listen-only path never mutates gameStore — success (AR12 / ADR-007)', async () => {
    const before = useGameStore.getState();
    const { room } = makeFakeRoom();
    const controller = createVoiceController({
      createRoom: () => room,
      requestToken: async () => okLoungeToken(),
    });
    await controller.connect(false);
    expect(useVoiceStore.getState().status).toBe('connected');
    const after = useGameStore.getState();
    expect(after.session).toBe(before.session);
    expect(after.bomb).toBe(before.bomb);
    expect(after.connection).toBe(before.connection);
  });

  it('the listen-only path never mutates gameStore — failure → unavailable, game keeps running', async () => {
    const before = useGameStore.getState();
    const controller = createVoiceController({
      createRoom: () => makeFakeRoom().room,
      requestToken: async (): Promise<TokenResult> => ({ ok: false }),
    });
    await controller.connect(false);
    expect(useVoiceStore.getState().status).toBe('unavailable');
    const after = useGameStore.getState();
    expect(after.session).toBe(before.session);
    expect(after.bomb).toBe(before.bomb);
    expect(after.connection).toBe(before.connection);
  });

  it('subscribe-only connect→disconnect detaches audio, drops listeners, disconnects (no leak)', async () => {
    const { room, disconnect, listeners } = makeFakeRoom();
    const controller = createVoiceController({
      createRoom: () => room,
      requestToken: async () => okLoungeToken(),
    });
    await controller.connect(false);

    const { track, el } = makeFakeAudioTrack();
    room.emit(RoomEvent.TrackSubscribed, track);

    await controller.disconnect();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(el.remove).toHaveBeenCalled(); // audio element removed from DOM
    for (const set of listeners.values()) expect(set.size).toBe(0); // listeners unbound
    expect(useVoiceStore.getState().status).toBe('idle');
  });

  it('reconnect after a listen-only disconnect requests a FRESH token', async () => {
    const requestToken = vi.fn(async () => okLoungeToken());
    const controller = createVoiceController({
      createRoom: () => makeFakeRoom().room,
      requestToken,
    });
    await controller.connect(false);
    await controller.disconnect();
    await controller.connect(false);
    expect(requestToken).toHaveBeenCalledTimes(2);
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
