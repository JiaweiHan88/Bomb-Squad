/**
 * The module-action dispatch seam (Story 5.1).
 *
 * DefuserViews call dispatchModuleAction(moduleIndex, action) and know
 * nothing about transport. What happens next depends on the installed
 * backend:
 *
 * - /dev/sandbox installs a LOCAL backend (sandbox/devDispatch.ts) that runs
 *   the module reducer client-side — a documented dev-only exception to
 *   "the client never owns authoritative state".
 * - The PRODUCTION backend — emit MODULE_INTERACT { teamId, moduleIndex,
 *   action } and let the server reduce/persist/broadcast — does not exist
 *   yet (the server has no MODULE_INTERACT handler; Story 5.3 / Epic 8
 *   installs it here). Until then, dispatch outside the sandbox warns and
 *   drops, which surfaces mis-wiring instead of hiding it.
 */
/**
 * Returns `true` if the action was actually handled (emitted to the server, or
 * applied by the sandbox's local backend), `false` if it was dropped (no backend
 * installed, or no team for self yet). Callers use this to gate optimistic UI: a
 * dropped action gets no confirming snapshot, so an optimistic pre-flash must not
 * be shown for it (it would linger until its rollback timeout — a phantom).
 */
export type ModuleActionDispatch = (moduleIndex: number, action: unknown) => boolean;

let backend: ModuleActionDispatch | null = null;

export function setModuleActionDispatch(dispatch: ModuleActionDispatch | null): void {
  backend = dispatch;
}

export function dispatchModuleAction(moduleIndex: number, action: unknown): boolean {
  if (!backend) {
    console.warn('[modules] action dropped: no dispatch backend installed', {
      moduleIndex,
      action,
    });
    return false;
  }
  return backend(moduleIndex, action);
}
