---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - _agent_docs/game-architecture.md
  - apps/client/package.json
---

# Story TD-3: React 19 + React-Three-Fiber 9 Coordinated Upgrade

Status: ready-for-dev

<!-- Tech-debt story (not from an epic). The HIGH-RISK slice of the dependency-refresh
     batch. React 18→19 is COUPLED to R3F 8→9 / drei 9→10 / camera-controls 2→3 — they
     must move together in one story because R3F 9 requires React 19. Touches the entire
     3D bomb scene. Do this AFTER TD-1 (component test framework) so the UI has a safety net. -->

## Story

As a developer on the client,
I want React, react-dom, react-three-fiber, drei, and camera-controls upgraded together to their current major generation (React 19 / R3F 9 / drei 10 / camera-controls 3),
so that the 3D bomb renderer stays on a supported, coherent ecosystem version — done as one coordinated migration because these packages are version-locked to each other, not as independent bumps.

## Context — verified 2026-06-14 (`pnpm outdated -r`)

| Package | Current | Latest | Why coupled |
|---|---|---|---|
| `react` | 18.3.1 | 19.2.x | base |
| `react-dom` | 18.3.1 | 19.2.x | must match `react` |
| `@types/react` | 18.3.x | 19.2.x | must match `react` |
| `@types/react-dom` | 18.3.x | 19.2.x | must match `react-dom` |
| `@react-three/fiber` | 8.18.0 | 9.6.x | **R3F 9 requires React 19** — this is the lock |
| `@react-three/drei` | 9.122.0 | 10.7.x | drei 10 pairs with R3F 9 |
| `camera-controls` | 2.10.1 | 3.1.x | used by the camera rig; major bump rides along |

**These cannot be bumped independently.** R3F 9 drops React 18 support, so React 19 + R3F 9 + drei 10 are a single atomic change; `camera-controls` 3 is folded in because it's part of the same scene/camera surface. This is **client-only** — `apps/server` and `packages/shared` have no React.

This story touches the **entire 3D surface**: `apps/client/src/scenes/*` (`BombScene`, `BombStage`, `ChassisFeatures`, `ModuleBay`, `StrikeIndicator`, `TimerLcd`, `DevBombHarness`) and the module `DefuserView` components (`modules/dev-demo`, `modules/wires`).

## Acceptance Criteria

1. **Given** the coupled set, **When** the upgrade is applied, **Then** `react`/`react-dom`/`@types/react`/`@types/react-dom` are on **19.x**, `@react-three/fiber` on **9.x**, `@react-three/drei` on **10.x**, and `camera-controls` on **3.x**, all in `apps/client` only (server/shared untouched), via a root `pnpm install`. No partial state (e.g. React 19 with R3F 8) is committed.
2. **Given** React 19's breaking changes, **When** the client is migrated, **Then** all React-19 API/type breakages are resolved in source (e.g. removed/changed APIs, ref-as-prop changes, stricter `useEffect`/StrictMode behavior, `@types/react` 19 type tightenings) with **no `@ts-ignore`** and **no `as any`** introduced; `pnpm --filter @bomb-squad/client typecheck` is clean.
3. **Given** R3F 9 / drei 10 breaking changes, **When** the scene is migrated, **Then** the bomb scene, camera rig (`camera-controls` 3 API), chassis/module/timer/strike renderers, and the dev harnesses all render and the R3F-specific breaking changes (e.g. `Canvas`/event/loop API changes, drei component renames/prop changes, `camera-controls` 3 API surface) are resolved in source.
4. **Given** the test suite, **When** `pnpm --filter @bomb-squad/client test` runs, **Then** the client suite stays green (≥ baseline of 221, plus whatever TD-1 added if merged first). If [[td-1-client-component-test-framework]] landed first, its `@react-three/fiber` mock convention is updated for the v9 import surface so component tests still mount.
5. **Given** the human-verify gate, **When** the full stack is brought up, **Then** **Jay interactively confirms the 3D bomb scene renders and is interactive at 60fps** — the bomb, chassis, module slots/LEDs, timer LCD, and strike indicator all render correctly and the camera rig responds — recorded in Completion Notes. (This is a renderer migration; the scene math has unit tests, but WebGL rendering is only verifiable in a real browser — AR16.)
6. **Given** the rest of the stack, **When** the upgrade lands, **Then** `pnpm -r test` and `pnpm -r typecheck` are green across all workspaces, and the server/shared workspaces are byte-unchanged (no React anywhere outside the client).

## Tasks / Subtasks

- [ ] **Task 1 — Sequence + safety net (AC: #4)**
  - [ ] **Do this story after [[td-1-client-component-test-framework]] if at all possible** — React 19's StrictMode/effect changes and the R3F migration are exactly what component tests catch. If TD-1 hasn't landed, note the elevated risk and lean harder on the Task 5 human-verify.
  - [ ] Read the official migration guides before editing: React 18→19, R3F v8→v9, drei v9→v10, camera-controls v2→v3. Confirm the exact latest versions at implementation time (the table above is the 2026-06-14 snapshot).

- [ ] **Task 2 — Apply the coupled bump (AC: #1)**
  - [ ] In `apps/client/package.json`: `react`/`react-dom` → `^19`, `@types/react`/`@types/react-dom` → `^19`, `@react-three/fiber` → `^9`, `@react-three/drei` → `^10`, `camera-controls` → `^3`. All in one change — never commit a partial (React 19 + R3F 8 is unsupported).
  - [ ] Root `pnpm install`. Confirm server/shared `package.json` untouched and have no React.

- [ ] **Task 3 — Migrate React 19 breakages (AC: #2)**
  - [ ] Resolve `@types/react` 19 type tightenings and any removed/changed React APIs across `apps/client/src` (UI + scenes). No `@ts-ignore`, no new `as any`. `pnpm --filter @bomb-squad/client typecheck` clean.
  - [ ] Re-check StrictMode/double-invoke effect assumptions — esp. anything with imperative setup/teardown (the voice `connectVoice` controller, R3F dispose hooks). React 19 + StrictMode can surface latent double-mount bugs.

- [ ] **Task 4 — Migrate R3F 9 / drei 10 / camera-controls 3 (AC: #3)**
  - [ ] Update `apps/client/src/scenes/*` and the module `DefuserView`s for the R3F v9 API (Canvas/events/loop), drei v10 component/prop changes, and the camera-controls v3 API in the camera rig.
  - [ ] Preserve the project's **Three.js dispose discipline** (R3F does not GC Three objects — explicit dispose on unmount; project-context rule). Don't regress it during the migration.

- [ ] **Task 5 — Tests + the interactive scene verification (AC: #4, #5) — Jay verifies**
  - [ ] Keep `pnpm --filter @bomb-squad/client test` green. If TD-1 is in, update its `vi.mock('@react-three/fiber', …)` stub for the v9 import surface.
  - [ ] **Jay verifies interactively:** bring up the full stack ([[worktree-fullstack-testing-gap]]: provision `.env`, `docker compose up -d --build` with a worktree-scoped project name) and confirm the bomb scene renders + is interactive at 60fps — bomb/chassis/module slots+LEDs/timer LCD/strike indicator all correct, camera rig responsive. Record the observed result in Completion Notes ([[human-verification-ac-rule]]).

- [ ] **Task 6 — Full-suite green (AC: #6)**
  - [ ] `pnpm -r test` + `pnpm -r typecheck` green across all workspaces; server/shared unchanged.

## Dev Notes

- **Why one story, not five:** R3F 9 hard-requires React 19, so `react`, `react-dom`, `@react-three/fiber`, `@react-three/drei` move atomically; `camera-controls` 3 is included because it's the same camera/scene surface and bumping it separately would mean two passes over the same files. Splitting them would create an un-buildable intermediate state.
- **This is the high-risk slice** of the dependency batch — it rewrites the rendering layer. [[td-2-safe-dependency-bumps-and-node-engine]] (patch bumps) and [[td-4-tooling-vite-typescript-jest]] (build/test tooling) are independent and lower-risk; this one stands alone.
- **Ordering vs TD-4:** Vite 8 (TD-4) and React 19 are largely orthogonal, but if both are planned, doing TD-3 on Vite 6 then TD-4 (or vice-versa) is fine — just don't interleave them in one branch, or a failure is ambiguous.
- **Architecture sign-off:** React/R3F versions are an Architect decision (`_agent_docs/game-architecture.md`). If the architecture pins React 18 deliberately, this story needs an arch update first (or a Correct Course) — confirm before bumping.

### Files to touch
- **UPDATE** `apps/client/package.json` — the 7 coupled packages.
- **UPDATE** `pnpm-lock.yaml`.
- **UPDATE** `apps/client/src/scenes/*` and `apps/client/src/modules/*/DefuserView.tsx` — R3F/drei/camera-controls API migration.
- **UPDATE** `apps/client/src/**` as needed — React 19 type/API fixes (UI + main.tsx render root).
- **UPDATE (if TD-1 merged)** the `@react-three/fiber` test mock for v9.

## References
- [Source: `pnpm outdated -r` @ 2026-06-14] — the coupled major-version rows.
- [Source: _agent_docs/game-architecture.md] — the React/R3F stack decision (confirm pinning intent before bumping).
- [Source: _agent_docs/project-context.md#React / R3F Gotchas] — R3F rendering-only, explicit Three.js dispose on unmount, getState() on the render loop.
- [Ref] React 18→19 upgrade guide; @react-three/fiber v8→v9 migration; @react-three/drei v10 notes; camera-controls v3 changelog (confirm latest at implementation time).
- Related: [[td-1-client-component-test-framework]] (land first — safety net + the R3F mock to update), [[td-2-safe-dependency-bumps-and-node-engine]], [[td-4-tooling-vite-typescript-jest]].

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-3 created (ready-for-dev): coordinated React 18→19 + R3F 8→9 + drei 9→10 + camera-controls 2→3 upgrade (coupled — R3F 9 requires React 19). Client-only; rewrites the 3D scene layer; carries an interactive 60fps render human-verify. Sequenced after TD-1 for a component-test safety net. |
