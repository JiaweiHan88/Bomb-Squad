import type { PlayerInfo } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import {
  PAUSE_HELD,
  PAUSE_DROPPED_PREFIX,
  PAUSE_RESUME_CTA,
  PAUSE_WAITING_READY,
  PAUSE_WAITING_FACILITATOR,
  PAUSE_READY_CTA,
  PAUSE_READY_DONE,
  FACILITATOR_PAUSE_CTA,
} from './copy.js';

/**
 * Pause surface (Story 8.7, AC-1/AC-2/AC-3). Rendering only — it derives entirely
 * from the authoritative `session` pause fields (`pausedAt`/`pauseKind`/
 * `disconnectedPlayerIds`), so it is reconnect-safe and needs no separate store
 * state. Self-hides when the session is running.
 *
 * - Facilitator pause (between rounds): neutral "Holding the clock." strip; the
 *   facilitator gets a free Resume.
 * - Disconnect auto-pause (mid round): AMBER strip naming who dropped + a dimmed
 *   scene; resume requires the facilitator AND every participant ready, so a
 *   waiting participant gets an "I'm ready" affordance and the facilitator's
 *   Resume is disabled until the gate clears.
 *
 * A non-diegetic DOM overlay (EXPERIENCE.md) — the same z-layer pattern as
 * ResolutionBanner; no Three.js/WebGL changes. The per-team timer LCD already
 * freezes on `TimerState.pausedAt` (Story 8.4), so this owns only the strip + dim.
 */
function isParticipant(player: PlayerInfo | undefined): boolean {
  return player?.teamId !== undefined;
}

export default function PauseOverlay() {
  const session = useGameStore((s) => s.session);
  const selfId = useGameStore((s) => s.myPlayerId);

  if (session === null) return null;

  const self = selfId !== null ? session.players[selfId] : undefined;
  const isFacilitator = self?.role === 'facilitator';

  // Not paused: the facilitator's "break-glass" Pause affordance (EXPERIENCE.md —
  // fades to low opacity until hovered). Only meaningful for a live round or the
  // between-rounds gap; everyone else sees nothing.
  if (session.pausedAt === null) {
    const canPause = session.status === 'active' || session.status === 'between-rounds';
    if (!isFacilitator || !canPause) return null;
    return (
      <button
        type="button"
        data-testid="facilitator-pause"
        onClick={() => getSocket().emit('FACILITATOR_PAUSE')}
        className="absolute right-4 top-4 z-40 rounded border border-ink-muted/40 bg-surface-raised/80 px-3 py-1 font-mono text-xs uppercase tracking-widest text-ink-muted opacity-20 transition-opacity hover:opacity-100"
      >
        {FACILITATOR_PAUSE_CTA}
      </button>
    );
  }

  const isDisconnect = session.pauseKind === 'disconnect';

  const droppedNames = session.disconnectedPlayerIds.map(
    (id) => session.players[id]?.displayName ?? 'A player',
  );
  // Mirror the server's canResume: every on-team participant must be ready.
  const participants = Object.values(session.players).filter(isParticipant);
  const allReady = participants.every((p) => p.isReady);

  const resume = () => getSocket().emit('FACILITATOR_RESUME');
  const readyUp = () => getSocket().emit('PLAYER_READY', { isReady: true });

  const message = isDisconnect
    ? `${droppedNames.join(', ')} ${PAUSE_DROPPED_PREFIX}`
    : PAUSE_HELD;

  // Resume is gated for a disconnect pause until all participants are ready.
  const resumeDisabled = isDisconnect && !allReady;

  let control: React.ReactNode;
  if (isFacilitator) {
    control = (
      <div className="flex items-center gap-3">
        {resumeDisabled && <span className="font-mono text-xs">{PAUSE_WAITING_READY}</span>}
        <button
          type="button"
          data-testid="pause-resume"
          onClick={resume}
          disabled={resumeDisabled}
          className="rounded bg-ink-primary px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-widest text-surface-base disabled:cursor-not-allowed disabled:opacity-40"
        >
          {PAUSE_RESUME_CTA}
        </button>
      </div>
    );
  } else if (isDisconnect && isParticipant(self)) {
    control = self?.isReady ? (
      <span className="font-mono text-xs">{PAUSE_READY_DONE}</span>
    ) : (
      <button
        type="button"
        data-testid="pause-ready"
        onClick={readyUp}
        className="rounded bg-ink-primary px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-widest text-surface-base"
      >
        {PAUSE_READY_CTA}
      </button>
    );
  } else {
    control = <span className="font-mono text-xs">{PAUSE_WAITING_FACILITATOR}</span>;
  }

  return (
    <>
      {/* Scene dim — semi-transparent, promoted to its own compositor layer so it
          never repaints/flickers over the WebGL canvas (ResolutionBanner pattern). */}
      <div
        data-testid="pause-dim"
        className="pointer-events-none absolute inset-0 z-40 transform-gpu bg-black/50 will-change-transform"
      />
      {/* Full-width top strip — amber for a disconnect, neutral for a facilitator hold. */}
      <div
        role="status"
        data-testid="pause-strip"
        data-kind={session.pauseKind ?? ''}
        className={`absolute inset-x-0 top-0 z-50 flex items-center justify-between gap-4 px-6 py-3 ${
          isDisconnect ? 'bg-amber-500 text-black' : 'bg-surface-raised text-ink-primary'
        }`}
      >
        <span className="font-mono text-sm font-semibold uppercase tracking-widest">{message}</span>
        {control}
      </div>
    </>
  );
}
