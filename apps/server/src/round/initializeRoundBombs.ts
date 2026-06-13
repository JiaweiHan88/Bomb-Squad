import {
  generateRoundBombs,
  type BombState,
  type RoundConfig,
  type TeamId,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { bombKey } from '../state/keys.js';

/**
 * Generate every team's bomb for a round and persist each under its per-team
 * bomb key (`session:{id}:team:{teamId}:bomb`), returning the bombs for the
 * caller to broadcast.
 *
 * This is the server-side I/O wrapper around the pure shared generator
 * (`generateRoundBombs`): all generation happens FIRST (one synchronous pass),
 * then writes. Because generation throws on a bad config (unregistered/empty
 * pool, out-of-range moduleCount) before any write runs, a bad round never
 * leaves a partially-written set of team bombs.
 *
 * No socket emission here. The BOMB_INIT / SESSION_STATE broadcast belongs to
 * the ROUND_START handler (Story 8.3), which owns the seam:
 *   `// Story 8.2: bomb generation slots in here, before status flip`
 * Story 8.3 edits `sessionHandlers.ts` in a parallel worktree; whichever story
 * merges second wires this single awaited call into that seam — neither story
 * edits the other's files.
 */
export async function initializeRoundBombs(
  store: RedisStore,
  sessionId: string,
  roundNumber: number,
  config: RoundConfig,
  teamIds: readonly TeamId[],
): Promise<Record<TeamId, BombState>> {
  // Generate ALL teams before the first write — a generation failure must reject
  // without having persisted any team's bomb (no partial round state).
  const bombs = generateRoundBombs(sessionId, roundNumber, config, teamIds);
  for (const teamId of teamIds) {
    await store.setJSON(bombKey(sessionId, teamId), bombs[teamId]);
  }
  return bombs;
}
