---
baseline_commit: fff5fc6
---

# Story 1.2: Shared Contracts — Core Types & Typed Events

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the core game-state types and the typed Socket.IO event interfaces defined once in `packages/shared`,
so that client and server share a single source of truth and untyped events are impossible.

## Acceptance Criteria

1. **Core type model available from `packages/shared/src/types`.** `SessionState`, `BombState`, `BombContext`, `ModuleState<S>`, `IModule<S,A>`, `Reducer<S,A>`, and `TimerState` are defined per the architecture data model (plus all required supporting types: `IndicatorLabel`, `PortType`, `TeamId`, `TeamState`, `RoundConfig`, `PlayerRole`, `ManualPage`). `BombContext.serialNumber` is documented with a code comment that its last character is always a digit.

2. **Typed Socket.IO event interfaces in `packages/shared/src/events`.** `ServerToClientEvents` and `ClientToServerEvents` are defined as TypeScript interfaces with all representative events from the architecture API surface (event payloads defined alongside). No import of `socket.io` or `socket.io-client` in `packages/shared` itself — pure TypeScript interfaces.

3. **Cross-package type resolution verified.** `apps/client/src/App.tsx` and `apps/server/src/index.ts` each contain at least one `import type { ... } from '@bomb-squad/shared'` that proves cross-workspace TS resolution works. `pnpm -r exec tsc --noEmit` still passes with zero errors.

4. **`packages/shared/src/index.ts` re-exports all new types/events.** The main barrel export is updated so consumers can import everything from `'@bomb-squad/shared'` directly.

5. **Untyped emit enforcement documented.** The story confirms that `socket.emit(string, any)` fails type-checking once the socket instances are typed in Stories 1.4 (server) and 1.7 (client). A type comment in the events index documents how the interfaces must be wired.

## Tasks / Subtasks

- [x] **Task 1 — Core game-state types in `packages/shared/src/types/` (AC: 1)**
  - [x] `types/reducer.ts` — Export `type Reducer<S, A> = (state: S, action: A) => S`. This single type is referenced by every module and the bomb reducer — define it here, import everywhere else.
  - [x] `types/bomb.ts` — Export `IndicatorLabel` (union of 11 labels), `PortType` (union of 6 ports), `BombContext` (with **code comment: serialNumber last char ALWAYS a digit**), `BombState` (modules[], strikes 0–3, solved).
  - [x] `types/module.ts` — Export `ModuleState<S>` (moduleId, status: 'armed'|'solved'|'struck', data: S), `ManualPage` (structured content — NOT raw HTML), `IModule<S,A>` interface with `id`, `generate(seed: number, ctx: BombContext): S`, `reduce: Reducer<ModuleState<S>, A>`, `getManualPages(): ManualPage[]`, and optional `onTick?(state: ModuleState<S>, now: number): ModuleState<S>`.
  - [x] `types/session.ts` — Export `PlayerRole` ('facilitator'|'defuser'|'expert'|'spectator'), `TeamId` ('A'|'B'), `DifficultyTier` ('easy'|'medium'|'hard'), `RoundConfig`, `PlayerInfo`, `TeamState`, `ModifierConfig`, `SessionState` exactly per architecture data model.
  - [x] `types/timer.ts` — Export `TimerState` (startedAt, remainingAtStart, speedMultiplier, pausedAt: number|null).
  - [x] `types/index.ts` — Barrel re-export of all five files above; remove `types/.gitkeep`.

- [x] **Task 2 — Typed Socket.IO event interfaces in `packages/shared/src/events/` (AC: 2)**
  - [x] `events/payloads.ts` — Define all event payload types: `ModuleUpdate`, `SessionJoinPayload`, `TeamAssignPayload`, `RoundRetryPayload`, `LifelineSendPayload`, `LifelineToastPayload`, `ErrorPayload` (code, message, recoverable), `StrikePayload`, `RoundEndPayload`, `ScoreboardPayload`. No socket.io import needed — pure TS types.
  - [x] `events/client-to-server.ts` — Export `ClientToServerEvents` interface. All events from architecture API Contracts (SESSION_CREATE, SESSION_JOIN, TEAM_ASSIGN, ROUND_CONFIGURE, ROUND_START, MODULE_INTERACT, FACILITATOR_PAUSE, FACILITATOR_RESUME, ROUND_RETRY, LIFELINE_SEND). Each event maps to its payload callback signature.
  - [x] `events/server-to-client.ts` — Export `ServerToClientEvents` interface. All events from architecture (SESSION_STATE, BOMB_INIT, MODULE_UPDATE, TIMER_UPDATE, STRIKE, BOMB_DEFUSED, BOMB_EXPLODED, SCOREBOARD, LIFELINE_TOAST, PAUSED, RESUMED, ERROR). Each event maps to its payload callback signature.
  - [x] `events/index.ts` — Barrel re-export + add wiring instruction comment (see Dev Notes); remove `events/.gitkeep`.

- [x] **Task 3 — Update `packages/shared/src/index.ts` (AC: 4)**
  - [x] Replace the stub `export const SHARED_PACKAGE = ...` with full re-exports: `export * from './types/index.js'` and `export * from './events/index.js'`.

- [x] **Task 4 — Cross-package import smoke-test (AC: 3)**
  - [x] In `apps/client/src/App.tsx` added `import type { BombState } from '@bomb-squad/shared';` (type-only). Declared `"@bomb-squad/shared": "workspace:*"` in client's `package.json`.
  - [x] In `apps/server/src/index.ts` added `import type { SessionState } from '@bomb-squad/shared';` (type-only). Declared `"@bomb-squad/shared": "workspace:*"` in server's `package.json`.
  - [x] `pnpm -r exec tsc --noEmit` exits 0 with zero errors.

- [x] **Task 5 — Entrypoint resolution decision (Deferred from 1.1) (AC: 3)**
  - [x] Updated `packages/shared/package.json` exports to `{ "types": "./src/index.ts", "import": "./src/index.ts", "default": "./src/index.ts" }` for explicit TypeScript condition.
  - [x] Added `.js` extensions to ALL relative imports inside `packages/shared` to satisfy NodeNext resolution when the server's tsc processes shared source. Bundler resolution also accepts `.js` extensions.
  - [x] Closed deferred item in `_agent_docs/implementation-artifacts/deferred-work.md`.

- [x] **Task 6 — Verify end-to-end (AC: 1–5)**
  - [x] `pnpm -r exec tsc --noEmit` exits 0, zero errors across all three workspaces (only expected Node engine warning).
  - [x] All 7 named types importable from `@bomb-squad/shared` by name.
  - [x] No `// @ts-ignore` added anywhere.
  - [x] `packages/shared/package.json` has no new runtime dependencies — only `typescript` devDep, zero framework deps.

## Dev Notes

### Scope discipline (read first)

This story defines types and interfaces only. It deliberately does NOT:
- Add socket.io, ioredis, pg, react, or any framework as a dependency to `packages/shared` (architectural hard rule)
- Implement any game logic or socket wiring (Stories 1.4/1.7)
- Set up Jest (deferred to Story 1.3/1.6 — no test runner yet, just tsc verification)
- Define per-module specific state types like `WiresState` (those come in Epic 5)

### Type design decisions

**`Reducer<S, A>`** — one-liner in its own file (`types/reducer.ts`). Imported by `IModule`, `bombReducer`, `sessionReducer`, etc. Define here, reference everywhere. Never inline this type.

**`IModule<S, A>` must include `onTick`** — even though V2 needy modules aren't built until much later, the interface must carry the optional `onTick?(state: ModuleState<S>, now: number): ModuleState<S>` hook now. The `IModule` plugin registry is open/closed: adding a new module never changes the interface. If `onTick` is added to the interface later, all existing implementations must be updated — introduce it now as optional to avoid that churn.

**`ModuleState<S>.status = 'struck'` is transient** — when a reducer returns a `struck` status, the bomb reducer (`bombReducer.ts`, Story 1.6) rolls it up into a team strike count and resets the module status to 'armed'. Reducers return `struck` to signal a mistake; they never hold that state permanently. Document this in the type comment.

**`BombContext.serialNumber` — last char ALWAYS a digit.** This is a rule referenced by multiple game modules (Complicated Wires S-code, Wire Sequences, Simon Says serial-vowel check, etc.). Add a JSDoc comment on the `serialNumber` field: `/** Last character is always a digit (0–9). */`. Misreading this causes silent module rule bugs — it is the #1 gotcha in project-context.md.

**`BombContext` is read-only.** Type it as `Readonly<BombContext>` or use `readonly` on every field. Modules receive it via `generate(seed, ctx)` and must never mutate it. This is enforced structurally, not just by convention.

**`TimerState.pausedAt: number | null`** — NOT a boolean. It is the epoch-ms timestamp at which the clock was frozen. A null means running. The client extrapolates from `startedAt + remainingAtStart - (now - startedAt) * speedMultiplier`; when `pausedAt` is set, displayed time = `remainingAtStart - (pausedAt - startedAt) * speedMultiplier`.

**`TeamId = 'A' | 'B'`** — the game has exactly two teams. Use a string literal union rather than a generic `string`. Redis keys use `session:{id}:team:A` and `session:{id}:team:B`.

**`RoundConfig` shape** (needed by Session and Handler stories):
```ts
interface RoundConfig {
  difficulty: DifficultyTier;
  moduleCount: number;          // 3–11
  timerMs: number;              // milliseconds
  strikeSpeedUpPct: number;     // 0–50, compounding; default 25
  modulePool?: string[];        // override module ids; undefined = tier default
  modifiers: ModifierConfig;
}

interface ModifierConfig {
  asymmetricExpertRoles: boolean;
  spectatorLifelines: boolean;
}
```

**`ManualPage` shape** — structured data, NOT raw HTML or untyped JSX:
```ts
interface ManualPage {
  chapterId: string;        // e.g. "wires"
  chapterTitle: string;
  sections: ManualSection[];
}

interface ManualSection {
  heading?: string;
  content: string;         // plain text or a structured table descriptor
  table?: ManualTable;     // optional structured table
}
```

### Socket.IO event interface wiring (how to use)

The interfaces in `packages/shared/src/events/` are pure TypeScript — no socket.io import. The wiring instructions belong as a comment in `events/index.ts`:

```ts
// Server wires as:
//   const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer)
//   const socket: Socket<ClientToServerEvents, ServerToClientEvents> = ...
// Client wires as:
//   const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url)
// Note: Server and Socket have reversed generic parameter order.
// Once wired, socket.emit(unknownEvent, payload) is a TS compile error.
```

Once Socket.IO instances are typed this way in Stories 1.4 and 1.7, `socket.emit('random_string', {})` becomes a TypeScript error — satisfying AC 3. Story 1.2's job is to define the interfaces; the enforcement is validated in 1.4/1.7.

**Event naming rule: ALL Socket.IO event names are `SCREAMING_SNAKE_CASE`.** This comes from project-context.md and the architecture. Do not use camelCase or kebab-case event names.

### File locations (authoritative)

```
packages/shared/src/
  types/
    reducer.ts          NEW — Reducer<S, A> type
    bomb.ts             NEW — BombContext (readonly), BombState, IndicatorLabel, PortType
    module.ts           NEW — ModuleState<S>, IModule<S,A>, ManualPage, ManualSection, ManualTable
    session.ts          NEW — SessionState, TeamState, TeamId, RoundConfig, PlayerInfo, PlayerRole, DifficultyTier, ModifierConfig
    timer.ts            NEW — TimerState
    index.ts            NEW — barrel re-export (replaces .gitkeep)
  events/
    payloads.ts         NEW — ModuleUpdate, ModuleInteract, all event payload types
    client-to-server.ts NEW — ClientToServerEvents interface
    server-to-client.ts NEW — ServerToClientEvents interface
    index.ts            NEW — barrel re-export + wiring comment (replaces .gitkeep)
  index.ts              UPDATE — re-export types/* and events/* (replaces SHARED_PACKAGE stub)
  modules/              UNTOUCHED — .gitkeep stays; per-module types come in Epic 5
  seeding/              UNTOUCHED — .gitkeep stays; seeding utility is Story 1.3
apps/client/src/App.tsx UPDATE — add import type { BombState } from '@bomb-squad/shared' (type-only)
apps/server/src/index.ts UPDATE — add import type { SessionState } from '@bomb-squad/shared' (type-only)
_agent_docs/implementation-artifacts/deferred-work.md UPDATE — close entrypoint deferred item (if smoke-test passes)
```

### Architecture source (authoritative data model)

All type shapes above are derived from architecture section **"Core Type Model"** and **"API Contracts → Socket.IO Event Surface"**:
- `SessionState`, `BombState`, `BombContext` — `game-architecture.md#Data Architecture → Core Type Model`
- `IModule<S, A>`, `ModuleState<S>` — `game-architecture.md#Novel Pattern Designs → Pattern 3`
- `Reducer<S, A>` — `game-architecture.md#Novel Pattern Designs → Pattern 2`
- `TimerState` — `game-architecture.md#Novel Pattern Designs → Pattern 5`
- `ModuleUpdate` — `game-architecture.md#Novel Pattern Designs → Pattern 6`
- Full event tables — `game-architecture.md#API Contracts → Socket.IO Event Surface`

### Previous story learnings (Story 1.1)

- **esbuild build scripts**: `pnpm.onlyBuiltDependencies: ["esbuild"]` is already in root `package.json`. No action needed.
- **Node engine mismatch**: Local machine runs v25.6.1 vs pinned `>=20 <21`. `tsc --noEmit` still exits 0 despite the warning — this is expected. Do not add `nvm use 20` as a blocker.
- **Per-workspace tsconfig**: Do NOT create a shared root tsconfig. Each workspace (`packages/shared`, `apps/client`, `apps/server`) has its own complete `tsconfig.json`. This is already true from 1.1.
- **Entrypoint strategy**: `packages/shared/package.json` currently exposes `./src/index.ts` as the module entry. This works for all consumers (Vite+tsx). Task 5 validates this and closes the deferred item if the smoke-test passes.
- **No `// @ts-ignore`**: The pre-commit hook and CI gate enforce this. Never add it.
- **Test locations for pure-logic tests**: `packages/shared/src/__tests__/`. Jest setup deferred to Story 1.3 or 1.6. For story 1.2, type-correctness is verified by `tsc --noEmit` only.

### Project Context Rules

From `project-context.md` — binding for this story:

- **`packages/shared` ZERO runtime deps** on react, socket.io, fastify, ioredis, pg, or any framework. Events interfaces are pure TypeScript — no import needed. `devDependencies` may only include `typescript` (already present).
- **TypeScript everywhere** — no `.js` files. All new files are `.ts`.
- **Socket.IO event names: `SCREAMING_SNAKE_CASE`** — enforced by the typed interfaces.
- **Server uses `ServerToClientEvents` / `ClientToServerEvents`** — typed Socket.IO pattern from `project-context.md#Web Stack & Architecture Rules`.
- **`BombContext.serialNumber` last char always a digit** — document in type definition; referenced by at minimum Complicated Wires, Wire rules, and Simon Says module logic in Epics 5–7.
- **All module types defined in `packages/shared/src/modules/` and re-exported** — for this story, the generic `IModule<S,A>` and `ModuleState<S>` live in `types/module.ts`. Per-module concrete types (e.g., `WiresState`) go in `modules/` in Epic 5 stories.
- **Module IDs: `kebab-case`** (e.g., `"wires"`, `"simon-says"`). Referenced in `IModule.id: string` — add a JSDoc comment noting the convention.
- **No MCP servers required** for this story.

### References

- [Source: _agent_docs/game-architecture.md#Data Architecture → Core Type Model]
- [Source: _agent_docs/game-architecture.md#Novel Pattern Designs → Pattern 2 (Pure Reducer)]
- [Source: _agent_docs/game-architecture.md#Novel Pattern Designs → Pattern 3 (IModule Contract)]
- [Source: _agent_docs/game-architecture.md#Novel Pattern Designs → Pattern 5 (TimerState)]
- [Source: _agent_docs/game-architecture.md#Novel Pattern Designs → Pattern 6 (ModuleUpdate)]
- [Source: _agent_docs/game-architecture.md#API Contracts → Socket.IO Event Surface]
- [Source: _agent_docs/game-architecture.md#Consistency Rules → Naming Conventions]
- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.2: Shared Contracts]
- [Source: _agent_docs/project-context.md#Web Stack & Architecture Rules → Socket.IO / Shared Types]
- [Source: _agent_docs/project-context.md#Code Organization Rules]
- [Source: _agent_docs/implementation-artifacts/1-1-monorepo-and-build-scaffold.md#Deferred Items]
- [Source: _agent_docs/implementation-artifacts/deferred-work.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Cross-package `import type` failed initially: `@bomb-squad/shared` not declared as a dependency in `apps/server` or `apps/client` → fixed by adding `"@bomb-squad/shared": "workspace:*"` to both `package.json` files + `pnpm install`.
- After adding workspace deps, NodeNext resolution in `apps/server` processes `packages/shared/src/index.ts` under NodeNext rules and required explicit `.js` extensions on relative imports (TS2834). Fixed by adding `.js` to all relative imports inside `packages/shared` throughout (Bundler resolution in shared's own tsconfig also accepts `.js` fine).
- Updated `packages/shared/package.json` exports from bare `"./src/index.ts"` to a condition map with explicit `"types"` key for proper TypeScript NodeNext resolution.

### Completion Notes List

- Defined all 7 AC-named types plus full supporting surface: `Reducer<S,A>`, `TimerState`, `PlayerRole`, `TeamId`, `DifficultyTier`, `ModifierConfig`, `RoundConfig`, `PlayerInfo`, `TeamState`, `SessionState`, `ManualTable`, `ManualSection`, `ManualPage`, `ModuleState<S>`, `IModule<S,A>`, `IndicatorLabel`, `PortType`, `BombContext`, `BombState`.
- `BombContext.serialNumber` carries JSDoc: "Last character is always a digit (0–9)." `ModuleState.status = 'struck'` documents transient roll-up behavior.
- `IModule` includes optional `onTick?` for V2 needy modules to avoid future interface churn.
- Defined full `ServerToClientEvents` (12 events) and `ClientToServerEvents` (10 events) with typed payloads — no socket.io import in `packages/shared`.
- Resolved deferred entrypoint item from Story 1.1: added `.js` extensions throughout shared, updated `package.json` exports to include `"types"` condition, both apps now declare `"@bomb-squad/shared": "workspace:*"`.
- `pnpm -r exec tsc --noEmit` exits 0 with zero errors across all three workspaces.
- `packages/shared` still has zero runtime framework dependencies (only `typescript` devDep).

### File List

- packages/shared/src/index.ts (updated)
- packages/shared/src/types/reducer.ts (new)
- packages/shared/src/types/bomb.ts (new)
- packages/shared/src/types/module.ts (new)
- packages/shared/src/types/session.ts (new)
- packages/shared/src/types/timer.ts (new)
- packages/shared/src/types/index.ts (new — replaces .gitkeep)
- packages/shared/src/events/payloads.ts (new)
- packages/shared/src/events/client-to-server.ts (new)
- packages/shared/src/events/server-to-client.ts (new)
- packages/shared/src/events/index.ts (new — replaces .gitkeep)
- packages/shared/package.json (updated — exports conditions + workspace dep added by apps)
- apps/client/package.json (updated — added @bomb-squad/shared workspace dep)
- apps/client/src/App.tsx (updated — import type smoke-test)
- apps/server/package.json (updated — added @bomb-squad/shared workspace dep)
- apps/server/src/index.ts (updated — import type smoke-test)
- pnpm-lock.yaml (updated — new workspace links)
- _agent_docs/implementation-artifacts/deferred-work.md (updated — closed entrypoint deferred item)
- _agent_docs/implementation-artifacts/sprint-status.yaml (updated — story moved to review)

## Review Findings

_Code review 2026-06-11 — 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 5 ACs confirmed substantively satisfied. Findings below are contract-shape concerns surfaced for a foundational types story (cheap to fix now, costly to churn across 8 epics later)._

### Decisions Needed (resolved 2026-06-11 — all to recommended fix; applied)

- [x] [Review][Decision→Patch] Strike count two sources of truth → **Dropped `bombDelta` from `ModuleUpdate`; `STRIKE` / `TIMER_UPDATE` are the sole channels.** [payloads.ts]
- [x] [Review][Decision→Patch] Module addressing mismatch → **Kept `moduleIndex` addressing; documented invariant `modules[moduleIndex].moduleId === state.moduleId` + server-side bounds-check obligation on both `ModuleInteractPayload` and `ModuleUpdate`.** [payloads.ts]
- [x] [Review][Decision→Patch] No ack channel on client→server events → **Added `SessionCreatedPayload` and an ack callback to `SESSION_CREATE`.** [client-to-server.ts, payloads.ts]
- [x] [Review][Decision→Patch] `TimerState` pause/speed model → **Documented the segment-reset convention in `TimerState` JSDoc (fresh segment on pause-resume and on every `speedMultiplier` change; formula valid only within a segment; substitute `pausedAt` for `now` when frozen).** [timer.ts]
- [x] [Review][Decision→Patch] Scoreboard vs Session team-map contradiction → **`ScoreboardPayload.teams` now `Partial<Record<TeamId,…>>`.** [payloads.ts]
- [x] [Review][Decision→Patch] `SessionState.modifiers` duplication → **Dropped the top-level `modifiers`; `config.modifiers` is canonical.** [session.ts]
- [x] [Review][Decision→Patch] Ranges/invariants comment-only → **Added `StrikeCount = 0 | 1 | 2 | 3` (used by `BombState.strikes` + `StrikePayload.strikes`); config bounds left to runtime validation.** [bomb.ts, payloads.ts]

### Patches (applied 2026-06-11)

- [x] [Review][Patch] `BombState.context` simplified from `Readonly<BombContext>` (no-op wrapper) to `BombContext`. [bomb.ts]
- [x] [Review][Patch] Documented `ScoreboardPayload.teams.rounds` semantics (per-round elapsed ms; success/failure via BOMB_DEFUSED/BOMB_EXPLODED). [payloads.ts]
- [x] [Review][Patch] Added `sprint-status.yaml` to the File List. [this file]

### Deferred

- [x] [Review][Defer] `PAUSED`/`RESUMED` carry only `reason: string` (no `TimerState`); partly redundant with `TIMER_UPDATE` — refine when the timer/pause story (1.4+) lands. [server-to-client.ts, payloads.ts] — deferred, depends on consuming story
- [x] [Review][Defer] Referential integrity unmodeled — `PlayerInfo.teamId` can disagree with `TeamState.relayOrder` membership — runtime concern for the session-state story. [session.ts] — deferred, runtime validation concern

## Change Log

- 2026-06-10: Story 1.2 implemented — full shared type surface (core types + typed Socket.IO events) in packages/shared; cross-workspace deps declared and typechecking verified zero errors; NodeNext entrypoint strategy resolved.
- 2026-06-11: Code review — 5 ACs satisfied; 7 decision_needed, 3 patch, 2 deferred, 7 dismissed. See Review Findings.
