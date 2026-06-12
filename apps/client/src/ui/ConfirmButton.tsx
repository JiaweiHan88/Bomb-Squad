import { useState, type ReactNode } from 'react';
import Button from './Button.js';

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
 * The idle/confirming toggle is local presentation state — it is NOT game state,
 * so it stays in `useState` and never touches Zustand (architecture: stores hold
 * server snapshots only).
 */
export default function ConfirmButton({
  label,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  disabled,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="secondary" disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={() => setConfirming(false)}>
        {cancelLabel}
      </Button>
    </span>
  );
}
