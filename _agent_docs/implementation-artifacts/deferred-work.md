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

## Deferred from: code review of story-1.4 (2026-06-11)

- **CORS `origin: true` reflects any origin** (`apps/server/src/index.ts:37`) — open cross-origin posture, but exactly what Story 1.4 Task 4 specifies for the bootstrap. Tighten to an allowlist in a later auth/deployment story. Deferred — spec-sanctioned for this story.
- **No graceful-shutdown hang-timeout; signal during in-flight `listen()` can exit non-zero** (`apps/server/src/index.ts:51-70`) — if `io.close`'s callback never fires the process wedges until SIGKILL; a signal arriving before `ready()`/`listen()` completes closes a not-yet-listening server and may reject into `exit(1)`. Add a forced-exit timer and gate the signal handlers on listen-complete when shutdown robustness matters. Deferred — low-likelihood in current scope.
- **Config shape and numeric errors are not aggregated into one boot failure** (`apps/server/src/config/env.ts:64-86`) — `parseEnv` throws on shape issues before numeric validation runs, so a missing key + bad PORT surfaces only the shape error first (two-round fixing), contradicting the function's own "see every problem at once" comment. Deferred — minor operator UX.
- **`HealthRegistry.runAll()` doesn't normalize a malformed resolved value; `register()` silently replaces a duplicate name** (`apps/server/src/health/registry.ts`) — a probe resolving `undefined`/`{}` produces a malformed `/health` entry (only throws/rejections are normalized), and duplicate `register(name,…)` silently drops the earlier probe. Both bite once real Redis/Postgres probes are added. Deferred — revisit in Story 1.5 when store probes are registered.
