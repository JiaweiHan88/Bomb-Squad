/**
 * Per-module pure logic (state/action types, generate, solve, reducer, manual
 * data) — the shared half of the module plugin contract (architecture
 * Pattern 3). Each module is one additive directory; the client binds
 * rendering in apps/client/src/modules/<id>/, the server registers the
 * reducer in MODULE_REDUCERS. Nothing outside a module's own directory
 * changes when a module is added.
 */
export * from './dev-demo/index.js';
export * from './registry.js';
