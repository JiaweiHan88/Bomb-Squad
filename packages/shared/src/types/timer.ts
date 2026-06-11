/**
 * A single timer SEGMENT. The clock runs at one constant speed within a segment.
 *
 * Segment-reset convention (server-authoritative — the only correct mutation model):
 *  - On RESUME: start a fresh segment — set `startedAt = resumeTime`,
 *    `remainingAtStart = ` the time that was frozen, `pausedAt = null`. Simply
 *    nulling `pausedAt` would silently subtract the whole paused span.
 *  - On a `speedMultiplier` change (e.g. a strike): snapshot remaining time and
 *    start a fresh segment, so the new rate never retro-applies to already-elapsed
 *    time. A single segment cannot describe a piecewise-speed timeline.
 * The displayed-time formula below is therefore only valid WITHIN one segment.
 */
export interface TimerState {
  /** Server epoch ms when this timer segment began. */
  startedAt: number;
  /** Milliseconds remaining when this segment began. */
  remainingAtStart: number;
  /**
   * Compounding speed multiplier for this segment. Default 1.0; rises with strikes
   * (e.g. 1.0 → 1.25 → 1.56 at the default 25% escalation). Within the segment:
   *   remaining = remainingAtStart - (now - startedAt) * speedMultiplier
   * When `pausedAt` is set, substitute `pausedAt` for `now` (the clock is frozen).
   */
  speedMultiplier: number;
  /** Epoch ms at which the clock was frozen; null means the clock is running. */
  pausedAt: number | null;
}
