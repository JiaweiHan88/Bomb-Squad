import type { TeamId } from './session.js';

/**
 * Per-round state, stored at `session:{sessionId}:round:{n}` (architecture
 * Redis keyspace). Created by ROUND_START (Story 8.3).
 *
 * - `status` is `'active'` only for now; round resolution (Story 8.5) widens
 *   it (defused / exploded / time-expired outcomes).
 * - `defusers` records the committed Defuser per team for this round —
 *   `Partial` because a team exists iff someone is on it (mirrors
 *   `SessionState.teams`). Values are roster keys (`PlayerInfo.playerId`).
 * - `retry` is always `false` here; Story 8.8 (retry a failed round) owns it.
 */
export interface RoundState {
  roundNumber: number;
  status: 'active';
  defusers: Partial<Record<TeamId, string>>;
  retry: boolean;
}
