/**
 * Shared DOM-environment helpers for the bomb scene (lifted from BombScene in
 * Story 4.3 so ModuleBay and the dev harness can reuse them without importing
 * the scene itself).
 */

/** Accessibility Floor: reduced-motion users get instant state changes. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when a keyboard event targets a text-entry element (don't hijack it). */
export const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
};
