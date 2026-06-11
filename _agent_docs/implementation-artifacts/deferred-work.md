# Deferred Work

## Deferred from: code review of story-1.1 (2026-06-10)

- ~~**`@bomb-squad/shared` entrypoint strategy**~~ — **RESOLVED in Story 1.2.** Updated `exports` to `{ "types": "./src/index.ts", "import": "./src/index.ts", "default": "./src/index.ts" }`. Added `.js` extensions to all relative imports inside `packages/shared` (NodeNext-compatible, Bundler also accepts them). Both `apps/client` and `apps/server` declared `"@bomb-squad/shared": "workspace:*"` and cross-workspace `import type` resolved cleanly under all three tsconfigs.
- **`@types/node` for client Vite config typecheck** — `apps/client/tsconfig.json` includes `vite.config.ts` in the typecheck graph without `@types/node`. Passes today (no Node globals used); add `@types/node` + a `tsconfig.node.json` split when the Vite config starts using `path`/`process`/etc.

## Deferred from: code review of story-1.2 (2026-06-11)

- **`PAUSED`/`RESUMED` event payloads carry no `TimerState`** — `PauseResumePayload` is only `{ reason: string }`, partly redundant with `TIMER_UPDATE`. Decide whether pause/resume events should bundle the frozen `TimerState` when the timer/pause story (1.4+) implements the clock. Deferred — depends on consuming story.
- **Referential integrity between `PlayerInfo.teamId` and `TeamState.relayOrder` is unmodeled** — a player's `teamId` can disagree with which team's `relayOrder` lists them. Validate at runtime in the session-state story rather than encoding in the pure type. Deferred — runtime validation concern.

## Deferred from: code review of story-1.3 (2026-06-11)

- **`@bomb-squad/shared` exports point at `.ts` source, not built `dist`** (`packages/shared/package.json:5-11`) — works today (client bundles via Vite; server uses only `import type`, erased at compile), but breaks the moment the tsc-compiled server imports a runtime value (`hash`, `makeSeededRng`) since Node cannot execute the `.ts`. Deliberate Story 1.2 decision, validated only for `import type`. Settle the runtime-value consumption strategy (built dist + conditional exports / TS project references / bundler) in Story 1.4 (server bootstrap). Deferred — depends on the first server runtime import of shared.
- **`StrikeCount` admits `3` as a steady-state value though third strike = explosion** (`packages/shared/src/types/bomb.ts`) — `BombState.strikes: 0|1|2|3` can rest at `3`. Whether the type or reducer should forbid a resting `3` is a modeling question for the strike/timer reducer. Deferred — resolve in Story 8.4 (server-authoritative timer and strike escalation).
