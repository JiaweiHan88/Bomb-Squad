import type { TeamId } from './session.js';

/**
 * Terminal outcome of a resolved round (Story 8.5). The three failure/success
 * results a round can reach once it leaves `'active'`:
 * - `'defused'`    — every armed module solved (BombState.solved false→true).
 * - `'exploded'`   — the 3rd strike (BombState.strikes reached 3).
 * - `'time-expired'` — the server-authoritative timer hit 0.
 *
 * Co-located here so server + client name outcomes without re-deriving them.
 */
export type RoundOutcome = 'defused' | 'exploded' | 'time-expired';

/**
 * Per-round state, stored at `session:{sessionId}:round:{n}` (architecture
 * Redis keyspace). Created by ROUND_START (Story 8.3).
 *
 * - `status` is `'active'` while the round runs; round resolution (Story 8.5)
 *   transitions it to a `RoundOutcome` once any team resolves. NOTE: a single
 *   `RoundState` is shared by both racing teams, so this round-level field is
 *   last-writer-wins across teams — it is NOT the per-team idempotency fence
 *   (that is each team's live timer key; see `resolveRound`). The authoritative
 *   per-team result is conveyed by `outcomes` (below) + which event fired
 *   (BOMB_DEFUSED vs BOMB_EXPLODED) + that team's `cumulativeTimeMs`, matching
 *   the `ScoreboardPayload` contract.
 * - `outcomes` records the per-team terminal result (Story 8.8). Set by
 *   `resolveRound` as each team resolves; the authoritative per-team outcome the
 *   round-level last-writer-wins `status` cannot express. The `ROUND_RETRY`
 *   handler reads it to gate retry to FAILED rounds only (a team is retryable iff
 *   `outcomes[teamId]` is `'exploded'`/`'time-expired'`). `Partial` because a
 *   team is present iff it resolved. (This widens the prior "future per-team
 *   round-outcome model" note.)
 * - `defusers` records the committed Defuser per team for this round —
 *   `Partial` because a team exists iff someone is on it (mirrors
 *   `SessionState.teams`). Values are roster keys (`PlayerInfo.playerId`).
 * - `retry` is `false` on a first attempt and `true` on a re-attempt round
 *   (Story 8.8). `resolveRound` reads it to record the BETTER of the two times
 *   in place (replace `roundTimesMs[roundNumber-1]`) instead of appending a
 *   second entry for the same round.
 */
export interface RoundState {
  roundNumber: number;
  status: 'active' | RoundOutcome;
  defusers: Partial<Record<TeamId, string>>;
  outcomes: Partial<Record<TeamId, RoundOutcome>>;
  retry: boolean;
}
