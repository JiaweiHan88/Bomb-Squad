import { describe, expect, it } from '@jest/globals';
import { createHmac } from 'node:crypto';
/**
 * Unit tests for TURN ICE-server minting (Story 3.6, AR16: pure logic, zero
 * infra). The coturn TURN-REST credential is `HMAC-SHA1(secret, "<expiry>:<id>")`
 * base64-encoded — we recompute it independently and assert equality, plus the
 * "no TURN configured → undefined" degradation contract.
 */
import { mintTurnIceServers } from '../turnCredentials.js';

const SECRET = 'turn-secret-test';
const IDENTITY = 'player-abc';

describe('mintTurnIceServers', () => {
  it('returns undefined when no turnUrl is configured (no regression for TURN-less)', () => {
    expect(
      mintTurnIceServers({ turnSecret: SECRET, identity: IDENTITY, ttlSeconds: 3600, nowSeconds: 1000 }),
    ).toBeUndefined();
    expect(
      mintTurnIceServers({ turnUrl: '', turnSecret: SECRET, identity: IDENTITY, ttlSeconds: 3600, nowSeconds: 1000 }),
    ).toBeUndefined();
  });

  it('mints one relay entry with udp+tcp transports and the TURN-REST credential', () => {
    const nowSeconds = 1_700_000_000;
    const ttlSeconds = 3600;
    const servers = mintTurnIceServers({
      turnUrl: 'turn:localhost:3478',
      turnSecret: SECRET,
      identity: IDENTITY,
      ttlSeconds,
      nowSeconds,
    });

    expect(servers).toBeDefined();
    expect(servers).toHaveLength(1);
    const [server] = servers!;

    // Both transports offered (UDP preferred, TCP is the UDP-blocked fallback).
    expect(server.urls).toEqual([
      'turn:localhost:3478?transport=udp',
      'turn:localhost:3478?transport=tcp',
    ]);

    // username carries the expiry so coturn rejects a stale credential statelessly.
    const expectedExpiry = nowSeconds + ttlSeconds;
    expect(server.username).toBe(`${expectedExpiry}:${IDENTITY}`);

    // credential is the base64 HMAC-SHA1 of the username under the static secret.
    const expectedCredential = createHmac('sha1', SECRET).update(server.username!).digest('base64');
    expect(server.credential).toBe(expectedCredential);
  });

  it('binds the expiry to nowSeconds + ttlSeconds (time-limited, project-context)', () => {
    const a = mintTurnIceServers({ turnUrl: 'turn:h:3478', turnSecret: SECRET, identity: IDENTITY, ttlSeconds: 60, nowSeconds: 100 });
    const b = mintTurnIceServers({ turnUrl: 'turn:h:3478', turnSecret: SECRET, identity: IDENTITY, ttlSeconds: 60, nowSeconds: 200 });
    expect(a![0].username).toBe(`160:${IDENTITY}`);
    expect(b![0].username).toBe(`260:${IDENTITY}`);
    // Different expiry ⇒ different signed credential.
    expect(a![0].credential).not.toBe(b![0].credential);
  });
});
