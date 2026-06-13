import { describe, expect, it } from 'vitest';
import {
  clearPreFlash,
  emptyPreFlash,
  markPreFlash,
  reconcilePreFlash,
  type PreFlashState,
} from '../preFlashCore.js';

/**
 * Optimistic pre-flash core (Story 4.7, AC-2). These prove the invariants the
 * Wires DefuserView relies on: a pre-flash is purely a set of keys (it can never
 * touch authoritative `status`/`solved` — there is no such field here), it
 * persists across the round-trip until confirmed, it reconciles away on
 * confirmation, and it rolls back (is cleared) when no confirmation lands.
 */

const withKeys = (...keys: number[]): PreFlashState => ({ active: new Set(keys) });

describe('preFlashCore', () => {
  it('mark adds a key; the optimistic state carries ONLY keys (never module status)', () => {
    const s = markPreFlash(emptyPreFlash(), 1);
    expect([...s.active]).toEqual([1]);
    // Structural guarantee: the state shape is a key set — it cannot express
    // `solved`, so the pre-flash can never flip the solve LED.
    expect(Object.keys(s)).toEqual(['active']);
  });

  it('mark is idempotent and returns the same reference', () => {
    const s = withKeys(1);
    expect(markPreFlash(s, 1)).toBe(s);
  });

  it('an unconfirmed key PERSISTS through reconcile (visible across the round-trip)', () => {
    const s = withKeys(0, 1);
    const next = reconcilePreFlash(s, () => false);
    expect(next).toBe(s); // nothing confirmed → same ref, no churn
    expect([...next.active]).toEqual([0, 1]);
  });

  it('reconcile drops exactly the confirmed keys, keeping the rest', () => {
    const s = withKeys(0, 1, 2);
    const next = reconcilePreFlash(s, (k) => k === 1);
    expect([...next.active].sort()).toEqual([0, 2]);
  });

  it('rollback (clear) removes an unconfirmed key — no severed wire left behind', () => {
    const s = withKeys(3);
    const next = clearPreFlash(s, 3);
    expect(next.active.has(3)).toBe(false);
  });

  it('clear of an absent key is a no-op (same reference)', () => {
    const s = withKeys(1);
    expect(clearPreFlash(s, 9)).toBe(s);
  });
});
