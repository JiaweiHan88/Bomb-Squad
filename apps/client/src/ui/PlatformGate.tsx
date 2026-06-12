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
 *
 * The gate is a full-bleed overlay — children stay MOUNTED (but hidden) while
 * gated, so a transient dip below 1280×720 (window snap, dock/undock) does not
 * destroy in-progress UI state.
 */
export default function PlatformGate({ children }: { children: ReactNode }) {
  const gate = useViewportGate();

  return (
    <>
      {gate === 'mobile' && <GateScreen message={GATE_MOBILE} />}
      {gate === 'too-small' && <GateScreen message={GATE_RESIZE} />}
      <div hidden={gate !== 'ok'}>{children}</div>
    </>
  );
}
