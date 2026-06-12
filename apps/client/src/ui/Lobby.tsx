import { useEffect, useRef, useState } from 'react';
import type { ErrorPayload, PlayerInfo, PlayerRole, TeamId } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import Button from './Button.js';
import ConfirmButton from './ConfirmButton.js';
import { buildShareLink } from './shareLink.js';
import {
  OPEN_PREPARATION,
  BRING_THEM_IN,
  SHARE_SUB,
  COPY_LINK,
  COPIED,
  TEAM_ROSTER,
  YOU_TAG,
  ROLE_FACILITATOR,
  ROLE_DEFUSER,
  ROLE_EXPERT,
  ROLE_SPECTATOR,
  TEAM_A,
  TEAM_B,
  UNASSIGNED,
} from './copy.js';

const ROLE_LABELS: Record<PlayerInfo['role'], string> = {
  facilitator: ROLE_FACILITATOR,
  defuser: ROLE_DEFUSER,
  expert: ROLE_EXPERT,
  spectator: ROLE_SPECTATOR,
};

const TEAM_LABELS: Record<TeamId, string> = { A: TEAM_A, B: TEAM_B };

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

/** Roles a facilitator may assign — the facilitator seat itself is mint-only. */
const ASSIGNABLE_ROLES: readonly PlayerRole[] = ['defuser', 'expert', 'spectator'];

/**
 * Error codes the assignment surface owns. The lobby socket can in principle
 * receive an ERROR from any future flow; the inline banner must only reflect
 * TEAM_ASSIGN rejections, never an unrelated code.
 */
const ASSIGN_ERROR_CODES: ReadonlySet<string> = new Set([
  'INVALID_PAYLOAD',
  'NOT_IN_SESSION',
  'NOT_FACILITATOR',
  'PLAYER_NOT_FOUND',
  'INVALID_ASSIGNMENT',
  'NOT_IN_LOBBY',
  'TEAM_ASSIGN_FAILED',
  // PREPARATION_OPEN rejections (Story 8.3) — emitted from this surface, so
  // its error banner owns them too.
  'CANNOT_OPEN_PREP',
  'PREPARATION_OPEN_FAILED',
]);

/** Facilitator first, then by name — a stable order across roster broadcasts. */
function sortRoster(players: Record<string, PlayerInfo>): PlayerInfo[] {
  return Object.values(players).sort((a, b) => {
    if (a.role === 'facilitator' && b.role !== 'facilitator') return -1;
    if (b.role === 'facilitator' && a.role !== 'facilitator') return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Lobby (operator world): roster (name + team + role + "You") and the share
 * panel — join code, shareable link, "Bring them in" copy affordance. Renders
 * purely from the last SESSION_STATE snapshot in gameStore; every join and
 * assignment re-broadcasts it, so the roster updates in real time for free.
 *
 * Facilitators additionally get per-row assignment controls (Story 2.4):
 * Team A/B toggle chips and a role select that emit TEAM_ASSIGN. Controls are
 * server-truth-driven — their state derives from the snapshot and the emit's
 * effect arrives via the room broadcast; no optimistic flips. Ready state,
 * mic check, and the empty-state message are Story 2.5 — intentionally absent.
 */
export default function Lobby() {
  const session = useGameStore((s) => s.session);
  // Presentation state only — never Zustand (2.1 rule).
  const [copied, setCopied] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "Copied" flip-back timer on unmount so we never setState after unmount.
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Server rejections (TEAM_ASSIGN has no ack): surface the typed ERROR's
  // human-readable message inline. Landing's listener is unmounted by now —
  // this is the lobby's own error surface. Only assignment-class codes paint
  // the banner; an unrelated ERROR to this socket must not show up here.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: ErrorPayload) => {
      if (ASSIGN_ERROR_CODES.has(payload.code)) setAssignError(payload.message);
    };
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
    };
  }, []);

  if (session === null) return null;

  const link = buildShareLink(window.location.origin, session.joinCode);
  const selfId = getSocket().id;
  const isFacilitator = selfId !== undefined && session.players[selfId]?.role === 'facilitator';
  const roster = sortRoster(session.players);

  // Clear any stale rejection on the facilitator's own next action — not on
  // room broadcasts, which fire for any participant's activity (a join would
  // otherwise wipe an unread rejection). A failed assign re-sets it; a silent
  // idempotent no-op leaves a clean slate either way.
  const assign = (playerId: string, teamId: TeamId, role: PlayerRole) => {
    setAssignError(null);
    getSocket().emit('TEAM_ASSIGN', { playerId, teamId, role });
  };

  // Story 8.3: the facilitator ends the lobby by opening preparation. Server
  // truth drives the surface change — the SESSION_STATE broadcast flips
  // status to 'preparation' and App.tsx swaps Lobby out; no optimistic flip.
  const openPreparation = () => {
    setAssignError(null);
    getSocket().emit('PREPARATION_OPEN');
  };

  const copyLink = async () => {
    try {
      // Clipboard API requires a secure context (localhost + the Caddy HTTPS
      // deployment both qualify); the catch keeps odd contexts from throwing.
      await navigator.clipboard.writeText(link);
      setCopied(true);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Copy unavailable — the code and link stay visible for manual selection.
    }
  };

  return (
    <div className="flex flex-1 items-start justify-center gap-6 p-8">
      <section className="w-full max-w-xl rounded-lg bg-surface-raised p-8">
        <h2 className="mb-4 font-display text-lg font-semibold">{TEAM_ROSTER}</h2>
        {assignError !== null && (
          <p role="alert" className="mb-3 text-sm text-led-red">
            {assignError}
          </p>
        )}
        <ul className="flex flex-col gap-3" data-testid="roster">
          {roster.map((player) => (
            <li
              key={player.playerId}
              className="flex items-center justify-between gap-4 rounded-md bg-surface px-4 py-3"
            >
              <span className="flex items-center gap-2.5 font-semibold">
                {player.displayName}
                {player.playerId === selfId && (
                  // speaker-self cool blue is reserved for "this is you" — identity,
                  // exactly its sanctioned use (DESIGN.md color reservations).
                  <span className="font-mono text-xs font-medium uppercase tracking-widest text-speaker-self">
                    {YOU_TAG}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2.5">
                {player.role !== 'facilitator' && (
                  // Team badge for every view — neutral ink only (LED colors are
                  // reserved semantics; speaker-self is identity-only).
                  <span className="rounded-full border border-ink-muted px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                    {player.teamId !== undefined ? TEAM_LABELS[player.teamId] : UNASSIGNED}
                  </span>
                )}
                {isFacilitator && player.role !== 'facilitator' ? (
                  <>
                    <span
                      className="flex gap-1"
                      role="group"
                      aria-label={`Assign ${player.displayName} to a team`}
                    >
                      {TEAM_IDS.map((teamId) => (
                        <button
                          key={teamId}
                          type="button"
                          aria-pressed={player.teamId === teamId}
                          onClick={() => assign(player.playerId, teamId, player.role)}
                          className={`h-7 w-7 cursor-pointer rounded-md border-2 text-xs font-semibold transition-colors ${
                            player.teamId === teamId
                              ? 'border-brass text-ink-primary'
                              : 'border-ink-muted text-ink-muted hover:text-ink-primary'
                          }`}
                        >
                          {teamId}
                        </button>
                      ))}
                    </span>
                    {/* Role changes need a team on the wire (TeamAssignPayload.teamId
                        is required) — mockup 6 likewise has no role select in the
                        unassigned pool, so it stays disabled until a team is set. */}
                    <select
                      value={player.role}
                      disabled={player.teamId === undefined}
                      aria-label={`Role for ${player.displayName}`}
                      onChange={(event) => {
                        if (player.teamId !== undefined) {
                          assign(player.playerId, player.teamId, event.target.value as PlayerRole);
                        }
                      }}
                      className="cursor-pointer rounded-md border border-ink-muted bg-surface px-2 py-1 text-sm text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {ASSIGNABLE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                    {ROLE_LABELS[player.role]}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-full max-w-md rounded-lg bg-surface-raised p-8">
        <h2 className="mb-1 font-display text-lg font-semibold">{BRING_THEM_IN}</h2>
        <p className="mb-6 text-sm text-ink-muted">{SHARE_SUB}</p>

        <p className="mb-6 text-center font-mono text-2xl tracking-[0.3em]" data-testid="join-code">
          {session.joinCode}
        </p>

        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate rounded-md border-2 border-ink-muted px-3 py-2.5 font-mono text-sm text-ink-muted">
            {link}
          </span>
          <Button onClick={() => void copyLink()}>{copied ? COPIED : COPY_LINK}</Button>
        </div>

        {isFacilitator && (
          // Two-step confirm: opening prep moves every player off the lobby —
          // major phase change, same affordance grammar as other commits.
          <div className="mt-6 flex justify-end">
            <ConfirmButton label={OPEN_PREPARATION} onConfirm={openPreparation} />
          </div>
        )}
      </section>
    </div>
  );
}
