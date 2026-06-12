import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore.js';
import BombStage from './BombStage.js';
import BombScene from './BombScene.js';
import { DEV_BOMB_STATE } from './devBombState.js';
import { isTextEntryTarget } from './dom.js';

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
 *   Shift + digit    → struck pulse: applyModuleUpdate('struck') then
 *                      immediately ('armed'), deliberately reproducing the
 *                      server's transient roll-up so the edge-triggered LED
 *                      flash is proven against the worst-case sequence.
 */
export default function DevBombHarness() {
  useEffect(() => {
    useGameStore.getState().setBomb(DEV_BOMB_STATE);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (!event.code.startsWith('Digit')) return; // e.code survives Shift ('!' vs Digit1)
      const digit = Number(event.code.slice('Digit'.length));
      if (!Number.isInteger(digit) || digit < 1) return;
      const moduleIndex = digit - 1;
      const { bomb, applyModuleUpdate } = useGameStore.getState();
      const module = bomb?.modules[moduleIndex];
      if (!module) return;
      if (event.shiftKey) {
        applyModuleUpdate({ moduleIndex, state: { ...module, status: 'struck' } });
        applyModuleUpdate({ moduleIndex, state: { ...module, status: 'armed' } });
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
