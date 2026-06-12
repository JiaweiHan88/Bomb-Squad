import type { IModule } from '@bomb-squad/shared';
import {
  DEV_DEMO_MODULE_ID,
  devDemoReducer,
  generateDevDemo,
  getDevDemoManualPages,
  type DevDemoState,
} from '@bomb-squad/shared';
import { registerModuleRenderer } from '../registry.js';
import { DevDemoDefuserView } from './DefuserView.js';

/**
 * dev-demo module directory — THE TEMPLATE every module from 5.3 (Wires)
 * onward copies. The contract (AC1):
 *
 *   generate.ts / solve.ts / reducer.ts / types.ts  → re-exports of the pure
 *     logic in packages/shared/src/modules/dev-demo/ (shared so the server's
 *     MODULE_REDUCERS and the client sandbox both run the SAME code)
 *   DefuserView.tsx  → R3F rendering only, zero game logic
 *   ManualPages.tsx  → renders getManualPages() structured data, never markup
 *   index.ts (this)  → the IModule binding + renderer registration
 *   __tests__/       → client-side binding tests (pure-logic tests live in shared)
 *
 * Adding a module = this directory + one MODULE_REDUCERS entry server-side.
 * Nothing in scenes/ or bombReducer.ts changes (open/closed, ADR-003).
 */
export const DEV_DEMO_MODULE: IModule<DevDemoState, unknown> = {
  id: DEV_DEMO_MODULE_ID,
  generate: generateDevDemo,
  reduce: devDemoReducer,
  getManualPages: getDevDemoManualPages,
};

// Import-time registration: the module cache makes this once-per-bundle (no
// StrictMode double-registration — effects are not involved). Vite HMR is
// safe too: this file is not a component module, so an edit anywhere below
// it escalates to a full page reload, which re-creates the registry.
registerModuleRenderer({ id: DEV_DEMO_MODULE_ID, DefuserView: DevDemoDefuserView });

export { DevDemoDefuserView } from './DefuserView.js';
export { DevDemoManualPages } from './ManualPages.js';
export * from './types.js';
