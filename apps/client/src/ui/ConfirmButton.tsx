import { useEffect, useRef, useState, type ReactNode } from 'react';
import Button from './Button.js';
import { CANCEL, CONFIRM } from './copy.js';

interface ConfirmButtonProps {
  /** Resting label, e.g. "End session". */
  label: ReactNode;
  /** Confirm-step label, defaults to "Confirm". */
  confirmLabel?: ReactNode;
  /** Cancel-step label, defaults to "Cancel". */
  cancelLabel?: ReactNode;
  /** Fired only on the second, explicit confirm click. */
  onConfirm: () => void;
  disabled?: boolean;
}

/**
 * Canonical destructive-action pattern (AC2): every irreversible action takes
 * TWO explicit steps. The resting button is a `secondary` (never `primary` —
 * no primary button is ever destructive). The first click reveals an inline
 * `danger` confirm + a `secondary` cancel; only the confirm fires `onConfirm`.
 *
 * Guard rails on the armed state:
 * - Cancel occupies the resting button's position, so an impatient
 *   double-click lands on the safe action — never on Confirm.
 * - `onConfirm` fires at most once per arming (rapid clicks can outrun the
 *   disarming re-render).
 * - Escape or focus leaving the pair disarms; armed is never a resting state.
 * - Focus follows the toggle (Confirm on arm, resting button on disarm) so
 *   keyboard users are never dropped on <body> when a button unmounts.
 *
 * The idle/confirming toggle is local presentation state — it is NOT game state,
 * so it stays in `useState` and never touches Zustand (architecture: stores hold
 * server snapshots only).
 */
export default function ConfirmButton({
  label,
  confirmLabel = CONFIRM,
  cancelLabel = CANCEL,
  onConfirm,
  disabled,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const restingRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const firedRef = useRef(false);
  const wasConfirmingRef = useRef(false);

  useEffect(() => {
    if (confirming) {
      wasConfirmingRef.current = true;
      confirmRef.current?.focus();
    } else if (wasConfirmingRef.current) {
      wasConfirmingRef.current = false;
      restingRef.current?.focus();
    }
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={restingRef}
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          firedRef.current = false;
          setConfirming(true);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setConfirming(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setConfirming(false);
      }}
    >
      <Button variant="secondary" disabled={disabled} onClick={() => setConfirming(false)}>
        {cancelLabel}
      </Button>
      <Button
        ref={confirmRef}
        variant="danger"
        disabled={disabled}
        onClick={() => {
          if (firedRef.current) return;
          firedRef.current = true;
          setConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </span>
  );
}
