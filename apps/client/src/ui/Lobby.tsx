import { useEffect, useRef, useState } from 'react';
import type { PlayerInfo } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import Button from './Button.js';
import { buildShareLink } from './shareLink.js';
import {
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
} from './copy.js';

const ROLE_LABELS: Record<PlayerInfo['role'], string> = {
  facilitator: ROLE_FACILITATOR,
  defuser: ROLE_DEFUSER,
  expert: ROLE_EXPERT,
  spectator: ROLE_SPECTATOR,
};

/** Facilitator first, then by name — a stable order across roster broadcasts. */
function sortRoster(players: Record<string, PlayerInfo>): PlayerInfo[] {
  return Object.values(players).sort((a, b) => {
    if (a.role === 'facilitator' && b.role !== 'facilitator') return -1;
    if (b.role === 'facilitator' && a.role !== 'facilitator') return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Lobby (operator world): roster (name + role + "You") and the share panel —
 * join code, shareable link, "Bring them in" copy affordance. Renders purely
 * from the last SESSION_STATE snapshot in gameStore; every join re-broadcasts
 * it, so the roster updates in real time for free. Team assignment is
 * Story 2.4; ready state, mic check, and the empty-state message are
 * Story 2.5 — intentionally absent.
 */
export default function Lobby() {
  const session = useGameStore((s) => s.session);
  // Presentation state only — never Zustand (2.1 rule).
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "Copied" flip-back timer on unmount so we never setState after unmount.
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  if (session === null) return null;

  const link = buildShareLink(window.location.origin, session.joinCode);
  const selfId = getSocket().id;
  const roster = sortRoster(session.players);

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
              <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                {ROLE_LABELS[player.role]}
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
      </section>
    </div>
  );
}
