import type { IModule } from '@bomb-squad/shared';
import { DEV_DEMO_MODULE } from './dev-demo/index.js';

/**
 * Module registration barrel — importing it (main.tsx does, once) registers
 * every module's renderer. Each module dir self-registers at import time;
 * adding a module here is one import + one SANDBOX_MODULES entry.
 */

/** Type-erased IModule for heterogeneous lists (mirrors the server registry's
 *  ModuleReducer erasure — per-module types live inside each module). */
export type SandboxModule = IModule<unknown, unknown>;

/** Modules available in /dev/sandbox. Wires joins in 5.3, etc. */
export const SANDBOX_MODULES: readonly SandboxModule[] = [
  DEV_DEMO_MODULE as SandboxModule,
];

export { DEV_DEMO_MODULE };
