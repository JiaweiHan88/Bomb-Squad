import type { ComponentType } from 'react';
import { PLACEHOLDER_RENDERER } from './PlaceholderModule.js';

/**
 * Client-side module renderer registry (game-architecture.md, Epic 4).
 *
 * Open/closed seam mirroring the server's MODULE_REDUCERS (ADR-003): Epic 5+
 * modules call registerModuleRenderer() additively; nothing in scenes/ changes
 * when a module is added. Lookup never fails — unknown ids resolve to the
 * placeholder renderer so the scene degrades gracefully instead of crashing.
 */

export interface ModuleDefuserViewProps {
  /**
   * Index into BombState.modules — the module's slot identity. MODULE_UPDATE
   * payloads are indexed (not id'd), so a DefuserView subscribes to its own
   * ModuleState slice via this index.
   */
  moduleIndex: number;
}

export interface ModuleRenderer {
  /** Module identifier in kebab-case, e.g. "wires", "simon-says". */
  readonly id: string;
  /** R3F rendering only — zero game logic (project rule). */
  readonly DefuserView: ComponentType<ModuleDefuserViewProps>;
}

const renderers = new Map<string, ModuleRenderer>();

/** Additive registration. Throws on a duplicate id (fail-loud). */
export function registerModuleRenderer(renderer: ModuleRenderer): void {
  if (renderers.has(renderer.id)) {
    throw new Error(`module renderer already registered: ${renderer.id}`);
  }
  renderers.set(renderer.id, renderer);
}

/** Never returns undefined: unregistered ids fall back to the placeholder. */
export function getModuleRenderer(moduleId: string): ModuleRenderer {
  return renderers.get(moduleId) ?? PLACEHOLDER_RENDERER;
}
