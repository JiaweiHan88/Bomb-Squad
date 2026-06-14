import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceTokenGrantPayload, VoiceTokenErrorPayload } from '@bomb-squad/shared';

/**
 * Exercises the REAL default token request path — `getSocket().timeout(ms)
 * .emit('VOICE_TOKEN', {}, errFirstAck)` — by mocking the socket (no SFU, no
 * server). Confirms the empty-payload contract (3.1), the error-first ack
 * handling, and that a fresh VOICE_TOKEN is emitted per call (AC #6).
 */

type Ack = (err: Error | null, result?: VoiceTokenGrantPayload | VoiceTokenErrorPayload) => void;

const emit = vi.fn();
const timeout = vi.fn(() => ({ emit }));

vi.mock('../../net/socket.js', () => ({
  getSocket: () => ({ id: 'self-1', timeout }),
}));

// Imported after the mock is registered.
const { requestVoiceToken } = await import('../connectVoice.js');

const GRANT: VoiceTokenGrantPayload = {
  url: 'ws://livekit:7880',
  token: 'SECRET.JWT',
  room: 'bomb-room:sess-1:A',
  identity: 'self-1',
};

beforeEach(() => {
  emit.mockReset();
  timeout.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestVoiceToken (default VOICE_TOKEN path)', () => {
  it('emits VOICE_TOKEN with an EMPTY payload (server derives room+grants)', async () => {
    emit.mockImplementation((_event: string, _payload: unknown, ack: Ack) => ack(null, GRANT));
    await requestVoiceToken();
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0]!;
    expect(event).toBe('VOICE_TOKEN');
    expect(payload).toEqual({});
  });

  it('a grant ack → { ok: true, grant }', async () => {
    emit.mockImplementation((_e: string, _p: unknown, ack: Ack) => ack(null, GRANT));
    const result = await requestVoiceToken();
    expect(result).toEqual({ ok: true, grant: GRANT });
  });

  it('an { error } ack → { ok: false }', async () => {
    const err: VoiceTokenErrorPayload = { error: 'VOICE_SCOPE_UNAVAILABLE' };
    emit.mockImplementation((_e: string, _p: unknown, ack: Ack) => ack(null, err));
    expect(await requestVoiceToken()).toEqual({ ok: false });
  });

  it('a timeout (error-first err set) → { ok: false }', async () => {
    emit.mockImplementation((_e: string, _p: unknown, ack: Ack) => ack(new Error('operation has timed out')));
    expect(await requestVoiceToken()).toEqual({ ok: false });
  });
});
