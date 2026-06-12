/**
 * Server-time offset estimation (Story 4.4, architecture Pattern 5 / ADR-005:
 * "estimated once at connect, refreshed on each timer broadcast").
 *
 * Every running-segment TIMER_UPDATE carries a server timestamp stamped at
 * emit (`startedAt` — segments are always rebased on change), so
 * `startedAt − receivedAt` estimates `serverEpoch − clientEpoch` with an error
 * of one-way latency. The error biases the displayed clock BEHIND the server —
 * the safe direction: the client never shows expiry before the server declares
 * it (AC3). Paused broadcasts are skipped (`startedAt` is not fresh there).
 *
 * Single-sample estimator by design — smoothing / RTT compensation is Story
 * 8.4's call when the real server emitter lands.
 */
import type { TimerState } from '@bomb-squad/shared';

/** Pure: offset estimate for one broadcast, or null when not estimable. */
export function estimateClockOffset(timer: TimerState, receivedAtMs: number): number | null {
  if (timer.pausedAt !== null) return null;
  return timer.startedAt - receivedAtMs;
}

// Module-level connection-scoped state (the socket.ts instance pattern):
// an offset is a property of the live connection, not snapshot game state.
let clockOffsetMs = 0;

/** Refresh the offset from a TIMER_UPDATE broadcast (no-op when paused). */
export function noteTimerBroadcast(timer: TimerState, receivedAtMs: number = Date.now()): void {
  const estimate = estimateClockOffset(timer, receivedAtMs);
  if (estimate !== null) clockOffsetMs = estimate;
}

/**
 * Best estimate of the server's epoch-ms clock. Offset defaults to 0, which is
 * exact for the dev harness (same origin) and safe before the first broadcast.
 */
export function serverNow(nowMs: number = Date.now()): number {
  return nowMs + clockOffsetMs;
}

export function resetClockOffsetForTest(): void {
  clockOffsetMs = 0;
}
