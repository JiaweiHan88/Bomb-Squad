import type { IModule } from '@bomb-squad/shared';
import {
  BUTTON_MODULE_ID,
  generateButton,
  getButtonManualPages,
  buttonReducer,
  type ButtonState,
} from '@bomb-squad/shared';
import { registerModuleRenderer } from '../registry.js';
import { ButtonDefuserView } from './DefuserView.js';

/**
 * the-button module directory — second Easy module (Story 5.4), built on the
 * wires (5.3) template:
 *
 *   generate.ts / solve.ts / reducer.ts / types.ts  → re-exports of the pure
 *     logic in packages/shared/src/modules/the-button/ (shared so the server's
 *     MODULE_REDUCERS and the client sandbox both run the SAME code)
 *   DefuserView.tsx  → R3F rendering only, zero game logic (press/hold + strip)
 *   ManualPages.tsx  → renders getManualPages() structured data, never markup
 *   index.ts (this)  → the IModule binding + renderer registration
 *   __tests__/       → client-side binding tests (pure-logic tests live in shared)
 *
 * Adding this module touched: this directory, one barrel import +
 * SANDBOX_MODULES entry, one MODULE_REDUCERS entry, one MODULE_GENERATORS +
 * TIER_POOLS entry, and the /dev/manual fixture swap to canonical content.
 * bombReducer.ts unchanged (open/closed).
 */
export const BUTTON_MODULE: IModule<ButtonState, unknown> = {
  id: BUTTON_MODULE_ID,
  generate: generateButton,
  reduce: buttonReducer,
  getManualPages: getButtonManualPages,
};

// Import-time registration: the module cache makes this once-per-bundle (no
// StrictMode double-registration — effects are not involved). Same pattern as
// wires/dev-demo.
registerModuleRenderer({ id: BUTTON_MODULE_ID, DefuserView: ButtonDefuserView });

export { ButtonDefuserView } from './DefuserView.js';
export { ButtonManualPages } from './ManualPages.js';
export * from './types.js';
