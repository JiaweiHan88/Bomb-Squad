/**
 * Module contract file: types re-exported from packages/shared — NEVER
 * duplicated (project rule). The shared dir is the single source of truth;
 * this file exists so the per-module directory is self-contained for readers.
 */
export {
  DEV_DEMO_MODULE_ID,
  isDevDemoAction,
  type DevDemoAction,
  type DevDemoReset,
  type DevDemoSolution,
  type DevDemoState,
} from '@bomb-squad/shared';
