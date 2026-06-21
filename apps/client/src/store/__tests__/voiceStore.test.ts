import { beforeEach, describe, expect, it } from 'vitest';
import { useVoiceStore } from '../voiceStore.js';

/**
 * voiceStore active-speaker primitive (Story 2.5). The 150ms-graced wiring from
 * LiveKit is covered by connectVoice.test.ts; here we pin the store's own
 * contract: setActiveSpeakers records the set, and every non-connected
 * transition clears it so no stale dots survive a drop.
 */
beforeEach(() => {
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [], muted: false, audioBlocked: false });
});

describe('voiceStore.activeSpeakers', () => {
  it('setActiveSpeakers records the current speaking set', () => {
    useVoiceStore.getState().setActiveSpeakers(['p1', 'p2']);
    expect(useVoiceStore.getState().activeSpeakers).toEqual(['p1', 'p2']);
  });

  it('reset clears activeSpeakers', () => {
    useVoiceStore.getState().setActiveSpeakers(['p1']);
    useVoiceStore.getState().reset();
    expect(useVoiceStore.getState().activeSpeakers).toEqual([]);
  });

  it('setUnavailable clears activeSpeakers', () => {
    useVoiceStore.getState().setActiveSpeakers(['p1']);
    useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
    expect(useVoiceStore.getState().activeSpeakers).toEqual([]);
  });

  it('setConnecting clears activeSpeakers (no stale dots on reconnect)', () => {
    useVoiceStore.getState().setActiveSpeakers(['p1']);
    useVoiceStore.getState().setConnecting();
    expect(useVoiceStore.getState().activeSpeakers).toEqual([]);
  });
});

/**
 * voiceStore self-mute flag (Story 3.4). The store is the SOLE home for mute
 * state. Every non-connected transition clears it so a stale mute can't survive a
 * reconnect — a fresh connect always starts un-muted.
 */
describe('voiceStore.muted', () => {
  it('defaults to false', () => {
    expect(useVoiceStore.getState().muted).toBe(false);
  });

  it('setMuted flips the flag both ways', () => {
    useVoiceStore.getState().setMuted(true);
    expect(useVoiceStore.getState().muted).toBe(true);
    useVoiceStore.getState().setMuted(false);
    expect(useVoiceStore.getState().muted).toBe(false);
  });

  it('setConnecting clears muted (no stale mute on reconnect)', () => {
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().setConnecting();
    expect(useVoiceStore.getState().muted).toBe(false);
  });

  it('setUnavailable clears muted', () => {
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
    expect(useVoiceStore.getState().muted).toBe(false);
  });

  it('reset clears muted', () => {
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().reset();
    expect(useVoiceStore.getState().muted).toBe(false);
  });
});

/**
 * voiceStore blocked-autoplay flag (Story 3.6). `audioBlocked` composes WITH
 * `connected` (a connected-but-silent participant) and is cleared on every
 * non-connected transition so a stale flag can't survive a reconnect.
 */
describe('voiceStore.audioBlocked', () => {
  it('defaults to false', () => {
    expect(useVoiceStore.getState().audioBlocked).toBe(false);
  });

  it('setAudioBlocked flips the flag both ways', () => {
    useVoiceStore.getState().setAudioBlocked(true);
    expect(useVoiceStore.getState().audioBlocked).toBe(true);
    useVoiceStore.getState().setAudioBlocked(false);
    expect(useVoiceStore.getState().audioBlocked).toBe(false);
  });

  it('setConnecting clears audioBlocked (no stale flag on reconnect)', () => {
    useVoiceStore.getState().setAudioBlocked(true);
    useVoiceStore.getState().setConnecting();
    expect(useVoiceStore.getState().audioBlocked).toBe(false);
  });

  it('setUnavailable clears audioBlocked', () => {
    useVoiceStore.getState().setAudioBlocked(true);
    useVoiceStore.getState().setUnavailable('Voice unavailable — game continues without it');
    expect(useVoiceStore.getState().audioBlocked).toBe(false);
  });

  it('reset clears audioBlocked', () => {
    useVoiceStore.getState().setAudioBlocked(true);
    useVoiceStore.getState().reset();
    expect(useVoiceStore.getState().audioBlocked).toBe(false);
  });
});
