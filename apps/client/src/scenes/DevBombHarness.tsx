import { useEffect } from 'react';
import type { StrikeCount } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import BombStage from './BombStage.js';
import BombScene from './BombScene.js';
import { DEV_BOMB_STATE } from './devBombState.js';
import { isTextEntryTarget } from './dom.js';
import { timerRemainingMs } from './timerLcd.js';

/**
 * Dev harness for /dev/bomb (no server emits MODULE_UPDATE until Epic 8).
 * Seeds the real gameStore and drives state changes through the real store
 * actions (setBomb / applyModuleUpdate) — the exact path snapshot sync (4.7)
 * will ride — so the scene under test is byte-identical to production.
 *
 * Dev-only keyboard controls (DEV-guarded; EXPERIENCE.md's "no bomb-side
 * keyboard except ESC" is a production constraint, and this component is only
 * mounted on the dev route):
 *   digit 1–9        → toggle module n-1 between armed and solved
 *   Shift + digit    → FULL strike (Story 4.5), the server's two broadcasts in
 *                      order: (1) MODULE_UPDATE struck→armed pulse via
 *                      applyModuleUpdate — bombReducer's transient roll-up,
 *                      proving the edge-triggered LED flash against the
 *                      worst-case sequence; (2) STRIKE via setStrike — the
 *                      absolute incremented total + a rebased fresh timer
 *                      segment at speedMultiplier × 1.25 (GDD default,
 *                      compounding). Strikes only happen mid-round, so with no
 *                      timer running the pulse fires alone (flash only, no
 *                      count change); at 3 strikes the real server explodes
 *                      instead of broadcasting again, so the strike path goes
 *                      quiet (flash only, no further escalation).
 *   T                → start a 5:00 timer (GDD Easy default; offset 0 is exact
 *                      in dev — same origin)
 *   P                → pause / resume, faithfully modelling the server's
 *                      segment-reset convention (resume opens a FRESH segment
 *                      from the frozen remaining — see shared/types/timer.ts)
 *   U                → jump to 12s remaining to watch the under-10s glow pulse
 *
 * All states ride the real store actions (setTimer / setStrike /
 * applyModuleUpdate) — the exact paths the server's broadcasts use (Story 8.4
 * builds the real emitter). The 4.4-era S key (timer-only rebase) is folded
 * into the strike path — one strike model, no harness drift.
 */
const DEV_TIMER_START_MS = 300_000; // 5:00
const DEV_STRIKE_SPEEDUP = 1.25;
const DEV_UNDER_10S_JUMP_MS = 12_000;
export default function DevBombHarness() {
  useEffect(() => {
    useGameStore.getState().setBomb(DEV_BOMB_STATE);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (event.code === 'KeyT' || event.code === 'KeyP' || event.code === 'KeyU') {
        const { timer, setTimer } = useGameStore.getState();
        const now = Date.now();
        if (event.code === 'KeyT') {
          setTimer({
            startedAt: now,
            remainingAtStart: DEV_TIMER_START_MS,
            speedMultiplier: 1,
            pausedAt: null,
          });
        } else if (timer !== null) {
          if (event.code === 'KeyP') {
            setTimer(
              timer.pausedAt === null
                ? { ...timer, pausedAt: now }
                : {
                    // Resume = fresh segment from the frozen remaining; merely
                    // nulling pausedAt would subtract the whole paused span.
                    startedAt: now,
                    remainingAtStart: timerRemainingMs(timer, now),
                    speedMultiplier: timer.speedMultiplier,
                    pausedAt: null,
                  },
            );
          } else {
            setTimer({
              startedAt: now,
              remainingAtStart: DEV_UNDER_10S_JUMP_MS,
              speedMultiplier: timer.speedMultiplier,
              pausedAt: null,
            });
          }
        }
        return;
      }
      if (!event.code.startsWith('Digit')) return; // e.code survives Shift ('!' vs Digit1)
      const digit = Number(event.code.slice('Digit'.length));
      if (!Number.isInteger(digit) || digit < 1) return;
      const moduleIndex = digit - 1;
      const { bomb, timer, applyModuleUpdate, setStrike } = useGameStore.getState();
      const module = bomb?.modules[moduleIndex];
      if (!module) return;
      if (event.shiftKey) {
        // (1) MODULE_UPDATE: the bombReducer's transient roll-up — module
        // arrives already reset to 'armed' right after the 'struck' edge.
        applyModuleUpdate({ moduleIndex, state: { ...module, status: 'struck' } });
        applyModuleUpdate({ moduleIndex, state: { ...module, status: 'armed' } });
        // (2) STRIKE: only mid-round (a running timer) — production strikes
        // cannot exist without one, and StrikePayload.timer is non-null.
        // At 3 strikes the real server explodes the bomb and never emits
        // another STRIKE — so once clamped, stop escalating too (otherwise
        // repeated presses compound the timer speed forever, which no real
        // broadcast sequence can produce).
        if (bomb && timer !== null && bomb.strikes < 3) {
          const now = Date.now();
          const strikes = (bomb.strikes + 1) as StrikeCount;
          setStrike({
            teamId: 'A', // fixed dev constant — no session in the harness
            strikes,
            timer: {
              // Strike escalation = fresh segment so the new rate never
              // retro-applies to already-elapsed time (compounding ×1.25).
              startedAt: now,
              remainingAtStart: timerRemainingMs(timer, now),
              speedMultiplier: timer.speedMultiplier * DEV_STRIKE_SPEEDUP,
              pausedAt: timer.pausedAt === null ? null : now,
            },
          });
        }
      } else {
        applyModuleUpdate({
          moduleIndex,
          state: { ...module, status: module.status === 'solved' ? 'armed' : 'solved' },
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <BombStage>
      <BombScene />
    </BombStage>
  );
}
