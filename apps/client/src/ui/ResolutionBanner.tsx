import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import {
  RESULT_DEFUSED,
  RESULT_DETONATED,
  RESULT_TIME_EXPIRED,
  BETWEEN_ROUNDS_PLACEHOLDER,
} from './copy.js';

/**
 * Round-result presentation (Story 8.5, AC-1/AC-2/AC-3). Rendering only — it
 * reads the non-authoritative `resolution` snapshot the server set via
 * BOMB_DEFUSED / BOMB_EXPLODED and shows the verdict; it derives nothing.
 *
 * - DEFUSED. → green accent, ~2s hold (the bomb's module LEDs are already green
 *   since every module is solved — 4.3 solve LEDs — so no extra LED wiring here).
 * - DETONATED. / TIME EXPIRED. → red scene tint, ~3s hold (no replay/freeze-frame
 *   in V1, EXPERIENCE.md §Detonated).
 *
 * After the hold it transitions to an interim post-round surface. AC-3: NO
 * scoreboard appears here or during the hold. Story 8.6 (between-rounds +
 * scoreboard preview + ready gate) replaces that interim surface.
 *
 * SFX cues (defuse fanfare / explosion bass) are Epic 10 polish — a no-op hook
 * placeholder, not blocked on audio assets.
 */
const HOLD_MS_DEFUSED = 2_000;
const HOLD_MS_FAILURE = 3_000;

function playResolutionCue(_outcome: 'defused' | 'exploded' | 'time-expired'): void {
  // Epic 10: wire defuse fanfare / explosion bass here. No-op placeholder for V1.
}

export default function ResolutionBanner() {
  const resolution = useGameStore((s) => s.resolution);
  const [held, setHeld] = useState(false);

  const outcome = resolution?.outcome;

  useEffect(() => {
    // Always restart from the un-held state when the outcome changes — including a
    // direct value→value transition (e.g. a new round resolving before the prior
    // resolution cleared), so a stale `held` from the previous outcome never skips
    // the new verdict straight to the interim surface.
    setHeld(false);
    if (outcome === undefined) return;
    playResolutionCue(outcome);
    const holdMs = outcome === 'defused' ? HOLD_MS_DEFUSED : HOLD_MS_FAILURE;
    const handle = window.setTimeout(() => setHeld(true), holdMs);
    return () => window.clearTimeout(handle);
  }, [outcome]);

  if (resolution === null) return null;

  // Post-hold interim surface (Story 8.6 will replace with the real
  // between-rounds + scoreboard-preview screen). No scoreboard here (AC-3).
  if (held) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90">
        <p className="font-mono text-sm uppercase tracking-widest text-ink-muted">
          {BETWEEN_ROUNDS_PLACEHOLDER}
        </p>
      </div>
    );
  }

  const defused = resolution.outcome === 'defused';
  const label = defused
    ? RESULT_DEFUSED
    : resolution.outcome === 'exploded'
      ? RESULT_DETONATED
      : RESULT_TIME_EXPIRED;

  return (
    <div
      data-testid="resolution-banner"
      className={`absolute inset-0 z-50 flex items-center justify-center ${
        defused ? 'bg-black/70' : 'bg-red-900/60'
      }`}
    >
      <p
        className={`font-mono text-5xl font-bold uppercase tracking-widest ${
          defused ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {label}
      </p>
    </div>
  );
}
