---
baseline_commit: 412696044d0efc2bf3e4c9c878b95c937193826a
---

# Story 5.1: Module Plugin Scaffold, Sandbox & Click Primitive

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the per-module file contract, client renderer registry, dev sandbox, and the Defuser click primitive,
So that modules can be built and tested in isolation and added additively.

## Acceptance Criteria

1. **Given** a new module directory
   **When** it is created
   **Then** it follows the contract: `generate.ts` (pure, seeded), `solve.ts` (pure), `reducer.ts` (pure), `DefuserView.tsx` (R3F rendering only), `ManualPages.tsx` (structured data), `types.ts` (re-exported from shared), `__tests__/`.

2. **Given** the module registry
   **When** a module registers its renderer and `MODULE_REDUCERS` entry
   **Then** it appears on the bomb with no change to `bombReducer.ts`.

3. **Given** `/dev/sandbox`
   **When** a developer opens it
   **Then** a single module can be generated from a seed and exercised in isolation.

4. **Given** a Defuser interaction
   **When** it occurs
   **Then** it is driven solely by mouse click (wire cut = click; button press = mousedown+up; hold = sustained); there are no bomb-side keyboard shortcuts.

## Tasks / Subtasks

- [x] Task 1 — Per-module pure-logic home in shared + dev demo module (AC: 1)
  - [x] Create `packages/shared/src/modules/dev-demo/` with `types.ts` (`DevDemoState`, `DevDemoAction` — PascalCaseState/PascalCaseAction), `generate.ts` (pure; all randomness via `makeSeededRng(seed)` from `packages/shared/src/seeding/`), `solve.ts` (pure validation), `reducer.ts` (pure `Reducer<ModuleState<DevDemoState>, DevDemoAction>`), `manual.ts` (returns `ManualPage[]` structured data). Barrel-export from `packages/shared/src/modules/index.ts`; wire into `packages/shared/src/index.ts`.
  - [x] The demo module's mechanic must exercise all three click gestures (AC4): a cut target (single click), a press target (mousedown+mouseup pair), and a hold target (mousedown → sustained → mouseup). Keep the rules trivial — e.g., seed picks which target index is "correct"; wrong target → `status: 'struck'` (transient, per the 1.6 roll-up contract); correct sequence → `'solved'`. Hold duration must be expressed as discrete PRESS/RELEASE actions reduced statefully — never `Date.now()` inside the reducer.
  - [x] Reducer contract obligations (will be reviewed against project-context Testing Rules): unknown action → state unchanged (no throw); guard out-of-bounds input; idempotent repeat of a completed action; recognise `{ type: 'MODULE_RESET' }` (the bomb reducer forwards the full action — see `packages/shared/src/types/actions.ts`) by restoring initial state.
- [x] Task 2 — Client module directory contract (AC: 1, 2)
  - [x] Create `apps/client/src/modules/dev-demo/` with: `index.ts` (the `IModule` binding object + renderer registration — see Dev Notes "Registration timing"), `DefuserView.tsx` (R3F, rendering only, consumes `ModuleDefuserViewProps.moduleIndex`, reads its `ModuleState` slice from `useGameStore`), `ManualPages.tsx` (renders the structured `ManualPage[]` minimally — the real paper-styled viewer is Story 5.2; a plain typed list is fine), `types.ts` (pure re-export from `@bomb-squad/shared`), `generate.ts`/`solve.ts`/`reducer.ts` (pure re-exports from shared — the architecture sanctions "or re-export from shared"), `__tests__/`.
  - [x] `DefuserView` geometry/visual state must derive entirely from the module's `data` (generate output + reducer state) — zero hardcoded layout-from-JSX, zero game logic in the component.
- [x] Task 3 — Server registration seam + reducer-output guard (AC: 2)
  - [x] Prove open/closed with a unit test in `apps/server/src/reducers/__tests__/`: build a registry containing the dev-demo reducer (imported from shared), pass it to the existing `createBombReducer(registry)`, and show a `MODULE_ACTION` solves/strikes a `dev-demo` module — **zero diff to `bombReducer.ts`'s dispatch logic**. Decide and document whether `dev-demo` enters the production `MODULE_REDUCERS` map (recommendation: yes, registering it is one line and harmless — no production bomb generation emits `dev-demo` until Story 8.2; alternatively keep it test/sandbox-only and say so).
  - [x] Close the 1.6-deferred item (deferred-work.md, cited to "when the Epic 5 module plugin contract is built"): in `applyModuleResult` (bombReducer.ts), defensively validate the module reducer's output — `moduleId` unchanged and `status ∈ {armed, solved, struck}`; on violation return state unchanged (no throw). Add tests. This edits `bombReducer.ts` once, for all modules — it does not violate open/closed (no per-module logic).
- [x] Task 4 — Defuser click primitive helpers (AC: 4)
  - [x] Create `apps/client/src/modules/interaction.ts` (pure helpers + thin hook): left-button-only (`event.button !== 0` → ignore; right/middle reserved per UX-DR13), drag-tolerance guard (`event.delta > 4` px = orbit, not click — reuse/lift the existing `CLICK_DRAG_TOLERANCE_PX` convention from `ModuleBay.tsx` rather than re-deriving), `stopPropagation()` so module-internal clicks don't re-trigger ModuleBay's click-to-focus.
  - [x] Expose three gesture surfaces for DefuserViews: `click` (onClick), `press` (onPointerDown/onPointerUp pair), `hold` (down → up with both events dispatched as actions). Gestures produce module **actions** handed to a dispatch callback — the helper knows nothing about sockets or reducers.
  - [x] No keyboard listeners anywhere in module/interaction code (AC4: "no bomb-side keyboard shortcuts"). The existing DEV-guarded harness keyboard (DevBombHarness) is the only sanctioned exception and stays as-is.
  - [x] Keep the testable logic (button/delta/gesture classification) as pure functions with vitest tests; the hook/JSX glue stays logic-free.
- [x] Task 5 — Local dispatch seam (AC: 3)
  - [x] Create a dev-only local dispatcher (e.g., `apps/client/src/modules/devDispatch.ts` or inside the sandbox dir): `(moduleIndex, action) → run the module's reducer from the IModule binding → useGameStore.getState().applyModuleUpdate(...)`, reproducing the server's transient-`'struck'` roll-up (emit struck state, then armed state back-to-back — exactly what DevBombHarness's Shift+digit does) so the LED flash path is exercised. Strikes roll up locally for display the same way `bombReducer.applyModuleResult` does.
  - [x] This is explicitly NOT the production path. Production dispatch is `MODULE_INTERACT` → server handler → bombReducer → `MODULE_UPDATE`, and the server handler does not exist yet (Epic 8 / Story 5.3 scope). Do not add a socket emit in this story; document the seam so 5.3 can swap the dispatcher.
- [x] Task 6 — `/dev/sandbox` route + harness (AC: 3)
  - [x] Add a `/dev/sandbox` branch in `App.tsx` following the existing `/dev/bomb` pattern exactly (path check + `import.meta.env.DEV || connected` guard; one-line-ish diff). The known `vite preview` SPA-fallback 404 gap applies and stays deferred (deferred-work.md).
  - [x] `SandboxHarness` (suggest `apps/client/src/sandbox/` or `apps/client/src/scenes/SandboxHarness.tsx` — pick one, document the choice): seed input (integer), module picker (from registered renderers / IModule bindings), Generate button → `generate(seed, DEV_BOMB_CONTEXT)` → seed `gameStore` with a one-module `BombState` via `setBomb` (the production read path, same philosophy as DevBombHarness), mount the DefuserView inside `BombStage` (reuse it — don't build a second stage), show a state inspector (module `status` + `data` JSON) and a Reset control dispatching `MODULE_RESET`.
  - [x] Same seed → identical module instance (determinism is visible and demonstrable from the UI); different seed → different instance.
- [x] Task 7 — Tests + gates (AC: all)
  - [x] Shared (jest): dev-demo `generate` determinism (same seed twice → deep-equal; two seeds → differs; no `Math.random` — assert via seeded-RNG-only code review + determinism test), `solve`, and the full reducer suite: happy path, wrong interaction (→ transient `'struck'`), idempotency, **immutability (frozen state input — never skip)**, guard clauses, `MODULE_RESET`.
  - [x] Server (jest): registry-injection open/closed test + reducer-output-guard tests (Task 3).
  - [x] Client (vitest): interaction-helper pure-fn tests; registry registration test for the new module id; dev-dispatch roll-up test if extracted as pure logic.
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm -r test` → no regressions (baseline: shared 24, client 76, server 64 as of 4.3); `pnpm --filter @bomb-squad/client build` green.
  - [x] Manual smoke on `/dev/sandbox` (record results honestly, item by item): (a) generate from seed, (b) same seed reproduces, (c) click/press/hold gestures work and wrong target pulses the strike path, (d) solve flips status to solved, (e) reset restores, (f) no keyboard affects the module, (g) drag-orbit near a target does not trigger an interaction.

## Review Findings

_Code review 2026-06-12 (Blind Hunter · Edge Case Hunter · Acceptance Auditor, all Opus). Auditor re-ran gates: tsc 0 errors, shared 53 / client 121 / server 155 green; all 4 ACs PASS; cut-then-press deviation judged sound; 1.6 output guard genuinely closed. 1 patch, 0 decisions, 0 defers, 14 dismissed as noise._

- [x] [Review][Patch] Press/hold handlers: stopPropagation runs after the button guard (reserved-button events leak to ModuleBay) and there is no onPointerCancel (a cancelled hold never releases pointer capture or fires the release action → stuck `held: true` until reset) — this is the template every later module copies [apps/client/src/modules/interaction.ts:79-97] — FIXED: stopPropagation hoisted above the button guard in both handlers; `onPointerCancel` added (mirrors release path, spread into DefuserView via `{...pressHold}`). tsc 0 errors, client 121 tests green.

### Dismissed as noise (recorded for traceability)

- Blind: stuck-held on a non-primary `pointerup` — not reachable in standard pointer semantics (the real left-up always reports `button === 0`); the genuine stuck path is `pointercancel`, folded into the patch above.
- Blind: idempotent `CUT` no-op gives no feedback after a wrong cut on a press-solution — intended (severed wire is permanent until reset; repeat-cut is deliberately idempotent, not a strike).
- Blind/Edge: dev-dispatch `bomb.solved`/strike roll-up is a separate hand-mirror of `applyModuleResult` that could drift; the multi-module solved-lag is not reachable (sandbox is single-module at index 0). Dev-only path.
- Blind: `Math.min(strikes+1, 3) as StrikeCount` magic `3` — clamp is correct; cosmetic.
- Blind: `generate.ts` assumes `serialNumber` ends in a digit — cosmetic only (label digit unused by `solution`); `BombContext` invariant holds.
- Blind/Edge: `solutionForLabel` `<= 'I'` string compare assumes uppercase A–Z — defensive-only; `generate` always emits A–Z.
- Blind: DefuserView selector factory allocates a fresh closure per render — harmless under zustand value-equality.
- Edge: release-without-press / double-release — guarded and tested in the reducer (idempotent fall-through).
- Edge: non-integer/NaN `moduleIndex`, double dispatch-backend install, reset-before-generate, store-cleared-mid-loop — all guarded (`if (!mod) return`, overwrite warn, warn-and-drop) or only theoretical in a dev tool.
- Edge: sandbox picker doesn't regenerate on select (stale inspector until Generate) — the Generate button is the intended explicit commit action; UX choice, not a defect.
- Auditor advisory: `MODULE_RESET` returns a fresh object even when already armed (not referentially idempotent) — no contract requires it; harmless.

## Dev Notes

### What this story is — and is not

Epic 4 built the bomb shell and the client renderer-registry seam; Story 1.6 built the server reducer seam. This story **proves both seams end-to-end** with a complete reference module and gives module authors their workbench: the canonical file contract, the `/dev/sandbox`, and the click-gesture vocabulary every later module (5.3 Wires, 5.4 Button, 5.5 Passwords, Epics 6–7) will copy. Wires (5.3) is the walking skeleton (AR5) — this story exists so 5.3 can be *only* about Wires rules, not plumbing.

**Out of scope (do not build):** the real manual viewer with paper styling/navigation (5.2 — `ManualPages.tsx` here is a minimal typed renderer of structured data), any real module rules (5.3–5.5), the server `MODULE_INTERACT` socket handler and production dispatch (Epic 8 / 5.3), optimistic pre-flash + rollback (4.7), bomb generation from seed chain (8.2), timer integration (4.4/8.4), solve chime/SFX (10.1), `custom/` community-module dir (V2 — don't scaffold empty dirs).

### The architecture decision this story must get right: where pure module logic lives

The server's `MODULE_REDUCERS` needs each module's reducer **at runtime**; the client sandbox needs `generate` + the reducer **at runtime**; `apps/server` must never import from `apps/client` or vice versa. Therefore pure module logic lives in **`packages/shared/src/modules/<id>/`** — the only package both sides can reach. This is sanctioned: architecture's per-module contract says client `generate.ts` may "re-export from shared", and project-context says "All module types defined in `packages/shared/src/modules/` and re-exported from `apps/client` — never duplicated".

Runtime feasibility is **verified, not assumed**: the server executes TypeScript source via `tsx` in dev (`tsx watch src/index.ts`) and in Docker (`CMD ... tsx apps/server/src/index.ts` — the Dockerfile comment explicitly says workspace imports of shared's `.ts` exports resolve without a shared compile step), and the client bundles shared source via Vite. The 1.3-deferred "shared exports `.ts` source breaks a tsc-compiled server" item only bites a `dist/`-executed server, which nothing does; it stays deferred — do not resolve it here.

Constraints that follow:
- `packages/shared` has **zero runtime deps** — no `react`, no `socket.io` imports in any shared module file. `ManualPage[]` data is pure (it already lives in shared types); the *React rendering* of it stays in the client dir.
- Shared files use `.js` extensions on relative imports (NodeNext convention, established 1.2) — e.g. `import { makeSeededRng } from '../../seeding/index.js'`.
- The AC's module-directory contract is satisfied by the client dir `apps/client/src/modules/<id>/` containing all seven entries, with `generate.ts`/`solve.ts`/`reducer.ts`/`types.ts` as re-exports from shared. Document this split in a comment in the demo module's `index.ts` — it is the template every later module copies.

### Existing code you are building on — read before editing (all reviewed & done)

- `apps/client/src/modules/registry.ts` — **exists; do not recreate.** `ModuleRenderer { id, DefuserView }`, `registerModuleRenderer` (throws on duplicate id), `getModuleRenderer` (unknown → `PLACEHOLDER_RENDERER`, never undefined). `ModuleDefuserViewProps` carries `moduleIndex` (slot identity into `BombState.modules` — MODULE_UPDATE payloads are indexed, not id'd). 4.3's Dev Notes flagged this file as 5.1's direct foundation: keep the API as-is; extend only if the sandbox needs enumeration (e.g., a `listModuleRenderers()` — additive, tested).
- `apps/server/src/reducers/MODULE_REDUCERS.ts` — exists, empty `Record<string, ModuleReducer>`; registration = one added entry. `ModuleReducer = Reducer<ModuleState<unknown>, unknown>` — per-module typing is erased at the registry boundary; your shared reducer is fully typed and cast once at registration.
- `apps/server/src/reducers/bombReducer.ts` — `createBombReducer(registry)` factory + `applyModuleResult` (transient-`'struck'` roll-up → team strike, solved-inert guard, all-solved → `bomb.solved`). The factory is your open/closed test hook. Task 3's output guard goes in `applyModuleResult`.
- `packages/shared/src/types/module.ts` — `IModule<S, A>` (id, generate, reduce, getManualPages, optional onTick for V2 needy — implement `getManualPages` on the demo binding; skip `onTick`), `ModuleState<S>` envelope, `ManualPage/ManualSection/ManualTable`. **No changes to these types are expected**; if you believe one is needed, justify it in Completion Notes.
- `packages/shared/src/types/actions.ts` — `BombAction`: `MODULE_ACTION { moduleIndex, payload }` and `MODULE_RESET { moduleIndex }`; reset is forwarded whole to the module reducer (discriminate on `action.type`).
- `packages/shared/src/seeding/` — `makeSeededRng(seed)` (mulberry32) is "the ONLY approved way to introduce randomness in module generate(seed, ctx) functions". Seed must be a non-negative integer (asserted). `deriveModuleSeed` exists but bomb-level seed-chain orchestration is 8.2 — the sandbox feeds a raw integer seed directly.
- `apps/client/src/scenes/ModuleBay.tsx` — owns the bay frame, MOD-NN tag, solve LED, and the **click-to-focus** handler on the faceplate (`button===0`, `delta>4`, `stopPropagation`, `setActiveModuleIndex`). Your DefuserView mounts inside it at `getModuleRenderer(moduleId)` — module-internal interactions must `stopPropagation()` or every wire cut will also dolly the camera.
- `apps/client/src/scenes/DevBombHarness.tsx` + `devBombState.ts` + `devBombContext.ts` — the `/dev/bomb` precedent: seeds the **real** gameStore via `setBomb`/`applyModuleUpdate` so the scene under test is byte-identical to production. The sandbox follows the same philosophy. `DEV_BOMB_CONTEXT` is your `BombContext` for sandbox generation. Optional, nice: switch one `DEV_BOMB_STATE` module to `dev-demo` so `/dev/bomb` shows a live module — only if the diff stays trivial.
- `apps/client/src/scenes/dom.ts` — `prefersReducedMotion`, `isTextEntryTarget` helpers (lifted in 4.3 for reuse — reuse, don't duplicate).
- `apps/client/src/store/gameStore.ts` — `setBomb`, `applyModuleUpdate` (immutable single-module replace, bounds-checked). Per-frame reads via `getState()`; snapshot-rate reads via scoped reactive selectors (ModuleBay's `statusAt` selector is the pattern for your DefuserView's data selector).
- `apps/client/src/App.tsx` — the `/dev/bomb` route branch (`isBombDevRoute`) is the exact pattern for `/dev/sandbox`. No router exists; don't add one.
- `apps/client/src/store/uiStore.ts` — `activeModuleIndex` focus state; no changes expected.

### Registration timing (a real footgun — decide deliberately)

`registerModuleRenderer` throws on duplicate id (fail-loud, by design — keep it). Module registration should be an **import-time side effect** in the module's `index.ts` (node/vite module cache makes it once-per-bundle), pulled in from one registration barrel (e.g. `apps/client/src/modules/index.ts` importing each module dir) that `main.tsx` or the scene entry imports once. Avoid registering inside React effects — StrictMode double-invokes effects in dev and you'll hit the duplicate throw. Vite HMR re-executing the registering module can also re-run the side effect: handle it (e.g. `import.meta.hot?.accept(() => location.reload())` in the barrel, or an idempotent `has` check at the call site) and document the choice. Server side has no such issue — `MODULE_REDUCERS` is a static object literal entry.

### Click primitive — the contract, precisely

- EXPERIENCE.md (verbatim): "**Click (Defuser):** sole module interaction primitive. Wire cut = click. Button press = mousedown+mouseup. Button hold = mousedown, sustain, mouseup. Keypad symbol = click. Maze = click adjacent cell. Memory = click numbered position. Morse Code = click TX button." Right/middle-click reserved (no module interaction). UX-DR13: NO bomb-side keyboard shortcuts (prevents Defuser self-coaching).
- Hold semantics: the primitive emits **discrete press and release actions**; "how long was it held / what digit was showing" is reducer state fed by the server (5.4's Button passes the live timer value as state input). Never measure wall-clock in the helper for game-rule purposes and never let `Date.now()` reach a reducer.
- R3F events (`ThreeEvent<MouseEvent>` / `PointerEvent` from `@react-three/fiber`) carry `delta` (screen-px travel since pointerdown) — that is the drag-vs-click discriminator ModuleBay already uses with tolerance 4px. Lift the constant somewhere shared between ModuleBay and the helper rather than duplicating the literal.
- Edge to handle: pointerdown on a hold target followed by a drag-orbit — decide whether release-after-drag counts as a release action or cancels (recommendation: deliver the release action regardless; a hold's correctness is judged by the reducer, and swallowing releases risks a stuck "held" state). Test whichever you choose.
- Focus-gating (does a module need camera focus before it accepts interaction?) is **not** decided here — do not implement gating; clicks on any module's internals interact, `stopPropagation` keeps focus behavior intact. Revisit in 5.3 with real Wires if playtest demands it; note it in Completion Notes for 5.3.

### Sandbox design constraints

- Sandbox state flows through the **real gameStore** (`setBomb` with a single-module `BombState` built from `generate(seed, DEV_BOMB_CONTEXT)`), so DefuserView's production read path (scoped selector on `moduleIndex` 0) is what's exercised — not a parallel props channel.
- The local dispatcher must reproduce the server's transient-struck roll-up (struck update immediately followed by armed update) — this is the worst-case sequencing the 4.3 LED flash was explicitly built to survive, and the sandbox should keep proving it.
- Sandbox chrome (seed input, picker, inspector, reset) is plain DOM/Tailwind around the `BombStage` canvas — operator-world styling; the existing `ui/` components (`Button` etc.) are available. It is a dev tool: functional beats pretty, but don't invent new visual language.
- DEV-guarded keyboard in the sandbox chrome (e.g. typing in the seed input) is fine — `isTextEntryTarget` exists for exactly this; keyboard must never reach the module canvas as a game input.

### Previous story intelligence (4.3 reviewed 2026-06-12; Epic 1 retro done)

- **House pattern:** pure-fn module + thin component (`moduleLed.ts`/`ModuleBay`, `layout.ts`/`BombScene`, `stage.ts`/`BombStage`). Review checks this split explicitly — interaction classification, demo-module rules, and dispatch roll-up all belong in pure files with tests; components stay logic-free.
- **Reviews sweep edge domains and count ranges** (4.1: count≥13 overlap; 4.2: battery 9–12 overhang; 4.3: flash 0/599/600ms boundaries). Sweep yours: seed 0 / large seeds, repeated actions after solve (solved-inert), reset-after-solve, press-without-release / release-without-press, drag-then-release.
- **Red→green TDD** is the established cadence (4.3 wrote failing tests first). Gates at the end of 4.3: shared 24 ✓ / client 76 ✓ / server 64 ✓ — your baseline; regressions are review findings.
- **Honest smoke notes:** record each manual-smoke item individually; an earlier story's unexecuted smoke claim was caught in review. 4.2/4.3 used a headless playwright-core + SwiftShader pass against `vite dev` with screenshot inspection — the same rig works for the sandbox, and gestures are scriptable (`mouse.down/up/move`).
- **Type narrowing recurs in review:** `status` is `ModuleState<unknown>['status']`, never `string`; action types are discriminated unions, never `string` fields; `moduleId` stays `string` (open-ended by design).
- **Keep diffs surgical:** new files + one `App.tsx` branch line + one `MODULE_REDUCERS` entry + the Task 3 guard hunk in `bombReducer.ts`. Zero diffs expected in: `BombScene`/`CameraRig`/`BombStage`/chassis files, stores (unless a genuinely missing accessor), `net/`, `ui/` (reuse only), socket events in shared (no new events this story).
- **Worktree merge discipline:** stories 4-x and 2-x merged to master as single story commits with review summaries; this story is on branch `worktree-story-5-1`.

### Git intelligence

Recent cadence (`git log`): implement → adversarial review → patches folded → one story commit (`Story 4.3: module slots & solve LEDs` → `review(story-4.3): apply code-review patch`). Parallel worktrees exist for 4-4/4-5, 5-2, 8-3/8-4 — another reason to keep shared-surface diffs (gameStore, App.tsx, shared types) minimal and additive: they are merge-conflict magnets.

### Installed stack (verified through 4.3 — zero new dependencies)

`three 0.184.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `camera-controls 2.10.1` · React 18.3 · zustand · vitest 4 (client) · jest 29 + ts-jest (shared/server, ESM via `--experimental-vm-modules`). **Never upgrade React or move to fiber@9/drei@10 (React-19-only).** No new packages, no new fonts/assets, no web research required — everything this story needs is in-repo.

### Project Context Rules (from `_agent_docs/project-context.md` — authoritative)

- **Module System (verbatim):** `generate(seed, bombCtx)` is the only place randomness is allowed; `render(state)`/`handleInteraction` pure; modules register in `MODULE_REDUCERS` — bomb reducer never changes per-module (open/closed); `getManualPages()` returns structured data, not raw HTML/untyped JSX; custom modules under `apps/client/src/modules/custom/` (V2 — not now); sandbox at `/dev/sandbox`.
- **Reducers:** zero imports from socket.io/ioredis/pg/fastify; never mutate in place; unknown actions fall through; never `setTimeout`/`Date.now()` in reducers or their tests (pass time as state input).
- **R3F:** data-driven geometry from `generate` output — never hardcoded in JSX; rendering-only components; `useFrame` for per-tick work; `getState()` (not reactive hooks) on the render loop; no per-frame allocations; memoize module components with stable scoped selectors; dispose manually-created Three objects (stay declarative and it's free).
- **Naming:** module IDs kebab-case (`dev-demo`); `DevDemoState`/`DevDemoAction`; components PascalCase; reducer files `camelCaseReducer.ts` in server contexts — within a module dir the contract name is `reducer.ts`.
- **Testing boundaries:** pure logic unit-tested in Node with zero infra; R3F components visual-only — "if a component requires a logic test, the logic has leaked"; never mock the pure reducer in a handler test; **never skip the immutability (frozen-state) test**.
- **Build:** `tsc --noEmit` zero errors before commit; no `@ts-ignore`; TypeScript only; per-workspace tsconfigs (don't touch them); no secrets/env changes in this story.
- **Don't-miss:** NEVER `Math.random()` outside `generate`; NEVER mutate `BombContext` (it's `readonly` — keep it that way); NEVER emit a socket event from a reducer; client never owns authoritative state (the sandbox's local authority is a documented dev-only exception confined to the dev dispatcher).

### Project Structure Notes

- New (shared): `packages/shared/src/modules/dev-demo/{types,generate,solve,reducer,manual}.ts`, `packages/shared/src/modules/index.ts` (replaces the `.gitkeep`), tests in `packages/shared/src/__tests__/` or co-located `packages/shared/src/modules/dev-demo/__tests__/` (jest globs `src/**` — verify `jest.config` pattern before choosing; keep all shared module tests in one consistent home for 5.3+ to copy).
- New (client): `apps/client/src/modules/dev-demo/{index.ts,DefuserView.tsx,ManualPages.tsx,types.ts,generate.ts,solve.ts,reducer.ts}`, `apps/client/src/modules/dev-demo/__tests__/`, `apps/client/src/modules/interaction.ts` (+ tests), `apps/client/src/modules/index.ts` (registration barrel), sandbox harness file(s), dev dispatcher.
- Modified: `apps/client/src/App.tsx` (one route branch), `apps/server/src/reducers/MODULE_REDUCERS.ts` (one entry, if production registration chosen), `apps/server/src/reducers/bombReducer.ts` (Task 3 guard only), `packages/shared/src/index.ts` (barrel line), possibly `apps/client/src/scenes/devBombState.ts` (optional dev-demo slot).
- Untouched: everything else — camera/chassis/scenes internals, stores, `net/`, shared `types/` and `events/`, server handlers/state/persistence, Docker/compose.
- This story sets the **template** every module dir from 5.3 onward copies. The demo module's files should read as exemplary: tight comments stating the contract obligations (purity, seeding, reset, transient-struck), not tutorial prose.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 5.1 + Epic 5 preamble] (ACs verbatim; FR20, AR4/AR5/AR16, NFR11, UX-DR8/UX-DR14 epic scope; 5.2–5.5 boundaries)
- [Source: _agent_docs/game-architecture.md#Pattern 3 — IModule Plugin Contract] (open/closed registry, per-module file contract incl. "or re-export from shared", ModuleState envelope)
- [Source: _agent_docs/game-architecture.md#Project Structure + Consistency Rules] (`modules/registry.ts`, per-module dirs, `/dev/sandbox`, naming; "modules are plugins — never edit bombReducer.ts per-module")
- [Source: _agent_docs/game-architecture.md#ADR-003, ADR-004] (open/closed registry; deterministic seeded generation)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Interaction Primitives (~L94) + Bomb chassis (~L78)] (click-gesture table verbatim; right/middle reserved; ≤100ms click→outcome budget context)
- [Source: _agent_docs/project-context.md#Module System / Code Organization / Testing Rules / Critical Don't-Miss Rules] (module file structure, MODULE_REDUCERS, sandbox path, reducer test list, randomness/timer bans)
- [Source: packages/shared/src/types/module.ts + actions.ts + bomb.ts] (IModule, ModuleState, transient 'struck', MODULE_RESET forwarding, readonly BombContext)
- [Source: packages/shared/src/seeding/seedChain.ts] (`makeSeededRng` — sole approved RNG; non-negative-integer seed assertion)
- [Source: apps/client/src/modules/registry.ts + PlaceholderModule.tsx] (existing registry API — extend, don't recreate)
- [Source: apps/server/src/reducers/bombReducer.ts + MODULE_REDUCERS.ts] (`createBombReducer(registry)` test hook; roll-up + solved-inert semantics the demo reducer must fit)
- [Source: apps/client/src/scenes/{ModuleBay.tsx,DevBombHarness.tsx,devBombState.ts,devBombContext.ts,dom.ts}] (click-to-focus handler + drag tolerance; dev-harness philosophy; DEV_BOMB_CONTEXT; reuse helpers)
- [Source: apps/server/Dockerfile + apps/server/package.json + packages/shared/package.json] (tsx runtime everywhere — shared runtime-value imports are safe; jest/vitest split)
- [Source: _agent_docs/implementation-artifacts/4-3-module-slots-and-solve-leds.md#Dev Notes + Completion Notes] (registry handoff note "Story 5.1 builds directly on this file"; house patterns; gate baselines)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md#story-1.6 + story-1.3 + story-1.8] (reducer-output guard owed to this story; shared `.ts`-exports deferral stays deferred; `vite preview` SPA-fallback gap)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD per task: shared devDemo suite written first (failed: modules absent), then implemented → green. Server moduleRegistration suite red (4 failures: empty MODULE_REDUCERS + missing output guard) → implemented → green. Client interaction/dispatch/sandbox/binding suites red (modules absent) → implemented → green.
- Gates (final state): `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm -r test` → shared 53 ✓ (24 baseline + 29 new), client 121 ✓ (94 baseline + 27 new), server 155 ✓ (147 baseline + 8 new); `pnpm --filter @bomb-squad/client build` green (pre-existing three.js chunk-size warning only).
- Headless smoke (playwright-core chromium + SwiftShader against `vite dev --port 5199`, 1920×1080, /tmp/pw-smoke rig reused from 4.2/4.3; screenshots in /tmp/pw-smoke/shots-5-1; server stopped after): all 14 checks PASS — see Completion Notes. One console 404 = missing favicon (pre-existing, not story-related).
- /dev/bomb regression smoke after the ModuleBay/App.tsx edits: bays, LEDs, click-to-focus + ESC all behave as the 4.3 baseline; no console errors.

### Completion Notes List

- **Task 1 — shared pure logic (`packages/shared/src/modules/dev-demo/`):** `types.ts` (DevDemoState/DevDemoAction + `isDevDemoAction` runtime guard — actions reach reducers as `unknown`), `generate.ts` (makeSeededRng only; label = 2 seeded letters + serial last digit, demonstrating BombContext threading), `solve.ts` (verdict functions + `solutionForLabel`), `reducer.ts` (all contract obligations: guards, idempotency, immutability, transient 'struck', MODULE_RESET, solved-inert), `manual.ts` (structured ManualPage[] with the letter-range rule table). 29 jest tests incl. determinism, Math.random ban (manual swap — the `jest` mock object is unavailable under ESM jest), frozen-input immutability, and every reducer obligation.
- **DESIGN DEVIATION (deliberate, flagged for review):** the story's suggested third mechanic "hold the button while cutting" is physically impossible in the click-primitive model — one mouse cannot hold left-down on one target and click another, and pointer capture during a hold would swallow the second click anyway. Replaced with a two-step **`cut-press` sequence** (cut first, THEN press) — still exercises click + press + sustained-hold state (`held` persists between BUTTON_DOWN/BUTTON_UP; button visibly sinks while held). Lesson recorded in the DevDemoSolution doc comment: **simultaneous-gesture rules are impossible; module rules must be sequences** (relevant to module designs in 5.3–7.x; The Button's timed hold (5.4) is unaffected — single target, judged against server timer state).
- **Puzzle soundness fix over the story sketch:** the solution is *derived from the Defuser-visible label* via `solutionForLabel` (A–I cut / J–R press / S–Z cut-press), and the manual documents exactly that mapping — making dev-demo a real (trivial) information-asymmetry puzzle instead of a rig whose solution is invisible. generate() and the manual share the same rule function, so they cannot diverge.
- **Task 2 — client module dir (`apps/client/src/modules/dev-demo/`):** the template directory. `index.ts` = IModule binding + import-time renderer registration (documented: module cache prevents double-registration; non-component module → HMR escalates to full reload, so the fail-loud duplicate throw is safe); `DefuserView.tsx` = R3F rendering only, fully data-driven (severed-wire stubs, button sinks while held, drei Text label with the vendored mono font), scoped snapshot-rate selector returning the stable `data` ref; `ManualPages.tsx` = minimal typed renderer of `getManualPages()` (real viewer is 5.2); `types/generate/solve/reducer.ts` = re-exports from shared.
- **Task 3 — server seam:** `MODULE_REDUCERS` gains the `dev-demo` entry (decision: YES to production registration — one line, nothing emits 'dev-demo' until 8.2 defines pools; documented in the map comment). 1.6-deferred output guard closed: `isContractResult` in bombReducer.ts validates moduleId stability + legal status at both reduce call sites; out-of-contract output → no-op. 8 jest tests: open/closed via `createBombReducer(registry)` injection (solve/strike-rollup/reset + production-map presence) + guard (rebound moduleId, illegal status, non-object output, not-over-broad).
- **Task 4 — click primitive (`apps/client/src/modules/interaction.ts`):** `isPrimaryActivation(button, delta)` + `moduleClickHandlers` + `modulePressHoldHandlers`, typed structurally (ModulePointerEvent) so pure logic tests need no R3F canvas. Left-button only; CLICK_DRAG_TOLERANCE_PX (4px) lifted here and ModuleBay refactored to consume `isPrimaryActivation` (focus-click and module-click can never disagree); stopPropagation everywhere (module surfaces own their pointer events); pointer captured on press so off-mesh releases arrive; release delivered even after a drag (documented decision — swallowing releases risks stuck-held state; correctness is the reducer's judgement). Zero keyboard listeners. 9 vitest tests.
- **Task 5 — dispatch seam:** `modules/dispatch.ts` (`setModuleActionDispatch`/`dispatchModuleAction`; no backend → warn+drop, surfacing mis-wiring) + `sandbox/devDispatch.ts` (dev-only local backend: pure `reduceDevModuleAction` mirrors applyModuleResult sequencing — transient struck→armed pulse, solved-inert with MODULE_RESET bypass — and the impure applier drives the REAL gameStore via applyModuleUpdate + bomb-level strikes/solved roll-up, saturating at 3). Production MODULE_INTERACT emit deliberately NOT added (no server handler exists; 5.3/Epic 8 installs it via setModuleActionDispatch — documented in dispatch.ts).
- **Task 6 — /dev/sandbox:** App.tsx branch mirrors /dev/bomb exactly (same DEV/connected guard, same `vite preview` SPA-fallback deferral); `sandbox/SandboxHarness.tsx` (decision: `src/sandbox/` dir — sandbox is neither a scene nor a module) overlays operator-world chrome (module picker from SANDBOX_MODULES, seed input with validation, Generate/Reset, live inspector: seed/status/strikes/bomb.solved/data JSON) on BombStage + a minimal Canvas mounting the registry-resolved DefuserView at moduleIndex 0. State flows through the real gameStore (`setBomb(buildSandboxBomb(...))`). `modules/index.ts` registration barrel imported once by main.tsx. `sandbox/sandbox.ts` pure helpers (parseSeed, buildSandboxBomb).
- **Task 7 — gates & smoke:** all green (see Debug Log). Headless smoke 14/14 PASS: (a) auto-generate on load, (b) same-seed reproduction byte-identical + different-seed differs, (c) cut solves / press solves / wrong-cut strikes+re-arms+severs, (d) cut-press two-step incl. progress-without-strike, (d3) held=true sustained mid-hold with sunk-button screenshot, (e) reset restores + still solvable, (f) keyboard does nothing to the module, (g) drag across the wire ≠ click, (h) right-click reserved.
- **Type-erasure pattern settled for registries:** module reducers are fully typed in shared; at registry boundaries (`MODULE_REDUCERS`, `SandboxModule`) the per-module state type is erased via a single documented cast (`devDemoReducer as ModuleReducer`, `DEV_DEMO_MODULE as SandboxModule`). Reducer variance makes this unavoidable; the bombReducer output guard is the runtime backstop. 5.3+ copies this pattern.
- **Human verification (Jay, 2026-06-12):** interactively exercised `/dev/sandbox` and confirmed the module behaves correctly — human-verification gate satisfied. Code review (2026-06-12) applied one patch (press/hold handler stopPropagation ordering + `onPointerCancel` to prevent stuck-held); gates re-run green (tsc 0, client 121). Status → done.
- **For Story 5.3 (Wires):** copy `apps/client/src/modules/dev-demo/` + `packages/shared/src/modules/dev-demo/` structure verbatim; add one MODULE_REDUCERS entry + one SANDBOX_MODULES entry + one barrel import; swap the dispatch backend to the MODULE_INTERACT emit via `setModuleActionDispatch` (or install it as the default backend in net/). Focus-gating of module interaction was deliberately NOT implemented (clicks interact from any camera pose; stopPropagation keeps focus behavior intact) — revisit with real Wires playtest.

### File List

New (shared):
- packages/shared/src/modules/index.ts
- packages/shared/src/modules/dev-demo/types.ts
- packages/shared/src/modules/dev-demo/generate.ts
- packages/shared/src/modules/dev-demo/solve.ts
- packages/shared/src/modules/dev-demo/reducer.ts
- packages/shared/src/modules/dev-demo/manual.ts
- packages/shared/src/modules/dev-demo/index.ts
- packages/shared/src/modules/dev-demo/__tests__/devDemo.test.ts

New (client):
- apps/client/src/modules/interaction.ts
- apps/client/src/modules/dispatch.ts
- apps/client/src/modules/index.ts
- apps/client/src/modules/dev-demo/index.ts
- apps/client/src/modules/dev-demo/DefuserView.tsx
- apps/client/src/modules/dev-demo/ManualPages.tsx
- apps/client/src/modules/dev-demo/types.ts
- apps/client/src/modules/dev-demo/generate.ts
- apps/client/src/modules/dev-demo/solve.ts
- apps/client/src/modules/dev-demo/reducer.ts
- apps/client/src/modules/__tests__/interaction.test.ts
- apps/client/src/modules/__tests__/dispatch.test.ts
- apps/client/src/modules/__tests__/devDemoBinding.test.ts
- apps/client/src/sandbox/SandboxHarness.tsx
- apps/client/src/sandbox/devDispatch.ts
- apps/client/src/sandbox/sandbox.ts
- apps/client/src/sandbox/__tests__/sandbox.test.ts

New (server):
- apps/server/src/reducers/__tests__/moduleRegistration.test.ts

Modified:
- packages/shared/src/index.ts (modules barrel export line)
- apps/server/src/reducers/MODULE_REDUCERS.ts (dev-demo entry + erasure comment)
- apps/server/src/reducers/bombReducer.ts (isContractResult guard at both reduce call sites)
- apps/client/src/App.tsx (/dev/sandbox route branch)
- apps/client/src/main.tsx (registration-barrel import)
- apps/client/src/scenes/ModuleBay.tsx (consume isPrimaryActivation; local constant removed)

Deleted:
- packages/shared/src/modules/.gitkeep (directory now populated)

## Change Log

- 2026-06-12: Story created (ultimate context engine analysis completed — comprehensive developer guide created). Status: ready-for-dev.
- 2026-06-12: Implemented (claude-fable-5): module plugin scaffold (shared pure logic + client template dir + server registration), 1.6-deferred bombReducer output guard, click-primitive helpers, dispatch seam with dev-only local backend, /dev/sandbox harness. Demo mechanic deviation: hold-while-cutting → cut-then-press sequence (simultaneous gestures physically impossible with one mouse — see Completion Notes). All gates green; 14/14 smoke checks pass. Status: review.
