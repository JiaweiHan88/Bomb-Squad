import type { IModule } from '@bomb-squad/shared';
import {
  PASSWORDS_MODULE_ID,
  generatePasswords,
  getPasswordsManualPages,
  passwordsReducer,
  type PasswordsState,
} from '@bomb-squad/shared';
import { registerModuleRenderer } from '../registry.js';
import { PasswordsDefuserView } from './DefuserView.js';

/**
 * passwords module directory — third Easy module (Story 5.5), built on the
 * wires (5.3) / the-button (5.4) template:
 *
 *   generate.ts / solve.ts / reducer.ts / types.ts  → re-exports of the pure
 *     logic in packages/shared/src/modules/passwords/ (shared so the server's
 *     MODULE_REDUCERS and the client sandbox both run the SAME code)
 *   DefuserView.tsx  → R3F rendering only, zero game logic (five cycle columns)
 *   ManualPages.tsx  → renders getManualPages() structured data, never markup
 *   index.ts (this)  → the IModule binding + renderer registration
 *   __tests__/       → client-side binding tests (pure-logic tests live in shared)
 *
 * Adding this module touched: this directory, one barrel import +
 * SANDBOX_MODULES entry, one MODULE_REDUCERS entry, one MODULE_GENERATORS +
 * TIER_POOLS entry, and the /dev/manual fixture swap to canonical content.
 * bombReducer.ts unchanged (open/closed).
 */
export const PASSWORDS_MODULE: IModule<PasswordsState, unknown> = {
  id: PASSWORDS_MODULE_ID,
  generate: generatePasswords,
  reduce: passwordsReducer,
  getManualPages: getPasswordsManualPages,
};

// Import-time registration: the module cache makes this once-per-bundle (no
// StrictMode double-registration — effects are not involved). Same pattern as
// wires/the-button/dev-demo.
registerModuleRenderer({ id: PASSWORDS_MODULE_ID, DefuserView: PasswordsDefuserView });

export { PasswordsDefuserView } from './DefuserView.js';
export { PasswordsManualPages } from './ManualPages.js';
export * from './types.js';
