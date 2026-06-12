---
baseline_commit: e6ed86c
---

# Story 4.2: Chassis & Bomb Metadata Rendering

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want the bomb to display its serial number, batteries, indicators, and ports as physical features,
So that I can read them aloud to the Experts.

## Acceptance Criteria

1. **Diegetic metadata rendering.** Given a `BombContext`, when the chassis renders, then the serial sticker (mono font, last char a digit), battery panel, indicator labels (lit/unlit), and ports are visible as diegetic chassis features.

2. **Serial findable by rotation.** Given the Maya flow target, when I rotate the bomb to find the serial, then the serial is findable in under 10 seconds with no menu-driven inspection.

## Tasks / Subtasks

- [x] **Task 1 — Vendor a mono font usable inside WebGL (AC: 1)**
  - [x] The serial sticker and indicator labels are 3D text — CSS fonts cannot reach WebGL. Use drei's `<Text>` (troika-three-text SDF, already installed transitively via `@react-three/drei@9.122` — **no new npm dependency**).
  - [x] **CRITICAL FORMAT CONSTRAINT:** troika-three-text loads `.ttf`/`.otf`/`.woff` only — **NOT `.woff2`**. The Google Fonts CSS `@import` in `index.css` serves woff2; its URLs cannot be reused. Vendor a JetBrains Mono Bold file (`.woff` or `.ttf`, OFL-licensed — include `OFL.txt` beside it) at `apps/client/public/fonts/jetbrains-mono-700.woff` and pass `font="/fonts/jetbrains-mono-700.woff"` to `<Text>`. (This partially advances the existing deferred-work item "self-host all five families before production" for the mono family.)
  - [x] Do NOT add `@fontsource` packages or any new runtime dependency for this; a static asset in `public/` is the whole job.

- [x] **Task 2 — Dev placeholder `BombContext` (AC: 1)**
  - [x] No bomb generation exists yet (server-side generation is Story 8.2), so the dev harness needs a fixed context. Create `apps/client/src/scenes/devBombContext.ts` exporting a `const DEV_BOMB_CONTEXT: BombContext` matching the mockup: `serialNumber: 'KTANE5'`, `batteryCount: 2`, `indicators: [{ label: 'FRK', lit: true }, { label: 'CAR', lit: false }]`, `ports: ['Parallel', 'PS/2']`. Import the `BombContext` type from `@bomb-squad/shared`.
  - [x] It is a **fixed constant** — `Math.random()` is forbidden outside `generate(seed, ctx)` (project rule), and a dev placeholder is not a generator. Last serial char MUST be a digit (`'KTANE5'` ✓ — the `BombContext` contract guarantees this for real data; the placeholder must honor it).
  - [x] In `BombScene.tsx`, read the context reactively (non-per-frame, same pattern as the existing `moduleCount` read): `useGameStore((s) => s.bomb?.context) ?? DEV_BOMB_CONTEXT`. When a real `BOMB_INIT` snapshot lands (Epic 8), the scene automatically renders real data with zero changes here.

- [x] **Task 3 — Pure metadata-placement layout (AC: 1, 2)**
  - [x] Create `apps/client/src/scenes/chassis.ts` — a pure helper (no React, no three.js imports; mirror `layout.ts`'s style): `computeChassisFeatureLayout(ctx: { batteryCount: number; indicatorCount: number; portCount: number }): ChassisFeatureLayout` returning positions/normals for the serial sticker, battery cells, indicator chips, and port plates in chassis-local space.
  - [x] **Hard placement rule:** metadata features live ONLY on the four non-module faces — left/right ends (x = ±`CHASSIS_SIZE[0]/2`, face size 1.05×1.5) and top/bottom (y = ±`CHASSIS_SIZE[1]/2`, face size 3×1.05). The front/back (±z) faces belong to module slots (`computeModuleLayout` fills front first, then back at count > 6) — placing metadata there collides with modules at higher counts. Import `CHASSIS_SIZE` from `./layout.js`; do not redeclare dimensions.
  - [x] Suggested assignment (keep deterministic; micro-positions are yours): **serial sticker → right end face** (single large feature, instantly readable when that face comes into view — AC2); **indicators + battery panel → top face** (row layout, grows with counts); **ports → bottom face** (row of plates). Features within a face are laid out from the count (centered row/grid, like `computeModuleLayout`'s centering math) — never hardcoded per-item positions in JSX.
  - [x] Guard clauses: counts of 0 → empty arrays for that feature (a bomb can have 0 indicators or 0 ports — GDD says "subset of", possibly empty); negative/NaN counts → treat as 0, never produce NaN positions. Features within a face must not overlap at max realistic counts (11 indicators, 6 ports — scale the row step down or wrap to a second row if needed; assert no-overlap in tests).

- [x] **Task 4 — Chassis material pass + serial sticker (AC: 1, 2)**
  - [x] This story owns the "real chassis materials" deferred from 4.1. Upgrade the chassis body in `BombScene.tsx` from the flat graphite placeholder to the DESIGN.md bomb-world read: **bakelite orange body** (`#C2491F`, `--color-bakelite`) with `#7A2A10` (`--color-bakelite-deep`) shadowed edge accents and **brass corner screws** (`#B8924A`, `--color-brass` — four small cylinders at the front-face corners, echoing the mockup's `.screw` elements). Flow 1's first impression is the contract: "Bakelite orange, brass screws" — the 4.1 graphite box was explicitly a placeholder. Keep it `meshStandardMaterial` flat colors + simple geometry — no texture pipeline, no environment maps, no normal maps. Keep the existing ambient + directional lighting untouched.
  - [x] Leave `ModulePlaceholder` faceplates and their bakelite color alone except where chassis-color contrast now demands a tweak (chassis turning bakelite means faceplates may need to go graphite `#1A1A1F` so modules still read as distinct bays). Module bay framing, screws-per-module, and solve LEDs are **Story 4.3 — do not build them**.
  - [x] **Serial sticker** (mockup `.serial` is the visual spec, translated to 3D): a cream plane (`#E8DCC2`, `--color-cream`, with `#C9BC9D` border feel) sitting ~0.01 proud of the right end face, rotated ~-1° around its normal (DESIGN.md allows ≤1° rotation for paper-feel; mockup uses exactly -1deg). On it, three stacked elements: small `<Text>` label `SERIAL NO.` (letter-spaced, muted `#8A7A5E`), large bold `<Text>` `{ctx.serialNumber}` (ink `#211A12`, the dominant element — sized to fill most of the sticker width so it's legible from the overview-ish distance once the face is visible), and a barcode-bars strip (thin black box meshes from a small pure helper, or a single striped plane — keep it cheap; it's a flourish, drop it before letting it complicate disposal).
  - [x] Sticker sizing sanity: the right end face is 1.05 wide × 1.5 tall in world units; make the sticker ≈0.85×0.45 so a 6-char serial at JetBrains Mono Bold reads crisply. SDF text stays sharp at any zoom — no DPI math needed.

- [x] **Task 5 — Battery panel, indicator chips, port plates (AC: 1)**
  - [x] All three are data-driven from `BombContext` via `computeChassisFeatureLayout` — **mapping over layout output, never JSX repetition** (same project rule the 4.1 module slots follow).
  - [x] **Battery panel** (mockup `.battery`/`.cell-bat`): a graphite (`#1A1A1F`) recessed tray on the top face holding `batteryCount` cells — each cell a small cylinder (AA read: radius ≈0.045, length ≈0.22, lying in the tray) with brass-amber body (`#C9A23A` top → darker base; two materials or one flat `#C9A23A` is fine). Count drives cells 1:1 — 0 batteries renders an empty tray or no tray (your call; test whichever you choose).
  - [x] **Indicator chips** (mockup `.indicator`): per entry in `ctx.indicators`, a small graphite chip (box ≈0.28×0.1×0.02) carrying a round LED dot and a mono `<Text>` label (`FRK`, `CAR`, … cream `#E8DCC2`, bold, letter-spaced). LED states from the mockup: **lit** = warm white `#FFF4D6` with emissive glow (`emissive: '#FFE9A8'`, emissiveIntensity ~1 — static, no pulse animation; nothing in this story animates, which also keeps `prefers-reduced-motion` trivially satisfied); **unlit** = flat `#3A3A40`, no emissive. Lit/unlit must be visually unmistakable at a glance — the Expert asks "is FRK lit?" over voice.
  - [x] **Port plates:** per entry in `ctx.ports`, a recessed graphite plate on the bottom face with a simple distinct-silhouette inset per `PortType` (e.g. wide slot for Parallel, round for PS/2, square for RJ-45 — crude geometric reads are fine) **plus a mono `<Text>` label of the type name** (`DVI-D`, `RJ-45`, …). The label is load-bearing: module rules reference ports by name ("does the bomb have a parallel port?") and v1 legibility beats silhouette artistry. Same port type can appear twice (`ports` is an array, not a set) — render duplicates.
  - [x] Wrap the whole metadata group in a `React.memo`-ized `ChassisFeatures` component (props: `context: BombContext`). `BombContext` is readonly and replaced wholesale on `setBomb`, so reference equality makes the memo effective against unrelated store broadcasts (strikes, module updates) — the 4.1 `ModulePlaceholder` memo pattern, same reason.
  - [x] Metadata meshes get **no click handlers** — clicking a sticker/battery does nothing (module focus clicks are the only scene interaction, Story 4.1's contract). They'll still be raycast-hit; without handlers that's a no-op, which is correct. Do not add `stopPropagation` layers.

- [x] **Task 6 — R3F discipline & integration (AC: 1, 2)**
  - [x] Rendering only — zero game logic. No `useFrame` needed in this story (nothing animates); don't add one. No new Zustand state; no `uiStore` changes; no socket events; no server code.
  - [x] Keep everything declarative JSX so R3F auto-disposes geometry/materials. If you do create anything manually (`new CanvasTexture(...)` for barcode bars, for instance), dispose it in a cleanup — manually constructed Three.js objects are not auto-managed. Prefer not creating any.
  - [x] Camera rig untouched: `OVERVIEW_POSITION`, focus dolly, ESC, button reservations, idle cursor, letterbox stage are 4.1's verified behavior — this story adds meshes to the scene graph and changes materials; it must not change `CameraRig`, `BombStage`, `stage.ts`, or `useIdleCursor.ts`. `MIN_DISTANCE`/`MAX_DISTANCE` clamps still hold (features sit on the chassis surface, inside the 1.2 min-distance shell — verify the serial is readable from `minDistance` zoom; if not, scale the sticker up rather than touching clamps).
  - [x] `App.tsx` is NOT touched — the `/dev/bomb` harness from 4.1 already mounts the scene. (Story 2.2 in a parallel worktree owns other `App.tsx` changes; zero-diff here keeps the merge clean.)

- [x] **Task 7 — Tests, gates & manual smoke (AC: 1, 2)**
  - [x] Unit tests (Vitest, Node env, pure logic only — R3F components themselves are visual-regression-only per project testing rules): `apps/client/src/scenes/__tests__/chassis.test.ts` covering `computeChassisFeatureLayout`: counts → lengths (battery 0/1/2/4, indicators 0/1/2/11, ports 0/1/2/6); all positions on non-±z faces (assert |z| < CHASSIS_SIZE[2]/2 at feature centers, or assert the normal axis is x/y); no overlap within a face at max counts; NaN/negative counts → empty, never NaN coordinates; stable ordering (index i always maps to the same slot).
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore`; `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → no regressions (baseline: shared 24 ✓, client 19 ✓, server 64 ✓).
  - [x] **Manual smoke (record results honestly in Completion Notes; do not mark done without it):** `pnpm --filter @bomb-squad/client dev`, open `http://localhost:5173/dev/bomb`. Verify: (a) chassis reads bakelite orange with brass screws — a lit physical prop, not a gray box; (b) orbit to the right end — serial sticker visible, `KTANE5` crisp in mono bold, label + bars present; **time the Maya flow: from overview, rotate and read the serial aloud — must be comfortably under 10 s** (AC2); (c) top face shows FRK chip with glowing-warm LED and CAR chip visibly dark, plus 2 battery cells in the tray; (d) bottom face shows Parallel and PS/2 plates with legible labels; (e) module clicks still focus-dolly, ESC still overviews, right/middle still dead, cursor still hides after 2 s (4.1 regression pass); (f) zoom to `minDistance` on the sticker — text stays sharp (SDF), no z-fighting between sticker/chip surfaces and chassis faces (offset features ~0.01 along their normal); (g) a few minutes idle — no console errors, no obvious frame collapse.

## Dev Notes

### What this story is — and is not

Story 4.1 built the interaction shell (stage, camera, placeholder geometry). This story makes the bomb *describable*: the four `BombContext` fields (serial, batteries, indicators, ports) become physical chassis features the Defuser can find by rotating and read aloud over voice, and the chassis itself gets its real bomb-world material identity (bakelite + brass replacing the 4.1 graphite stand-in).

**Out of scope (do not build):** module bays/registry layout/solve LEDs (4.3), timer LCD + `--timer-*` tokens + DSEG7 font (4.4), strike HUD (4.5), preparation gating (4.6), snapshot/optimistic/60fps hardening (4.7), any HUD overlay, any server/generation code (8.2 generates real `BombContext`s). The DSEG7/LCD font is explicitly NOT vendored here — only JetBrains Mono.

### Diegetic ruling: the mockup's top band is a 2D fake — the ACs and spines win

The Defuser Bomb View mockup places serial/indicators/battery in a flat "top band" above the module grid. That is a static-HTML convenience (the same mockup family whose `stage.js` approach 2.1 explicitly rejected). The authoritative sources disagree with the band and with each other in this story's favor:

- EXPERIENCE.md "HUD & Diegetic UI": "Serial number sticker, battery count panel, indicator labels — all physical chassis features" — **diegetic, on the bomb**.
- EXPERIENCE.md Flow 1 step 4: Maya "rotates the bomb, finds the serial sticker **on the back**… Mono font, clearly legible at zoom."
- AC2 exists precisely because the serial is NOT always on screen — it's findable by rotation in <10 s.
- EXPERIENCE.md line 15: "Both spines win on conflict with any mock or import."

So: features live on the 3D chassis (non-module faces), not in screen space. Use the mockup only for **per-feature visual styling** (sticker anatomy, indicator chip anatomy, battery cell colors) — it's excellent for that.

### Current state of the scene code (read before editing — all 4.1, reviewed & done)

- `apps/client/src/scenes/BombScene.tsx` — **the file you modify.** Graphite chassis box (`CHASSIS_SIZE` 3×1.5×1.05) + bakelite `ModulePlaceholder` faceplates (memoized, click→focus with `button===0` + 4px drag-tolerance guards) + `CameraRig` (drei `CameraControls`, overview pose [0,1.1,5.2], focus distance 1.6, clamps 1.2–10, ESC handler, reduced-motion-aware). Your changes: swap chassis materials, add screws, mount `<ChassisFeatures context={...}>`, add the reactive context read. Everything else stays byte-identical in behavior.
- `apps/client/src/scenes/layout.ts` — pure module-slot layout; exports `CHASSIS_SIZE`, `DEFAULT_PLACEHOLDER_COUNT`, `computeModuleLayout`. Slots fill the front face (+z) first, then back (−z), growing rows downward at count > 12. **This is why metadata can never use ±z faces.** Import `CHASSIS_SIZE` from here; don't touch the module layout.
- `apps/client/src/scenes/BombStage.tsx`, `stage.ts`, `useIdleCursor.ts` — letterbox stage, pure sizing math, idle cursor. **Untouched.**
- `apps/client/src/store/gameStore.ts` — `bomb: BombState | null`; `BombState.context` is the `BombContext`. Doc comment mandates `getState()` only for per-frame reads; reactive selectors are fine for click/snapshot-rate reads like this story's context read.
- `apps/client/src/store/uiStore.ts` — `activeModuleIndex` focus state. **No changes** — this story adds no UI state.
- `packages/shared/src/types/bomb.ts` — `BombContext { serialNumber, batteryCount, indicators: {label: IndicatorLabel, lit}[], ports: PortType[] }`, all readonly; `IndicatorLabel` = SND|CLR|CAR|IND|FRQ|SIG|NSA|MSA|TRN|BOB|FRK; `PortType` = DVI-D|Parallel|PS/2|RJ-45|Serial|Stereo RCA. Serial's last char is always a digit (documented contract). **Never mutate `BombContext`** (project don't-miss rule); it's structurally readonly anyway.
- `apps/client/src/App.tsx` — `/dev/bomb` harness already mounts `BombStage`→`BombScene` inside `PlatformGate`. **Untouched.** Known accepted gap: `vite preview` SPA-fallback 404 on the dev route (deferred-work.md).
- Open deferral from 4.1's review (do NOT fix here): stale `activeModuleIndex` on remount/shrink — owned by round-lifecycle stories 4.6/4.7.

### Installed 3D stack (4.1's verified resolution — no version work needed)

`three 0.184.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `camera-controls 2.10.1` · `@types/three 0.184.1`. React stays 18.3 — **never upgrade React or jump to fiber@9/drei@10** (React-19-only). drei@9 ships `<Text>` (troika-three-text) — the only new capability this story consumes, zero new packages.

### drei `<Text>` specifics (researched against drei 9.x / troika)

- Font formats: `.ttf`/`.otf`/`.woff` only — **woff2 will fail to parse**. Vendor the file; don't hot-link Google Fonts (their CSS pipeline serves woff2, and the deferred-work list already flags the CDN dependency for removal).
- `<Text>` renders SDF glyphs — crisp at any camera distance, ideal for the zoom-to-read serial. Useful props: `font`, `fontSize` (world units), `color`, `letterSpacing`, `anchorX/anchorY`, `maxWidth`. It loads the font async and pops in when ready — acceptable for a dev-harness scene; no Suspense gymnastics required.
- Each `<Text>` is a mesh in the scene graph — position/rotate it like any mesh (so it can sit on a face, offset ~0.01 along the normal to avoid z-fighting with the sticker/chip surface beneath it).
- Declarative `<Text>` is disposed by R3F on unmount like other JSX scene objects.

### Architecture & project-rule compliance (what review will judge)

- **R3F components are dumb renderers** — this story is 100% presentation; if you find yourself writing a rule about serial digits or battery counts, stop — that's module/generation logic belonging to Epics 5/8.
- **Data-driven geometry:** every repeated feature (cells, chips, plates) maps over pure-layout output keyed by `BombContext` counts. Reviewer precedent: 4.1's layout overlap bug was found by walking counts the tests didn't cover — make `chassis.test.ts` sweep count ranges (0 → max), not just the happy 2-and-2.
- **Memoization:** `ChassisFeatures` wrapped in `React.memo`; context reference is stable between bombs, so chips don't re-render on strike/module broadcasts.
- **Disposal:** stay declarative and it's free; anything `new`-ed (textures) needs explicit cleanup.
- **No per-frame work:** nothing here animates; no `useFrame`, no `setInterval`, no timers. The lit-indicator glow is a static emissive material, not a pulse (pulsing LEDs aren't in any spec for indicators — and skipping animation sidesteps the `prefers-reduced-motion` branch entirely).
- **Literal spec values** (review culture from 2.1/4.1: literal, not approximate): mono font for serial + indicator labels; lit vs unlit as distinct material states; serial last char a digit in the placeholder; features on the chassis, not screen space; sticker rotation ≤1°.
- **Colors are raw hexes in scene code** (CSS vars can't reach WebGL) with the token name cited in a comment next to each hex — the established 4.1 convention. Palette for this story: bakelite `#C2491F`, bakelite-deep `#7A2A10`, brass `#B8924A`, graphite `#1A1A1F`, cream `#E8DCC2`, manual-ink `#211A12`, lit-LED `#FFF4D6`/glow `#FFE9A8`, unlit-LED `#3A3A40`, battery brass `#C9A23A` (last four from the mockup's chassis-meta styles).

### UX requirements bound into the ACs

- **Mockup anatomy to mirror in 3D** — serial sticker: cream, −1° rotation, `SERIAL NO.` micro-label, bold 6-char mono number, barcode bars beneath. Indicator chip: graphite, LED dot left, bold mono label right. Battery: brass-amber cells in a graphite tray. (Mockup `3. Defuser Bomb View.html` styles `.serial`, `.indicator`, `.battery`.)
- **Findability over beauty (AC2):** one big high-contrast cream sticker on an end face beats a beautiful tiny one. The Maya flow is the test script: overview → orbit → read aloud, <10 s.
- **Voice-describability is the point of every feature:** "two batteries", "FRK is lit, CAR is dark", "there's a parallel port" must each be answerable at a glance. If a feature needs squinting, make it bigger.
- **No keyboard/menu inspection paths** — rotation is the only discovery mechanism (EXPERIENCE.md: no bomb-side keyboard except ESC).
- **Depth tier 1** (DESIGN.md): the bomb is lit 3D with real materials — this story completes the "real materials" half deferred from 4.1. Tone: "chunky 1960s spy-thriller prop", industrial, high-contrast, knowable in a glance.

### Previous story intelligence (4.1, reviewed 2026-06-12)

- **The review layer walks count ranges:** 4.1's only patch was a layout overlap at count ≥ 13 that tests hadn't swept. Sweep your count domains in `chassis.test.ts` (indicators 0–11, ports 0–6, batteries 0–high).
- **Pure-fn + thin-component split is the house pattern** (`stage.ts`/`BombStage`, `layout.ts`/`BombScene`): `chassis.ts` carries all testable math; components stay logic-free.
- **Honest smoke notes:** 4.1 documented headless smoke results check-by-check; an earlier story's unexecuted smoke claim was caught by the auditor. Record (a)–(g) individually.
- **Keep diffs surgical:** 4.1 kept `App.tsx` to one branch for the parallel 2.2 worktree; this story achieves zero `App.tsx` diff. `BombScene.tsx` is where the diff concentrates — keep `CameraRig` and click-handling hunks untouched so the 4.1 behavior provably survives.
- **4.1 left a hook:** BombScene's header comment says "Real chassis materials land in 4.2" — update that comment when you land them (and 4.3's pointer stays).

### Git intelligence

`e6ed86c` (Story 4.1) shows the cadence: implement → adversarial code review → patches folded → single story commit with review summary in the message. Client-only story, no lockfile churn expected this time (no new deps — only a font asset + license file). Worktree branch: `worktree-story-4-1`.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack for this story:** React 18 + Three.js/R3F + Zustand + TypeScript only. No LiveKit, no server, no socket events, no new deps.
- **R3F (verbatim rules):** geometry/layout data-driven, never hardcoded in JSX; rendering-only components, zero game logic; `useFrame` only for per-tick updates (none here); tick-rate reads via `getState()` (none here — context reads are snapshot-rate, reactive selector is correct).
- **Performance:** 60 fps budget — adding ~20 small meshes + a handful of SDF texts is well inside it; no per-frame allocations (trivially true: no `useFrame`); memoize repeated components; dispose manually-created Three objects.
- **Don't-miss rules in play:** NEVER mutate `BombContext`; NEVER call `Math.random()` outside `generate()` (the dev context is a constant, not a generator); serial last char is always a digit — placeholder respects the contract; no client-side timers (nothing timer-shaped in this story).
- **Build rules:** `tsc --noEmit` 0 errors before commit, no `@ts-ignore`; TypeScript only; naming — `ChassisFeatures` PascalCase component, `computeChassisFeatureLayout` camelCase pure helper, `devBombContext.ts` camelCase module.

### Project Structure Notes

- New files: `apps/client/src/scenes/chassis.ts` (pure layout), `apps/client/src/scenes/ChassisFeatures.tsx` (memoized feature renderer — sub-components like `SerialSticker`/`IndicatorChip`/`BatteryTray`/`PortPlate` may live in this file or split within `scenes/`, your call), `apps/client/src/scenes/devBombContext.ts`, `apps/client/src/scenes/__tests__/chassis.test.ts`, `apps/client/public/fonts/jetbrains-mono-700.woff` (+ `OFL.txt`).
- Modified: `apps/client/src/scenes/BombScene.tsx` only.
- Untouched: `App.tsx`, `BombStage.tsx`, `stage.ts`, `layout.ts` (import-only), `useIdleCursor.ts`, both stores, everything outside `apps/client`.
- `scenes/` remains the architecture's "R3F bomb scene, camera rig" home; `modules/` still does not exist (5.1).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.2: Chassis & Bomb Metadata Rendering] (ACs verbatim; Epic 4 objective)
- [Source: packages/shared/src/types/bomb.ts] (`BombContext`, `IndicatorLabel`, `PortType` — exact shapes; serial last-char-digit contract)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD & Diegetic UI] (serial/battery/indicators = physical chassis features; diegetic vs non-diegetic split)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Key Flows — Flow 1] (rotate-to-find serial sticker; mono, legible at zoom; <10 s findability claim)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md] (line 15: spines win over mocks — basis for the diegetic ruling)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#Colors / Brand & Style / Elevation & Depth] (bakelite = primary chassis; brass accents; mono typography role; depth tier 1 real materials; ≤1° paper rotation)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/3. Defuser Bomb View.html] (`.serial`, `.indicator`, `.battery` styles — per-feature visual anatomy; top band is a 2D fake, see Dev Notes ruling)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md] (L164–167 metadata definitions; L618–621 randomization domains — counts this story's layout must tolerate)
- [Source: _agent_docs/game-architecture.md#Novel Pattern Designs — Pattern 4] (BombContext generated from teamSeed in Epic 8 — why this story uses a fixed dev placeholder)
- [Source: _agent_docs/game-architecture.md#Implementation Patterns / Performance Considerations] (dumb renderers; memoization; disposal; 60 fps gate)
- [Source: _agent_docs/project-context.md#React / R3F Gotchas, Critical Don't-Miss Rules] (BombContext immutability; Math.random ban; disposal; memo)
- [Source: _agent_docs/implementation-artifacts/4-1-3d-bomb-scene-and-camera-rig.md] (scene file inventory; verified dep versions; review findings; camera/interaction contract this story must not regress)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (self-host fonts item — partially advanced; 4.1 focus-state deferral — not this story's to fix)
- troika-three-text font support (ttf/otf/woff, no woff2): https://protectwise.github.io/troika/troika-three-text/ (drei `<Text>` wraps it; verify at implementation time)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Font vendored from the official JetBrains Mono repo (`fonts/ttf/JetBrainsMono-Bold.ttf` + `OFL.txt`) — used **`.ttf`** instead of the story's suggested `.woff` (identical troika support; the repo's source-of-truth file). `file` confirms valid TrueType; Vite serves it 200 at `/fonts/jetbrains-mono-700.ttf`.
- Red→green TDD: `chassis.test.ts` written first, confirmed failing (module absent), then `chassis.ts` implemented → 32/32 pass.
- Gates after implementation: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → shared 24 ✓, client 51 ✓ (19 baseline + 32 new), server 64 ✓ — no regressions.
- Headless-browser smoke (Playwright-core chromium + SwiftShader against `vite dev --port 5199`, 1920×1080, harness in /tmp, removed after) with screenshot inspection at multiple orbit angles/zooms — results in Completion Notes.

### Completion Notes List

- **Task 1 — font:** `apps/client/public/fonts/jetbrains-mono-700.ttf` (+ `OFL.txt`). Zero new npm dependencies; drei 9.122's `<Text>` (troika SDF) renders all WebGL text.
- **Task 2 — dev context:** `DEV_BOMB_CONTEXT` constant (`KTANE5`, FRK lit / CAR unlit, 2 batteries, Parallel + PS/2) in `scenes/devBombContext.ts`; `BombScene` reads `useGameStore((s) => s.bomb?.context) ?? DEV_BOMB_CONTEXT` reactively (snapshot-rate, not per-frame).
- **Task 3 — pure layout:** `scenes/chassis.ts` — `computeChassisFeatureLayout` puts serial → +x end face, indicators (−z zone) + battery tray (+z zone) → top face, ports → bottom face; centred grids keyed by (index, count) with per-group `maxPerRow` wrapping; exported footprint constants shared by renderer and tests; NaN/negative/fractional counts sanitized; tray bounds computed from cell extents (`batteryTray: null` at count 0). 32 unit tests sweep the full GDD count domains (batteries 0–12, indicators 0–11, ports 0–6) including intra-group and cross-group overlap assertions — the 4.1 review lesson applied.
- **Task 4 — chassis + sticker:** chassis body → bakelite `#C2491F`; bakelite-deep `#7A2A10` raised end ribs (inset from the ±x faces so the sticker's end face stays clean); 8 brass `#B8924A` corner screws on front/back faces from a data-driven positions array. Module faceplates flipped to graphite `#1A1A1F` (story-sanctioned contrast tweak; bays/LEDs remain 4.3). Serial sticker: cream box + `SERIAL NO.` micro-label + bold mono serial + 11 barcode bars (thin declarative boxes), −1° tilt around the face normal.
- **Task 5 — features:** `scenes/ChassisFeatures.tsx` (memoized; `BombContext` reference equality) — `SerialSticker`, `BatteryPanel` (graphite tray + brass-amber cylinder cells, count-driven), memoized `IndicatorChip` (graphite chip, lit = `#FFF4D6` + emissive `#FFE9A8` static glow / unlit = flat `#3A3A40`, mono cream label), memoized `PortPlate` (graphite plate, per-type silhouette inset — slots / PS/2 circle / RCA twin circles — plus load-bearing mono type label). No click handlers on any metadata mesh. All geometry declarative JSX → R3F auto-disposal; no `useFrame`, no animation (reduced-motion trivially satisfied).
- **Task 6 — integration:** `BombScene.tsx` is the only modified file; `CameraRig`, `BombStage`, `stage.ts`, `useIdleCursor.ts`, both stores, and `App.tsx` untouched (zero-diff for the parallel 2.2 worktree). Header comment updated to reflect 4.2 landing.
- **Task 7 — manual smoke (executed headlessly 2026-06-12, screenshots inspected):** (a) chassis reads as a lit bakelite-orange prop with brass screws and dark end ribs ✓; (b) **AC2:** from overview, a single ~90° orbit drag brings the serial sticker into view — `SERIAL NO.` label, bold `KTANE5`, barcode bars all crisp — comfortably under 10 s, no menus ✓; (c) top face shows FRK chip with bright warm-white LED vs CAR chip visibly dark, labels legible, 2 brass cells in the graphite tray ✓; (d) bottom face shows `Parallel` and `PS/2` plates with crisp mono labels and distinct insets ✓; (e) 4.1 regression: module click dollies in ✓, ESC restores the overview (visually identical; byte-diff differs only by damping sub-pixels) ✓, right-click does nothing ✓, cursor hides after 2 s idle and wakes on move ✓ (middle-click and letterbox geometry untouched since 4.1's verified pass — code paths unmodified); (f) SDF serial text stays sharp at close zoom; no z-fighting observed on sticker/chips/plates ✓; (g) zero console/page errors across all runs — only the pre-existing automatic `/favicon.ico` 404 (known, unrelated) ✓.
- **Finding (deferred, documented in deferred-work.md):** at max wheel-zoom toward a ±x end the camera clips through the chassis (`MIN_DISTANCE` 1.2 < half-width 1.5) — pre-existing 4.1 clamp characteristic newly observable now the ends carry content. Serial is fully legible well before the clamp, so AC2 holds; raising the clamp would alter the 4.1 focus-dolly pose (`FOCUS_DISTANCE` 1.6) and belongs to the bomb-view polish stories (4.7/10.2). Camera rig deliberately untouched per story scope.
- Recommend Jay does a quick interactive pass in a real browser for feel (sticker size at preferred zoom, indicator glow intensity).

### File List

- apps/client/public/fonts/jetbrains-mono-700.ttf (created — vendored JetBrains Mono Bold, OFL)
- apps/client/public/fonts/OFL.txt (created — font license)
- apps/client/src/scenes/chassis.ts (created — pure metadata-placement layout + footprint constants)
- apps/client/src/scenes/devBombContext.ts (created — fixed dev-harness BombContext)
- apps/client/src/scenes/ChassisFeatures.tsx (created — memoized diegetic metadata renderer)
- apps/client/src/scenes/BombScene.tsx (modified — bakelite chassis, end ribs, brass screws, graphite faceplates, ChassisFeatures mount, context read; CameraRig/click handling untouched)
- apps/client/src/scenes/__tests__/chassis.test.ts (created — 32 tests)
- _agent_docs/implementation-artifacts/deferred-work.md (modified — min-distance end-face clip deferral)

## Change Log

- 2026-06-12: Story 4.2 implemented — diegetic BombContext metadata on the 3D chassis: serial sticker (cream, mono KTANE5, barcode bars, −1° tilt) on the right end face, lit/unlit indicator chips + battery tray on the top face, labelled port plates on the bottom face, all data-driven via a pure tested layout (`chassis.ts`, 32 tests sweeping full count domains). Chassis material pass: bakelite body, bakelite-deep end ribs, brass corner screws, graphite module faceplates. WebGL text via drei `<Text>` + vendored JetBrains Mono ttf (no new npm deps). Typecheck/build/full-suite green; headless smoke with screenshot inspection passes all checks; one pre-existing camera-clamp clip-through documented as deferral.

## Review Findings

_Adversarial code review 2026-06-12 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). AC1 & AC2 both upheld; no acceptance violations. Findings below._

- [x] [Review][Patch] Battery tray overhangs the rear edge of the top face at batteryCount 9–12 (in realistic domain) [apps/client/src/scenes/chassis.ts] — FIXED: pulled `BATTERY_CENTER_Z` 0.26→0.2 so a two-row tray's padded box maxZ≈0.51 ≤ HALF_D 0.525 while still clearing the indicator zone. Added regression tests sweeping tray-vs-face bounds at battery 1/2/8/9/10/12. Found by Edge + Blind.
- [x] [Review][Patch] Partial last grid row is centered using the first row's column count [apps/client/src/scenes/chassis.ts `grid()`] — FIXED: `grid()` now centers each row on its own `rowCols` (`min(count − row*maxPerRow, maxPerRow)`). Added symmetry regression tests for 9 indicators / 12 batteries.
- [x] [Review][Patch] Serial sticker base back-face is coplanar with the chassis +x surface (z-fight risk) [apps/client/src/scenes/ChassisFeatures.tsx `SerialSticker`] — FIXED: group offset bumped from `SURFACE_OFFSET/2` to the full `SURFACE_OFFSET`, lifting the back face clear of x=HALF_W.
- [x] [Review][Patch] `PortInset` width map typed `Record<string, …>` not `Record<PortType, …>` [apps/client/src/scenes/ChassisFeatures.tsx `PortInset`] — FIXED: retyped `Partial<Record<PortType, [number, number]>>`; renamed/added port types now fail the type check instead of silently hitting the default.
- [x] [Review][Patch] `IndicatorChip` `label` prop typed `string` instead of `IndicatorLabel` [apps/client/src/scenes/ChassisFeatures.tsx] — FIXED: prop retyped to `IndicatorLabel` (imported from `@bomb-squad/shared`).
- [x] [Review][Defer] Battery cells/tray spill off the top face at batteryCount ≥17 [apps/client/src/scenes/chassis.ts] — deferred, beyond the documented ~12 max; no clamp exists, but the count is unreachable in the dev harness and only matters once server-side generation (Story 8.2) emits real counts. Add a clamp/guard there.
- [x] [Review][Defer] Manual-smoke claims (a)–(g), incl. the AC2 <10 s timing, are headless and unverifiable from the diff — deferred to a human interactive pass (the dev already recommends Jay confirm sticker size / indicator glow feel in a real browser). Not a code defect.
