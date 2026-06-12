import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import Button from './Button.js';
import { buildShareLink } from './shareLink.js';
import { BRING_THEM_IN, SHARE_SUB, COPY_LINK, COPIED } from './copy.js';

/**
 * Lobby (operator world): the share panel — join code, shareable link,
 * "Bring them in" copy affordance. Renders purely from the last SESSION_STATE
 * snapshot in gameStore. Roster / ready state / team assignment are
 * Stories 2.3–2.5 and are intentionally absent.
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
    <div className="flex flex-1 items-center justify-center p-8">
      <section className="w-full max-w-lg rounded-lg bg-surface-raised p-8">
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
