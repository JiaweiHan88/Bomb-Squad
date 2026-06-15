import { beforeEach, describe, expect, it } from 'vitest';
import { useVoiceStore } from '../voiceStore.js';

/**
 * voiceStore active-speaker primitive (Story 2.5). The 150ms-graced wiring from
 * LiveKit is covered by connectVoice.test.ts; here we pin the store's own
 * contract: setActiveSpeakers records the set, and every non-connected
 * transition clears it so no stale dots survive a drop.
 */
beforeEach(() => {
  useVoiceStore.setState({ status: 'idle', room: undefined, identity: undefined, error: undefined, activeSpeakers: [] });
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
