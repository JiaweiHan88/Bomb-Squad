---
baseline_commit: 7f283c6
---

# Story 4.1: 3D Bomb Scene & Camera Rig

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want to orbit, zoom, and focus on the 3D bomb,
So that I can inspect every face and describe what I see.

## Acceptance Criteria

1. **Camera rig input contract.** Given the bomb scene, when I drag, scroll, click a module, or press ESC, then drag orbits, scroll zooms, click focuses (camera dollies into the module), and ESC returns to overview; right-click and middle-click are reserved (no module interaction).

2. **Cursor idle hide.** Given the bomb scene with no mouse movement, when 2 seconds elapse, then the cursor hides.

3. **Letterboxed stage, chassis never cropped.** Given a 16:10 or 21:9 viewport, when the scene renders, then it letterboxes vertically and never crops the chassis.

## Tasks / Subtasks

- [x] **Task 1 — Install the R3F stack with React-18-compatible versions (AC: 1)**
  - [x] `pnpm --filter @bomb-squad/client add three @react-three/fiber@^8 @react-three/drei@^9` and `pnpm --filter @bomb-squad/client add -D @types/three`.
  - [x] **CRITICAL VERSION PIN:** this project is React 18.3 (`apps/client/package.json`). `@react-three/fiber@9` and `@react-three/drei@10` require React 19 and WILL NOT work here — use fiber `^8` and drei `^9` only. Do not "upgrade React to 19 to get the latest R3F"; React 18 is the settled stack (project-context.md).
  - [x] Pin `three` to a version satisfying both fiber@8 and drei@9 peer ranges. If pnpm reports a peer-dependency warning on `three`, downgrade `three` to the newest version inside drei@9's declared peer range rather than ignoring the warning. Record the resolved versions in the story File List / Completion Notes.
  - [x] Note: fiber@8 carries its own internal `zustand@^3/4` dependency. The client uses `zustand@^5` directly. pnpm isolates them — do **not** try to align or dedupe these versions, and do not change the client's zustand version.
  - [x] Gate after install: `pnpm -r exec tsc --noEmit` still 0 errors; `pnpm --filter @bomb-squad/client build` still green (deps resolve, tree-shaking works).

- [x] **Task 2 — Letterboxed stage container with pure, testable sizing math (AC: 3)**
  - [x] Create `apps/client/src/scenes/stage.ts` — a pure helper (no React, no DOM): `computeStageSize(viewportW: number, viewportH: number, aspect = 16 / 9): { width: number; height: number }`. It returns the largest box of the given aspect that fits inside the viewport: if the viewport is wider than `aspect` (e.g. 21:9), height = viewportH and width = viewportH × aspect (vertical bars left/right); if taller/narrower than `aspect` (e.g. 16:10), width = viewportW and height = viewportW ÷ aspect (horizontal bars top/bottom). The chassis is framed for the 16:9 design baseline, so a stage that never shrinks the 16:9 box below the fit guarantees the chassis is never cropped (AC3).
  - [x] Create `apps/client/src/scenes/BombStage.tsx` — a presentational wrapper that measures its own container (via a `ResizeObserver` on a ref, cleaned up on unmount), calls `computeStageSize`, and centers a fixed-size child box on a **pure-black** background (`#000`, the letterbox bars). Per Story 2.1's documented decision: "pure black is the letterbox background behind the R3F stage" — black bars, NOT `--color-surface` (that's the operator shell, a different surface).
  - [x] Do **not** copy the mockups' `stage.js` fixed-1920×1080 transform-scale approach — that was a static-mockup convenience explicitly rejected in Story 2.1. The real stage resizes the canvas box; R3F handles DPR internally.
  - [x] Unit-test `computeStageSize` in `apps/client/src/scenes/__tests__/stage.test.ts` (Vitest, Node env, no DOM): 16:9 viewport → exact fit (1920×1080 → 1920×1080); 16:10 (1920×1200) → 1920×1080 with top/bottom bars; 21:9 (2560×1080) → 1920×1080 with side bars; degenerate inputs (0 or negative dimension) → `{ width: 0, height: 0 }`, never NaN/negative.

- [x] **Task 3 — `BombScene` canvas with a placeholder bomb rig (AC: 1, 3)**
  - [x] Create `apps/client/src/scenes/BombScene.tsx` — the R3F `<Canvas>` mounted inside `BombStage`. Scene contents for THIS story: a placeholder chassis (a graphite `boxGeometry` roughly 2:1:0.7 proportions) carrying a grid of placeholder module faceplates (small raised boxes on the front/back faces) — enough geometry to orbit around, click, and dolly into. Use DESIGN.md bomb-world colors as flat material colors (`#1A1A1F` graphite chassis, `#C2491F` bakelite accents); real chassis materials/details are **Story 4.2 — do not build them here**.
  - [x] Module placeholder count/layout must be **data-driven**, not hardcoded JSX repetition: read `useGameStore.getState().bomb?.modules.length` when a bomb exists, else default to 6 placeholder slots for the dev harness. Map over a positions array computed from the count. (Project rule: geometry/layout is never hardcoded in JSX; the real registry-driven layout lands in 4.3 — keep the layout function small and replaceable.)
  - [x] Each module placeholder is a clickable mesh with a stable `moduleIndex`. `onClick` → focus that module (Task 4). Attach R3F `onPointerDown` ONLY for the primary button: check `event.button === 0` and ignore buttons 1 (middle) and 2 (right) — AC1 reserves them. Also add `onContextMenu={(e) => e.preventDefault()}` on the canvas container so right-click never opens the browser menu over the scene.
  - [x] Basic lighting: one ambient + one directional light (the bomb must read as a lit physical object — DESIGN.md depth tier 1). No shadows tuning, no environment maps — keep it minimal; 4.2 owns materials/look.
  - [x] **R3F discipline (project-context, non-negotiable):** components are rendering-only — zero game logic; no `useState` for per-frame data; reuse refs inside `useFrame` (no per-frame object allocation); R3F auto-disposes declarative JSX geometry/materials on unmount, but any manually `new`-ed Three.js object (e.g. reusable `Vector3` scratch refs are fine; manually created geometries/materials/textures are not auto-managed) must be disposed in a cleanup.

- [x] **Task 4 — Camera rig: orbit / zoom / focus-dolly / ESC overview (AC: 1)**
  - [x] Use drei's `<CameraControls>` (wraps the `camera-controls` package — installed transitively by drei; it supports **smooth animated transitions**, which `OrbitControls` does not — required for the "camera dollies into the module" focus behavior).
  - [x] Configure mouse buttons explicitly: left-drag = rotate (orbit), wheel = dolly (zoom), right = NONE, middle = NONE (AC1: reserved). With `camera-controls` this is `controls.mouseButtons.right = CameraControls.ACTION.NONE` and `.middle = ...NONE` (import the `CameraControls` class type from `camera-controls` for the action enum, or via `drei`'s re-export). Clamp zoom with sensible `minDistance`/`maxDistance` so the user can neither enter the chassis nor lose it to a speck.
  - [x] Capture the **overview pose** (initial camera position + target framing the whole chassis within the 16:9 stage) once on mount. ESC keydown → `controls.setLookAt(...overviewPose, true)` (animated). Add the `keydown` listener on `window`, clean up on unmount, and ignore the event when focus is in an input/textarea (future-proofing; EXPERIENCE.md: "ESC for camera reset" is a global bomb-scene affordance).
  - [x] Module click → focus: compute the clicked module's world position and `controls.setLookAt(eyeX, eyeY, eyeZ, targetX, targetY, targetZ, true)` to dolly the camera in toward the module face (eye offset along the module's outward normal). Use the already-existing `useUiStore.activeModuleIndex` (created in Story 1.7) as the single source of focus state — set it on click, clear to `null` on ESC. **Do not invent a new store or a parallel `focusedModule` state.**
  - [x] Clicking a module while another is focused re-focuses to the new module (no required ESC round-trip). Clicking empty space (canvas miss) does nothing in this story.
  - [x] Focus/orbit state is presentation state — it lives in `uiStore` (cross-component: HUD in 4.4/4.5 will need it) — never in `gameStore` (server snapshots only — Story 2.1's documented state-boundary pattern).

- [x] **Task 5 — Cursor idle-hide after 2 s (AC: 2)**
  - [x] Create `apps/client/src/scenes/useIdleCursor.ts` — a hook scoped to the stage container element: on `pointermove`, show the cursor and (re)arm a 2000 ms timeout; on timeout, hide it (`cursor: 'none'` on the container). Clean up timer + listener on unmount. A plain `setTimeout` is correct here — this is UI presentation, not game/timer state (the "no `setInterval`" rule targets the authoritative game clock, which is server-owned).
  - [x] Hide only over the bomb stage (scope to the stage container, not `document.body`) — HUD/overlay elements in later stories must not lose the cursor outside the scene.
  - [x] Respect interaction: any `pointerdown`/`pointermove` (including drag-orbit) re-shows the cursor instantly.

- [x] **Task 6 — Dev harness mount (no router exists; keep `App.tsx` delta minimal) (AC: 1–3)**
  - [x] There is no lobby/round flow yet (Stories 2.2+ are in progress/backlog), so the scene needs a dev-only mount: in `App.tsx`, when `connection === 'connected'` **or** `import.meta.env.DEV`, render the bomb view if `window.location.pathname === '/dev/bomb'` (a one-line branch — no router dependency; the architecture's `/dev/sandbox` route convention arrives with Story 5.1). Otherwise the existing PlatformGate → LoadingScreen → AppShell flow is unchanged.
  - [x] **Keep the `App.tsx` diff to that single branch.** Story 2.2 (lobby) is being developed in a parallel worktree and also touches `App.tsx` — a small, additive diff minimizes the merge conflict. **Preserve verbatim** the Story 1.7 socket `useEffect` and the PlatformGate precedence from Story 2.1.
  - [x] Known limitation (already in deferred-work.md): `vite preview` has no SPA fallback, so `/dev/bomb` 404s in the production container. Acceptable — it is a dev-mode harness; do not fix the fallback in this story.
  - [x] The bomb view itself = `BombStage` → `BombScene` full-viewport on pure black. The route page may bypass `AppShell` (the bomb view is bomb-world, not operator-world; AppShell's surface background must not show behind the letterbox bars) but must stay **inside** `PlatformGate`.

- [x] **Task 7 — Tests, gates & manual smoke (AC: 1–3)**
  - [x] Unit tests (Vitest, pure logic only — project rule: R3F components are visual-regression-only, no component tests): `computeStageSize` matrix (Task 2); module placeholder **layout function** (positions array from count: count→length, stable ordering, no NaN) if extracted as a pure function — extract it so it is testable.
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors (no `// @ts-ignore`); `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → no regressions (shared 24 ✓, client 6+ ✓, server 64 ✓ at baseline).
  - [x] **Manual smoke (document results in Completion Notes; do not mark done without it):** `pnpm --filter @bomb-squad/client dev`, open `http://localhost:5173/dev/bomb`. Verify: (a) left-drag orbits, scroll zooms in/out with clamps; (b) clicking a module placeholder dollies the camera in smoothly; ESC animates back to overview; clicking another module while focused re-focuses; (c) right-click does nothing (no context menu, no camera action); middle-click does nothing; (d) cursor disappears after ~2 s idle over the scene and reappears on move; (e) resize the window to 16:10-ish and very wide 21:9-ish shapes — black bars appear and the whole chassis stays visible; (f) leave the tab running a few minutes — no console errors, no obvious frame-rate collapse (devtools FPS meter; the 60 fps profiling gate proper is Story 10.2).

## Dev Notes

### What this story is — and is not

This story creates `apps/client/src/scenes/` (the architecture's "R3F bomb scene, camera rig" home) and proves the **interaction shell** of the bomb view: letterboxed stage, orbit/zoom/focus camera, reserved mouse buttons, idle cursor. The bomb itself is a deliberately crude placeholder.

**Out of scope (later stories in this epic):** chassis materials/serial/batteries/indicators/ports (4.2), registry-driven module layout + solve LEDs (4.3), timer LCD + extrapolation (4.4), strike HUD (4.5), preparation placeholder gating (4.6), snapshot sync/optimistic render/60fps hardening (4.7). Do not build HUD overlays, do not consume `--timer-*`/`--led-*` tokens, do not touch the manual. Building any of it now diverges from its consuming story's context.

### Critical version constraints (researched 2026-06-12)

| Package | Version | Why |
| ------- | ------- | --- |
| `@react-three/fiber` | **`^8`** (NOT 9) | fiber@9 pairs only with React 19; this project is React 18.3 — settled, do not upgrade React |
| `@react-three/drei` | **`^9`** (NOT 10) | drei@9 is the line compatible with fiber@8 + React 18 |
| `three` | newest satisfying both peers | check pnpm peer warnings; prefer drei@9's declared range over latest (latest is ~0.184) |
| `@types/three` | match `three` minor | devDep |
| `camera-controls` | transitive via drei | drei `<CameraControls>` wraps it; import its action enum for button config |

fiber@8 internally depends on an older zustand major than the client's `zustand@^5` — pnpm keeps them isolated; leave both alone.

### Current state of `apps/client` (read before editing)

- `apps/client/src/App.tsx` — Story 1.7's load-bearing socket `useEffect` (StrictMode-safe: autoConnect:false + explicit connect/disconnect) + Story 2.1's `PlatformGate → LoadingScreen → AppShell` precedence. **You add only the `/dev/bomb` branch.** R3F's `<Canvas>` is StrictMode-compatible; keep StrictMode in `main.tsx`.
- `apps/client/src/store/uiStore.ts` — already has `activeModuleIndex: number | null` + `setActiveModuleIndex`. This IS the focus state for the camera rig. Reuse it; do not duplicate.
- `apps/client/src/store/gameStore.ts` — holds `bomb: BombState | null` (modules array). Read module count from it when present. Its doc comment already mandates the access pattern: **inside a render loop read via `useGameStore.getState()`, never the reactive hook.** Reactive selectors are fine in non-per-frame React components.
- `apps/client/src/index.css` — Tailwind v4 `@theme` tokens (Story 2.1). Bomb-world hexes for placeholder materials: graphite `#1A1A1F`, bakelite `#C2491F`, bakelite-deep `#7A2A10`, brass `#B8924A`. Three.js materials take raw hex colors, not CSS vars — copying the hex literals into scene code is correct here (the CSS tokens cannot reach WebGL materials); cite the token name in a comment next to each hex.
- `apps/client/src/ui/` — operator-world components. The bomb stage is a **new, separate surface** (bomb-world); do not put scene components in `ui/`, do not use operator tokens (`surface`, `ink-*`) inside the stage. (ui/README.md's "no fourth surface" rule: bomb / HUD overlay / modal-or-manual — this story builds surface #1.)
- Tests: Vitest is set up (Story 2.1), Node-environment, pure-function focused. No jsdom, no React Testing Library, no Playwright yet.

### Architecture compliance (the rules this story is judged against)

- **R3F components are dumb renderers** — zero game logic. The camera rig and focus state are presentation, which is allowed; anything touching bomb *rules* is not.
- **`useFrame` discipline:** no per-frame allocations (reuse `Vector3`/scratch refs), no async work, no React-context reads inside `useFrame`. This story barely needs `useFrame` (CameraControls animates internally) — if you don't need it, don't add it.
- **Dispose Three.js objects on unmount** — declarative R3F JSX is auto-managed; manually constructed geometries/materials/textures are yours to dispose. Keep everything declarative and this is free.
- **Memoize module components** (`React.memo`) — placeholder slots re-render on every store broadcast otherwise; build the habit now since 4.3 inherits this code.
- **Never trigger React re-renders from the render loop**; never `useEffect`+`setInterval` for anything game-authoritative (the idle-cursor `setTimeout` is UI-local and fine).
- **Server-authoritative boundary:** nothing in this story simulates game state. The scene renders whatever `gameStore` holds (or dev placeholders); it never mutates it.

### UX requirements bound into the ACs (EXPERIENCE.md / DESIGN.md)

- **Interaction primitives:** Drag = orbit camera ONLY (never drags modules/wires). Scroll = zoom. Click = the sole module interaction primitive (here: focus; real interactions arrive in Epic 5). Right-click and middle-click reserved. No keyboard shortcuts on the bomb side except ESC (camera reset) — adding more would let the Defuser self-coach.
- **Camera behavior (EXPERIENCE.md "Bomb chassis (R3F)"):** click module → camera dollies in; ESC → bomb overview.
- **Cursor hides after 2 s idle on the bomb scene** (EXPERIENCE.md "Things that fade or hide during active play").
- **Responsive (EXPERIENCE.md "Responsive & Platform"):** 16:9 design baseline; 16:10 and 21:9 supported via letterbox, never cropping the chassis; 1280×720 minimum is already enforced by `PlatformGate` (Story 2.1) — the stage sits inside the gate and can assume ≥1280×720.
- **Depth tiers (DESIGN.md):** the bomb is depth tier 1 — "R3F-rendered 3D, lit. Real shadows, real materials." For this story: lit, yes; real materials, deferred to 4.2.
- **Reduced motion:** `prefers-reduced-motion` users should get instant (non-animated) focus/reset transitions — pass `false` for the transition flag (or set the controls' transition duration ~0) when `window.matchMedia('(prefers-reduced-motion: reduce)').matches`. The Accessibility Floor is a release gate, not polish.

### Previous story intelligence (2.1, reviewed 2026-06-12 + epic-1 learnings)

- The code-review layer goes hard on **literal spec values** (2.1 was patched for rem-vs-px drift and transition timing). AC values here are literal: 2 s cursor idle, 16:9 stage aspect, button reservations. Implement them literally; don't approximate.
- 2.1's review also patched **unmount/remount state loss** (PlatformGate became an overlay so children stay mounted). Same class of bug to avoid here: don't unmount the `<Canvas>` on transient resize — `BombStage` resizes a mounted canvas box, never remounts it (a WebGL context rebuild on every resize is also a performance bug).
- Listener hygiene was a 2.1 review theme (Escape/blur disarm, focus management): every `window`/element listener and timer in this story (`keydown`, `pointermove`, `ResizeObserver`, idle timeout) gets a cleanup path; assume the reviewer checks each one.
- Pattern from 1.7/2.1: pure decision logic extracted to a plain `.ts` file with unit tests, React kept thin (`platform.ts`/`useViewportGate` split). Mirror it: `stage.ts` (+ layout positions fn) pure and tested; `BombStage`/`useIdleCursor` thin wrappers.
- Build gate culture: `pnpm -r exec tsc --noEmit` zero errors across all workspaces is the hard pre-commit contract; manual smoke results are recorded honestly in Completion Notes (2.1's unexecuted smoke claim was flagged by the auditor and had to be re-run — do not repeat that).

### Git intelligence

Recent commits (`7f283c6`, `8355fda`) show the working pattern: implement story → adversarial code review → `review(story-X.Y): apply code-review patches; story → done`. Client work lands with Tailwind v4 tokens already in place; `pnpm-lock.yaml` changes accompany any dependency add. This story is the first to add 3D dependencies — expect a large lockfile diff; that is normal.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack for this story:** React 18 + Three.js + React Three Fiber (3D bomb rendering), Zustand, TypeScript throughout, Vite. No LiveKit, no server work, no new socket events here.
- **R3F rules (verbatim):** geometry/layout data-driven, never hardcoded in JSX; tick-rate state via `useStore.getState()` inside `useFrame`, not the reactive hook; `useFrame` for per-tick updates, never `useEffect` + `setInterval`; R3F components are rendering-only.
- **Performance rules:** 60 fps on the bomb view — frame-budget violations are bugs; no React re-renders from the game loop; no per-frame allocations; module visual state flows Zustand → R3F subscription, not prop drilling.
- **Build rules:** `tsc --noEmit` zero errors before commit, no `// @ts-ignore`; per-workspace tsconfig (the client's existing tsconfig covers `src/**`; no changes needed); TypeScript only — no `.js`/`.jsx` source.
- **Naming:** components `PascalCase` (`BombStage`, `BombScene`); hooks `use`-prefixed camelCase (`useIdleCursor`); pure helpers camelCase (`computeStageSize`).
- **Don't-miss:** never run a bomb timer on the client (not in this story, but the scene is where 4.4 will land — leave no timer scaffolding); never mutate `BombContext`; client input is untrusted (focus clicks are local-only here — no socket emission in this story).

### Project Structure Notes

- New dir: `apps/client/src/scenes/` — exactly the architecture's `scenes/` ("R3F bomb scene, camera rig"). New files: `scenes/BombStage.tsx`, `scenes/BombScene.tsx`, `scenes/stage.ts`, `scenes/useIdleCursor.ts`, `scenes/__tests__/stage.test.ts` (+ layout test if extracted separately). Updated: `App.tsx` (dev-route branch only), `apps/client/package.json` + `pnpm-lock.yaml` (deps).
- `modules/` directory is NOT created here (Story 5.1). The placeholder slots live inside `scenes/` and are explicitly disposable — 4.3 replaces them with registry-driven layout.
- **Parallel-work warning:** Story 2.2 is in development in a separate worktree and modifies `App.tsx`. Keep this story's `App.tsx` change to the single dev-route branch to keep the eventual merge trivial.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.1: 3D Bomb Scene & Camera Rig] (ACs verbatim; epic 4 objective)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Interaction Primitives] (drag=orbit only, scroll=zoom, click=sole primitive, right/middle reserved, ESC reset, no other keyboard)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Component Patterns (behavioral) — "Bomb chassis (R3F)"] (click focus dolly; ESC overview)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD & Diegetic UI] (cursor hides after 2 s idle)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Responsive & Platform] (16:9 baseline; 16:10/21:9 letterbox, never crop; PlatformGate handles <1280×720)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Accessibility Floor] (prefers-reduced-motion: disable pulses/animations → instant state changes)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#Elevation & Depth] (bomb = tier 1, lit 3D; HUD = flat overlays — not built here)
- [Source: _agent_docs/game-architecture.md#Project Structure] (`apps/client/src/scenes/` = R3F bomb scene, camera rig)
- [Source: _agent_docs/game-architecture.md#Implementation Patterns] (R3F dumb renderers; `getState()` in `useFrame`; modules-as-plugins arrives later)
- [Source: _agent_docs/game-architecture.md#Performance Considerations] (60 fps budget; no per-frame allocations; dispose on unmount; memoize module components)
- [Source: _agent_docs/project-context.md#Web Stack & Architecture Rules / Performance Rules / React & R3F Gotchas] (R3F + Zustand access pattern; disposal; memoization)
- [Source: _agent_docs/implementation-artifacts/2-1-design-tokens-ui-shell-and-state-patterns.md] (tokens; PlatformGate precedence; pure-black letterbox decision; review-culture learnings; presentation-state-stays-local pattern)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (`vite preview` no SPA fallback — dev-route 404 in prod is a known accepted gap)
- [Source: apps/client/src/store/uiStore.ts] (`activeModuleIndex` — the focus state to reuse)
- [Source: apps/client/src/store/gameStore.ts] (bomb snapshot + documented `getState()` access pattern)
- [Source: apps/client/src/App.tsx] (socket effect + gate precedence — add the dev-route branch only)
- R3F/React version pairing: fiber@8↔React 18, fiber@9↔React 19 — https://r3f.docs.pmnd.rs/getting-started/installation (verified 2026-06-12)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- `pnpm install` (fresh worktree) + `pnpm --filter @bomb-squad/client add three @react-three/fiber@^8 @react-three/drei@^9` (+ `-D @types/three`) → resolved **fiber 8.18.0, drei 9.122.0, three 0.184.0, @types/three 0.184.1** — zero peer-dependency warnings (drei@9's `three` peer is `>=0.137`, satisfied by 0.184).
- `camera-controls@2.10.1` added as a direct dep (pinned to drei's own `^2.9.0` range) — required to import the `ACTION` enum under pnpm's strict node_modules isolation; named in Task 4 / Dev Notes, not a new out-of-spec dependency.
- Red→green TDD: `stage.test.ts` + `layout.test.ts` written first, confirmed failing (modules absent), then implemented → 13/13 pass.
- Gates: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green (bundle 1,109 kB / 307 kB gzip — three.js; code-splitting deferred to a polish story); `pnpm -r test` → shared 24 ✓, client 19 ✓ (6 baseline + 13 new), server 64 ✓ — no regressions.
- Headless-browser smoke (Playwright chromium + SwiftShader against `vite dev`, 1920×1080): all checks pass — see Completion Notes.

### Completion Notes List

- **Task 1 — deps:** fiber 8.18.0 / drei 9.122.0 / three 0.184.0 / @types/three 0.184.1 / camera-controls 2.10.1 (direct, for the `ACTION` enum import). React stays 18.3; client `zustand@5` untouched (fiber's internal zustand isolated by pnpm). Pre-existing engine warning (host runs Node 25, root wants 20) — environmental, out of scope.
- **Task 2 — stage:** pure `computeStageSize` in `scenes/stage.ts` (largest aspect-fit box; degenerate inputs → 0×0, never NaN/negative) + `BombStage.tsx` (ResizeObserver-measured, pure-black letterbox bars, canvas box **resized never remounted**, `onContextMenu` suppressed at the stage container). 7 unit tests.
- **Task 3 — scene:** `BombScene.tsx` — graphite chassis box (3×1.5×1.05, `--color-graphite` #1A1A1F) + bakelite module faceplates (#C2491F), layout **data-driven** via pure `computeModuleLayout(count)` in `scenes/layout.ts` (3×2 grid per face, front then back, mirrored x on back; 6 unit tests). Count follows `gameStore.bomb?.modules.length`, defaulting to 6 (`DEFAULT_PLACEHOLDER_COUNT`) for the dev harness. Ambient + directional light only. All geometry declarative JSX (R3F auto-disposal); no `useFrame` needed, none added.
- **Task 3 decision — click handler:** used R3F `onClick` with `event.button === 0` guard **plus** `event.delta > 4px` drag-tolerance (a drag-orbit released over a module must not count as a click) instead of bare `onPointerDown` — strictly stronger enforcement of the same AC1 contract; `stopPropagation` prevents click-through to occluded meshes.
- **Task 4 — camera rig:** drei `<CameraControls>` with explicit `mouseButtons` (left=ROTATE, wheel=DOLLY, right/middle=NONE), `minDistance` 1.2 / `maxDistance` 10 (min sits below the 1.6 focus eye-distance so the dolly is never clamped). Overview pose is a module constant (camera starts there; effect skips its first run). Focus state = existing `uiStore.activeModuleIndex` (single source); a `useEffect` watching it drives `setLookAt` — click sets the index, ESC (window keydown, text-entry targets ignored) clears to `null`, re-click while focused re-focuses directly. `prefers-reduced-motion` → transitions instant (animate=false).
- **Task 5 — idle cursor:** `useIdleCursor` (2000 ms, exported `IDLE_CURSOR_MS`) scoped to the stage container only; `pointermove`/`pointerdown` wake instantly; timer + listeners + cursor style all cleaned up on unmount.
- **Task 6 — dev harness:** single added branch in `App.tsx`: `/dev/bomb` when `import.meta.env.DEV || connection === 'connected'`, rendered **inside** `PlatformGate`, bypassing `AppShell` (bomb-world surface). Story 1.7 socket effect and 2.1 gate precedence preserved verbatim. Known accepted gap: `vite preview` SPA-fallback 404 (deferred-work.md).
- **Task 7 — manual smoke (a)–(f), executed headlessly 2026-06-12** (Playwright-driven chromium w/ SwiftShader WebGL against `vite dev --port 5199`, harness in /tmp, removed after): (a) left-drag orbits and scroll zooms (canvas render changed) ✓; (b) module click dollies in, re-click while focused re-focuses, ESC animates back to overview ✓; (c) right-click does nothing (context menu suppressed, render unchanged) and middle-click does nothing ✓; (d) cursor `style.cursor='none'` after 2 s idle, reappears instantly on move ✓; (e) stage box measured exactly 1920×1080 at 16:9 (1920×1080), 16:10 (1920×1200) and 21:9 (2560×1080) viewports — letterboxed, chassis never cropped ✓; (f) no console/page errors across the session — the only console 404 is the browser's automatic `/favicon.ico` request (project has no favicon; pre-existing, unrelated) ✓. Recommend Jay repeats a quick interactive pass in a real browser for feel (orbit inertia, dolly speed).

### File List

- apps/client/package.json (modified — three, @react-three/fiber@^8, @react-three/drei@^9, camera-controls; @types/three devDep)
- pnpm-lock.yaml (modified — dependency resolution)
- apps/client/src/App.tsx (modified — `/dev/bomb` dev-harness branch only; socket effect + gate precedence untouched)
- apps/client/src/scenes/stage.ts (created — pure letterbox math)
- apps/client/src/scenes/layout.ts (created — pure placeholder module layout)
- apps/client/src/scenes/BombStage.tsx (created — letterbox stage container + context-menu suppression)
- apps/client/src/scenes/BombScene.tsx (created — R3F canvas, chassis/module placeholders, CameraRig)
- apps/client/src/scenes/useIdleCursor.ts (created — 2 s idle cursor hide)
- apps/client/src/scenes/__tests__/stage.test.ts (created — 6 tests)
- apps/client/src/scenes/__tests__/layout.test.ts (created — 7 tests)

### Review Findings

_Code review 2026-06-12 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 3 ACs PASS. 1 patch, 1 deferred, 8 dismissed as noise._

- [x] [Review][Patch] `computeModuleLayout` silently overlaps slots for count ≥ 13 [apps/client/src/scenes/layout.ts:34-58] — `face = Math.floor(i/6) % 2` wraps a third face-batch back onto the front face, so slot 12 lands exactly on slot 0 (verified: count=14 → 2 collisions). The `__tests__/layout.test.ts` "never overlaps" assertion only exercised counts ≤ 11, so it never caught the failing range. Found independently by Blind + Edge. **Fixed 2026-06-12:** on-face index now accumulates prior full batches (`Math.floor(faceBatch/2) * SLOTS_PER_FACE + …`) so the grid grows extra rows downward instead of wrapping onto an occupied face; the overlap test now covers counts 11–37. tsc 0 errors, 13 scene tests green.

- [x] [Review][Defer] Focus state (`uiStore.activeModuleIndex`) not auto-cleared on remount or module-count shrink [apps/client/src/scenes/BombScene.tsx:43-98] — deferred. If the rig remounts with a stale non-null index, or `bomb.modules` shrinks below the focused index, the camera lingers/no-ops (handled gracefully, no crash — `slots.find` guard returns early). Auto-reset belongs to the real round-lifecycle stories (4.6/4.7); in 4.1 there is no remount path and `uiStore` defaults to `null`.

## Change Log

- 2026-06-12: Story 4.1 implemented — R3F stack installed with React-18-compatible versions (fiber 8.18 / drei 9.122 / three 0.184 / camera-controls 2.10); new `apps/client/src/scenes/` with letterboxed 16:9 BombStage (pure tested math), placeholder bomb scene (data-driven slot layout), CameraControls rig (orbit/zoom/focus-dolly/ESC, right+middle reserved, reduced-motion respected), 2 s idle-cursor hide, and a `/dev/bomb` dev harness branch in App.tsx. 13 new unit tests; typecheck/build/full-suite green; headless-browser smoke (a)–(f) all pass.
