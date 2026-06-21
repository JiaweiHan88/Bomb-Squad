import type { PlayerInfo, SessionState, TeamId } from '@bomb-squad/shared';

/**
 * Pure pause/resume reducers (Story 8.7, FR13). No I/O, no clock, no randomness —
 * same discipline as `openPreparation`/`cancelPreparation`. The session-level
 * freeze is ORTHOGONAL to `status`: pausing sets `pausedAt`/`pauseKind` without
 * touching `status`/`roundNumber`/`teams`, so `resumeSession` returns the session
 * to the exact phase it paused from (the per-team countdown freeze is the Task-4
 * timer effect, which the handler runs alongside these for an `active` round).
 *
 * An "active participant" is a player on the team CURRENTLY PLAYING the round
 * (`teamId === activeTeamId`). Under Model B (Story 8.11) only one team plays a
 * given round; the Facilitator, unassigned spectators, AND the resting team are
 * excluded from the disconnect-pause ready gate and never freeze the live round.
 * (When `activeTeamId` is unset — defensive — any on-a-team player counts.)
 */

export interface PauseArgs {
  /**
   * `'facilitator'` — a manual between-rounds hold (resume is a free Facilitator
   * click). `'disconnect'` — a mid-round participant dropped (resume requires the
   * Facilitator PLUS all participants ready, so this resets every participant's
   * `isReady`).
   */
  kind: 'facilitator' | 'disconnect';
  /** Server-epoch ms the pause begins (injected — never `Date.now()`). */
  now: number;
  /** The durable player id that dropped (disconnect kind only). */
  droppedPlayerId?: string;
}

/**
 * Whether a player counts toward the disconnect-pause ready gate: on the team
 * currently playing (`teamId === activeTeamId`). A resting-team player, the
 * Facilitator, and spectators do NOT count. When `activeTeamId` is undefined
 * (defensive — no active team) any on-a-team player counts.
 */
function isActiveParticipant(player: PlayerInfo, activeTeamId: TeamId | undefined): boolean {
  if (player.teamId === undefined) return false;
  return activeTeamId === undefined || player.teamId === activeTeamId;
}

/** Reset every active participant's `isReady` to false; same ref if none changed. */
function resetParticipantsReady(
  players: Record<string, PlayerInfo>,
  activeTeamId: TeamId | undefined,
): Record<string, PlayerInfo> {
  let changed = false;
  const next: Record<string, PlayerInfo> = {};
  for (const [id, player] of Object.entries(players)) {
    if (isActiveParticipant(player, activeTeamId) && player.isReady) {
      next[id] = { ...player, isReady: false };
      changed = true;
    } else {
      next[id] = player;
    }
  }
  return changed ? next : players;
}

/**
 * Freeze the session (Story 8.7). Facilitator pause is idempotent (already-paused
 * returns same ref). Disconnect pause records the dropped player (deduped) and
 * resets every participant's `isReady` so the all-ready resume gate starts fresh;
 * the original freeze instant is preserved if the session was already paused (a
 * second drop must not re-stamp the clock).
 */
export function pauseSession(state: SessionState, args: PauseArgs): SessionState {
  if (args.kind === 'facilitator') {
    if (state.pausedAt !== null) return state; // idempotent
    return { ...state, pausedAt: args.now, pauseKind: 'facilitator' };
  }

  // disconnect
  const already = state.disconnectedPlayerIds;
  const nextDropped =
    args.droppedPlayerId !== undefined && !already.includes(args.droppedPlayerId)
      ? [...already, args.droppedPlayerId]
      : already;
  const players = resetParticipantsReady(state.players, state.activeTeamId);

  // No-op only if already a disconnect-pause AND nothing changed.
  if (
    state.pausedAt !== null &&
    state.pauseKind === 'disconnect' &&
    nextDropped === already &&
    players === state.players
  ) {
    return state;
  }

  return {
    ...state,
    pausedAt: state.pausedAt ?? args.now, // keep the original freeze instant
    pauseKind: 'disconnect',
    disconnectedPlayerIds: nextDropped,
    players,
  };
}

/**
 * Resume the session (Story 8.7): clear all pause fields. Idempotent (a running
 * session returns same ref). Leaves `status`/`roundNumber`/`teams`/`players`
 * otherwise untouched — the session resumes into the exact phase it paused from.
 * The per-team timer re-arm (which needs `now`) is the Task-4 handler effect.
 */
export function resumeSession(state: SessionState): SessionState {
  if (state.pausedAt === null) return state;
  return { ...state, pausedAt: null, pauseKind: null, disconnectedPlayerIds: [] };
}

/**
 * Whether the session may resume right now (Story 8.7 AC-1/AC-2 gate). A
 * Facilitator-kind pause is always resumable (the handler authority-gates the
 * Facilitator). A disconnect-kind pause requires EVERY active participant (the
 * team currently playing) ready — a resting-team drop does not block resume.
 */
export function canResume(state: SessionState): boolean {
  if (state.pauseKind !== 'disconnect') return true;
  return Object.values(state.players).every(
    (p) => !isActiveParticipant(p, state.activeTeamId) || p.isReady,
  );
}

/** Remove a reconnected player from the dropped list (same ref if absent). */
export function clearDisconnectedPlayer(state: SessionState, playerId: string): SessionState {
  if (!state.disconnectedPlayerIds.includes(playerId)) return state;
  return {
    ...state,
    disconnectedPlayerIds: state.disconnectedPlayerIds.filter((id) => id !== playerId),
  };
}
