import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPreFlash,
  emptyPreFlash,
  markPreFlash,
  reconcilePreFlash,
  type PreFlashState,
} from './preFlashCore.js';

/**
 * Optimistic pre-flash layer for DefuserViews (Story 4.7, AC-2).
 *
 * THE BUDGET (≤100ms perceived): a Defuser activation must feel instant. The
 * pre-flash visual is driven entirely by LOCAL state set SYNCHRONOUSLY in the
 * same click handler that dispatches the action — `mark(key)` flips local state
 * before the socket emit, so the affordance renders on the click's own frame,
 * independent of the server round-trip. We never gate the visual on the network.
 *
 * NON-AUTHORITATIVE: markers live OUTSIDE the gameStore snapshot (a plain set of
 * keys; see preFlashCore). They change only the module's own transient chrome
 * (e.g. a wire shown severed) — never the module `status`, never the solve LED.
 * Only the server's MODULE_UPDATE snapshot flips `solved` (AC-2).
 *
 * RECONCILE / ROLLBACK (semantics in preFlashCore, tested there):
 * - Reconcile: every render (the component re-renders when the authoritative
 *   snapshot changes) confirmed keys are dropped so the authoritative state
 *   drives the visual seamlessly (no flicker — both show the same thing).
 * - Rollback: if no confirming snapshot arrives within `rollbackMs` (action
 *   dropped, rejected, or lost), the marker is cleared and the visual reverts to
 *   the authoritative state — never a severed wire left on a still-armed module.
 *
 * `isConfirmed` should read the LATEST authoritative state (e.g. via
 * `useGameStore.getState()`), not a closed-over render snapshot.
 */

/** Window to wait for a confirming snapshot before rolling a pre-flash back.
 *  Generous vs a normal round-trip (the pre-flash itself is instant); this only
 *  governs the failure case where no confirmation ever lands. */
export const PRE_FLASH_ROLLBACK_MS = 2000;

export interface OptimisticPreFlash {
  /** Keys currently shown optimistically (not yet confirmed by the server). */
  active: ReadonlySet<number>;
  /** Mark a key optimistically and arm its rollback timer. Call synchronously
   *  in the activation handler, alongside the dispatch. */
  mark: (key: number) => void;
}

export function useOptimisticPreFlash(
  isConfirmed: (key: number) => boolean,
  rollbackMs: number = PRE_FLASH_ROLLBACK_MS,
): OptimisticPreFlash {
  const [state, setState] = useState<PreFlashState>(emptyPreFlash);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clear = useCallback((key: number) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(key);
    }
    setState((prev) => clearPreFlash(prev, key));
  }, []);

  const mark = useCallback(
    (key: number) => {
      setState((prev) => markPreFlash(prev, key));
      const existing = timers.current.get(key);
      if (existing !== undefined) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => clear(key), rollbackMs),
      );
    },
    [clear, rollbackMs],
  );

  // Reconcile against the authoritative snapshot. The component re-renders when
  // that snapshot changes (its reactive selector), so reconciling each render
  // catches confirmations; but there is nothing to reconcile unless a marker is
  // pending, so skip the setState churn entirely in the (overwhelmingly common)
  // no-pending state. When markers exist, setState still bails out by ref when
  // nothing is confirmed, so this converges and never loops. Also drop the
  // rollback timer for any key the reconcile cleared.
  useEffect(() => {
    if (state.active.size === 0) return;
    setState((prev) => {
      const next = reconcilePreFlash(prev, isConfirmed);
      if (next !== prev) {
        for (const key of prev.active) {
          if (!next.active.has(key)) {
            const timer = timers.current.get(key);
            if (timer !== undefined) {
              clearTimeout(timer);
              timers.current.delete(key);
            }
          }
        }
      }
      return next;
    });
  });

  // Flush any pending rollback timers on unmount (round transition / scene
  // teardown) so a timeout can't fire into an unmounted component.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return { active: state.active, mark };
}
