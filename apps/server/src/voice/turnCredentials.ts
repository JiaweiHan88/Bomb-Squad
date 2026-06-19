/**
 * TURN ICE-server minting (Story 3.6 — graceful voice degradation, relay path).
 *
 * Pure, side-effect-free derivation mirroring {@link file://./mintToken.ts}: given
 * a TURN URL + the static auth secret + the participant identity + a TTL + the
 * current time, it produces the `iceServers` the client passes to LiveKit's
 * `rtcConfig.iceServers` so a corporate-NAT participant can reach the Bomb Room
 * via the coturn relay when direct/STUN paths fail (AC #3).
 *
 * coturn runs with `--use-auth-secret --static-auth-secret=${TURN_SECRET}`, which
 * enables the TURN REST API credential scheme: the `username` is
 * `<unixExpiry>:<identity>` and the `credential` is the base64 HMAC-SHA1 of that
 * username under the shared secret. The server can therefore mint short-lived
 * TURN credentials locally with NO coturn round-trip (project-context: "coturn …
 * write own HMAC-SHA1 credential generation"; TURN credentials must be
 * time-limited, HMAC-SHA1, TTL ≤ 86400s).
 *
 * This module never reads `process.env` and never calls `Date.now()` — the
 * caller injects `turnUrl`/`turnSecret`/`ttlSeconds`/`nowSeconds`, keeping it
 * trivially unit-testable (same purity rule as the seed-chain + reducers).
 *
 * The returned `credential` is a SECRET — callers must never log it.
 */
import { createHmac } from 'node:crypto';
import type { IceServer } from '@bomb-squad/shared';

export interface TurnCredentialOptions {
  /**
   * Browser-reachable TURN URI base, e.g. `turn:localhost:3478` (like
   * `LIVEKIT_URL`, this is handed to the CLIENT, not dialed by the server). When
   * empty/undefined, TURN is not configured → returns `undefined` and the client
   * connects with no explicit TURN (no regression from pre-3.6 behavior).
   */
  turnUrl?: string;
  /** coturn `--static-auth-secret`. Used to HMAC-sign the ephemeral credential. */
  turnSecret: string;
  /** LiveKit participant identity (the durable playerId) — bound into the username. */
  identity: string;
  /** Credential lifetime in seconds (caller bounds this; mirrors the token TTL). */
  ttlSeconds: number;
  /** Current time in unix seconds, injected for purity (never `Date.now()` here). */
  nowSeconds: number;
}

/**
 * Mint the TURN ICE servers for a participant, or `undefined` when no `turnUrl`
 * is configured. Returns a single relay entry exposing both UDP and TCP
 * transports (TCP is the corporate-firewall fallback when UDP is blocked).
 */
export function mintTurnIceServers(opts: TurnCredentialOptions): IceServer[] | undefined {
  const { turnUrl, turnSecret, identity, ttlSeconds, nowSeconds } = opts;
  if (turnUrl === undefined || turnUrl === '') return undefined;

  // TURN REST API credential: username carries the expiry so coturn can reject a
  // stale credential without server state; credential is HMAC-SHA1(secret, username).
  const expiry = nowSeconds + ttlSeconds;
  const username = `${expiry}:${identity}`;
  const credential = createHmac('sha1', turnSecret).update(username).digest('base64');

  return [
    {
      // Offer both transports: UDP is preferred, TCP is the symmetric-NAT /
      // UDP-blocked fallback. Full TLS `turns://` on 443 is Story 10-3.
      urls: [`${turnUrl}?transport=udp`, `${turnUrl}?transport=tcp`],
      username,
      credential,
    },
  ];
}
