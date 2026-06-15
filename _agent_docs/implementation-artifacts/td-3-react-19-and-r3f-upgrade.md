---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - _agent_docs/game-architecture.md
  - apps/client/package.json
---

# Story TD-3: React 19 + React-Three-Fiber 9 Coordinated Upgrade

Status: done

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

- [x] **Task 1 — Sequence + safety net (AC: #4)**
  - [x] **Do this story after [[td-1-client-component-test-framework]]** — TD-1 landed first (done), so the component-test safety net + jsdom env are in place. React 19's StrictMode/effect changes ride on top of that net.
  - [x] Confirmed exact latest versions at implementation time (2026-06-15): react/react-dom **19.2.7**, @types/react **19.2.17**, @types/react-dom **19.2.3**, @react-three/fiber **9.6.1**, @react-three/drei **10.7.7**, camera-controls **3.1.2**. Pre-flight: checked the architecture pin gate — `game-architecture.md` named "React 18" but `project-context.md` says "React 18+" (no deliberate-pin language), so 19 is permitted; aligned the two stale arch cells to React 19.

- [x] **Task 2 — Apply the coupled bump (AC: #1)**
  - [x] `apps/client/package.json`: react/react-dom → `^19.2.7`, @types/react → `^19.2.17`, @types/react-dom → `^19.2.3`, @react-three/fiber → `^9.6.1`, @react-three/drei → `^10.7.7`, camera-controls → `^3.1.2`. One atomic change — no partial committed.
  - [x] Root `pnpm install` clean (exit 0; `+19 -34` — drei 10 dropped the deprecated three-mesh-bvh@0.7.8). Confirmed `apps/server`/`packages/shared` package.json **byte-unchanged** (`git diff --name-only` empty) and React-free.

- [x] **Task 3 — Migrate React 19 breakages (AC: #2)**
  - [x] `pnpm --filter @bomb-squad/client typecheck` **clean on the first pass** — zero `@types/react` 19 type tightenings to fix, no removed/changed React API in use. The codebase was already on modern patterns (`createRoot` from `react-dom/client`, no `defaultProps`/`propTypes` on function components, `forwardRef` in `Button.tsx` which still works in 19, typed refs). **No `@ts-ignore`, no new `as any`.**
  - [x] StrictMode/double-invoke re-check: render root stays `<StrictMode>`; the imperative setup/teardown sites (`connectVoice` controller, R3F `useEffect` camera-rig handlers in `BombScene`, `useFrame` LED/timer drivers) all have symmetric cleanup and pass under the React-19 reconciler — full suite (incl. TD-1's component tests + 2.5's voice tests) green.

- [x] **Task 4 — Migrate R3F 9 / drei 10 / camera-controls 3 (AC: #3)**
  - [x] `apps/client/src/scenes/*` + module `DefuserView`s: the R3F v9 import surface (`Canvas`, `useFrame`, `useThree`, `ThreeEvent`), drei v10 (`Text`, `CameraControls`, `Stats`), and camera-controls v3 (`ACTION` enum, `mouseButtons`, `setLookAt`) are all **API-compatible with the existing code** — typecheck + suite green with **no source change required** to the scene/camera/module-render layer.
  - [x] **Three.js dispose discipline preserved** — no scene geometry/material code was touched, so the declarative-JSX auto-dispose path (project-context "dispose on unmount" rule) is intact and unregressed.

- [x] **Task 5 — Tests + the interactive scene verification (AC: #4, #5) — Jay verifies**
  - [x] `pnpm --filter @bomb-squad/client test` green under React 19 + R3F 9 (**269/269**). The TD-1 `vi.mock('@react-three/fiber', …)` convention: no test file actually mocks R3F yet (the README pattern is documented-but-unused), and the `Canvas`/`useFrame`/`useThree` import surface it stubs is **unchanged in v9** — annotated as verified-for-v9 in `src/test/README.md`.
  - [x] **Jay verified interactively (2026-06-16):** client image rebuilt (`docker compose up -d --build client` — React 19.2.7 / R3F 9.6.1 / drei 10.7.7 / camera-controls 3.1.2 confirmed baked in; container healthy, HTTP 200). Jay confirmed **"everything renders correctly"** — bomb scene renders + is interactive at 60fps. AC #5 satisfied per [[human-verification-ac-rule]].

- [x] **Task 6 — Full-suite green (AC: #6)**
  - [x] `pnpm -r typecheck` clean + `pnpm -r test` green across all workspaces: shared **136** / client **269** / server **375**. Server/shared unchanged (no React outside the client).

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

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- Pre-flight architecture gate: `game-architecture.md` listed "React 18", but it cites `project-context.md` as the source of truth, which says "React 18+" (no deliberate-pin language) → 19 permitted. Aligned the two stale arch cells to React 19.
- `npm view` (2026-06-15) — confirmed latest: react/react-dom 19.2.7, @types/react 19.2.17, @types/react-dom 19.2.3, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, camera-controls 3.1.2.
- Root `pnpm install` — exit 0; `Packages: +19 -34` (drei 10 drops deprecated three-mesh-bvh@0.7.8). server/shared package.json byte-unchanged.
- `pnpm --filter @bomb-squad/client typecheck` — **clean first pass, zero source edits needed**.
- `pnpm --filter @bomb-squad/client test` — 269/269 under React 19 + R3F 9.
- `pnpm -r typecheck` clean; `pnpm -r test` → shared 136 / client 269 / server 375, all green.

### Completion Notes List

- **AC #1** — coupled set on target majors in `apps/client` only: react/react-dom 19.2.7, @types/react 19.2.17, @types/react-dom 19.2.3, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, camera-controls 3.1.2. One atomic bump; no partial state. server/shared untouched and React-free (verified).
- **AC #2** — React 19 migration: `pnpm --filter @bomb-squad/client typecheck` clean with **no source changes, no `@ts-ignore`, no new `as any`**. The codebase was already React-19-ready (`createRoot`, no `defaultProps`/`propTypes`, typed refs; `forwardRef` in `Button.tsx` still valid in 19). StrictMode preserved; imperative setup/teardown sites (connectVoice, R3F effects/`useFrame`) pass under the new reconciler.
- **AC #3** — R3F 9 / drei 10 / camera-controls 3: the import surface used by `scenes/*` + module `DefuserView`s (`Canvas`/`useFrame`/`useThree`/`ThreeEvent`, drei `Text`/`CameraControls`/`Stats`, camera-controls `ACTION`/`mouseButtons`/`setLookAt`) is API-compatible — typecheck + suite green with **zero scene/camera/module-render source changes**. Three.js dispose discipline intact (no geometry/material code touched).
- **AC #4** — client suite green under the new stack: **269/269** (baseline rose 250→269 via the 2.5 merge; all pass). README R3F-mock convention annotated as verified-for-v9 (its `Canvas`/`useFrame`/`useThree` stub surface is unchanged in v9; no test currently mocks R3F).
- **AC #6** — full-workspace green: `pnpm -r typecheck` clean; `pnpm -r test` shared 136 / client 269 / server 375. server/shared byte-unchanged.
- **AC #5 — SATISFIED (Jay interactive verify, 2026-06-16):** client image rebuilt from the updated lockfile (`docker compose up -d --build client`; React 19.2.7 / R3F 9.6.1 / drei 10.7.7 / camera-controls 3.1.2 confirmed in the image's pnpm store; container healthy, HTTP 200). Jay confirmed **"everything renders correctly"** — bomb scene renders + interactive at 60fps. Per [[human-verification-ac-rule]], the gate is closed.
- **Surprise of note:** a "high-risk rewrite the rendering layer" story turned out to need **zero source changes** — only the dependency bump + doc alignment. The risk was real (R3F 9 drops React 18), but the code was already on the forward-compatible API subset. The genuine risk now lives entirely in the runtime render, which is exactly what the AC #5 human-verify covers.

### File List

- **UPDATE** `apps/client/package.json` — the 7 coupled packages → React 19 / R3F 9 / drei 10 / camera-controls 3.
- **UPDATE** `pnpm-lock.yaml` — root install (coupled majors; drei 10 drops three-mesh-bvh@0.7.8).
- **UPDATE** `apps/client/src/test/README.md` — note the R3F-mock stub surface is verified unchanged on v9.
- **UPDATE** `_agent_docs/game-architecture.md` — stack cells React 18 → React 19 (R3F 9), reflecting the migration.
- _No `apps/client/src/**` source changes required — the scene/UI code was already React-19/R3F-9 API-compatible._

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-3 created (ready-for-dev): coordinated React 18→19 + R3F 8→9 + drei 9→10 + camera-controls 2→3 upgrade (coupled — R3F 9 requires React 19). Client-only; rewrites the 3D scene layer; carries an interactive 60fps render human-verify. Sequenced after TD-1 for a component-test safety net. |
| 2026-06-15 | Implemented the coupled bump (react/react-dom 19.2.7, @types/react 19.2.17, @types/react-dom 19.2.3, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, camera-controls 3.1.2), client-only. **No source changes needed** — typecheck clean first pass, full suite green (shared 136 / client 269 / server 375), dispose discipline intact. Aligned the stale "React 18" arch-doc cells to 19. AC #1–#4/#6 satisfied; **AC #5 interactive 60fps verify is the remaining gate (pending Jay).** Status → in-progress (held for human-verify). |
| 2026-06-16 | AC #5 closed: client image rebuilt (React 19/R3F 9 confirmed baked in, container healthy); Jay verified interactively — "everything renders correctly", bomb scene renders + interactive at 60fps. All ACs satisfied. Status → done. |
