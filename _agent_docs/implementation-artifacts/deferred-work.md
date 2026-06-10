# Deferred Work

## Deferred from: code review of story-1.1 (2026-06-10)

- **`@bomb-squad/shared` entrypoint strategy** — `packages/shared/package.json` exposes raw `./src/index.ts` as `main`/`exports`. No consumers yet, so unexercised. Works for tsx/Vite/Bundler resolution, but the server's `tsc`+NodeNext build will need a real entrypoint. Decide raw-TS-source vs built-`dist`+conditional-`exports` when Story 1.2 wires the first cross-package consumer.
- **`@types/node` for client Vite config typecheck** — `apps/client/tsconfig.json` includes `vite.config.ts` in the typecheck graph without `@types/node`. Passes today (no Node globals used); add `@types/node` + a `tsconfig.node.json` split when the Vite config starts using `path`/`process`/etc.
