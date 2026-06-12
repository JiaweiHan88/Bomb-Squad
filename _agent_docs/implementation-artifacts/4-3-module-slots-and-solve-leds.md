---
baseline_commit: 6ca28c9
---

# Story 4.3: Module Slots & Solve LEDs

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want each module slot to show a solve LED,
So that I can learn the bomb's progress by scanning for greens.

## Acceptance Criteria

1. **Registry-driven module slots.** Given a bomb with N modules, when it renders, then module geometry/layout is data-driven from the registry (never hardcoded in JSX) and each module shows a 10px solve LED.

2. **LED state semantics.** Given a module's status, when it is armed, solved, or struck, then the LED shows dim-red, green-glow, or a 600ms red flash respectively, and green is the single source of truth for "solved."

## Tasks / Subtasks

- [x] **Task 1 — Client-side module renderer registry (AC: 1)**
  - [x] Create `apps/client/src/modules/registry.ts` — the architecture's designated home (`src/modules/registry.ts`, "client-side module renderer registry"; Epic 4 owns it per the Epic→Architecture map). The `modules/` directory does not exist yet — this story creates it.
  - [x] Shape: a `ModuleRenderer` descriptor — `{ id: string; DefuserView: ComponentType<{ moduleIndex: number }> }` (exact prop surface is yours, but it must receive enough to subscribe to its own `ModuleState` slice later; `moduleIndex` is the natural key — `ModuleUpdate` is indexed, not id'd). A `registerModuleRenderer(renderer)` additive entry point plus `getModuleRenderer(moduleId): ModuleRenderer` that **falls back to a placeholder renderer for unregistered ids** — never throws, never returns undefined. Open/closed mirror of the server's `MODULE_REDUCERS` (ADR-003): Epic 5 modules register additively; nothing in `scenes/` changes when they do.
  - [x] Create the fallback `PlaceholderModule` DefuserView (in `modules/` — e.g. `modules/PlaceholderModule.tsx`): renders the empty bay body (nothing or a subtle blank panel). In this story **every** module resolves to it — real DefuserViews are Epic 5. Keep it rendering-only and trivially cheap.
  - [x] Registry unit tests `apps/client/src/modules/__tests__/registry.test.ts`: unknown id → placeholder fallback (not undefined/throw); registered id → that renderer; duplicate registration → throw (fail-loud, matching `HealthRegistry.register`'s house precedent from 1.5).

- [x] **Task 2 — Module slots driven by `bomb.modules` data (AC: 1)**
  - [x] `BombScene` currently lays out from a bare count (`s.bomb?.modules.length ?? DEFAULT_PLACEHOLDER_COUNT`). Change the source of truth to the `ModuleState[]` itself: read `const modules = useGameStore((s) => s.bomb?.modules) ?? DEV_PLACEHOLDER_MODULES` (reactive selector — snapshot-rate, not per-frame; same justification as 4.2's context read). Layout stays `computeModuleLayout(modules.length)` — the pure slot-position math in `layout.ts` survives unchanged; "registry-driven" means each slot renders the module **data** (id → registry lookup, status → LED), not that positions move into the registry.
  - [x] Replace `ModulePlaceholder` with a `ModuleBay` component (new file `apps/client/src/scenes/ModuleBay.tsx`, mirroring the `ChassisFeatures.tsx` pattern): props `{ slot: ModuleSlot; moduleId: string }`, memoized. It keeps 4.1's click-to-focus handler **byte-for-byte in behavior** (`button === 0` guard, `delta > 4` drag tolerance, `stopPropagation`, `setActiveModuleIndex(slot.moduleIndex)`) and subscribes to its own status via a scoped selector: `useGameStore((s) => s.bomb?.modules[slot.moduleIndex]?.status)` (fallback for the no-bomb case below). Per-slot subscription + memo keeps a single module's update from re-rendering every bay.
  - [x] Bay anatomy (mockup `.bay`/`.bay-screw`/`.bay-head`/`.bay-tag` translated to 3D — this story owns "module bay framing, screws-per-module, and solve LEDs" explicitly deferred from 4.2): graphite faceplate (keep `#1A1A1F`, the 4.2 contrast decision) framed with a darker border read (`#0C0B0E` rim — a slightly larger thin box behind the plate, or a flat border strip; cheap geometry only), 4 small brass (`#B8924A`) bay screws at the plate corners from a data-driven positions array (the `SCREW_POSITIONS` pattern already in `BombScene.tsx` — reuse the approach, not copy-paste constants), a mono micro-label bay tag `MOD-01`…`MOD-NN` (drei `<Text>`, existing vendored font `/fonts/jetbrains-mono-700.ttf` — **no new font assets**; color `#5A5560`, letter-spaced, top-left of the plate), and the solve LED top-right (Task 3).
  - [x] Bay tag formatting is a pure helper (`formatBayTag(index): string` → `MOD-01`, zero-padded, 1-based) — testable, lives with the other pure scene math, not inline JSX string math.
  - [x] Body content: `const Renderer = getModuleRenderer(moduleId)` → `<Renderer.DefuserView moduleIndex={slot.moduleIndex} />` centered in the bay. The lookup is the AC1 "data-driven from the registry" contract — no per-module conditionals in scene JSX, ever.
  - [x] Sweep-test the count domain (4.1's review lesson, repeated in 4.2): GDD module count is 3–11 facilitator-configured, but `computeModuleLayout` handles any count — keep existing layout tests green and make any new pure helpers (`formatBayTag`, LED layout offsets if extracted) tested across 0/1/6/11/13.

- [x] **Task 3 — Solve LED states as a pure function (AC: 1, 2)**
  - [x] Create `apps/client/src/scenes/moduleLed.ts` — pure, no React/three imports (the `layout.ts`/`chassis.ts` house pattern): `solveLedVisual(status: ModuleState<unknown>['status'], flashElapsedMs: number | null, reducedMotion: boolean): { color: string; emissive: string; emissiveIntensity: number }` (exact return shape yours, but it must be a complete material description — the component applies it verbatim, zero logic in JSX).
  - [x] State table (DESIGN.md `componentSpec.moduleSolveLed` + `colors.hud`, literal values — review culture is literal-not-approximate):
    - **armed** → dim red: base `#7A0000` (`--led-red-glow`), low/no emissive — reads as a dark dormant dot.
    - **solved** → green glow: `#3DFF7A` (`--led-green`) with emissive `#15B548` (`--led-green-glow`) — unmistakable at overview distance; "Defuser learns the bomb by scanning greens."
    - **struck flash** → `#FF2E2E` (`--led-red`) bright emissive for **600ms from flash start**, then back to the armed visual. With `reducedMotion`, no animated ramp — a static instant red state for the window, then instant revert (DESIGN.md a11y: "strike flash → swap for instant state changes").
  - [x] Unit tests `apps/client/src/scenes/__tests__/moduleLed.test.ts`: armed/solved mappings; flash active at 0/300/599ms; expired at ≥600ms → armed visual; solved + stale flashElapsed → solved wins (a solved module never flashes red); reduced-motion variant returns static (no intermediate intensity values across the window); `null` flashElapsed → plain status mapping.
  - [x] **Flash trigger mechanics in `ModuleBay`:** `'struck'` is transient by contract (`ModuleState` doc: the bomb reducer rolls it into a team strike and resets status to `'armed'` — the client may observe `struck` only briefly, or see `armed` again in the next snapshot). So the flash must be **edge-triggered, not level-driven**: when the subscribed status transitions *to* `'struck'`, capture a flash-start timestamp in a ref, and let the flash run its full 600ms even if status reverts to `'armed'` immediately. Drive the countdown in `useFrame` using the frame clock (`clock.elapsedTime` or accumulated `delta`) — **never `setTimeout`/`setInterval`/`Date.now()` polling** (project rule: `useFrame` for per-tick animation). Mutate the LED material via a ref inside `useFrame`; do not setState per frame; no object allocation inside the callback (reuse refs — compute the visual only when the flash is active or state changed, not unconditionally every frame).
  - [x] **LED size — the 10px ruling:** DESIGN.md specs "10px circular" against the 2D mock. In world units at the overview pose (camera distance ≈5.2, fov 45°, 1080p stage → ≈0.0042 world-units/px), 10px ≈ **0.042 world diameter** — use a small cylinder or circle of radius ≈0.02 sitting ~0.01 proud of the faceplate (the 4.2 z-fighting offset convention). Document the math in a comment; it's the AC1 "10px" trace.
  - [x] **Green is the single source of truth for "solved":** the LED goes green if and only if the module's snapshot `status === 'solved'`. No other affordance in this story signals solved, and nothing ever sets green optimistically (4.7's optimistic path explicitly never pre-commits solved — that contract starts holding here). Solve chime is Story 10.1 — **no audio in this story**. "All LEDs green = defused" is the server's `bomb.solved`, not client logic — render LEDs, don't aggregate them.

- [x] **Task 4 — Dev harness: seed the store, preview the states (AC: 1, 2)**
  - [x] No server emits `MODULE_UPDATE` yet (Epic 8 wires the round flow), so the dev harness must exercise all three LED states through the **real store path** — not a parallel fake. Create `apps/client/src/scenes/DevBombHarness.tsx`: on mount (dev only), seeds `useGameStore.getState().setBomb(DEV_BOMB_STATE)` and renders `<BombStage><BombScene /></BombStage>`.
  - [x] `DEV_BOMB_STATE` lives beside `devBombContext.ts` (extend that file or add `devBombState.ts`): a fixed `BombState` — `context: DEV_BOMB_CONTEXT`, `strikes: 0`, `solved: false`, and 6 placeholder modules (`moduleId: 'placeholder'`, `data: null`), **module 0 `'solved'`, the rest `'armed'`** — matching the mockup's scene state ("Wires solved, five modules unsolved"). Fixed constant, no `Math.random()` (project rule; a dev placeholder is not a generator).
  - [x] Dev-only state controls, gated so they cannot ship into real play: inside `DevBombHarness` (NOT in `BombScene` — the scene stays a dumb renderer), guarded by `import.meta.env.DEV`, add a keyboard listener: digit `1`–`9` toggles module `n-1` between `armed`/`solved`; `Shift+digit` fires a struck pulse — `applyModuleUpdate({ status: 'struck' })` then immediately `applyModuleUpdate({ status: 'armed' })`, deliberately reproducing the server's transient roll-up so the edge-triggered flash is proven against the real-world sequence. Reuse the `isTextEntryTarget` guard pattern from `CameraRig`'s ESC handler. (EXPERIENCE.md's "no bomb-side keyboard except ESC" is a production constraint; this listener exists only in the dev harness component under a DEV guard.)
  - [x] `App.tsx` diff is confined to **one line inside the existing `isBombDevRoute` branch**: `<BombStage><BombScene/></BombStage>` → `<DevBombHarness />`. Nothing else in `App.tsx` moves (Story 2.2 owns the lobby branch; keep the merge surface minimal as 4.1/4.2 did).
  - [x] Keep the `?? DEV_PLACEHOLDER_MODULES` fallback in `BombScene` (replacing `DEFAULT_PLACEHOLDER_COUNT`) so the scene still renders if mounted with an unseeded store — but with the harness seeding, the dev route now exercises `setBomb` + `applyModuleUpdate` end to end, the exact path 4.7's snapshot sync will ride.

- [x] **Task 5 — R3F discipline & integration (AC: 1, 2)**
  - [x] `CameraRig`, `BombStage`, `stage.ts`, `useIdleCursor.ts`, `ChassisFeatures.tsx`, `chassis.ts`, `devBombContext.ts` (content), both store **files**: untouched. Click-to-focus, ESC, button reservations, zoom clamps, idle cursor, letterbox — all 4.1/4.2 verified behavior must provably survive (the focus-dolly targets `slot.position`/`slot.normal`, which don't change).
  - [x] `layout.ts`: update the stale doc comment ("Story 4.3 replaces it with registry-driven layout" — the math survives; the *data source* changed) and retire `DEFAULT_PLACEHOLDER_COUNT` in favor of the dev module constant (or keep it derived as `DEV_PLACEHOLDER_MODULES.length` — don't leave two competing defaults).
  - [x] `BombScene.tsx` header comment: 4.2 left the hook "Registry-driven module layout + solve LEDs land in 4.3" — update it; leave a pointer for what lands next (timer LCD 4.4, strike HUD 4.5).
  - [x] All new geometry/materials declarative JSX → R3F auto-disposal. The only `useFrame` is the flash driver in `ModuleBay` (or a child LED component) — it must early-return when no flash is active and allocate nothing per frame. No `setInterval`, no `Date.now()` in render logic, no socket events, no server code, no new npm dependencies (drei `<Text>` and the vendored mono font already cover the bay tag).
  - [x] Memoization audit: `ModuleBay` memoized on `(slot, moduleId)`; status arrives via internal scoped selector so a `MODULE_UPDATE` to module 3 re-renders only bay 3; `ChassisFeatures` memo from 4.2 must remain effective (context reference unchanged by module updates — `applyModuleUpdate` spreads `bomb` but reuses `context`, verify no accidental context-identity churn).

- [x] **Task 6 — Tests, gates & manual smoke (AC: 1, 2)**
  - [x] Unit tests (Vitest, Node env, pure logic only — R3F components are visual-regression-only per project testing rules): `moduleLed.test.ts` (state table + flash window + reduced-motion, per Task 3), `registry.test.ts` (per Task 1), bay-tag/format tests. Existing `layout.test`/`chassis.test` suites stay green.
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore`; `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → no regressions (baseline: shared 24 ✓, client 51 ✓, server 64 ✓).
  - [x] **Manual smoke (record results honestly, check by check, in Completion Notes — 4.1/4.2 house standard):** `pnpm --filter @bomb-squad/client dev`, open `http://localhost:5173/dev/bomb`. Verify: (a) 6 bays render with graphite plates, dark rims, 4 brass screws each, `MOD-01`…`MOD-06` mono tags; (b) module 0's LED is green with visible glow, modules 1–5 dim red — the green is findable by scanning at overview distance (the AC's reason for existing); (c) digit key toggles a module's LED green↔dim-red; (d) Shift+digit produces a single ~600ms red flash that settles back to dim red — including on a module that is already showing armed again (transient struck proof); (e) a solved module does not flash when Shift+digit is fired on a different module (scoped re-render + scoped flash); (f) 4.1/4.2 regression: click a bay → focus dolly, ESC → overview, right/middle dead, cursor hides after 2s, serial sticker/indicators/batteries/ports all still present and correct; (g) emulate `prefers-reduced-motion: reduce` (DevTools rendering tab) → strike shows instant red state, no animated ramp; camera transitions already instant per 4.1; (h) several minutes idle + repeated flashes — no console errors, no frame collapse, no memory creep from repeated flash triggers.

## Dev Notes

### What this story is — and is not

4.1 built the interaction shell, 4.2 made the bomb describable. This story makes it **trackable**: module slots become real bays whose contents resolve through the client renderer registry (the open/closed seam Epic 5 plugs real modules into), and every bay carries the solve LED — the Defuser's only visual solved-confirmation in the whole game (EXPERIENCE.md). It also establishes the LED's strike-flash mechanism that 4.5 will build the team-strike roll-up on.

**Out of scope (do not build):** timer LCD/DSEG7 font (4.4), strike counter HUD + team strike roll-up + whole-module red flash (4.5 — this story flashes the *LED* only; 4.5 decides whether the flash extends to the module face), preparation gating (4.6), optimistic pre-flash/rollback and 60fps profiling pass (4.7), any real module DefuserView/generate/reducer (Epic 5), solve chime/SFX (10.1), server-side anything (Epic 8). "All-disarmed = defused" (FR18) is the server's `bomb.solved` flag — no client aggregation logic.

### The registry is an architecture seam — get the shape right

- Architecture places it at `apps/client/src/modules/registry.ts` and maps it to **Epic 4** ("R3F bomb scene, `modules/registry`, timer extrapolation, strike HUD"). Epics 5–7 are "additive registry entries; no bomb-reducer change". ADR-003 is the server-side mirror (`MODULE_REDUCERS`).
- The fallback-renderer design (unknown id → placeholder, never throw) matters beyond this story: a client meeting a module id it doesn't know must degrade gracefully, and in *this* story every id is unknown — the placeholder IS the v4.3 experience.
- Don't over-build it: no manual pages, no generate, no reducer references — those are `IModule` concerns living in Epic 5's per-module dirs. The client registry maps id → rendering capability only.
- Story 5.1 ("module plugin scaffold, sandbox and click primitive") builds directly on this file. Keep the registration API obvious and documented.

### `'struck'` is transient — design the flash for the real protocol

`ModuleState.status` doc (packages/shared/src/types/module.ts): "'struck' is transient — the bomb reducer rolls it up into a team strike and resets status back to 'armed'." The server-side `bombReducer` (Story 1.6) already does this. `StrikePayload` carries **no moduleIndex** — the only way the client learns *which* module struck is a `MODULE_UPDATE` whose state passes through `'struck'`. Therefore:

- Flash is **edge-triggered** on the armed→struck transition observation, runs a fixed 600ms on the frame clock, and is indifferent to the status snapping back to `'armed'` mid-flash (it will).
- A module whose snapshot says `'solved'` never shows red — solved wins over any stale flash state.
- Exactly how Epic 8 sequences the struck broadcast (transient state in the update vs. only the post-rollup armed state) is still open — the dev harness's pulse (struck → armed back-to-back) is the worst case; if the flash survives that, it survives any sequencing. If you find the contract genuinely unworkable (e.g. you believe the client will *never* see `'struck'`), flag it in Completion Notes for the Epic 8 stories rather than silently inventing a different protocol.

### Current state of the code you're touching (all reviewed & done — read before editing)

- `apps/client/src/scenes/BombScene.tsx` — the main modification target. Today: bakelite chassis + ribs + 8 chassis screws + `ChassisFeatures` + `ModulePlaceholder` (memoized graphite plate, click→focus with `button===0`/`delta>4` guards) + `CameraRig` (overview [0,1.1,5.2], `FOCUS_DISTANCE` 1.6, clamps 1.2–10, ESC, reduced-motion-aware). Your changes: swap `ModulePlaceholder` → `ModuleBay` (new file), change the modules read from count to `ModuleState[]`, update header comment. `CameraRig` and chassis/feature hunks stay untouched.
- `apps/client/src/scenes/layout.ts` — `computeModuleLayout(count)` fills front face 3×2 then back, growing rows at count>12; exports `CHASSIS_SIZE`, `DEFAULT_PLACEHOLDER_COUNT`. The position math is correct and tested — keep it; update the stale "4.3 replaces" comment; `ModuleSlot {moduleIndex, position, normal}` is your bay's placement input. Faceplate today is 0.8×0.55×0.08 at `position + normal*0.04`.
- `apps/client/src/store/gameStore.ts` — `bomb: BombState | null`; `applyModuleUpdate({moduleIndex, state})` immutably replaces one module (out-of-range ignored); `setBomb` replaces wholesale. The dev harness drives these real actions. Per-frame reads must use `getState()`; snapshot-rate reads (status selectors) use reactive hooks — both patterns documented in the file.
- `apps/client/src/store/uiStore.ts` — `activeModuleIndex` focus state. **No changes.** Known 4.1 deferral (stale index on remount/shrink) is owned by 4.6/4.7 — do not fix here.
- `packages/shared/src/types/module.ts` / `bomb.ts` — `ModuleState<S> { moduleId, status: 'armed'|'solved'|'struck', data }`; `BombState { context, modules, strikes, solved }`. **No shared-type changes needed or wanted** in this story (zero-diff outside `apps/client`).
- `apps/client/src/scenes/ChassisFeatures.tsx`, `chassis.ts`, `devBombContext.ts` — 4.2's metadata work; untouched except possibly co-locating `DEV_BOMB_STATE` beside `DEV_BOMB_CONTEXT`.
- `apps/client/src/App.tsx` — dev route branch mounts `BombStage`→`BombScene` directly; your one-line swap to `DevBombHarness` (Task 4). The `/dev/bomb` `vite preview` SPA-fallback 404 is a known accepted gap.

### Installed 3D stack (verified in 4.1/4.2 — no version work)

`three 0.184.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `camera-controls 2.10.1` · `@types/three 0.184.1` · React 18.3. **Never upgrade React or jump to fiber@9/drei@10** (React-19-only). Bay tags use drei `<Text>` + the already-vendored `/fonts/jetbrains-mono-700.ttf` (troika loads ttf/otf/woff, not woff2 — already solved in 4.2). Zero new packages, zero new assets.

### Architecture & project-rule compliance (what review will judge)

- **R3F components are dumb renderers** — the only logic that may live in a component is the flash-edge detection ref bookkeeping; the visual mapping itself is the pure `solveLedVisual` function with its own tests. If you're writing solve/strike *rules*, stop — that's the server reducer's job (already built, 1.6).
- **Data-driven geometry:** bays map over `computeModuleLayout(modules.length)`; bay screws/LED/tag positions derive from constants + slot data, not per-bay literals; module bodies resolve via `getModuleRenderer(moduleId)` — AC1 is verbatim a project rule, and it's the thing the review will grep for first.
- **`useFrame` discipline (the per-frame rules bite for the first time in Epic 4 here):** flash driver early-returns when inactive; no allocations in the callback (reuse a scratch ref / write material properties in place); never `setState` from `useFrame`; status *reads* that drive the flash come from the subscribed prop captured into a ref, or `useGameStore.getState()` — never a reactive hook read inside the frame callback.
- **Memoization:** per-bay scoped selectors so one module's update re-renders one bay. This is the pattern 4.7's 60fps gate will profile — building it right now is cheaper than retrofitting.
- **Colors are raw hexes with the token name in a comment** (4.1/4.2 convention; CSS vars can't reach WebGL). This story's palette: led-red-glow `#7A0000`, led-green `#3DFF7A`, led-green-glow `#15B548`, led-red `#FF2E2E`, graphite `#1A1A1F`, bay-rim `#0C0B0E`, bay-tag `#5A5560`, brass `#B8924A`.
- **Literal spec values:** 600ms flash; 10px LED (translated ≈0.042 world diameter at overview — show the math); the three-state table exactly as DESIGN.md's `componentSpec.moduleSolveLed`; `MOD-NN` mono tags per mockup `.bay-tag`.
- **Reduced motion:** the flash is this story's only animation — DESIGN.md mandates strike-flash → instant state change under `prefers-reduced-motion`. Read the media query the way `BombScene.prefersReducedMotion()` already does (or lift that helper out for reuse rather than duplicating it).

### UX requirements bound into the ACs

- **The LED is the Defuser's only visual solve confirmation** (EXPERIENCE.md: "green-glow on solve is the only solved confirmation the Defuser gets visually" — the paired chime is 10.1). It must read unambiguously at overview distance: glow on green, clearly dormant dim-red otherwise.
- **Scanning greens is the progress model** (DESIGN.md: "Module solve LED is the single source of truth for module state — green = done. Defuser learns the bomb by scanning greens"). Don't add solve counters, checkmarks, or any competing affordance.
- **Strike feedback is non-blocking** (EXPERIENCE.md: "module flashes red 600ms… No modal interruption") — the flash is diegetic, on the bomb, and play continues through it.
- **Colorblind safety:** LED red/green is semantic but the *position* (one LED per bay, lit-vs-glow difference, dim-vs-bright) carries load too — keep armed genuinely dim (low intensity) vs solved genuinely glowing so the brightness channel distinguishes them even if hue fails. Keep LED colors strictly semantic, never decorative (DESIGN.md).
- **Mockup anatomy** (`3. Defuser Bomb View.html` `.bay`, `.bay-screw`, `.bay-head`, `.bay-tag`, `.solve-led`): recessed dark bay, 4 corner screws, head row with tag left + LED right. Mockup's 2D solve-led is 13px while DESIGN.md's componentSpec says 10px — **the AC says 10px; DESIGN.md componentSpec wins** (same precedence as 4.2's diegetic ruling: spines over mocks). Mockup is the anatomy reference, not the dimension authority.

### Previous story intelligence (4.1 + 4.2, reviewed 2026-06-12)

- **Reviews walk count ranges and edge domains:** 4.1's patch was a layout overlap at count ≥13; 4.2's patches were tray overhang at battery 9–12 and partial-row centering. Sweep your domains: flash at 0/599/600ms boundaries, count 0/1/11/13 bays, solved-during-flash, double-strike-during-flash (re-trigger restarts the window — decide and test the behavior).
- **Pure-fn + thin-component split is the house pattern** (`stage.ts`/`BombStage`, `layout.ts`/`BombScene`, `chassis.ts`/`ChassisFeatures`): `moduleLed.ts` + registry carry all testable logic; components stay logic-free. Review checks this split explicitly.
- **Honest smoke notes:** record (a)–(h) individually; an earlier story's unexecuted smoke claim was caught by the auditor. 4.2 ran a headless Playwright/SwiftShader pass with screenshot inspection — same approach works here, and the keyboard controls make state changes scriptable; note that flash timing (~600ms) is verifiable via timestamped screenshots.
- **Keep diffs surgical:** concentrate changes in new files + `BombScene.tsx`'s module hunk; one-line `App.tsx` diff; zero diffs in camera/chassis/store/shared code. 4.2 achieved zero `App.tsx` diff — this story can't (the harness must mount), so keep it to the single branch line.
- **Type-narrowing findings recur:** 4.2's review retyped two `string`-typed props to their union types (`IndicatorLabel`, `PortType`). Type `moduleId` as `string` (it is open-ended by design — registry keys are arbitrary kebab-case ids), but type `status` as `ModuleState<unknown>['status']`, never `string`.
- **Known deferral you may observe but must not fix:** camera clips through chassis ends at max wheel-zoom (`MIN_DISTANCE` 1.2 < half-width 1.5) — owned by 4.7/10.2.

### Git intelligence

`6ca28c9` (4.2) and `e6ed86c` (4.1) show the cadence: implement → adversarial review → patches folded → single story commit with review summary. Client-only story again — no lockfile churn (zero new deps). Worktree branch: `worktree-story-4-1`. Story 1.7 sits at `review` status and 2.2+ are backlog in parallel — another reason `App.tsx`/store diffs stay minimal.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack for this story:** React 18 + Three.js/R3F + Zustand + TypeScript only. No LiveKit, no server, no socket emissions, no new deps.
- **R3F (verbatim):** geometry/layout data-driven, never hardcoded in JSX; rendering-only components, zero game logic; `useFrame` for per-tick animation (the flash) — never `useEffect` + `setInterval`; tick-rate reads via `getState()`/refs inside `useFrame`, reactive selectors only for snapshot-rate reads.
- **Performance:** 60fps budget; no per-frame allocations (reuse refs); memoize module components with stable selectors ("module components re-render on every state broadcast — memoize with `React.memo` and stable selector functions"); dispose manually-created Three objects (stay declarative and it's free).
- **Don't-miss rules in play:** NEVER `Math.random()` outside `generate()` (dev state is a fixed constant); NEVER mutate `BombContext` or module state (store actions already spread immutably — keep it that way in the dev controls); no client-side authoritative logic (LEDs render server truth; green only from `status === 'solved'`); module IDs are kebab-case strings.
- **Build rules:** `tsc --noEmit` 0 errors, no `@ts-ignore`; TypeScript only; naming — `ModuleBay`/`DevBombHarness`/`PlaceholderModule` PascalCase components, `solveLedVisual`/`formatBayTag`/`getModuleRenderer` camelCase helpers, `registry.ts`/`moduleLed.ts` camelCase modules.
- **Testing boundaries:** pure logic unit-tested in Node (registry, LED table, tag format); R3F components visual-only — if a component needs a logic test, the logic has leaked, move it to the pure module.

### Project Structure Notes

- New files: `apps/client/src/modules/registry.ts`, `apps/client/src/modules/PlaceholderModule.tsx`, `apps/client/src/modules/__tests__/registry.test.ts`, `apps/client/src/scenes/ModuleBay.tsx`, `apps/client/src/scenes/moduleLed.ts`, `apps/client/src/scenes/DevBombHarness.tsx`, `apps/client/src/scenes/devBombState.ts` (or extend `devBombContext.ts`), `apps/client/src/scenes/__tests__/moduleLed.test.ts`.
- Modified: `apps/client/src/scenes/BombScene.tsx` (module hunk + header comment), `apps/client/src/scenes/layout.ts` (doc comment + `DEFAULT_PLACEHOLDER_COUNT` retirement), `apps/client/src/App.tsx` (one line in the dev branch).
- Untouched: `CameraRig` (within BombScene), `BombStage.tsx`, `stage.ts`, `useIdleCursor.ts`, `ChassisFeatures.tsx`, `chassis.ts`, both stores, everything in `packages/shared` and `apps/server`.
- This story creates `apps/client/src/modules/` — the architecture's per-module client home. Real module dirs (`wires/`, …) arrive in Epic 5; `custom/` in V2. Don't scaffold empty dirs for them.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.3: Module Slots & Solve LEDs] (ACs verbatim; Epic 4 objective; 4.5/4.6/4.7 boundaries)
- [Source: _agent_docs/game-architecture.md#Repository & Workspace Layout] (`src/modules/registry.ts` — client-side module renderer registry)
- [Source: _agent_docs/game-architecture.md#Epic to Architecture Mapping] (Epic 4 owns `modules/registry`; Epics 5–7 are additive registry entries)
- [Source: _agent_docs/game-architecture.md#ADR-003] (open/closed registry pattern — server mirror `MODULE_REDUCERS`)
- [Source: _agent_docs/game-architecture.md — state-sync section] (optimistic render never pre-commits solved; only the server's `ModuleUpdate` flips the solve LED)
- [Source: packages/shared/src/types/module.ts] (`ModuleState`, transient `'struck'` contract — basis of the edge-triggered flash design)
- [Source: packages/shared/src/events/payloads.ts] (`ModuleUpdate {moduleIndex, state}`; `StrikePayload` has no moduleIndex — why the flash keys off module status)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#componentSpec.moduleSolveLed + colors.hud] (10px circular; unsolved/solved/striking states; exact hexes; LED semantics; colorblind notes; reduced-motion strike-flash rule)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD & Diegetic UI / Game Feel] (per-module solve LEDs diegetic on the bomb; green-glow = only visual solve confirmation; strike flash 600ms, no modal; chime is paired but separate)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/3. Defuser Bomb View.html] (`.bay`/`.bay-screw`/`.bay-head`/`.bay-tag`/`.solve-led` anatomy; scene state: one solved, five armed)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#L131, L577–586] (3–11 modules facilitator-configured; green LED = disarmed; all disarmed = defused)
- [Source: _agent_docs/project-context.md#React / R3F Gotchas, Performance Rules, Critical Don't-Miss Rules] (useFrame discipline; memoization; no per-frame allocations; Math.random ban)
- [Source: _agent_docs/implementation-artifacts/4-2-chassis-and-bomb-metadata-rendering.md] (deferred-to-4.3 list: bay framing, per-module screws, solve LEDs; vendored mono font; review-finding patterns; smoke methodology)
- [Source: _agent_docs/implementation-artifacts/4-1-3d-bomb-scene-and-camera-rig.md] (camera/interaction contract; `ModuleSlot` shape; memo pattern)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (camera end-face clip — 4.7/10.2; stale focus index — 4.6/4.7; neither is this story's to fix)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD: `moduleLed.test.ts` + `registry.test.ts` + `formatBayTag` tests written first and confirmed failing (modules absent / function missing), then implemented → all green.
- Gates after implementation: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green (chunk-size warning is the pre-existing three.js bundle note); `pnpm -r test` → shared 24 ✓, client 76 ✓ (51 baseline + 25 new/migrated), server 64 ✓ — no regressions.
- Headless-browser smoke (playwright-core chromium + SwiftShader against `vite dev --port 5199`, 1920×1080, harness reused from 4.2's `/tmp/pw-smoke`, server stopped after) with screenshot inspection — results in Completion Notes.

### Completion Notes List

- **Task 1 — registry:** `modules/registry.ts` — `ModuleRenderer { id, DefuserView }`, `registerModuleRenderer` (throws on duplicate id, fail-loud), `getModuleRenderer` (unknown id → `PLACEHOLDER_RENDERER`, never undefined/throw). `modules/PlaceholderModule.tsx` renders null (bay frame/tag/LED are ModuleBay's). 5 registry tests.
- **Task 2 — data-driven slots:** `BombScene` now reads `s.bomb?.modules ?? DEV_PLACEHOLDER_MODULES` (reactive, snapshot-rate); layout stays `computeModuleLayout(modules.length)`. New `scenes/ModuleBay.tsx` (memoized on `(slot, moduleId)`): rim `#0C0B0E`, graphite plate `#1A1A1F` carrying the 4.1 click-to-focus handler unchanged (`button===0`, `delta>4`, `stopPropagation`), 4 brass corner screws from a data-driven positions array, `MOD-NN` drei `<Text>` tag (vendored jetbrains-mono ttf, `#5A5560`), solve LED top-right, body via `getModuleRenderer(moduleId)` — zero per-module conditionals. `formatBayTag` pure helper in `layout.ts` (tests sweep 0–12). Back-face bays rotate 180° about y so tag/LED/body face outward.
- **Task 3 — LED pure fn:** `scenes/moduleLed.ts` — `solveLedVisual(status, flashElapsedMs, reducedMotion)` with literal DESIGN.md values: armed `#7A0000` @0.25, solved `#3DFF7A`/emissive `#15B548` @1.4, flash `#FF2E2E` decaying 2.2→0.6 over 600ms (`SOLVE_LED_FLASH_MS`), reduced-motion → static `#FF2E2E` @1.8 (no ramp). Solved wins unconditionally; stale/garbage elapsed (≥600/negative/NaN) → status mapping. 11 tests incl. 0/300/599/600ms boundaries. LED is radius 0.021 (10px ≈ 0.042 world diameter at the overview pose — math in a comment at the constant).
- **Task 3 — flash trigger:** edge-triggered via a direct `useGameStore.subscribe` (zustand notifies synchronously per `set()`, so the armed→struck→armed pulse is observed even when React batches both updates into one render — the render-time prop never shows 'struck' in that case, which is why subscription, not prop-diffing, is the detector). `useFrame` drives the 600ms window off `clock.elapsedTime` (no setTimeout/Date.now), early-returns when no flash is active, allocates nothing per frame (`Color.set` reuses), and re-asserts the flash visual every active frame so a mid-flash re-render can't cancel it. Base (non-flash) visual is declarative JSX from `solveLedVisual(status, null, false)`. A re-trigger during an active flash restarts the window (each observed armed→struck edge sets the pending flag).
- **Task 4 — dev harness:** `scenes/DevBombHarness.tsx` seeds `setBomb(DEV_BOMB_STATE)` on mount and (DEV-guarded) maps digit 1–9 → armed/solved toggle, Shift+digit → struck pulse (`applyModuleUpdate` struck then armed back-to-back — the worst-case transient). Uses `event.code` (`DigitN`) so Shift doesn't change the key identity; respects `isTextEntryTarget`. `scenes/devBombState.ts` holds `DEV_PLACEHOLDER_MODULES` (6× moduleId 'placeholder'; module 0 solved per the mockup scene state) + `DEV_BOMB_STATE` (fixed constants, no Math.random). All state changes ride the real store actions — the exact path 4.7's snapshot sync uses.
- **Task 5 — integration:** `CameraRig`, `BombStage.tsx`, `stage.ts`, `useIdleCursor.ts`, `ChassisFeatures.tsx`, `chassis.ts`, both stores, `packages/shared`, `apps/server` — all untouched. `prefersReducedMotion`/`isTextEntryTarget` lifted verbatim into `scenes/dom.ts` (BombScene now imports them; needed by ModuleBay/harness without a circular import). `layout.ts`: doc comment updated, `DEFAULT_PLACEHOLDER_COUNT` retired (replaced by `DEV_PLACEHOLDER_MODULES.length`), `formatBayTag` added. `App.tsx` diff confined to the dev-route branch (mounts `DevBombHarness`; import swap). `BombScene` header comment updated with 4.4/4.5 pointers.
- **Task 6 — gates:** tsc 0 errors / no `@ts-ignore`; client build green; full suite shared 24 ✓ / client 76 ✓ / server 64 ✓.
- **Task 6 — manual smoke (executed headlessly 2026-06-12, screenshots inspected):** (a) 6 bays with dark rims, graphite plates, 4 brass screws each, crisp `MOD-01`–`MOD-06` mono tags ✓; (b) MOD-01 LED glowing green, MOD-02–06 dim red — the single green is findable at a glance from overview ✓; (c) digit `2` flips MOD-02 green, second press back to dim red ✓; (d) Shift+3 → MOD-03 LED bright hot red at ~120ms, settled back to dim red by ~1s ✓ (and the pulse was struck→armed in the same tick — the batched worst case); (e) MOD-01 stayed green through every strike fired at other modules ✓; (f) 4.1/4.2 regression: bay click → focus dolly ✓, ESC → overview ✓, right-click no-op ✓, cursor hides after ~2.4s idle and wakes on move ✓ (verified via container style probe), serial sticker/indicators/batteries/ports all present after orbit ✓; (g) `prefers-reduced-motion: reduce` emulated → Shift+4 shows a static red state at 120ms, reverted after the window, no ramp ✓; (h) 8 rapid strike pulses + idle soak → all LEDs settled correctly, zero console/page errors (only the known pre-existing `/favicon.ico` 404) ✓.
- **Protocol note for Epic 8 (flagged, not a defect):** the client can only flash the correct module if the server broadcasts a `MODULE_UPDATE` whose state passes through `'struck'` before the rolled-up `'armed'` state (since `StrikePayload` carries no `moduleIndex`). The flash mechanism tolerates both sequencings (separate messages or same-tick), but Story 8.4 should make the transient-struck broadcast an explicit server contract.
- Recommend Jay does a quick interactive pass in a real browser for feel (LED glow intensity, flash brightness, bay tag size at preferred zoom).

### File List

- apps/client/src/modules/registry.ts (created — client-side module renderer registry, open/closed seam)
- apps/client/src/modules/PlaceholderModule.tsx (created — fallback DefuserView + PLACEHOLDER_RENDERER)
- apps/client/src/modules/__tests__/registry.test.ts (created — 5 tests)
- apps/client/src/scenes/ModuleBay.tsx (created — bay frame/screws/tag/LED + registry-resolved body; click-to-focus; edge-triggered flash driver)
- apps/client/src/scenes/moduleLed.ts (created — pure solve-LED state table + SOLVE_LED_FLASH_MS)
- apps/client/src/scenes/__tests__/moduleLed.test.ts (created — 11 tests)
- apps/client/src/scenes/devBombState.ts (created — DEV_PLACEHOLDER_MODULES + DEV_BOMB_STATE)
- apps/client/src/scenes/DevBombHarness.tsx (created — store seeding + DEV-only keyboard state controls)
- apps/client/src/scenes/dom.ts (created — prefersReducedMotion / isTextEntryTarget lifted from BombScene)
- apps/client/src/scenes/BombScene.tsx (modified — modules-array read, ModuleBay mount, helpers lifted out, header comment; CameraRig/chassis hunks untouched)
- apps/client/src/scenes/layout.ts (modified — doc comment, DEFAULT_PLACEHOLDER_COUNT retired, formatBayTag added)
- apps/client/src/scenes/__tests__/layout.test.ts (modified — formatBayTag tests; retired-constant assertion removed)
- apps/client/src/App.tsx (modified — dev-route branch mounts DevBombHarness)
- _agent_docs/implementation-artifacts/sprint-status.yaml (modified — story status tracking)

## Change Log

- 2026-06-12: Story 4.3 implemented — module slots are now data-driven from `BombState.modules` through the new client-side renderer registry (`modules/registry.ts`, placeholder fallback until Epic 5), each slot rendered as a ModuleBay (rim, graphite plate, brass screws, MOD-NN mono tag) carrying a 10px-equivalent solve LED with pure-function state table (dim red / green glow / 600ms edge-triggered red flash, reduced-motion static variant). Dev harness seeds the real store and drives statuses via keyboard (digit toggle solve, Shift+digit struck pulse). Typecheck/build/full suite green (24/76/64); headless smoke with screenshot inspection passes all checks (a)–(h).
