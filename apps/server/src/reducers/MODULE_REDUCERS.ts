import type { ModuleState, Reducer } from '@bomb-squad/shared';

export type ModuleReducer = Reducer<ModuleState<unknown>, unknown>;

/**
 * Open/closed module registry.
 *
 * Add an entry here to register a module. Never edit bombReducer.ts to support a new module.
 * Modules from Epic 5+ register into this map additively; the bomb reducer delegates by moduleId.
 */
export const MODULE_REDUCERS: Record<string, ModuleReducer> = {};
