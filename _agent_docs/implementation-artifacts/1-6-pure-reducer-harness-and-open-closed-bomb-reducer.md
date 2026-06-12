---
baseline_commit: e1a90e1
---

# Story 1.6: Pure-Reducer Harness & Open/Closed Bomb Reducer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the pure-reducer core with an open/closed `bombReducer` delegating to a `MODULE_REDUCERS` registry,
so that game logic is unit-testable and new modules are purely additive.

## Acceptance Criteria

1. **No infra imports.** Given any reducer in the core, when its imports are inspected, then it imports nothing from `socket.io`, `ioredis`, `pg`, `fastify`, or `react`, and uses no `Date.now()` / `Math.random()` / `setTimeout`.

2. **Guard clauses — unknown index or unregistered module.** Given the `bombReducer`, when it receives a `MODULE_ACTION` with an unknown `moduleIndex` (out of bounds) or an unregistered `moduleId` (not in the registry), then it returns the state unchanged (guard → no-op), never throws.

3. **Immutability.** Given a frozen state object, when any reducer is called, then it returns a new object via spread/map and does not throw on the frozen input.

4. **Open/closed principle.** Given a new module is added to `MODULE_REDUCERS`, when the change is reviewed, then `bombReducer.ts` is unmodified.

## Tasks / Subtasks

- [x] **Task 1 — Define `BombAction` type in shared (AC: 1, 2)**
  - [x] Create `packages/shared/src/types/actions.ts`. Define `BombAction` as a discriminated union. The only variant for this story is `{ type: 'MODULE_ACTION'; moduleIndex: number; payload: unknown }`. Add a JSDoc comment noting that bomb-level timer/pause actions are deferred to Story 8.4 (see Dev Notes "BombAction scope").
  - [x] Update `packages/shared/src/types/index.ts` to export `BombAction` from `./actions.js`.
  - [x] Run `pnpm -r exec tsc --noEmit` to confirm the shared package still compiles cleanly.
  - [x] Do not add any runtime dependencies to `packages/shared`. It must stay zero-dependency (no react, socket.io, ioredis, pg).

- [x] **Task 2 — Module registry (AC: 4)**
  - [x] Create `apps/server/src/reducers/MODULE_REDUCERS.ts`. Define `type ModuleReducer = Reducer<ModuleState<unknown>, unknown>` (import `Reducer` and `ModuleState` from `@bomb-squad/shared`). Export a mutable `MODULE_REDUCERS: Record<string, ModuleReducer> = {}` — this starts empty; modules from Epic 5+ register into it additively. The bomb reducer never needs to be edited when a new entry is added here (that's the open/closed guarantee). Add a JSDoc note: "Add an entry here to register a module. Never edit bombReducer.ts to support a new module."
  - [x] Do not add any infra imports (`socket.io`, `ioredis`, `pg`, `fastify`, `react`). Only `@bomb-squad/shared` and relative imports allowed.

- [x] **Task 3 — `bombReducer` with open/closed delegation (AC: 1, 2, 3, 4)**
  - [x] Create `apps/server/src/reducers/bombReducer.ts`. Implement two exports:
    - `createBombReducer(registry: Record<string, ModuleReducer>): Reducer<BombState, BombAction>` — a factory that takes the registry as a parameter. This is the testable entry point; tests inject a fresh registry rather than mutating the global singleton.
    - `const bombReducer = createBombReducer(MODULE_REDUCERS)` — the production singleton, exported for handler use (Epic 2+).
  - [x] Inside `createBombReducer`, implement the returned reducer:
    - `MODULE_ACTION`: bounds-check `moduleIndex` (`0 <= moduleIndex < state.modules.length`; guard → return state). Lookup `MODULE_REDUCERS[mod.moduleId]`; if undefined, return state unchanged. Call `reduce(mod, action.payload)`. Apply the result via a private `applyModuleResult` helper (see Dev Notes "applyModuleResult contract"). Return a new `BombState` — never mutate in place.
    - Unknown action type (fall-through): return `state` unchanged. No throw.
  - [x] Implement `applyModuleResult(state: BombState, moduleIndex: number, next: ModuleState<unknown>): BombState` as a **private** (unexported) pure helper. Its contract:
    - Replace `state.modules[moduleIndex]` with `next` (immutable map).
    - If `next.status === 'struck'`: reset the module's status to `'armed'` in the new array, and increment `state.strikes` by 1 (capped at `3 as StrikeCount`).
    - Recalculate `solved`: `true` iff every module in the new array has `status === 'solved'`.
    - Return a new `BombState` via spread — never mutate the input object or its `modules` array.
  - [x] Import only from `@bomb-squad/shared` and `./MODULE_REDUCERS.js` (and `./index.js` barrel if needed). Zero infra imports.

- [x] **Task 4 — Barrel export (AC: 1)**
  - [x] Create `apps/server/src/reducers/index.ts`. Re-export `bombReducer`, `createBombReducer`, and `MODULE_REDUCERS` (and `ModuleReducer` type) from their respective files using `.js` extensions (NodeNext convention — non-negotiable).

- [x] **Task 5 — Test suite (AC: 1, 2, 3, 4)**
  - [x] Create `apps/server/src/reducers/__tests__/bombReducer.test.ts`. Tests drive `createBombReducer` with an **injected in-memory registry** — never mutate the global `MODULE_REDUCERS` singleton from a test. Write a `makeTestBomb(overrides?)` factory for concise test fixtures.
  - [x] **Guard — unknown moduleIndex** (AC2): call `bombReducer` with `moduleIndex: 99` on a bomb with 2 modules → returns the exact same state reference (no new object allocated).
  - [x] **Guard — unregistered moduleId** (AC2): call with a valid `moduleIndex` whose `moduleId` is not in the injected registry → returns state unchanged, no throw.
  - [x] **Happy path — module solved** (AC3): a stub module reducer that returns `{ ...state, status: 'solved' }` when called → `bomb.modules[i].status === 'solved'`; when all modules are solved, `bomb.solved === true`; returns a NEW object (not the same reference as input).
  - [x] **Strike roll-up** (AC3): a stub reducer that returns `{ ...state, status: 'struck' }` → `bomb.strikes` incremented by 1 (capped at 3), module status reset to `'armed'`, `bomb.solved === false`.
  - [x] **Idempotency** (AC3): applying the same solved-module action twice → second call is a no-op (module stays `'solved'`, `bomb.solved` stays true if all solved, no double-decrement).
  - [x] **Immutability** (AC3): call `createBombReducer` result on `Object.freeze(makeFrozenBomb())` — must not throw; returned state must be a new object distinct from the frozen input. Use `Object.freeze` recursively on the modules array too (`Object.freeze(modules.map(Object.freeze))`).
  - [x] **Open/closed** (AC4): add a stub module to the *test-local* registry; assert `bombReducer.ts` was not modified (this is a static code review guarantee, not a runtime test — document it as a "structural AC" in a comment; the test just exercises the delegation via the injected registry to demonstrate the pattern).
  - [x] Confirm the test gate is real (Story 1.1 / 1.4 lesson): temporarily break one assertion, verify `pnpm --filter @bomb-squad/server test` exits non-zero, then restore it before finalizing.

- [x] **Task 6 — Verify (AC: 1–4)**
  - [x] `pnpm --filter @bomb-squad/server test` exits 0. All new tests pass; existing 9 server tests are unaffected.
  - [x] `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces. No `// @ts-ignore`.
  - [x] Grep the new reducer files for `socket.io`, `ioredis`, `pg`, `fastify`, `react`, `Date.now`, `Math.random`, `setTimeout` — zero hits (proves AC1 mechanically).
  - [x] `packages/shared` test suite (`pnpm --filter @bomb-squad/shared test`) exits 0 — no regression from adding `actions.ts`.
  - [x] `apps/client` is untouched.

## Review Findings

_Code review 2026-06-12 (gds-code-review, 3-layer: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 4 ACs verified PASS; 28/28 server tests + tsc --noEmit reproduced clean by the Acceptance Auditor._

- [x] [Review][Patch] (resolved from Decision) Make already-solved modules inert for `MODULE_ACTION` — short-circuit in `bombReducer`: if the target module's `status === 'solved'`, return state unchanged. This also closes the `solved` `true → false` regression path. (Edge Case Hunter — bombReducer.ts:22,30-37) — **FIXED**: solved-inert guard added; 2 tests (inert no-op + no-regression).
- [x] [Review][Patch] (resolved from Decision) Add `MODULE_RESET` to `BombAction` + reducer handling + test, satisfying the project-context "6-case mandate" reset requirement. Reset delegates to the module reducer (bypassing the solved-inert guard) so the module restores its initial state. (Acceptance Auditor — actions.ts:8-9; project-context.md:164) — **FIXED**: `MODULE_RESET` variant + reducer case + 4 tests.
- [x] [Review][Patch] Strike-increment arithmetic only tested at boundaries (0→1 and 3→3 cap); intermediate 1→2 / 2→3 increments are unexercised [apps/server/src/reducers/__tests__/bombReducer.test.ts:99-130] — **FIXED**: added 1→2 and 2→3 increment tests.

_Patches applied 2026-06-12: 36/36 server tests pass (was 28), `pnpm -r exec tsc --noEmit` exit 0 across all three workspaces._
- [x] [Review][Defer] No runtime guard on module-reducer output contract — a reducer may return an out-of-contract `status` (anything not `armed|solved|struck` is silently treated as not-solved/not-struck) or change `moduleId`, rebinding the slot. [apps/server/src/reducers/bombReducer.ts:9-14] — deferred: module reducers are first-party/typed; revisit when the Epic 5 module plugin contract is built.

## Dev Notes

### What this story IS (and is NOT)

**IS:** the pure-reducer scaffold for the server — defining `BombAction`, the `MODULE_REDUCERS` plugin registry, and a fully tested `bombReducer` that is open/closed (never edited per-module). This establishes the patterns every future module (Epics 5–7) and game-loop story (Epic 8) plugs into.

**IS NOT:**
- **No Socket.IO event handlers.** Game handlers (`parse → load → reduce → persist → emit`) are Epic 2+. The reducers created here will be called FROM handlers, but no handler code lives in this story. Do not add anything to `apps/server/src/index.ts`.
- **No `sessionReducer` or `timerReducer` implementation.** The architecture lists these files under `reducers/` but they contain the session state machine (Epic 2) and authoritative clock (Story 8.4) respectively. Stub files are acceptable if the dev wants to reserve the paths, but no logic — leave them for the right stories.
- **No module implementations.** `MODULE_REDUCERS` starts empty. Actual modules (Wires, Button, etc.) register in Epic 5+.
- **No Redis/Postgres.** Reducers are pure functions with zero I/O. Never import `ioredis` or `pg`.
- **No changes to `apps/server/src/index.ts`.** Story 1.5 owns the last changes to `index.ts` for Epic 1. The bomb reducer will be imported by socket handlers in Epic 2, not by the boot file.

### Independence from Story 1.5

Story 1-6 does NOT depend on Story 1.5. Pure reducers have zero imports from `ioredis`/`pg` by definition. Story 1-5 creates `state/` and `persistence/` directories; Story 1-6 creates `reducers/` — these are completely orthogonal. This story can (and was) started while 1-5 is still in-progress on `master`.

**Branch strategy**: create a feature branch from the current `master` HEAD (`e1a90e1` or the latest 1-5 commit if it has since merged). The `reducers/` directory is new and will have zero merge conflicts with 1-5.

### BombAction scope — what's in, what's deferred

`BombAction` for this story contains only `MODULE_ACTION`. The architecture shows the bomb reducer also handles timer/pause actions (`// ... bomb-level actions (timer, pause) handled here`) — those are Story 8.4 (server-authoritative timer & strike escalation). When Story 8.4 adds new action variants to `BombAction`, `bombReducer.ts` will need to be updated for those new cases (that's acceptable — the open/closed principle applies to *module* additions, not to new top-level game mechanics).

```ts
// packages/shared/src/types/actions.ts
/**
 * Discriminated union of all actions the bomb reducer handles.
 * Bomb-level timer / pause actions are deferred to Story 8.4.
 */
export type BombAction =
  | { type: 'MODULE_ACTION'; moduleIndex: number; payload: unknown };
```

### applyModuleResult contract (read carefully before coding)

This unexported helper is the strike/solve roll-up logic. Key invariants:

1. **Immutability first**: build a new `modules` array via `.map(...)` — never `modules[i] = next`. Then build a new `BombState` via `{ ...state, modules: newModules, strikes: ..., solved: ... }`.

2. **Strike cap**: `StrikeCount` admits `0|1|2|3`. The third strike (3) means explosion — `BombState.strikes` can legally hold `3` as a terminal value (deferral from Story 1.3 review: whether to forbid resting `3` is deferred to Story 8.4). So the cap is `Math.min(state.strikes + 1, 3) as StrikeCount`.

3. **`'struck'` is transient**: when a module reducer returns `status: 'struck'`, the bomb reducer *resets* that status to `'armed'` in the persisted state before rolling up the team strike. The module itself never rests at `'struck'`. This invariant is documented in `ModuleState` (shared types) and the architecture. Verify your implementation.

4. **Solved check**: after building `newModules`, check `newModules.every(m => m.status === 'solved')`. Only then set `solved: true`. (A bomb with 0 modules is an edge case — `[].every(...)` is `true`; handle by requiring `newModules.length > 0` or document the edge case.)

5. **The guard runs BEFORE applyModuleResult**: if `moduleIndex` is out-of-bounds or `moduleId` is unregistered, return `state` unchanged — never call `applyModuleResult` in those paths.

Reference pattern (from architecture doc):
```ts
// apps/server/src/reducers/bombReducer.ts
const next = reduce(mod, action.payload);
return applyModuleResult(state, action.moduleIndex, next);
```

### testability via createBombReducer factory

The global `MODULE_REDUCERS` singleton is a mutable `Record`. Mutating it in tests causes cross-test pollution (same defect pattern as the `healthRegistry` singleton in Story 1.4's review). Use the factory pattern:

```ts
// bombReducer.ts
export function createBombReducer(registry: Record<string, ModuleReducer>): Reducer<BombState, BombAction> {
  return (state, action) => {
    if (action.type === 'MODULE_ACTION') {
      const mod = state.modules[action.moduleIndex];
      if (!mod) return state;
      const reduce = registry[mod.moduleId];
      if (!reduce) return state;
      return applyModuleResult(state, action.moduleIndex, reduce(mod, action.payload));
    }
    return state;
  };
}

export const bombReducer = createBombReducer(MODULE_REDUCERS);
```

Tests use `createBombReducer({ 'test-mod': myStubReducer })` — never touching the singleton.

### Test fixture helpers

Use a `makeTestBomb` factory to avoid repetitive fixture setup:

```ts
function makeTestBomb(overrides?: Partial<BombState>): BombState {
  return {
    context: {
      serialNumber: 'AB1234',
      batteryCount: 2,
      indicators: [],
      ports: [],
    },
    modules: [
      { moduleId: 'test-mod', status: 'armed', data: {} },
    ],
    strikes: 0,
    solved: false,
    ...overrides,
  };
}
```

For the immutability test, freeze recursively:
```ts
const frozenBomb = Object.freeze({
  ...makeTestBomb(),
  modules: Object.freeze([Object.freeze({ moduleId: 'test-mod', status: 'armed' as const, data: {} })]),
} as BombState);
```

### NodeNext `.js` import extensions (non-negotiable)

Every relative import inside `apps/server/src` uses a `.js` extension even though the file is `.ts`:
- `import { MODULE_REDUCERS } from './MODULE_REDUCERS.js'`
- `import type { ModuleReducer } from './MODULE_REDUCERS.js'`

Cross-workspace imports from `@bomb-squad/shared` use the bare specifier (no extension — resolved via the workspace `exports` map). This was established Stories 1.1–1.5 and is required for NodeNext resolution; violating it breaks `tsc --noEmit`.

### Jest setup — reuse Story 1.4's exact recipe

`apps/server` already has a working Jest + ESM + ts-jest setup from Story 1.4 (`jest.config.cjs`, `isolatedModules: true` in `tsconfig.json`, `NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest` test script). New test files under `src/reducers/__tests__/` work automatically. Do not change `jest.config.cjs` or the test script.

### No new dependencies required

This story adds no new `npm` packages to any workspace. Everything needed is:
- `@bomb-squad/shared` (already a workspace dep in `apps/server`)
- Node.js built-ins (none needed for pure reducers)

Do NOT run `pnpm install` unless you somehow determine a package was missed.

### File locations (authoritative — from architecture project structure)

```
packages/shared/
  src/
    types/
      actions.ts          NEW — BombAction discriminated union
      index.ts            UPDATE — export BombAction from ./actions.js

apps/server/
  src/
    reducers/             NEW DIR
      MODULE_REDUCERS.ts  NEW — ModuleReducer type + empty mutable registry
      bombReducer.ts      NEW — createBombReducer factory + bombReducer singleton
      index.ts            NEW — barrel re-export
      __tests__/
        bombReducer.test.ts  NEW — 6-case test suite
```

Do NOT create `sessionReducer.ts`, `timerReducer.ts`, `handlers/`, `session/`, or `generation/` — those are later stories.
Do NOT modify `apps/server/src/index.ts` — no handler wiring needed yet.

### Existing code state (what you inherit)

- **`packages/shared/src/types/`** (Stories 1.2, 1.3): `BombState`, `ModuleState<S>`, `Reducer<S,A>`, `TimerState`, `StrikeCount` all exist and are exported. Import them freely. `BombState.modules` is `ModuleState<unknown>[]`, `BombState.strikes` is `StrikeCount` (0|1|2|3), `BombState.solved` is `boolean`.
- **`apps/server` Jest harness** (Story 1.4): `jest.config.cjs` with `ts-jest/presets/default-esm` + `isolatedModules: true`; 9 passing server tests already exist. Your new tests must not regress them.
- **`apps/server/src/health/registry.ts`** (Story 1.4): singleton `healthRegistry` — irrelevant to reducers, do not import or touch it.
- **`apps/server/src/state/` and `apps/server/src/persistence/`** (Story 1.5, in-progress): being created by the 1.5 developer. Reducers must NEVER import from these directories (that would violate AC1 and the architecture's handler=I/O / reducer=logic invariant).

### Previous-story learnings (Stories 1.1–1.5) that apply here

- **Pure/impure split for testability** — factories take injected dependencies; global singletons are for production use only. (Lesson from Story 1.4's `process.exit`-on-import bug; Story 1.5's `createRedisStore(fake)` pattern.)
- **Prove the test gate is real** — a deliberately broken assertion must turn the suite red before you declare done (Story 1.1 false-green).
- **Singleton mutation causes cross-test pollution** — Story 1.4 review found `healthRegistry` singleton leaking between tests. Use `createBombReducer` injection to avoid the same defect.
- **No `// @ts-ignore`** — `pnpm -r exec tsc --noEmit` and CI enforce it.
- **No shared root tsconfig** — each workspace owns its own.
- **NodeNext `.js` import extensions** — established Stories 1.1–1.5; do not deviate.

### Project Context Rules (binding — from project-context.md)

- **Pure reducers, zero I/O**: `(state, event) => newState` — reducers import nothing from `socket.io`, `ioredis`, `pg`, `fastify`, or `react`. Never mutate state in place; always return new objects via spread/map. Unknown actions fall through returning state unchanged (no throws). `Date.now()` / `Math.random()` / `setTimeout` are forbidden inside reducers.
- **Handler = I/O, reducer = logic**: These reducers will be called FROM socket handlers (Epic 2+). The socket handlers own all I/O: `parse & validate → load from Redis → call reducer → persist → broadcast`. Reducers never see a Redis client.
- **Open/closed module system**: `bombReducer.ts` is never edited to add a module. New modules register in `MODULE_REDUCERS`. This is the single most important extensibility property.
- **TypeScript throughout**: No `.js` source files. `tsc --noEmit` must pass with zero errors.
- **Immutability tests are mandatory**: Never skip the frozen-input test — mutation bugs are silent in TypeScript.
- **Pure reducer test requirements** (for the bomb reducer and all future module reducers): happy path, wrong interaction (strike), idempotency, immutability (frozen input), guard clauses, reset.
- **Test file location**: `apps/server/src/reducers/__tests__/` (not in shared; not in handlers).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.6: Pure-Reducer Harness & Open/Closed Bomb Reducer] (the four Given/When/Then ACs)
- [Source: _agent_docs/game-architecture.md#Pattern 2 — Pure-Reducer Game Core] (bombReducer snippet; MODULE_REDUCERS delegation; applyModuleResult; no-infra rule)
- [Source: _agent_docs/game-architecture.md#Pattern 3 — Open/Closed Module Plugin System] (registry pattern; bombReducer never edited per-module)
- [Source: _agent_docs/game-architecture.md#Project Structure → apps/server → reducers/] (file layout: bombReducer.ts, MODULE_REDUCERS.ts, __tests__/)
- [Source: _agent_docs/game-architecture.md#Testing Strategy] (pure reducer test locations; the 6-case test mandate)
- [Source: _agent_docs/game-architecture.md#ADR-002 — Pure-reducer game core] and [ADR-003 — Open/closed module plugin system]
- [Source: packages/shared/src/types/bomb.ts] (BombState, BombContext, StrikeCount — import directly)
- [Source: packages/shared/src/types/module.ts] (ModuleState<S>, IModule<S,A>)
- [Source: packages/shared/src/types/reducer.ts] (Reducer<S,A> type)
- [Source: _agent_docs/project-context.md#Critical Implementation Rules → Server-Authoritative State (Pure Reducer Pattern)] (binding rules)
- [Source: _agent_docs/project-context.md#Testing Rules] (6-case mandate; immutability never skip; no setTimeout in reducer tests)
- [Source: _agent_docs/implementation-artifacts/1-4-server-bootstrap-fastify-socketio-health.md#Dev Notes] (Jest ESM + ts-jest recipe; .js import convention; singleton-pollution lesson from code review)
- [Source: _agent_docs/implementation-artifacts/1-5-data-store-adapters-redis-keyspace-and-postgres-pool.md#Dev Notes] (pure/impure split pattern; why registration happens in boot not module-load)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (StrikeCount admits 3 as steady-state — deferred to Story 8.4; resolve as cap-at-3 for now)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (gds-dev-story workflow). Implemented in git worktree `../Ktane-story-1-6` on branch `story/1-6-pure-reducer-harness`.

### Debug Log References

1. **`@jest/globals` import not needed** — the story spec suggested importing from `@jest/globals`, but existing server tests use Jest globals via `@types/jest` without an explicit import. Removed the import to match the established project pattern; `tsc --noEmit` was the signal (`TS2307: Cannot find module '@jest/globals'`).

### Completion Notes List

- All 4 ACs satisfied:
  - AC1 (no infra imports): grep of `reducers/` for `socket.io`, `ioredis`, `pg`, `fastify`, `react`, `Date.now`, `Math.random`, `setTimeout` → zero hits.
  - AC2 (guard clauses): out-of-bounds `moduleIndex` returns exact same state reference; unregistered `moduleId` returns state unchanged; neither throws.
  - AC3 (immutability): deeply frozen `BombState` (modules array and each element also frozen) → no throw; result is a new object distinct from the frozen input. All spread/map — no in-place mutation anywhere.
  - AC4 (open/closed): injecting a new module into the test-local registry exercises delegation without any edit to `bombReducer.ts`.
- 28/28 tests pass — 19 new reducer tests + 9 existing server tests (zero regressions). 24/24 shared tests also green.
- `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces.
- Test gate proven real: a deliberately broken assertion (`toBe(99)`) turned the suite red (1 failed, exit 1), then restored.
- `apps/client` untouched. `apps/server/src/index.ts` untouched (1-5 is not this story's concern).
- `applyModuleResult` correctly handles the transient `'struck'` status: resets module to `'armed'`, caps strikes at 3 as `StrikeCount`.
- `createBombReducer(registry)` factory pattern prevents singleton pollution — the same defect found in Story 1.4's `healthRegistry` review.

### File List

- `packages/shared/src/types/actions.ts` (A) — `BombAction` discriminated union (`MODULE_ACTION` only)
- `packages/shared/src/types/index.ts` (M) — added `export type { BombAction }` from `./actions.js`
- `apps/server/src/reducers/MODULE_REDUCERS.ts` (A) — `ModuleReducer` type + empty `MODULE_REDUCERS` registry
- `apps/server/src/reducers/bombReducer.ts` (A) — `createBombReducer` factory + `bombReducer` singleton + private `applyModuleResult`
- `apps/server/src/reducers/index.ts` (A) — barrel re-export
- `apps/server/src/reducers/__tests__/bombReducer.test.ts` (A) — 19-test suite (guards, happy path, strike roll-up, idempotency, immutability, open/closed, unknown-action fall-through)

## Change Log

- 2026-06-12: Story 1.6 drafted — BombAction type, MODULE_REDUCERS registry, open/closed bombReducer with createBombReducer factory, 6-case test suite. Confirmed independent of Story 1.5 (pure reducers have zero ioredis/pg imports). Status: ready-for-dev.
- 2026-06-12: Story 1.6 implemented on worktree branch `story/1-6-pure-reducer-harness`. BombAction in shared, MODULE_REDUCERS registry, bombReducer with guard clauses + applyModuleResult + open/closed delegation; 28/28 tests pass; full monorepo typecheck clean. Status: review.
