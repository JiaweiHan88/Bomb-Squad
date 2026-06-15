---
baseline_commit: f532aeb
---

# Story 4.6: Preparation Placeholder Bomb View

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser in the Preparation phase,
I want to see the module *types* on a placeholder bomb without their values,
So that I can orient to the layout while Experts study the manual.

## Acceptance Criteria

1. **Defuser sees types, not values:** **Given** the Preparation phase, **when** the (upcoming) Defuser views the bomb, **then** module *types* are shown on a placeholder bomb but **no randomised values** (wire colours, button label/strip, password letters, symbols) are revealed.
2. **Role-gated surfaces stay separate:** **Given** the same Preparation phase, **when** an Expert or Spectator views their surface, **then** they see the full manual (the existing 5.2 role-gated split — Preparation.tsx already routes this), confirming roles never see each other's primary surface.
3. **Human verification:** Jay confirms interactively that during Preparation the upcoming Defuser sees a placeholder bomb labelled with module types (no values), while an Expert on the same team still sees the manual — recorded in Completion Notes before the story is marked done.

## Tasks / Subtasks

- [x] Task 0 — **Settle the layout source first (the one design decision)** (AC: 1)
  - [x] The committed bomb (which module type sits in which slot) is generated at **ROUND_START** today (`initializeRoundBombs` → `BOMB_INIT`, broadcast only after the timer arms — `sessionHandlers.ts:1086`). During Preparation **there is no bomb in the client store** (`gameStore.bomb === null`). So a prep "placeholder bomb" needs a *types-only* layout source. Choose and record the decision in Dev Notes before coding:
    - **Option A (recommended — lowest coupling, no server/event change): config-derived orientation board.** Render the placeholder slots from the round config the client already has in `session.config` (`moduleCount` + `modulePool ?? TIER_POOLS[difficulty]`). This shows the *candidate* module types and the slot count the Defuser will face — a true orientation aid that reveals zero randomised values, and needs **no server work, no new event, no dependency on 8.1/8.2 internals.** Caveat to note: it shows the pool, not the per-slot committed assignment (the seeded slot order is only fixed at generation). For Easy (pool currently `['wires']`, soon `['wires','the-button','passwords']`) this is a faithful "here are the module types on your bomb."
    - **Option B (faithful committed layout — defer unless Jay wants it): server prep-layout broadcast.** The layout (module *types* per slot) derives from the shared `templateSeed` (identical across teams, independent of the per-team value `teamSeed` — Story 8.2), so the server *could* compute and broadcast a types-only descriptor at `openPreparation` without leaking any value. This is the architecturally exact answer but adds a server emit + a typed event + a store field — server surface that overlaps Epic 8 territory and is heavier than this client story warrants. **Recommend deferring; if chosen, scope it explicitly and keep the value-stripping projection (the 5.3 anti-cheat note) in mind.**
  - [x] Default to **Option A** unless Jay directs otherwise in Task 0 review. The rest of these tasks assume A; if B is chosen, add the server/event subtasks and cite 8.2's generator.
- [x] Task 1 — Mount the placeholder bomb at the existing Preparation seam (AC: 1)
  - [x] `apps/client/src/ui/Preparation.tsx` already marks the exact insertion point in the `isUpcomingDefuser` branch: `{/* Story 4.6 seam: the preparation placeholder bomb (module types, no values) mounts here in place of this line. */}`. Replace the `PREP_DEFUSER_PLACEHOLDER` text line with the placeholder bomb view. Keep the role gating intact — only the upcoming Defuser branch changes; facilitator and expert/spectator branches are untouched (AC2).
  - [x] Reuse the existing 3D stage shell: wrap in `BombStage` (as `ActiveRound` does for the live bomb) so framing/camera match the real bomb. Do not build a second stage.
- [x] Task 2 — Type-only / value-free rendering (AC: 1)
  - [x] The scene must show module **type labels** without values. Two clean levers already exist:
    - `ModuleBay` renders the bay frame, the `MOD-NN` tag, and the solve LED, then delegates the face to `getModuleRenderer(moduleId).DefuserView`. For prep, the bay tag should show the **module type** (e.g. `WIRES`, `THE BUTTON`) and the face must be **value-free**.
    - `PLACEHOLDER_RENDERER` (`apps/client/src/modules/PlaceholderModule.tsx`) renders an empty face (`return null`) for any module. **The cleanest value-free render is to force the placeholder renderer for every slot in prep** — i.e. render bays with type tags + empty faces, never the real `wires`/`the-button` DefuserView (which would draw values). Prefer a `prepMode`/`typesOnly` prop threaded into the scene/`ModuleBay` over duplicating the scene, so there is one bay component.
  - [x] Decide where the type label renders: extend the bay tag to show the module type in prep (smallest change), or add a centered type label on the empty face. Keep it data-driven from the slot's `moduleId` — never hardcode counts/positions in JSX (the 4.1–4.3 house rule). Pair any colour with a label (colorblind floor) — but prep is types-only so this is mostly moot.
  - [x] Source the slot list per Task 0 Option A: build `ModuleSlot[]` from `config.moduleCount` + the resolved pool via the existing `computeModuleLayout` (`apps/client/src/scenes/layout.ts`) so positions match the real bomb. If the pool has fewer types than `moduleCount`, repeat/cycle types across slots (orientation board, not a committed assignment) and note it.
- [x] Task 3 — Reconcile with `BombScene` without forking it (AC: 1)
  - [x] `BombScene` already computes a layout and renders `ModuleBay` per slot, tolerating `bomb === null` by falling back to `DEV_PLACEHOLDER_MODULES`. Prefer **parameterising `BombScene` (or `ModuleBay`) with a `typesOnly`/prep flag + an explicit slot source** over a parallel scene component, so the live bomb and the prep bomb share one renderer and can't drift. If a thin dedicated `PrepBombScene` is genuinely cleaner, keep it to composition of the existing `ModuleBay`/`ChassisFeatures`/camera — zero copied geometry.
  - [x] No timer LCD, no strike indicator, no interaction in prep (those are active-round chrome). Clicks/press-hold must be inert in prep mode (the placeholder face has no handlers — verify a click does nothing).
- [ ] Task 4 — Copy + tests (AC: 1, 2)
  - [x] Update `apps/client/src/ui/copy.ts` if the defuser prep line/heading changes (the current `PREP_DEFUSER_PLACEHOLDER` text is replaced by the bomb; keep a short heading like "Study your bomb" if useful — follow the existing copy-constant pattern).
  - [x] Client tests (vitest): the upcoming-Defuser prep branch renders the placeholder bomb (type tags present, no value-bearing module faces); the facilitator and expert/spectator branches are unchanged (assert ManualViewer still renders for expert — AC2 regression guard); a non-defuser/non-expert sees no bomb. If you add a `typesOnly` flag to the scene, unit-test that it selects `PLACEHOLDER_RENDERER` regardless of registered renderers. Pure-render assertions only — R3F components are dumb renderers; if a component needs a logic test, the logic has leaked.
  - [x] Gates: record the merged baseline first (`pnpm -r test`), then `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm -r test` green, no regressions; `pnpm --filter @bomb-squad/client build` green.
  - [ ] Headless smoke (reuse the `/tmp/pw-smoke` playwright-core + SwiftShader rig against `vite dev`; record honestly): enter Preparation as the upcoming Defuser → placeholder bomb with type tags renders, no values; as an Expert → manual renders; a click on a prep module face does nothing.
- [x] Task 5 — Human verification (AC: 3)
  - [x] **Jay verifies interactively:** in a real session (or the closest dev harness), reach Preparation; confirm the upcoming Defuser sees a placeholder bomb labelled with module types and **no** wire colours / button label / letters / symbols, while an Expert on the same team sees the manual. Record his observed results in Completion Notes — story is not done without this. (Coordinate the live full-stack check with 8.6's between-round verification if both are testing the same session — see worktree note.)

## Dev Notes

### Scope decisions (read first)

- **This is a client presentation story.** AC2 (Expert/Spectator see the manual) **already works** — `Preparation.tsx` routes experts/spectators to `ManualViewer` today. The real deliverable is replacing the upcoming-Defuser's text placeholder line with a value-free placeholder bomb at the seam Preparation.tsx already marks.
- **Layout source is the only design decision — settle it in Task 0.** Default to the config-derived orientation board (Option A): zero server/event work, no dependency on 8.1 (round config) or the internals of 8.2 (generation). This keeps 4.6 decoupled inside worktree B and out of 8.1's `TIER_POOLS`/config territory. Option B (faithful committed layout via a server prep broadcast) is the architecturally exact version but is heavier and overlaps Epic 8 — defer unless Jay asks.
- **No values, ever.** The entire point is information asymmetry during prep: the Defuser orients to *what* modules exist, the Expert studies *how* to solve them. Forcing `PLACEHOLDER_RENDERER` for every slot is the simplest guarantee that no generated value can leak onto the prep bomb.
- **Out of scope:** the live bomb / snapshot sync (4.7), the timer + strikes (4.4/4.5), interaction (5.x modules), round config (8.1), between-round flow (8.6 — sibling in this worktree), voice.

### Reuse, do not rebuild — the scene already exists

- `apps/client/src/scenes/BombScene.tsx` — computes `computeModuleLayout`, renders `ModuleBay` per slot, tolerates `bomb === null` (falls back to `DEV_PLACEHOLDER_MODULES`). Parameterise it (or `ModuleBay`) with a `typesOnly` flag + slot source rather than forking.
- `apps/client/src/scenes/ModuleBay.tsx` — owns the bay frame, the `MOD-NN` tag (drei `Text`, `formatBayTag` in `layout.ts`), the solve LED, and delegates the face to `getModuleRenderer(moduleId).DefuserView`. The prep type-tag + value-free face live here.
- `apps/client/src/scenes/layout.ts` — `computeModuleLayout`, `ModuleSlot`, `formatBayTag`, `CHASSIS_SIZE`. Slot positions for the prep bomb come from here so they match the real bomb.
- `apps/client/src/modules/PlaceholderModule.tsx` — `PLACEHOLDER_RENDERER` (empty face). The value-free renderer for every prep slot.
- `apps/client/src/scenes/BombStage.tsx` — the 16:9 stage shell `ActiveRound` wraps the live bomb in; wrap the prep bomb the same way.
- `apps/client/src/ui/Preparation.tsx` — the host. The `isUpcomingDefuser` branch carries the literal `Story 4.6 seam` comment; the file already resolves `self`/`isUpcomingDefuser` from the durable `playerId` (2.7) and routes experts/spectators to `ManualViewer`. **Touch only the upcoming-Defuser branch.**
- `apps/client/src/ui/ActiveRound.tsx` — the precedent for mounting `BombStage > BombScene` for the Defuser role; mirror its structure for prep.

### Where the type list comes from (Option A specifics)

- `session.config` is already in `gameStore` (`SessionState.config: RoundConfig`). Resolve the pool exactly as generation does: `config.modulePool ?? TIER_POOLS[config.difficulty]` (`packages/shared/src/modules/registry.ts`). `config.moduleCount` (3–11) gives the slot count.
- Today every tier pool is `['wires']`; once 5.4/5.5 land (sibling modules worktree) and 8.1 expands the pools, the prep board automatically shows the richer Easy set. No code change here when that happens — it reads the pool live. (This is why 4.6 stays decoupled from the modules worktree and from 8.1.)

### Worktree & environment

This story runs in worktree `Ktane-s4-round-framing` (branch `worktree-s4-round-framing`), bundled with **8.6 Between-round flow**. The two share `apps/client/src/App.tsx` phase routing and the `Preparation`/post-round surfaces — that shared `App.tsx`/UI surface is exactly why they're bundled (one routing reconcile instead of a cross-worktree merge conflict). 4.6 touches the `preparation` branch of routing; 8.6 touches `between-rounds`. Worktrees start without `node_modules` — run `pnpm install` first; `.env` is provisioned. 4.6 itself is client-only (vite dev; no docker/secrets), but 8.6 in this worktree is full-stack — when verifying full-stack, use a worktree-scoped compose project name and always `--build` (memory: worktree-fullstack-testing-gap), and provision `.env` (already copied in).

### Previous story intelligence (4.1–4.5, 8.3 — all done)

- **R3F house rules (4.1–4.3):** data-driven geometry (positions/counts from arrays, never JSX repetition), rendering-only components, `useFrame`+`getState()` for per-frame work, reused refs, no per-frame allocations, dispose on unmount. The prep bomb is static (no countdown), so it should need no per-frame work at all.
- **Role-gating discipline (8.3):** `Preparation.tsx` resolves "which player am I" via the durable `playerId` from the reactive store, never `socket.id` (2.7). Keep that — don't reintroduce socket.id.
- **5.3 anti-cheat note:** generated solution/value data must never reach a client that shouldn't see it. Prep is the strongest case — show types only. Forcing the placeholder renderer sidesteps the whole class of leak.
- **Honest smoke notes:** record each smoke item individually (a prior unexecuted-smoke claim was caught in review).

### Project Structure Notes

- Modified: `apps/client/src/ui/Preparation.tsx` (upcoming-Defuser branch → placeholder bomb at the marked seam), `apps/client/src/ui/copy.ts` (prep defuser copy, if changed). Likely modified: `apps/client/src/scenes/BombScene.tsx` and/or `apps/client/src/scenes/ModuleBay.tsx` (add `typesOnly`/prep flag + slot source) — keep surgical and shared with the live bomb.
- Possibly new: a thin `apps/client/src/ui/PrepBombView.tsx` (or `scenes/PrepBombScene.tsx`) composing the existing stage/scene — only if it's genuinely cleaner than a flag; do not copy geometry.
- New tests: `apps/client/src/ui/__tests__/Preparation.test.tsx` additions (or a new test file) for the three role branches + the value-free guarantee.
- Untouched: server (Option A needs none), shared `events/`, `gameStore`/`uiStore` shape, the live `BombScene` behaviour when `typesOnly` is false, `interaction.ts`, Docker. If you pick Option B, this list grows — re-scope in Task 0.

### Project Context Rules (from `_agent_docs/project-context.md` — binding)

- R3F components are dumb renderers — rendering only; "if a component requires a logic test, the logic has leaked." Data-driven geometry; no per-frame allocations.
- Never reveal randomised values to a role that shouldn't see them (information asymmetry is the core mechanic).
- Resolve player identity by durable `playerId`, never `socket.id`.
- Build: `tsc --noEmit` 0 errors, no `@ts-ignore`, TypeScript only, no new dependencies (stack pinned at three 0.184 / fiber 8.18 / drei 9.122 / React 18.3 — never upgrade).
- Testing: vitest for client; assert render output, not internal logic.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.6 (~L769–783) + Epic 4 preamble] (ACs verbatim; role-gated content split; FR-coverage)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#IA item 3 (Preparation)] (prep is orientation; roles never see each other's surface)
- [Source: apps/client/src/ui/Preparation.tsx] (the host; the literal `Story 4.6 seam` comment in the upcoming-Defuser branch; durable-id role gating; expert/spectator → ManualViewer already wired)
- [Source: apps/client/src/scenes/{BombScene,ModuleBay,layout,BombStage}.tsx + scenes/layout.ts] (the reusable stage/scene/bay + `computeModuleLayout`/`formatBayTag`; `bomb === null` tolerance)
- [Source: apps/client/src/modules/PlaceholderModule.tsx] (`PLACEHOLDER_RENDERER` — the value-free face)
- [Source: apps/client/src/ui/ActiveRound.tsx] (precedent for mounting `BombStage > BombScene` for the Defuser role)
- [Source: packages/shared/src/types/session.ts + packages/shared/src/modules/registry.ts] (`RoundConfig` `moduleCount`/`modulePool`/`difficulty`; `TIER_POOLS` resolution for Option A)
- [Source: apps/server/src/round/initializeRoundBombs.ts + apps/server/src/handlers/sessionHandlers.ts:1086] (bombs generate at ROUND_START and BOMB_INIT broadcasts only after timer arms — why there is no prep bomb in the store, the basis for Task 0)
- [Source: _agent_docs/implementation-artifacts/5-3-wires-module-walking-skeleton.md#Review Findings] (anti-cheat: never transmit values a role shouldn't see)
- [Source: _agent_docs/implementation-artifacts/Sprint 4 — Easy modules + round framing parallelization analysis.md] (worktree B bundling with 8.6; shared App.tsx routing; decoupling from 8.1/modules)
- [Source: _agent_docs/project-context.md] (full binding rule set)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`).
- `pnpm -r test` → client 282 passed (34 files), server 375 passed (26 suites), shared green. No regressions.
- `pnpm --filter @bomb-squad/client build` → green (pre-existing >500 kB single-chunk warning only; not introduced here).
- Headless smoke (Task 4 last subtask): **not run** — the referenced `/tmp/pw-smoke` playwright-core + SwiftShader rig is not present in this worktree, and there is no lightweight harness to reach Preparation-as-upcoming-Defuser without the full server session flow. Not fabricated. The value-free render and role-gating are covered by the automated tests below; the live visual confirmation is Task 5 (Jay).

### Completion Notes List

- **Task 0 decision — Option A (config-derived orientation board).** Chosen as the story recommends: zero server/event work, no dependency on 8.1/8.2 internals, fully decoupled inside this worktree. The prep bomb's slot source is `session.config` (`moduleCount` + `modulePool ?? TIER_POOLS[difficulty]`), cycled across slots. Trade-off noted in code: this shows the candidate *pool* per slot, not the seeded committed per-slot assignment (only fixed at generation) — a faithful "here are the module types on your bomb," never a value. Option B (server prep-layout broadcast) deferred; not needed for AC1/AC2. Jay can redirect to B if he wants the exact committed layout.
- **Value-free guarantee (AC1).** Every prep slot is forced to `PLACEHOLDER_RENDERER` via `selectModuleRenderer(moduleId, typesOnly=true)` regardless of what is registered — no `wires`/`the-button` DefuserView ever draws, so no wire colour / button label / password letter / symbol can leak. Active-round chrome (timer LCD, strike LEDs, and the diegetic BombContext metadata — serial/batteries/indicators/ports are themselves randomised values) is hidden in `typesOnly`. The bay tag carries the module *type* (`formatModuleType`, e.g. `WIRES`, `THE BUTTON`) centered on the empty face.
- **One renderer, no fork (Task 3).** Parameterised the existing `BombScene` + `ModuleBay` with a `typesOnly` flag + explicit `modules` source rather than copying geometry; the live bomb and prep bomb share one renderer and can't drift. New thin `PrepBombView` only *composes* `BombStage > BombScene` (mirrors `ActiveRound`).
- **Inert in prep (Task 3).** Module faceplate `onClick` is `undefined` in `typesOnly` (no click-to-focus), and the per-frame LED flash driver + its store subscription early-out — the prep bomb is static (no per-frame work, project rule). Orbit/zoom still orient the camera.
- **Role gating preserved (AC2).** Only the upcoming-Defuser branch of `Preparation.tsx` changed (now returns `<PrepBombView />`). Facilitator panel and Expert/Spectator → `ManualViewer` branches untouched; a regression test asserts the Expert still gets the manual and no bomb.
- **Copy.** Retired the now-unused `PREP_DEFUSER_LINE` / `PREP_DEFUSER_PLACEHOLDER` constants (the text placeholder the bomb replaces).
- **Tests added:** `scenes/__tests__/prepLayout.test.ts` (slot derivation: count, pool cycling, override precedence, empty-pool degrade, zero-count); `formatModuleType` cases in `layout.test.ts`; `selectModuleRenderer` value-free cases in `modules/__tests__/registry.test.ts`; `Preparation.test.tsx` role-branch tests (Defuser→bomb, Expert→manual+no bomb, Spectator→manual+no bomb, Facilitator→no bomb). R3F components are not mounted in jsdom (pure-render/logic assertions only, per house rule) — `PrepBombView` is stubbed in the Preparation test.
- **Prep solve-LED leak — found in interactive verification, fixed.** Jay's first look caught a green light on bay 1. Root cause: `ModuleBay`'s solve LED reads `statusAt(s.bomb?.modules, index)`, which in prep (no committed bomb) falls back to `DEV_PLACEHOLDER_MODULES` — whose module 0 is `solved`, lighting the LED green. The solve LED is live-round state chrome (like the timer/strikes already hidden in `typesOnly`), so it is now hidden in prep entirely — a lit LED would imply a non-existent solve. Re-verified clean.
- **Task 5 (AC3) — DONE. Jay verified interactively (2026-06-16).** In the worktree-scoped full stack (project `ktane-s4r46`, http://localhost), during Preparation the upcoming Defuser saw the placeholder bomb labelled with module **types** (`WIRES`) on empty value-free faces — no wire colours / button label / letters / symbols, no timer/strikes, and (after the LED fix) no solve LED — while an Expert on the same team saw the manual. Jay: "confirmed". Headless smoke (Task 4) was not run (rig absent, see Debug Log); this live interactive verification supersedes it.

### File List

- Modified: `apps/client/src/ui/Preparation.tsx` (upcoming-Defuser branch → `<PrepBombView />`; dropped retired copy imports)
- Modified: `apps/client/src/ui/copy.ts` (retired `PREP_DEFUSER_LINE` / `PREP_DEFUSER_PLACEHOLDER`)
- Modified: `apps/client/src/scenes/BombScene.tsx` (`typesOnly` + `modules` override props; hide active-round chrome in prep)
- Modified: `apps/client/src/scenes/ModuleBay.tsx` (`typesOnly` prop: type tag, forced placeholder face, inert clicks, no per-frame work)
- Modified: `apps/client/src/scenes/layout.ts` (`formatModuleType`)
- Modified: `apps/client/src/modules/registry.ts` (`selectModuleRenderer`)
- New: `apps/client/src/scenes/prepLayout.ts` (`buildPrepModules` — Option A slot source)
- New: `apps/client/src/ui/PrepBombView.tsx` (composes `BombStage > BombScene` in `typesOnly` mode)
- New: `apps/client/src/scenes/__tests__/prepLayout.test.ts`
- Modified (tests): `apps/client/src/scenes/__tests__/layout.test.ts`, `apps/client/src/modules/__tests__/registry.test.ts`, `apps/client/src/ui/__tests__/Preparation.test.tsx`
- Modified (tracking): `_agent_docs/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-06-15: Story created (context engine analysis — comprehensive developer guide). Status: ready-for-dev.
- 2026-06-16: Implemented Option A prep placeholder bomb (value-free types-only `BombScene`/`ModuleBay`, `PrepBombView`, `buildPrepModules`, `selectModuleRenderer`, `formatModuleType`). Tests added; tsc/test/build gates green. Status → review.
- 2026-06-16: Interactive verification (Jay) caught a leaked solve LED on bay 1 (dev-placeholder `solved` fallback); hid the solve LED in `typesOnly` prep. Re-verified clean. Task 5 / AC3 confirmed.
