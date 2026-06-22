import type { PlayerInfo, SessionState } from '@bomb-squad/shared';
import { resolveVoiceScope, VoiceScopeError } from '@bomb-squad/shared';
import type { VoiceStatus } from '../store/voiceStore.js';

/**
 * Pure decision logic for the re-mint-on-role-change reconciler (Story 3.5).
 *
 * The server is already correct and stateless: every `VOICE_TOKEN` request mints
 * a fresh token for the player's CURRENT authoritative role, and the client never
 * caches tokens. The only gap is client REACTION — nothing tears down and
 * reconnects when the player's effective voice scope changes mid-session (a
 * connected Bomb Room player reassigned to Spectator keeps the old publishing
 * connection while the UI merely relabels — the bug this story fixes).
 *
 * Kept pure (no store/hook/LiveKit imports beyond the shared scope helper) so the
 * full AC matrix is unit-testable with plain data.
 */

/** The local player's desired voice scope, derived from authoritative state. */
export interface DesiredVoiceScope {
  room: string;
  /** Mirrors the shared `canPublish` → the client's connect `publish` flag. */
  publish: boolean;
}

/** The voice connection as the store currently reflects it. */
export interface VoiceConnectionView {
  status: VoiceStatus;
  /** The connected LiveKit room (set on `connected`); undefined otherwise. */
  room?: string;
  /** Whether the current connection published the mic. */
  publishing: boolean;
}

export type VoiceAction =
  | { type: 'none' }
  | { type: 'reconnect'; publish: boolean };

const NONE: VoiceAction = { type: 'none' };

/**
 * Derive the local player's desired voice scope from authoritative session
 * state, or `null` when no re-mint-managed scope applies.
 *
 * Scoped DELIBERATELY to the two roles this client's voice UI manages — a Bomb
 * Room participant (defuser/expert with a team) and a Spectator — which is the
 * Bomb-Room↔Lounge boundary the facilitator's `TEAM_ASSIGN` crosses today (the
 * core observable trigger). Other roles (facilitator, un-teamed) resolve to
 * `null` → no auto re-mint; their voice is owned by later stories. The active↔
 * resting Lounge routing for the relay (which keeps Bomb Room roles but rests a
 * team) arrives with Story 3.7 — it changes what scope the server assigns, and
 * this mechanism re-mints for it "for free" once it does.
 */
export function deriveDesiredScope(
  self: PlayerInfo | undefined,
  status: SessionState['status'] | undefined,
  sessionId: string | undefined,
): DesiredVoiceScope | null {
  if (self === undefined || sessionId === undefined) return null;
  const isBombRoomParticipant =
    (self.role === 'defuser' || self.role === 'expert') && self.teamId !== undefined;
  const isSpectator = self.role === 'spectator';
  if (!isBombRoomParticipant && !isSpectator) return null;

  try {
    const scope = resolveVoiceScope({
      role: self.role,
      sessionId,
      teamId: self.teamId,
      phase: status,
    });
    return { room: scope.room, publish: scope.canPublish };
  } catch (err) {
    // A teamless Bomb Room role outside the lobby throws VoiceScopeError — there
    // is no resolvable scope to re-mint to, so leave the connection as-is.
    if (err instanceof VoiceScopeError) return null;
    throw err;
  }
}

/**
 * Decide whether to re-mint the voice connection given the current connection
 * and the desired scope. Re-mint (disconnect → fresh connect) ONLY when:
 *
 * - The user has already opted in — status is `connected` (AC #5: never
 *   auto-connect from `idle`; the first connect still needs the gesture). We do
 *   NOT act while `connecting`: the room isn't known yet, so we cannot compare —
 *   the in-flight connect lands first, then the next `connected` evaluation
 *   reconciles to the latest desired scope (collapsing rapid SESSION_STATE bursts
 *   to the newest target, not each intermediate one).
 * - A desired scope resolves (a re-mint-managed role with a valid scope).
 * - The desired `{ room, publish }` actually DIFFERS from the connected one.
 *   Comparing the full tuple is what makes Defuser↔Expert on the same team a
 *   no-op (identical room + publish ⇒ no audio drop — AC #3) while Spectator↔
 *   Facilitator in the shared lounge (same room, different publish) still
 *   re-mints.
 *
 * `unavailable` is intentionally NOT auto-reconnected here: a post-drop reconnect
 * is the user-driven "Reconnect voice" affordance (Story 3.6), which already
 * connects in the player's live role mode (so it lands in the new scope anyway).
 */
export function computeVoiceAction(
  conn: VoiceConnectionView,
  desired: DesiredVoiceScope | null,
): VoiceAction {
  if (conn.status !== 'connected') return NONE;
  if (desired === null) return NONE;
  if (conn.room === desired.room && conn.publishing === desired.publish) return NONE;
  return { type: 'reconnect', publish: desired.publish };
}
