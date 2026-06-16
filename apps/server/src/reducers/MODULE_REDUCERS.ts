import {
  DEV_DEMO_MODULE_ID,
  WIRES_MODULE_ID,
  BUTTON_MODULE_ID,
  PASSWORDS_MODULE_ID,
  devDemoReducer,
  wiresReducer,
  buttonReducer,
  passwordsReducer,
  type ModuleState,
  type Reducer,
} from '@bomb-squad/shared';

export type ModuleReducer = Reducer<ModuleState<unknown>, unknown>;

/**
 * Open/closed module registry.
 *
 * Add an entry here to register a module. Never edit bombReducer.ts to support a new module.
 * Modules from Epic 5+ register into this map additively; the bomb reducer delegates by moduleId.
 *
 * Entries are cast to ModuleReducer: each module's reducer is fully typed in
 * packages/shared; the per-module state type is deliberately erased at this
 * registry boundary (the bomb reducer dispatches by moduleId and treats data
 * as opaque). Reducers themselves guard against malformed actions.
 */
export const MODULE_REDUCERS: Record<string, ModuleReducer> = {
  // dev-demo: Story 5.1 reference module. Harmless in production — no bomb
  // generation emits 'dev-demo' until Story 8.2 defines the module pool.
  [DEV_DEMO_MODULE_ID]: devDemoReducer as ModuleReducer,
  // wires: Story 5.3 walking skeleton — first real module.
  [WIRES_MODULE_ID]: wiresReducer as ModuleReducer,
  // the-button: Story 5.4 — press/hold with a timed release.
  [BUTTON_MODULE_ID]: buttonReducer as ModuleReducer,
  // passwords: Story 5.5 — cycle five columns to spell a listed word, SUBMIT.
  [PASSWORDS_MODULE_ID]: passwordsReducer as ModuleReducer,
};
