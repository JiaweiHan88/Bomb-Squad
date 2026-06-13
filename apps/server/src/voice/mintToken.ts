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
import type { PlayerRole, TeamId } from '@bomb-squad/shared';

/**
 * Roles that belong in a team's bidirectional Bomb Room (AR12). The facilitator
 * is deliberately NOT here: their baseline room is the Spectator Lounge (see
 * {@link resolveVoiceScope}). Their on-demand push-to-talk INTO a team's Bomb
 * Room is a separate mechanism (its own grant/token) handled by a later story.
 */
const BOMB_ROOM_ROLES: ReadonlySet<PlayerRole> = new Set<PlayerRole>([
  'defuser',
  'expert',
]);

/** Raised when a participant cannot be scoped to a room (e.g. a Bomb Room role
 * with no team assigned). The voiceHandlers guard catches this and acks an
 * error rather than minting a malformed token. */
export class VoiceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceScopeError';
  }
}

export interface VoiceParticipant {
  /** Server-side player id, used verbatim as the LiveKit participant identity. */
  identity: string;
  role: PlayerRole;
  sessionId: string;
  /** Required for Bomb Room roles; absent for spectators. */
  teamId?: TeamId;
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

/** LiveKit room name for a team's Bomb Room (bidirectional). */
export const bombRoomName = (sessionId: string, teamId: TeamId): string =>
  `bomb-room:${sessionId}:${teamId}`;

/** LiveKit room name for the session's Spectator Lounge (listen-only). */
export const spectatorLoungeName = (sessionId: string): string =>
  `spectator-lounge:${sessionId}`;

/**
 * Resolve a participant's single room + grant from their role. Pure and
 * total over valid inputs; throws {@link VoiceScopeError} for the one
 * unrepresentable case (a Bomb Room role with no team).
 *
 * - defuser / expert → `bomb-room:{sessionId}:{teamId}`, `canPublish: true`,
 *   `canSubscribe: true` (bidirectional).
 * - spectator → `spectator-lounge:{sessionId}`, `canPublish: false`,
 *   `canSubscribe: true` (listen-only — enforced at the grant level, FR39).
 * - facilitator → `spectator-lounge:{sessionId}`, `canPublish: true`,
 *   `canSubscribe: true`. The facilitator's baseline is the lounge alongside the
 *   spectators, but as the host they may narrate (publish). Their on-demand
 *   push-to-talk into a team's Bomb Room is a separate grant handled by a later
 *   story — never minted here.
 */
export function resolveVoiceScope(participant: VoiceParticipant): ResolvedVoiceScope {
  const { role, sessionId, teamId } = participant;

  // Spectators and the facilitator share the Spectator Lounge as their baseline
  // room; only the facilitator may publish into it (host narration). Spectators
  // stay listen-only (FR39), enforced at the grant level.
  if (role === 'spectator' || role === 'facilitator') {
    const room = spectatorLoungeName(sessionId);
    return {
      room,
      grant: {
        roomJoin: true,
        room,
        canPublish: role === 'facilitator',
        canSubscribe: true,
      },
    };
  }

  if (BOMB_ROOM_ROLES.has(role)) {
    if (teamId === undefined) {
      throw new VoiceScopeError(`Bomb Room role "${role}" has no team assigned`);
    }
    const room = bombRoomName(sessionId, teamId);
    return {
      room,
      grant: { roomJoin: true, room, canPublish: true, canSubscribe: true },
    };
  }

  // Defensive: PlayerRole is a closed union, so this is unreachable today, but
  // a future role must opt into a scope explicitly rather than default-publish.
  throw new VoiceScopeError(`role "${role}" has no voice scope`);
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
