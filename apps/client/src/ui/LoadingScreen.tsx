import type { ReactNode } from 'react';

interface LoadingScreenProps {
  /** Status line, e.g. "Connecting…". Callers choose so the voice path can use
   *  its own copy ("Connecting to Bomb Room…") — never hardcode a single string. */
  status: string;
  /** Optional spinner / visual; omitted by default (operator world stays calm). */
  spinner?: ReactNode;
}

/**
 * Full-bleed operator-world wait screen (AC3). Shown whenever a network call is
 * in progress so the app never sits behind a silent blocking call. Driven purely
 * by the caller's last-received store snapshot — it computes no truth of its own.
 */
export default function LoadingScreen({ status, spinner }: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-surface font-body text-ink-primary"
    >
      {spinner}
      <p className="text-md text-ink-muted">{status}</p>
    </div>
  );
}
