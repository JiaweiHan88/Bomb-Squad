import type { IModule } from '@bomb-squad/shared';
import {
  WIRES_MODULE_ID,
  generateWires,
  getWiresManualPages,
  wiresReducer,
  type WiresState,
} from '@bomb-squad/shared';
import { registerModuleRenderer } from '../registry.js';
import { WiresDefuserView } from './DefuserView.js';

/**
 * wires module directory — first real module (Story 5.3, walking skeleton),
 * built on the dev-demo template:
 *
 *   generate.ts / solve.ts / reducer.ts / types.ts  → re-exports of the pure
 *     logic in packages/shared/src/modules/wires/ (shared so the server's
 *     MODULE_REDUCERS and the client sandbox both run the SAME code)
 *   DefuserView.tsx  → R3F rendering only, zero game logic
 *   ManualPages.tsx  → renders getManualPages() structured data, never markup
 *   index.ts (this)  → the IModule binding + renderer registration
 *   __tests__/       → client-side binding tests (pure-logic tests live in shared)
 *
 * Adding this module touched: this directory, one barrel import +
 * SANDBOX_MODULES entry, one MODULE_REDUCERS entry, and the /dev/manual
 * fixture swap to canonical content. bombReducer.ts unchanged (open/closed).
 */
export const WIRES_MODULE: IModule<WiresState, unknown> = {
  id: WIRES_MODULE_ID,
  generate: generateWires,
  reduce: wiresReducer,
  getManualPages: getWiresManualPages,
};

// Import-time registration: the module cache makes this once-per-bundle (no
// StrictMode double-registration — effects are not involved). Vite HMR is
// safe too: this file is not a component module, so an edit anywhere below
// it escalates to a full page reload, which re-creates the registry.
registerModuleRenderer({ id: WIRES_MODULE_ID, DefuserView: WiresDefuserView });

export { WiresDefuserView } from './DefuserView.js';
export { WiresManualPages } from './ManualPages.js';
export * from './types.js';
