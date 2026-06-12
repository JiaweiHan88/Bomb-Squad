import type { BombState, ModuleState } from '@bomb-squad/shared';
import { DEV_BOMB_CONTEXT } from './devBombContext.js';

/**
 * Fixed dev-harness BombState (no bomb generation exists until Story 8.2).
 * Fixed constants, not generators — Math.random() is forbidden outside
 * generate(seed, ctx) (project rule).
 *
 * Module statuses match the mockup's scene state: module 0 solved (green LED),
 * the rest armed. Every moduleId is 'placeholder' — the renderer registry
 * resolves it to the placeholder DefuserView until Epic 5 registers real
 * modules.
 */

const placeholderModule = (status: ModuleState<null>['status']): ModuleState<null> => ({
  moduleId: 'placeholder',
  status,
  data: null,
});

export const DEV_PLACEHOLDER_MODULES: ReadonlyArray<ModuleState<null>> = [
  placeholderModule('solved'),
  placeholderModule('armed'),
  placeholderModule('armed'),
  placeholderModule('armed'),
  placeholderModule('armed'),
  placeholderModule('armed'),
];

/** Seeded into the real gameStore by DevBombHarness (setBomb on mount). */
export const DEV_BOMB_STATE: BombState = {
  context: DEV_BOMB_CONTEXT,
  modules: [...DEV_PLACEHOLDER_MODULES],
  strikes: 0,
  solved: false,
};
