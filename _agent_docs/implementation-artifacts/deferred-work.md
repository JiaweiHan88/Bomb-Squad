# Deferred Work

## Deferred from: code review of story-1.1 (2026-06-10)

- ~~**`@bomb-squad/shared` entrypoint strategy**~~ — **RESOLVED in Story 1.2.** Updated `exports` to `{ "types": "./src/index.ts", "import": "./src/index.ts", "default": "./src/index.ts" }`. Added `.js` extensions to all relative imports inside `packages/shared` (NodeNext-compatible, Bundler also accepts them). Both `apps/client` and `apps/server` declared `"@bomb-squad/shared": "workspace:*"` and cross-workspace `import type` resolved cleanly under all three tsconfigs.
- **`@types/node` for client Vite config typecheck** — `apps/client/tsconfig.json` includes `vite.config.ts` in the typecheck graph without `@types/node`. Passes today (no Node globals used); add `@types/node` + a `tsconfig.node.json` split when the Vite config starts using `path`/`process`/etc.
