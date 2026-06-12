import type { ModuleRenderer } from './registry.js';

/**
 * Fallback DefuserView for module ids with no registered renderer.
 *
 * In Story 4.3 every module resolves here — real DefuserViews arrive with the
 * Epic 5 module plugins. It also guards forward: a client meeting an unknown
 * module id degrades to an empty bay instead of crashing the scene.
 * Rendering-only; the bay frame, tag, and solve LED are owned by ModuleBay.
 */
function PlaceholderDefuserView() {
  return null;
}

export const PLACEHOLDER_RENDERER: ModuleRenderer = {
  id: 'placeholder',
  DefuserView: PlaceholderDefuserView,
};
