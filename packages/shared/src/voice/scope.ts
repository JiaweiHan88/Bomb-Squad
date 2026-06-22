/**
 * Canonical voice-scope derivation (Story 3.5).
 *
 * The SINGLE source of truth for "which LiveKit room + what publish/subscribe
 * rights does a participant get". The server (token minting) and the client
 * (the re-mint-on-role-change reconciler) BOTH derive scope from here, so they
 * can never drift on the voice topology — the same "client/server can't drift"
 * lesson that moved the relay predicates into shared (Story 8.9).
 *
 * Pure TypeScript returning plain data: NO `livekit-server-sdk`, NO `react`, NO
 * `socket.io`. The server shapes this into a `VideoGrant` (adding `roomJoin`);
 * the client maps `canPublish` → its connect `publish` flag.
 */
import type { PlayerRole, SessionState, TeamId } from '../types/index.js';

/**
 * Roles that belong in a team's bidirectional Bomb Room (AR12). The facilitator
 * is deliberately NOT here: their baseline room is the Spectator Lounge (see
 * {@link resolveVoiceScope}). Their on-demand push-to-talk INTO a team's Bomb
 * Room is a separate mechanism handled by a later story.
 */
const BOMB_ROOM_ROLES: ReadonlySet<PlayerRole> = new Set<PlayerRole>([
  'defuser',
  'expert',
]);

/**
 * Raised when a participant cannot be scoped to a room (e.g. a Bomb Room role
 * with no team assigned, outside the lobby). The server's voiceHandlers guard
 * catches this and acks an error rather than minting a malformed token; the
 * client's scope-sync treats it as "no resolvable scope" → no re-mint.
 *
 * Defined HERE (shared) so the `instanceof` check works regardless of whether
 * the throw originates client- or server-side; the server re-exports it for
 * backward compatibility with existing import sites.
 */
export class VoiceScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceScopeError';
  }
}

/** LiveKit room name for a team's Bomb Room (bidirectional). */
export const bombRoomName = (sessionId: string, teamId: TeamId): string =>
  `bomb-room:${sessionId}:${teamId}`;

/** LiveKit room name for the session's Spectator Lounge (listen-only). */
export const spectatorLoungeName = (sessionId: string): string =>
  `spectator-lounge:${sessionId}`;

/** LiveKit room name for the session's pre-game lobby mic check (Story 2.5).
 * A single shared, bidirectional room every participant joins while the session
 * is in `lobby` status. */
export const lobbyRoomName = (sessionId: string): string => `lobby:${sessionId}`;

export interface VoiceScopeParticipant {
  role: PlayerRole;
  sessionId: string;
  /** Required for Bomb Room roles outside the lobby; absent for spectators. */
  teamId?: TeamId;
  /**
   * Current session phase (Story 2.5). When `'lobby'`, EVERY participant is
   * scoped to the shared lobby mic-check room regardless of role/team. Absent or
   * any other phase keeps the role-scoped routing.
   */
  phase?: SessionState['status'];
}

/** The pure scope a participant resolves to: a single room + its grant flags.
 * The server adds `roomJoin: true` when shaping the LiveKit `VideoGrant`. */
export interface VoiceScope {
  room: string;
  canPublish: boolean;
  canSubscribe: boolean;
}

/**
 * Resolve a participant's single room + grant flags from their role/team/phase.
 * Pure and total over valid inputs; throws {@link VoiceScopeError} for the one
 * unrepresentable case (a Bomb Room role with no team, outside the lobby).
 *
 * - `phase === 'lobby'` → shared `lobby:{sessionId}`, `canPublish: true` for
 *   EVERYONE (mic check, Story 2.5 — a deliberate FR39 exception for spectators,
 *   who are listen-only ONLY in the in-game lounge, not the pre-game mic check).
 * - defuser / expert → `bomb-room:{sessionId}:{teamId}`, `canPublish: true`.
 * - spectator → `spectator-lounge:{sessionId}`, `canPublish: false` (FR39).
 * - facilitator → `spectator-lounge:{sessionId}`, `canPublish: true` (narration).
 */
export function resolveVoiceScope(participant: VoiceScopeParticipant): VoiceScope {
  const { role, sessionId, teamId, phase } = participant;

  // Lobby mic check (Story 2.5): while in `lobby` status EVERY participant shares
  // one bidirectional room. Runs BEFORE the role checks so an un-teamed Bomb Room
  // role in the lobby does not throw — in the lobby they belong in the lobby room
  // regardless of team. Spectators get `canPublish: true` HERE ONLY (a deliberate
  // FR39 exception — every participant must verify their own mic; do NOT "fix"
  // this into listen-only).
  if (phase === 'lobby') {
    return { room: lobbyRoomName(sessionId), canPublish: true, canSubscribe: true };
  }

  // Spectators and the facilitator share the Spectator Lounge as their baseline
  // room; only the facilitator may publish into it (host narration). Spectators
  // stay listen-only (FR39), enforced at the grant level.
  if (role === 'spectator' || role === 'facilitator') {
    return {
      room: spectatorLoungeName(sessionId),
      canPublish: role === 'facilitator',
      canSubscribe: true,
    };
  }

  if (BOMB_ROOM_ROLES.has(role)) {
    if (teamId === undefined) {
      throw new VoiceScopeError(`Bomb Room role "${role}" has no team assigned`);
    }
    return { room: bombRoomName(sessionId, teamId), canPublish: true, canSubscribe: true };
  }

  // Defensive: PlayerRole is a closed union, so this is unreachable today, but a
  // future role must opt into a scope explicitly rather than default-publish.
  throw new VoiceScopeError(`role "${role}" has no voice scope`);
}
