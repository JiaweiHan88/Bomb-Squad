/**
 * Pure state core for the optimistic pre-flash (Story 4.7, AC-2). React-free so
 * the reconcile/rollback semantics are unit-testable without a DOM (project
 * testing rule: keep logic out of rendering-only components). The React hook
 * `useOptimisticPreFlash` holds one of these in state and drives the timers.
 *
 * The state is ONLY a set of optimistic keys (e.g. wire indices shown severed
 * before the server confirms). It has NO notion of module `status`/`solved` — it
 * structurally cannot flip the solve LED; only the server snapshot does that.
 * Every transition returns the SAME reference when nothing changes, so callers
 * can bail out of needless renders by identity.
 */
export interface PreFlashState {
  readonly active: ReadonlySet<number>;
}

export function emptyPreFlash(): PreFlashState {
  return { active: new Set() };
}

/** Mark a key optimistically (idempotent). */
export function markPreFlash(state: PreFlashState, key: number): PreFlashState {
  if (state.active.has(key)) return state;
  const active = new Set(state.active);
  active.add(key);
  return { active };
}

/** Drop a key — used both on confirmation (reconcile) and on rollback (timeout). */
export function clearPreFlash(state: PreFlashState, key: number): PreFlashState {
  if (!state.active.has(key)) return state;
  const active = new Set(state.active);
  active.delete(key);
  return { active };
}

/**
 * Reconcile against the authoritative snapshot: drop every optimistic key the
 * server has now confirmed, so the authoritative state drives the visual.
 * Unconfirmed keys are LEFT in place (they persist until either a later confirm
 * or the rollback timeout) — this is what keeps a pre-flash visible across the
 * round-trip without ever committing it.
 */
export function reconcilePreFlash(
  state: PreFlashState,
  isConfirmed: (key: number) => boolean,
): PreFlashState {
  let active: Set<number> | null = null;
  for (const key of state.active) {
    if (isConfirmed(key)) {
      active ??= new Set(state.active);
      active.delete(key);
    }
  }
  return active === null ? state : { active };
}
