import { useEffect, useRef, useState } from 'react';
import type { ErrorPayload, PlayerInfo, PlayerRole, TeamId } from '@bomb-squad/shared';
import { undersizedTeams } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { useVoiceStore } from '../store/voiceStore.js';
import { getSocket } from '../net/socket.js';
import Button from './Button.js';
import ConfirmButton from './ConfirmButton.js';
import LobbyMicCheck from './LobbyMicCheck.js';
import RoundConfigPanel from './RoundConfigPanel.js';
import { buildShareLink } from './shareLink.js';
import {
  OPEN_PREPARATION,
  PREP_NEEDS_TEAM,
  PREP_TEAM_TOO_SMALL,
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
  REMOVE_PLAYER,
  REMOVE_CONFIRM,
  READY,
  MARK_READY,
  READY_INDICATOR,
  WAITING_FOR_TEAM,
  SPEAKING,
  MIC_QUIET,
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
  // PLAYER_REMOVE rejections (Story 2.7) — facilitator-only control on this surface.
  'INVALID_REMOVAL',
  'PLAYER_REMOVE_FAILED',
  // PLAYER_READY rejection (Story 2.5) — the self-toggle shares this banner.
  'PLAYER_READY_FAILED',
  // ROUND_CONFIGURE rejections (Story 8.1) — the round-config panel emits from
  // this surface (NOT_FACILITATOR / INVALID_PAYLOAD / NOT_IN_SESSION already listed).
  'NOT_IN_CONFIGURABLE_PHASE',
  'ROUND_CONFIGURE_FAILED',
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
 * effect arrives via the room broadcast; no optimistic flips.
 *
 * Story 2.5 adds the last lobby pieces: a self-toggle Ready control + per-row
 * ready indicators (PLAYER_READY → SESSION_STATE; informational, no start gate),
 * per-row speaker dots driven by `voiceStore.activeSpeakers` (the LobbyMicCheck
 * affordance joins the shared lobby voice room), and the single-player empty
 * state. Ready/indicators/dots derive purely from snapshots — no optimistic flips.
 */
export default function Lobby() {
  const session = useGameStore((s) => s.session);
  // Reactive self-id (Story 2.7) — updates the moment SESSION_IDENTITY lands, so
  // the "You" tag appears on first join, not only after a refresh.
  const selfId = useGameStore((s) => s.myPlayerId);
  // Speaker presence (Story 2.5) — reactive so a dot lights/clears live. Empty
  // until this client joins the mic check (you can't see speakers in a room you
  // haven't joined); voice-only, never game-authoritative.
  const activeSpeakers = useVoiceStore((s) => s.activeSpeakers);
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
  const isFacilitator = selfId !== null && session.players[selfId]?.role === 'facilitator';
  const roster = sortRoster(session.players);

  // Prep can only open once someone can defuse — at least one team must hold a
  // rostered player. Mirrors the server's hasPopulatedTeam guard so the button
  // disables before the emit ever fails (the server stays the authority).
  const hasPopulatedTeam = Object.values(session.teams).some((team) =>
    team.relayOrder.some((id) => session.players[id] !== undefined),
  );
  // Min-team-size gate (Story 8.9 follow-up): a populated team of 1 can't play (a
  // lone Defuser with no Expert). Uses the SAME shared predicate the server gates
  // on. A single-team session is allowed if its one team has ≥2.
  const tooSmallTeams = undersizedTeams(session);
  const canOpenPrep = hasPopulatedTeam && tooSmallTeams.length === 0;

  // Clear any stale rejection on the facilitator's own next action — not on
  // room broadcasts, which fire for any participant's activity (a join would
  // otherwise wipe an unread rejection). A failed assign re-sets it; a silent
  // idempotent no-op leaves a clean slate either way.
  const assign = (playerId: string, teamId: TeamId, role: PlayerRole) => {
    setAssignError(null);
    getSocket().emit('TEAM_ASSIGN', { playerId, teamId, role });
  };

  // Story 2.7: the facilitator removes a player (server re-broadcasts the roster;
  // the removed client receives SESSION_REMOVED and drops to Landing). The
  // secondary confirm is the ConfirmButton's two-step affordance.
  const remove = (playerId: string) => {
    setAssignError(null);
    getSocket().emit('PLAYER_REMOVE', { playerId });
  };

  // Story 2.5: a player toggles their OWN ready (no playerId on the wire — the
  // server resolves the caller). Server-truth-driven: the button's label and
  // aria-pressed derive from the snapshot, never an optimistic flip.
  const toggleReady = (currentIsReady: boolean) => {
    setAssignError(null);
    getSocket().emit('PLAYER_READY', { isReady: !currentIsReady });
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
    <div className="flex flex-1 flex-wrap items-start justify-center gap-6 p-8">
      {/* Facilitator round-setup (Story 8.1) — self-gated; renders null for
          non-facilitators and once a round is running. */}
      <RoundConfigPanel />
      <section className="w-full max-w-xl rounded-lg bg-surface-raised p-8">
        <h2 className="mb-4 font-display text-lg font-semibold">{TEAM_ROSTER}</h2>
        {assignError !== null && (
          <p role="alert" className="mb-3 text-sm text-led-red">
            {assignError}
          </p>
        )}
        {roster.length <= 1 ? (
          // Empty state (AC 3): the viewer is alone. Show the message in place of
          // a lonely one-row roster; the share panel stays so they can invite the
          // team. Count the roster (not "players minus me") — a solo facilitator
          // and a solo joiner both see it. (EXPERIENCE.md §Empty states.) `<= 1`
          // (not `=== 1`) so an unexpected empty-players snapshot can't fall
          // through to a blank roster `<ul>` with no message.
          <p className="rounded-md bg-surface px-4 py-6 text-center text-sm text-ink-muted">
            {WAITING_FOR_TEAM}
          </p>
        ) : (
        <ul className="flex flex-col gap-3" data-testid="roster">
          {roster.map((player) => (
            <li
              key={player.playerId}
              className="flex items-center justify-between gap-4 rounded-md bg-surface px-4 py-3"
            >
              <span className="flex items-center gap-2.5 font-semibold">
                {/* Speaker dot (AC 2): green when this player is transmitting in
                    the mic check, gray otherwise. Name is ALWAYS shown beside it
                    (colorblind floor — never icon-only). Green is the lobby's only
                    sanctioned LED use ("audible"); under reduced motion it's a
                    solid green with no pulse (motion-safe gates the pulse). */}
                {(() => {
                  const isSpeaking = activeSpeakers.includes(player.playerId);
                  return (
                    <span
                      aria-label={`${player.displayName} ${isSpeaking ? SPEAKING : MIC_QUIET}`}
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        isSpeaking ? 'bg-speaker-active motion-safe:animate-pulse' : 'bg-ink-muted/40'
                      }`}
                    />
                  );
                })()}
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
                    {/* Remove (Story 2.7): two-step confirm; server re-validates
                        facilitator authority + rejects self-removal. */}
                    <span aria-label={`Remove ${player.displayName}`}>
                      <ConfirmButton
                        label={REMOVE_PLAYER}
                        confirmLabel={REMOVE_CONFIRM}
                        onConfirm={() => remove(player.playerId)}
                      />
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                    {ROLE_LABELS[player.role]}
                  </span>
                )}
                {/* Ready (AC 1). On the viewer's OWN row: a self-toggle whose
                    label + aria-pressed derive from the snapshot (server-truth,
                    no optimistic flip). On every other row: a read-only indicator
                    when ready. Neutral ink, never LED green/red (those are
                    reserved; the speaker dot is the only green here). */}
                {player.playerId === selfId ? (
                  <button
                    type="button"
                    aria-pressed={player.isReady}
                    onClick={() => toggleReady(player.isReady)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                      player.isReady
                        ? 'border-brass text-ink-primary'
                        : 'border-ink-muted text-ink-muted hover:text-ink-primary'
                    }`}
                  >
                    {player.isReady ? READY : MARK_READY}
                  </button>
                ) : (
                  player.isReady && (
                    <span className="rounded-md border border-ink-muted px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                      {READY_INDICATOR}
                    </span>
                  )
                )}
              </span>
            </li>
          ))}
        </ul>
        )}
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

        {/* Mic check (Story 2.5): a gesture-driven join into the shared lobby
            voice room. Non-blocking — a voice failure never gates the lobby.
            Hidden while the viewer is alone (`roster.length <= 1`): a solo player
            has no one to check against and would see no dot, so the affordance
            only appears once a second player arrives (review decision 2026-06-15). */}
        {roster.length > 1 && <LobbyMicCheck />}

        {isFacilitator && (
          // Two-step confirm: opening prep moves every player off the lobby —
          // major phase change, same affordance grammar as other commits.
          <div className="mt-6 flex flex-col items-end gap-2">
            {!canOpenPrep && (
              <p className="text-sm text-ink-muted">
                {hasPopulatedTeam && tooSmallTeams.length > 0 ? PREP_TEAM_TOO_SMALL : PREP_NEEDS_TEAM}
              </p>
            )}
            <ConfirmButton
              label={OPEN_PREPARATION}
              onConfirm={openPreparation}
              disabled={!canOpenPrep}
            />
          </div>
        )}
      </section>
    </div>
  );
}
