import type { IModule } from '@bomb-squad/shared';
import { DEV_DEMO_MODULE } from './dev-demo/index.js';
import { WIRES_MODULE } from './wires/index.js';
import { BUTTON_MODULE } from './the-button/index.js';

/**
 * Module registration barrel — importing it (main.tsx does, once) registers
 * every module's renderer. Each module dir self-registers at import time;
 * adding a module here is one import + one SANDBOX_MODULES entry.
 */

/** Type-erased IModule for heterogeneous lists (mirrors the server registry's
 *  ModuleReducer erasure — per-module types live inside each module). */
export type SandboxModule = IModule<unknown, unknown>;

/** Modules available in /dev/sandbox. */
export const SANDBOX_MODULES: readonly SandboxModule[] = [
  DEV_DEMO_MODULE as SandboxModule,
  WIRES_MODULE as SandboxModule,
  BUTTON_MODULE as SandboxModule,
];

export { DEV_DEMO_MODULE, WIRES_MODULE, BUTTON_MODULE };
