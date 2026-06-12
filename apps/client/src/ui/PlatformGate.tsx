import type { ReactNode } from 'react';
import { useViewportGate } from './useViewportGate.js';
import { GATE_MOBILE, GATE_RESIZE } from './copy.js';

/** Full-bleed operator-world gate message (dark shell, cream ink, deadpan). */
function GateScreen({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-surface px-8 text-center font-body text-ink-primary">
      <h1 className="font-display text-xl font-semibold">Bomb Squad</h1>
      <p className="max-w-md text-md text-ink-muted">{message}</p>
    </div>
  );
}

/**
 * Outermost UI boundary (AC4, AC5). Wins before any connecting/loading UI:
 * a mobile or too-small user sees the gate even while the socket is connecting.
 * Precedence top-to-bottom: platform gate -> loading screen -> app shell.
 */
export default function PlatformGate({ children }: { children: ReactNode }) {
  const gate = useViewportGate();

  if (gate === 'mobile') return <GateScreen message={GATE_MOBILE} />;
  if (gate === 'too-small') return <GateScreen message={GATE_RESIZE} />;
  return <>{children}</>;
}
