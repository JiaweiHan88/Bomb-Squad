import { describe, expect, it } from '@jest/globals';
/**
 * Unit tests for role-scoped token minting (Story 3.1, AR16: pure logic, zero
 * infra). We decode the JWT's claims and assert the embedded video grant — we
 * never assert the opaque token string. The spectator `canPublish: false`
 * invariant is the security core of FR39 and is asserted explicitly.
 */
import {
  mintVoiceToken,
  resolveVoiceScope,
  VoiceScopeError,
  type VoiceParticipant,
} from '../mintToken.js';

const CREDS = { apiKey: 'devkey', apiSecret: 'devsecret-at-least-32-chars-long!!', ttlSeconds: 3600 };

/** LiveKit video grant claims, as embedded under the JWT `video` claim. */
interface DecodedClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  video?: {
    room?: string;
    roomJoin?: boolean;
    canPublish?: boolean;
    canSubscribe?: boolean;
  };
}

/** Decode (not verify) the JWT payload segment. Sufficient for grant assertions. */
function decodeJwt(token: string): DecodedClaims {
  const [, payload] = token.split('.');
  expect(payload).toBeTruthy();
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DecodedClaims;
}

describe('resolveVoiceScope', () => {
  it('scopes a defuser to the team Bomb Room with publish + subscribe', () => {
    const { room, grant } = resolveVoiceScope({
      identity: 'p1',
      role: 'defuser',
      sessionId: 'sess1',
      teamId: 'A',
    });
    expect(room).toBe('bomb-room:sess1:A');
    expect(grant).toMatchObject({
      roomJoin: true,
      room: 'bomb-room:sess1:A',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('scopes an expert to the team Bomb Room', () => {
    const { room } = resolveVoiceScope({
      identity: 'p2',
      role: 'expert',
      sessionId: 'sess1',
      teamId: 'B',
    });
    expect(room).toBe('bomb-room:sess1:B');
  });

  it('scopes a spectator to the listen-only Spectator Lounge (canPublish false)', () => {
    const { room, grant } = resolveVoiceScope({
      identity: 'p3',
      role: 'spectator',
      sessionId: 'sess1',
    });
    expect(room).toBe('spectator-lounge:sess1');
    expect(grant.canPublish).toBe(false);
    expect(grant.canSubscribe).toBe(true);
  });

  it('scopes a facilitator to the Spectator Lounge with publish (host narration)', () => {
    const { room, grant } = resolveVoiceScope({
      identity: 'p-fac',
      role: 'facilitator',
      sessionId: 'sess1',
    });
    // Baseline room is the lounge alongside spectators, but the facilitator may
    // publish (narrate); the on-demand Bomb Room PTT bridge is a later story.
    expect(room).toBe('spectator-lounge:sess1');
    expect(grant).toMatchObject({
      roomJoin: true,
      room: 'spectator-lounge:sess1',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('does not require a teamId for a facilitator (lounge-scoped, never throws)', () => {
    expect(() =>
      resolveVoiceScope({ identity: 'p5', role: 'facilitator', sessionId: 'sess1' }),
    ).not.toThrow();
  });

  it('throws VoiceScopeError for a Bomb Room role with no team', () => {
    expect(() =>
      resolveVoiceScope({ identity: 'p4', role: 'defuser', sessionId: 'sess1' }),
    ).toThrow(VoiceScopeError);
    expect(() =>
      resolveVoiceScope({ identity: 'p6', role: 'expert', sessionId: 'sess1' }),
    ).toThrow(VoiceScopeError);
  });

  // ── Lobby mic-check phase (Story 2.5) ──────────────────────────────────────
  // While `phase === 'lobby'` EVERY participant is scoped to one shared,
  // bidirectional room — before the role checks, so an un-teamed Bomb Room role
  // no longer throws and a spectator gets publish (the lobby-only FR39 exception).

  it('lobby phase scopes a teamless defuser to the shared lobby room (no throw)', () => {
    const { room, grant } = resolveVoiceScope({
      identity: 'p1',
      role: 'defuser',
      sessionId: 'sess1',
      phase: 'lobby',
    });
    expect(room).toBe('lobby:sess1');
    expect(grant).toMatchObject({
      roomJoin: true,
      room: 'lobby:sess1',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('lobby phase scopes a spectator to the shared lobby room WITH publish (mic-check exception)', () => {
    const { room, grant } = resolveVoiceScope({
      identity: 'p3',
      role: 'spectator',
      sessionId: 'sess1',
      phase: 'lobby',
    });
    expect(room).toBe('lobby:sess1');
    expect(grant.canPublish).toBe(true);
    expect(grant.canSubscribe).toBe(true);
  });

  it('lobby phase scopes the facilitator to the shared lobby room', () => {
    const { room } = resolveVoiceScope({
      identity: 'p-fac',
      role: 'facilitator',
      sessionId: 'sess1',
      phase: 'lobby',
    });
    expect(room).toBe('lobby:sess1');
  });

  it('the SAME spectator outside the lobby reverts to the listen-only lounge (path unchanged)', () => {
    const lobby = resolveVoiceScope({ identity: 'p3', role: 'spectator', sessionId: 'sess1', phase: 'lobby' });
    const active = resolveVoiceScope({ identity: 'p3', role: 'spectator', sessionId: 'sess1', phase: 'active' });
    expect(lobby.room).toBe('lobby:sess1');
    expect(lobby.grant.canPublish).toBe(true);
    expect(active.room).toBe('spectator-lounge:sess1');
    expect(active.grant.canPublish).toBe(false);
  });
});

describe('mintVoiceToken', () => {
  it('mints a JWT whose identity, room, and grant match a defuser', async () => {
    const participant: VoiceParticipant = {
      identity: 'player-abc',
      role: 'defuser',
      sessionId: 'sess9',
      teamId: 'A',
    };
    const { token, room } = await mintVoiceToken(participant, CREDS);
    expect(room).toBe('bomb-room:sess9:A');

    const claims = decodeJwt(token);
    expect(claims.sub).toBe('player-abc');
    expect(claims.video?.room).toBe('bomb-room:sess9:A');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('mints a spectator JWT with canPublish:false (the FR39 security invariant)', async () => {
    const { token, room } = await mintVoiceToken(
      { identity: 'spec-1', role: 'spectator', sessionId: 'sess9' },
      CREDS,
    );
    expect(room).toBe('spectator-lounge:sess9');

    const claims = decodeJwt(token);
    expect(claims.video?.room).toBe('spectator-lounge:sess9');
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canSubscribe).toBe(true);
  });

  it('bounds the token lifetime to the supplied ttl (never unbounded)', async () => {
    const ttlSeconds = 600;
    const nowSec = Math.floor(Date.now() / 1000);
    const { token } = await mintVoiceToken(
      { identity: 'spec-2', role: 'spectator', sessionId: 'sess9' },
      { ...CREDS, ttlSeconds },
    );
    const claims = decodeJwt(token);
    // LiveKit stamps `exp` (it does not emit `iat`); assert it expires roughly
    // `ttl` seconds from now, never open-ended.
    expect(typeof claims.exp).toBe('number');
    const expectedExp = nowSec + ttlSeconds;
    expect(claims.exp as number).toBeGreaterThanOrEqual(expectedExp - 30);
    expect(claims.exp as number).toBeLessThanOrEqual(expectedExp + 30);
  });

  it('rejects a Bomb Room role with no team before producing a token', async () => {
    await expect(
      mintVoiceToken({ identity: 'p', role: 'expert', sessionId: 'sess9' }, CREDS),
    ).rejects.toBeInstanceOf(VoiceScopeError);
  });
});
