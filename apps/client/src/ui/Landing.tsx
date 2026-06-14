import { useEffect, useRef, useState } from 'react';
import type { PlayerRole } from '@bomb-squad/shared';
import { getSocket } from '../net/socket.js';
import { useGameStore } from '../store/gameStore.js';
import Button from './Button.js';
import {
  CODE_LENGTH,
  EMPTY_CELLS,
  applyBackspaceAt,
  applyCharAt,
  applyPasteAt,
  isCodeComplete,
  isJoinReady,
  sanitizeCode,
} from './joinCode.js';
import {
  HOST_A_SESSION,
  HOST_PITCH,
  HOST_BUSY,
  HOST_FAILED,
  ENTER_A_JOIN_CODE,
  JOIN_HELP,
  JOIN_HELP_EMPHASIS,
  YOUR_NAME,
  ROLE_DEFUSER,
  ROLE_EXPERT,
  ROLE_SPECTATOR,
  JOIN_INCOMPLETE,
  JOIN_BUSY,
  JOIN_TIMEOUT,
  JOIN_NOW,
  OR_DIVIDER,
} from './copy.js';

/** Joinable seats only — the facilitator seat is minted by SESSION_CREATE. */
const ROLE_OPTIONS: { role: PlayerRole; label: string }[] = [
  { role: 'defuser', label: ROLE_DEFUSER },
  { role: 'expert', label: ROLE_EXPERT },
  { role: 'spectator', label: ROLE_SPECTATOR },
];

/**
 * Landing surface (operator world): join-by-code on top (name, role, 6 mono
 * cells — submits on the 6th character, no Join button), "or", host below.
 *
 * SESSION_JOIN has no ack (frozen contract): success is the SESSION_STATE
 * broadcast that mounts Lobby (unmounting this component); failure is a typed
 * ERROR surfaced inline. SESSION_CREATE's ack is only a success/failure
 * receipt — the lobby renders from gameStore either way (client is render-only).
 */
export default function Landing() {
  // Presentation state only — never Zustand (2.1 rule).
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [cells, setCells] = useState<string[]>([...EMPTY_CELLS]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<PlayerRole | null>(null);
  // Tracks an in-flight attempt (host OR join — one at a time) so a failure
  // resolves exactly once: whichever of ack-timeout / join-timeout / ERROR
  // arrives first settles it, the later is ignored, and an unrelated ERROR
  // (nothing pending) is not surfaced here.
  const pending = useRef(false);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const cellRefs = useRef<(HTMLInputElement | null)[]>([]);

  const clearJoinTimer = () => {
    if (joinTimer.current !== null) {
      clearTimeout(joinTimer.current);
      joinTimer.current = null;
    }
  };

  const settleFailure = (message: string) => {
    if (!pending.current) return;
    pending.current = false;
    clearJoinTimer();
    setCreating(false);
    setJoining(false);
    setError(message);
  };

  // Server-side rejections (INVALID_PAYLOAD / SESSION_NOT_FOUND / SESSION_FULL /
  // SESSION_NOT_JOINABLE / *_FAILED) arrive as ERROR events — the server's
  // message is already human-readable and deadpan, so render it directly.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: { message: string }) => settleFailure(payload.message);
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
      clearJoinTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?join= prefill — the consumer half of Lobby's buildShareLink contract.
  // Never auto-submits: name and role gate the emit naturally.
  useEffect(() => {
    const prefill = sanitizeCode(
      new URLSearchParams(window.location.search).get('join') ?? '',
    ).slice(0, CODE_LENGTH);
    if (prefill !== '') {
      setCells(applyPasteAt(EMPTY_CELLS, 0, prefill).cells);
      nameRef.current?.focus();
    }
  }, []);

  // Story 2.7: a facilitator-removed client lands back here carrying a notice in
  // the store (it survived the remount that ERROR-local state could not). Show
  // it once, then acknowledge so it can't re-appear on the next mount.
  useEffect(() => {
    const { removalNotice, clearRemovalNotice } = useGameStore.getState();
    if (removalNotice !== null) {
      setError(removalNotice);
      clearRemovalNotice();
    }
  }, []);

  const busy = creating || joining;

  /**
   * The single submit path (AC: submits on the 6th character — no Join button).
   * Fires only from user-event handlers, never reactively from state changes,
   * so a role click can never surprise-submit.
   */
  const tryJoin = (cellsNow: readonly string[], nameNow: string, roleNow: PlayerRole | null) => {
    if (pending.current || busy) return;
    if (!isCodeComplete(cellsNow)) return;
    if (!isJoinReady(cellsNow, nameNow, roleNow)) {
      setHint(JOIN_INCOMPLETE);
      nameRef.current?.focus();
      return;
    }
    setHint(null);
    setError(null);
    pending.current = true;
    setJoining(true);
    getSocket().emit('SESSION_JOIN', {
      joinCode: cellsNow.join(''),
      displayName: nameNow.trim(),
      role: roleNow as PlayerRole,
    });
    // No ack on this event — a local timer is the only timeout we get.
    joinTimer.current = setTimeout(() => settleFailure(JOIN_TIMEOUT), 5000);
  };

  const applyUpdate = (update: { cells: string[]; focusIndex: number }, submit: boolean) => {
    setCells(update.cells);
    cellRefs.current[update.focusIndex]?.focus();
    if (submit && isCodeComplete(update.cells)) tryJoin(update.cells, name, role);
  };

  const hostSession = () => {
    if (busy || pending.current) return;
    pending.current = true;
    setCreating(true);
    setError(null);
    setHint(null);
    // .timeout() flips the ack to an error-first callback (err set on timeout).
    getSocket()
      .timeout(5000)
      .emit('SESSION_CREATE', {}, (err) => {
        if (err) {
          settleFailure(HOST_FAILED);
          return;
        }
        // Success: SESSION_STATE will mount Lobby (unmounting Landing). Clear the
        // in-flight flag so a dropped broadcast can't wedge the button disabled.
        if (!pending.current) return;
        pending.current = false;
        setCreating(false);
      });
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <section className="w-full max-w-lg rounded-lg bg-surface-raised p-8">
        {/* ── Join by code ─────────────────────────────────────────── */}
        <label htmlFor="join-name" className="mb-2 block text-sm font-semibold">
          {YOUR_NAME}
        </label>
        <input
          id="join-name"
          ref={nameRef}
          type="text"
          maxLength={24}
          autoComplete="off"
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') tryJoin(cells, name, role);
          }}
          className="mb-5 w-full rounded-md border-2 border-ink-muted bg-surface px-3 py-2.5 text-ink-primary disabled:opacity-50"
        />

        <div className="mb-5 flex gap-2.5" role="group" aria-label="Choose a role">
          {ROLE_OPTIONS.map(({ role: r, label }) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              disabled={busy}
              onClick={() => setRole(r)}
              className={`flex-1 cursor-pointer rounded-md border-2 px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                role === r
                  ? 'border-brass text-ink-primary'
                  : 'border-ink-muted text-ink-muted hover:text-ink-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="mb-3 text-sm font-semibold">{ENTER_A_JOIN_CODE}</p>
        <div className="mb-3 grid grid-cols-6 gap-2.5">
          {cells.map((value, i) => (
            <input
              key={i}
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              type="text"
              maxLength={1}
              autoComplete="off"
              aria-label={`Join code character ${i + 1}`}
              disabled={busy}
              value={value}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const v = e.target.value;
                applyUpdate(applyCharAt(cells, i, v.length > 1 ? v.slice(-1) : v), true);
              }}
              onPaste={(e) => {
                e.preventDefault();
                applyUpdate(applyPasteAt(cells, i, e.clipboardData.getData('text')), true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Backspace') {
                  e.preventDefault();
                  applyUpdate(applyBackspaceAt(cells, i), false);
                } else if (e.key === 'Enter') {
                  tryJoin(cells, name, role);
                }
              }}
              className={`h-16 w-full rounded-md border-2 bg-surface text-center font-mono text-xl font-bold uppercase text-cream disabled:opacity-50 ${
                value !== '' ? 'border-brass' : 'border-ink-muted'
              }`}
            />
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          {JOIN_HELP} <b className="font-semibold text-ink-primary">{JOIN_HELP_EMPHASIS}</b>
        </p>
        {/* Story 2.7: a `?join=` link prefills the cells without a submitting
            keystroke, so a complete code needs an explicit Join. Typing the 6th
            character still auto-submits (Story 2.3) — this button is additive. */}
        {isCodeComplete(cells) && (
          <Button
            onClick={() => tryJoin(cells, name, role)}
            disabled={busy}
            className="mt-3 w-full"
          >
            {JOIN_NOW}
          </Button>
        )}
        {joining && <p className="mt-3 text-sm text-ink-muted">{JOIN_BUSY}</p>}
        {hint !== null && <p className="mt-3 text-sm text-ink-muted">{hint}</p>}

        {/* ── or host ──────────────────────────────────────────────── */}
        <div className="my-6 flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-ink-muted">
          <span className="h-px flex-1 bg-ink-muted/30" />
          {OR_DIVIDER}
          <span className="h-px flex-1 bg-ink-muted/30" />
        </div>

        <p className="mb-4 text-sm text-ink-muted">{HOST_PITCH}</p>
        <Button variant="secondary" onClick={hostSession} disabled={busy} className="w-full">
          {creating ? HOST_BUSY : HOST_A_SESSION}
        </Button>

        {error !== null && (
          <p role="alert" className="mt-4 text-sm text-led-red">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
