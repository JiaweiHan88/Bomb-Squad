/**
 * Timer-display digit extraction — a faithful mirror of the client's
 * `apps/client/src/scenes/timerLcd.ts` (`timerRemainingMs` + `formatTimerDisplay`)
 * and `the-button/DefuserView.tsx`'s `currentTimerDigits()`. Replicated (not
 * imported) because those live in apps/client, which pulls in React/three; this
 * tool stays framework-free. The button reducer checks
 * `timerDigits.includes(releaseDigit)`, so the bot must produce the SAME digit
 * set the real Defuser's client would for a given TimerState.
 *
 * NOTE on the clock: the bot uses `Date.now()` as the server-now estimate. The
 * server timer is server-epoch-ms; on localhost / in-process the skew is ~0
 * (the documented test environment). For remote runs a small skew is harmless —
 * it only shifts which second the hold releases on.
 */
import type { TimerState } from '@bomb-squad/shared';

/** Remaining ms within the current segment, clamped ≥ 0 (mirror of timerLcd.ts). */
export function timerRemainingMs(timer: TimerState, serverNowMs: number): number {
  const now = timer.pausedAt ?? serverNowMs;
  const remaining = timer.remainingAtStart - (now - timer.startedAt) * timer.speedMultiplier;
  return remaining > 0 ? remaining : 0;
}

/** M:SS / MM:SS, seconds floored (mirror of timerLcd.ts). */
export function formatTimerDisplay(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The digits currently shown on the timer LCD (e.g. "4:05" → [4,0,5]). */
export function displayedTimerDigits(timer: TimerState, serverNowMs: number): number[] {
  return formatTimerDisplay(timerRemainingMs(timer, serverNowMs))
    .replace(/\D/g, '')
    .split('')
    .map(Number);
}
