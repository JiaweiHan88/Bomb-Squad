export interface TimerState {
  /** Server epoch ms when this timer segment began. */
  startedAt: number;
  /** Milliseconds remaining when this segment began. */
  remainingAtStart: number;
  /**
   * Compounding speed multiplier. Default 1.0; rises with strikes (e.g. 1.0 → 1.25 → 1.56
   * at the default 25% escalation). Client displayed time:
   *   remaining = remainingAtStart - (now - startedAt) * speedMultiplier
   */
  speedMultiplier: number;
  /** Epoch ms at which the clock was frozen; null means the clock is running. */
  pausedAt: number | null;
}
