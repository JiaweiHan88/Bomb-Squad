/**
 * Role-scoped LiveKit token minting (Story 3.1).
 *
 * Pure, side-effect-free token derivation: given a resolved participant
 * (identity + role + session/team) and the LiveKit credentials, it produces a
 * JWT scoped to EXACTLY one room with EXACTLY the grants that role allows.
 *
 * This module never reads `process.env`, never touches Redis or Socket.IO —
 * the caller (voiceHandlers) injects credentials and supplies a participant
 * already resolved from authoritative session state. The role→room→grant
 * mapping below is the single place the voice topology rule lives (AR12).
 */
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import type { PlayerRole, SessionState, TeamId } from '@bomb-squad/shared';
import { resolveVoiceScope as resolveSharedVoiceScope } from '@bomb-squad/shared';

// The room/grant derivation now lives in `@bomb-squad/shared` (Story 3.5) so the
// client's re-mint reconciler and this server minting path can never drift. We
// re-export the shared error + room-name builders here to keep existing import
// sites (`voiceHandlers`, tests) unchanged — this module stays the server's
// public voice-scope surface; it just delegates the topology rule to shared.
export {
  VoiceScopeError,
  bombRoomName,
  spectatorLoungeName,
  lobbyRoomName,
} from '@bomb-squad/shared';

export interface VoiceParticipant {
  /** Server-side player id, used verbatim as the LiveKit participant identity. */
  identity: string;
  role: PlayerRole;
  sessionId: string;
  /** Required for Bomb Room roles; absent for spectators. */
  teamId?: TeamId;
  /**
   * Current session phase (Story 2.5). When `'lobby'`, EVERY participant is
   * scoped to the shared lobby mic-check room regardless of role/team — see
   * {@link resolveVoiceScope}. Absent/other phases keep the role-scoped routing.
   */
  phase?: SessionState['status'];
}

export interface VoiceCredentials {
  apiKey: string;
  apiSecret: string;
  /** Token lifetime in seconds. Caller bounds this; never unbounded. */
  ttlSeconds: number;
}

export interface ResolvedVoiceScope {
  room: string;
  grant: VideoGrant;
}

/**
 * Resolve a participant's single room + LiveKit grant from their role/team/phase.
 *
 * Delegates the topology rule (room name + publish/subscribe) to the SHARED
 * `resolveVoiceScope` (Story 3.5) — the one place client and server agree on
 * scope — then shapes the result into a LiveKit `VideoGrant` by adding
 * `roomJoin: true`. Pure and total over valid inputs; propagates
 * {@link VoiceScopeError} for the one unrepresentable case (a Bomb Room role
 * with no team, outside the lobby). See the shared helper for the full mapping
 * (lobby mic-check exception, spectator listen-only, facilitator narration).
 */
export function resolveVoiceScope(participant: VoiceParticipant): ResolvedVoiceScope {
  const { role, sessionId, teamId, phase } = participant;
  const { room, canPublish, canSubscribe } = resolveSharedVoiceScope({
    role,
    sessionId,
    teamId,
    phase,
  });
  return {
    room,
    grant: { roomJoin: true, room, canPublish, canSubscribe },
  };
}

/**
 * Mint a signed LiveKit JWT for a resolved participant.
 *
 * `toJwt()` is async in livekit-server-sdk v2 (it was a synchronous `toJWT()`
 * in v1) — it MUST be awaited; a forgotten await ships a `Promise` cast to
 * string, i.e. a broken token. Returns the JWT plus the room it is scoped to
 * (the caller needs the room name for its ack and for logging).
 */
export async function mintVoiceToken(
  participant: VoiceParticipant,
  credentials: VoiceCredentials,
): Promise<{ token: string; room: string }> {
  const { room, grant } = resolveVoiceScope(participant);

  const at = new AccessToken(credentials.apiKey, credentials.apiSecret, {
    identity: participant.identity,
    ttl: credentials.ttlSeconds,
  });
  at.addGrant(grant);

  const token = await at.toJwt();
  return { token, room };
}
