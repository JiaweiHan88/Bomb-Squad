---
baseline_commit: f532aeb
---

# Story 5.4: The Button Module

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want to defuse The Button (press/hold + timed release),
So that we handle a module whose solution depends on bomb context and the live timer.

## Acceptance Criteria

1. **Press/hold decision (first-match, ordered):** **Given** a generated Button, **when** the press/hold decision rules are evaluated in order, **then** the first matching rule determines the correct action: ① Blue + label "Abort" → **hold**; ② >1 battery + label "Detonate" → **press** (tap); ③ White + lit CAR → **hold**; ④ >2 batteries + lit FRK → **press**; ⑤ Yellow → **hold**; ⑥ Red + label "Hold" → **press**; ⑦ otherwise → **hold**.
2. **Timed release on a held button:** **Given** a held button showing a coloured release strip, **when** the Defuser releases at a timer digit matching the strip rule (Blue→4, White→1, Yellow→5, any-other→1, the digit appearing in **any** position of the displayed time), **then** the module solves; releasing at a wrong digit records a strike.
3. **Colorblind floor:** **Given** the module visuals, **when** rendered, **then** colour is paired with label/pattern redundancy (button colour-word + strip colour-letter — never colour alone).
4. **Reducer test suite (timer as state input):** **Given** the reducer test suite, **when** it runs, **then** it covers happy/wrong/idempotent/immutable/guard/reset, passing the live timer value **as action/state input** (never `Date.now()` inside the reducer).
5. **Human verification:** Jay exercises The Button interactively in `/dev/sandbox` (tap-solve and hold-release-solve paths, deliberate wrong action, deliberate wrong release digit) and his observed results are recorded in Completion Notes before the story is marked done.

## Tasks / Subtasks

- [x] Task 1 — Shared pure logic: `packages/shared/src/modules/the-button/` (AC: 1, 2, 4)
  - [x] Copied the **wires** directory shape: `types.ts`, `generate.ts`, `solve.ts`, `reducer.ts`, `manual.ts`, `index.ts`, `__tests__/`. Barrel-exported from `packages/shared/src/modules/index.ts` (reaches the package root). Module id = `'the-button'`.
  - [x] `types.ts`: `ButtonState { color, label, stripColor, held, ctx }`, `ButtonAction` discriminated union, `isButtonAction` runtime guard. Colours `red|blue|white|yellow`; labels `Abort|Detonate|Hold|Press`; strip `blue|white|yellow|red`. **`ctx` carried in state** (wires AI1 pattern) so the answer is recomputed at interaction time, never stored/transmitted.
  - [x] **Action model — refined during implementation to PRESS + RELEASE (cleaner than the planned TAP/HOLD/RELEASE).** `modulePressHoldHandlers` emits PRESS on pointer-down and RELEASE on pointer-up and *never measures duration* (its own contract), so the client cannot distinguish a tap from a hold — the reducer judges. `{ type: 'PRESS' }` reveals the strip (`held: true`); `{ type: 'RELEASE'; timerDigits: number[] }` carries the displayed digits. A TAP-answer button solves on any RELEASE (timer irrelevant); a HOLD-answer button solves iff `timerDigits.includes(releaseDigitFor(strip))`. This models real KTANE exactly and keeps zero game logic in the input layer.
  - [x] `generate.ts`: seeded `color`/`label`/`stripColor` via `makeSeededRng`; `held:false`; `ctx` stored by reference (never mutated). Pure, synchronous.
  - [x] `solve.ts`: 7-row decision as ordered `ButtonRule[]` (`when`/`decision`/`conditionText`/`actionText`) → `decideButton(color, label, ctx): 'tap'|'hold'` (final rule always matches → total). `releaseDigitFor(strip)` + `STRIP_RELEASE_DIGIT` (Blue→4, White→1, Yellow→5, red/other→1). Same arrays the manual renders.
  - [x] `reducer.ts`: PRESS reveals strip (idempotent while held); RELEASE judges via `decideButton` (tap→solve; hold→digit match or strike), always clears `held`; RELEASE-without-press and unknown/malformed actions → no-op; solved-inert; `MODULE_RESET` re-arms + un-holds (strip/layout preserved); structural no-op when already in reset shape. No `Date.now()`/`Math.random()`.
  - [x] `manual.ts`: `getButtonManualPages()` — one `the-button` chapter: decision `ManualTable` from `BUTTON_RULES` + release `ManualTable` from `STRIP_RELEASE_DIGIT` + a confirming-colours note. Structured data only.
- [x] Task 2 — GDD rule fidelity check (AC: 1, 2)
  - [x] Verified every row against GDD `#Module 2: The Button` (~L202–224). One test per decision row + ordering tests (earlier rule wins) + battery-threshold strictness (`>1`, `>2`) + unlit-indicator non-trigger. CAR/FRK read from `ctx.indicators` (lit). No shared-type change.
- [x] Task 3 — Client module directory: `apps/client/src/modules/the-button/` (AC: 1, 2, 3)
  - [x] Wires client dir shape: `index.ts` (IModule binding + import-time `registerModuleRenderer`), `DefuserView.tsx`, `ManualPages.tsx`, re-export `types/generate/solve/reducer`, `__tests__`.
  - [x] `DefuserView.tsx` (R3F, rendering only): coloured button cap with its **label text** + graphite housing; release strip on the right, emissive only while `held`, with its colour **letter** (B/W/Y/R). Memoized scoped zustand selector on `moduleIndex` (5.3 review pattern). No per-frame work.
  - [x] Interaction via the existing `modulePressHoldHandlers` (PRESS → dispatch PRESS; RELEASE → dispatch RELEASE with the live digits). No gesture reimplementation, no duration measurement, no keyboard.
  - [x] Live timer for RELEASE read via `timerRemainingMs` + `formatTimerDisplay` (4.4 `timerLcd.ts`) + `serverNow()` at the release instant, mapped to its digit set; absent timer → `[]`.
  - [x] Registration: one import + `SANDBOX_MODULES` entry (`modules/index.ts`); one `the-button` entry in `MODULE_REDUCERS.ts`. **Zero diff to `bombReducer.ts`.**
- [x] Task 4 — Generator + tier-pool registration (AC: 1)
  - [x] `the-button` added to `MODULE_GENERATORS` and to `TIER_POOLS` (all three tiers → `['wires','the-button']`) — generator + reducer + pool entry land together so `generateLayout` never throws.
  - [x] Registry comment updated to hand the authoritative tier GATING to Story 8.1 (the planned reconcile); the easy pool now reflects the two registered Easy modules.
- [x] Task 5 — Canonical manual content into the 5.2 viewer (AC: 1, 2)
  - [x] `devManualFixtures.ts`: the two placeholder Button pages replaced with `...getButtonManualPages()` (canonical). Header comment updated. (Chapter-grouping coverage lives in `chapters.test.ts`, which builds its own pages — unaffected.)
- [x] Task 6 — Sandbox proof of the loop (AC: 1, 2)
  - [x] The Button is in the `/dev/sandbox` picker (SANDBOX_MODULES). Generation determinism + legal value sets are covered by the shared suite; same-seed reproduction is the harness's existing guarantee.
  - [x] **Sandbox clock control added** (the bare sandbox has no running timer): a "Clock seconds" field sets a *paused* `TimerState` and previews the displayed `M:SS` + digit set, so the held-release path is exercisable (set 0:04 → release a blue-strip hold → solve; 0:02 → strike). The tap/hold/strike/reset transitions otherwise run through the real gameStore + local devDispatch backend exactly as wires does.
- [x] Task 7 — Tests + gates (AC: 4, and all)
  - [x] Shared (jest): `generate` determinism + 200-seed legal-value sweep + frozen-ctx + Math.random ban; all 7 `decideButton` rows + ordering + thresholds + unlit indicators; `releaseDigitFor` for all four strips; full reducer suite (PRESS reveal/idempotent, tap-solve, hold-release solve/strike per strip, release-without-press no-op, solved-inert, malformed/unknown guards, MODULE_RESET, frozen-input immutability, post-solve idempotency); manual-derives-from-solver assertions. New tests in `the-button/__tests__/the-button.test.ts`.
  - [x] Manual/solver divergence test included (decision + release tables assert against `BUTTON_RULES`/`STRIP_RELEASE_DIGIT`).
  - [x] Client (vitest): `theButtonBinding.test.ts` (renderer registered, IModule contract, sandbox-listed). Server (jest): extended `moduleRegistration.test.ts` — registered + PRESS/RELEASE solve & wrong-digit strike through the untouched bomb reducer.
  - [x] Gates: baseline re-measured on this worktree; `pnpm -r exec tsc --noEmit` → **0 errors** (no `@ts-ignore`); `pnpm -r test` green with new tests — **shared 170, server 376, client 272**, no regressions; `pnpm --filter @bomb-squad/client build` green (pre-existing three.js chunk-size note only).
  - [x] Headless smoke: the committed SwiftShader playwright rig from 5.3 was ad-hoc (not in this worktree, `playwright-core` absent). Ran a runtime liveness smoke instead — `vite dev` boots, `/dev/sandbox` serves 200, the-button resolves cleanly in the module graph, no vite errors; production build transformed all 748 modules incl. the-button. **The full visual smoke (10-item screenshot inspection) folds into Jay's interactive Task 8** (honest record — the screenshot rig was not re-provisioned).
- [x] Task 8 — Human verification (AC: 5)
  - [x] **Jay verifies interactively:** in `/dev/sandbox`, generate The Button from a couple of seeds, solve a "press" one by tapping and a "hold" one by reading the strip rule from `/dev/manual` and releasing at the right displayed digit (the real information-asymmetry loop), make a deliberate wrong action and a deliberate wrong-digit release, confirm strike pulse + recovery, confirm label/strip-letter legibility at normal zoom. Record his observed results item-by-item in Completion Notes — story is not done without this.

### Review Findings

_Code review 2026-06-16 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All ACs verified satisfied; findings below are non-blocking._

- [x] [Review][Patch] Stray `buttonReducer` re-export in the client contract-types file — **fixed:** stray lines removed; `index.ts` imports `buttonReducer` directly from shared, tsc clean. — copy-paste residue: a `types.ts` (types-only barrel) re-exports a runtime value, leaked through `index.ts`'s `export * from './types.js'`. `reducer.ts` is the designated home; the Passwords sibling has no such line. Harmless, no collision, but inconsistent. [apps/client/src/modules/the-button/types.ts:20-21]
- [x] [Review][Defer] Client-supplied `RELEASE.timerDigits` is fully trusted by the reducer — deferred, future scope. The guard only checks `typeof === 'number'`; the server never recomputes the true displayed digit, so a crafted `[4]` solves a blue HOLD button. No present bug (production `MODULE_INTERACT` is deferred to Epic 8); becomes Medium when that handler lands. Add to the Epic 8 checklist: server must recompute the displayed digit, not trust the payload. [packages/shared/src/modules/the-button/types.ts]

## Dev Notes

### Scope decisions (read first)

- **This story = The Button module + canonical manual content, proven in the sandbox and `/dev/manual`** — exactly the 5.3 envelope. The production `MODULE_INTERACT` server handler is **still Epic 8** (5.3 resolved that ambiguity; the sandbox's local backend is the sanctioned dev path). Leave the dispatch seam as is.
- **The one real difference from Wires is the timer dependency.** Wires is static; The Button's release solve depends on the *live displayed timer digit*. Keep the clock out of the reducer entirely — the DefuserView reads the displayed timer at the release instant (via 4.4's `timerLcd.ts` math) and passes the digit set into the `RELEASE` action. The reducer stays pure and the test suite passes timer values as plain inputs (AC4). This is the pattern 8.4's server timer was built to support.
- **Solve chime** = Story 10.1 (no audio infra; deferred for Wires too). Ship the LED-green visual; record chime as deferred-to-10.1 if you touch `deferred-work.md`.
- **`solutionIndex`/answer-in-state caution:** 5.3's review flagged that generated solution data riding in module `data` must be stripped before bomb state crosses to clients (anti-cheat). The Button's "answer" is *derivable* from public rules + visible colour/label/strip + ctx + timer, so don't bake a literal `correctAction` into transmitted state; if you cache it for convenience, add it to the same client-safe projection 8.x owns (see deferred-work.md "code review of story 5-3").
- **Out of scope:** Passwords (5.5 — sibling in this worktree), Preparation placeholder view (4.6), round config/difficulty gating (8.1 — owns the authoritative `TIER_POOLS` gating), voice, optimistic pre-flash (4.7).

### Copy the template — do not redesign it

Story 5.3 (Wires) is the proven real-module template; copy its directory shape file-for-file with Button content, then add **exactly the sanctioned integration lines**: client barrel import + `SANDBOX_MODULES` entry, `MODULE_REDUCERS` entry, `MODULE_GENERATORS` entry, `TIER_POOLS` entries. Settled patterns inherited for free: registration as import-time side effect (HMR/StrictMode-safe), the single documented type-erasure cast at registry boundaries, `isXxxAction` runtime guards, `.js` extensions on shared relative imports (NodeNext), transient-`'struck'` semantics, **memoized** scoped zustand selectors in DefuserView, rule-data shared by solver+manual.

### The GDD rules (authoritative — `solve.ts` implements these verbatim)

Press/hold decision, first matching rule wins, top to bottom:
1. Blue + label "Abort" → **hold**
2. >1 battery + label "Detonate" → **press** (tap)
3. White + lit CAR indicator → **hold**
4. >2 batteries + lit FRK indicator → **press**
5. Yellow → **hold**
6. Red + label "Hold" → **press**
7. otherwise → **hold**

Release strip (release when the displayed timer shows the digit in any position): Blue→**4**, White→**1**, Yellow→**5**, any other→**1**.

### Existing code you build on — read before writing

- `packages/shared/src/modules/wires/*` — the shared-side template (types + runtime guard, seeded generate, rule-driven solve shared with manual, contract-complete reducer, structured manual). Read 5.3's whole dir; The Button is the same shape with a richer reducer.
- `apps/client/src/modules/wires/*` — the client-side template (IModule binding, registration side effect, data-driven R3F DefuserView with drei Text labels, memoized selector, re-export files).
- `apps/client/src/modules/interaction.ts` — **`modulePressHoldHandlers(onPress, onRelease, ...)`** already exists for The Button (pointer capture + pointercancel handled; never measures duration). `isPrimaryActivation`, `CLICK_DRAG_TOLERANCE_PX`. Use as-is; do not fork.
- `apps/client/src/scenes/timerLcd.ts` — `timerRemainingMs(timer, serverNowMs)` + `formatTimerDisplay` (4.4). The source of the displayed digits for `RELEASE`.
- `packages/shared/src/modules/registry.ts` — `MODULE_GENERATORS`, `MODULE_IDS` (`'the-button'` reserved), `TIER_POOLS` (currently `['wires']` all tiers — the re-expansion target). `apps/server/src/reducers/MODULE_REDUCERS.ts` — one new entry. `bombReducer.ts` untouched.
- `packages/shared/src/types/bomb.ts` — `BombContext` has `batteryCount`, `indicators[{label,lit}]` with `IndicatorLabel` incl. `'CAR'`/`'FRK'`, `serialNumber`. **No shared-type change expected** beyond the new module's own `types.ts`; justify in Completion Notes if you believe one is needed.
- `packages/shared/src/seeding/` — `makeSeededRng(seed)` (mulberry32), the only approved RNG.
- `apps/client/src/manual/` — 5.2's viewer (`buildChapters`, `PageRenderer` renders `ManualTable`, tints colour words); `devManualFixtures.ts` is where the canonical Button chapter plugs in (Task 5).

### Worktree & environment

This story runs in worktree `Ktane-s4-modules` (branch `worktree-s4-modules`), bundled with **5.5 Passwords** — the two collide only on the shared registry files (`MODULE_REDUCERS.ts`, `registry.ts` `MODULE_GENERATORS`/`TIER_POOLS`, the `modules/index.ts` barrels), so land them as sequential commits and reconcile those additive lines locally rather than across a merge. Worktrees start without `node_modules` — run `pnpm install` first; `.env` is already provisioned. This story is pure logic + vite dev (no docker/secrets needed). Merge discipline: story commit + review patches merged to master as a unit.

### Previous story intelligence (5.1, 5.2, 5.3 — all done)

- **5.3 handoff (verbatim): "the wires dir confirms the dev-demo template scales to a real module with zero friction; the rule-data-shared-by-solver-and-manual pattern (`WiresRule[]`) is recommended for the Button's press/hold decision table too."** Follow it.
- **Red→green TDD is the house cadence:** write the shared Button suite first (fails on missing module), then implement. Reviews verify gate claims — record real numbers.
- **Reviews sweep edge domains:** expect probing of seed 0/large seeds, ordered-rule fall-through (a state matching two rules takes the first), repeat actions after solve, reset-after-solve, NaN/empty `timerDigits`, the hold→release vs tap distinction, and the "any position" digit match. Test them preemptively.
- **5.1 review lesson:** pointer-handler ordering + `pointercancel` were the only real defects and they live in `interaction.ts`, already fixed (and `modulePressHoldHandlers` already frees capture on cancel so a hold can't strand). Don't fork that file.
- **5.3 review patch:** the DefuserView selector must be memoized (`useMemo(() => select(moduleIndex), [moduleIndex])`) so zustand only re-subscribes on index change.
- **Honest smoke notes:** record every smoke item individually; an unexecuted-smoke claim was caught in a prior review.
- **Type narrowing recurs in review:** `status` is `ModuleState<unknown>['status']`; actions are discriminated unions; never widen to `string`.

### Project Structure Notes

- New (shared): `packages/shared/src/modules/the-button/{types,generate,solve,reducer,manual,index}.ts` + `__tests__/the-button.test.ts`; barrel line in `packages/shared/src/modules/index.ts`.
- New (client): `apps/client/src/modules/the-button/{index.ts,DefuserView.tsx,ManualPages.tsx,types.ts,generate.ts,solve.ts,reducer.ts}` + `apps/client/src/modules/__tests__/theButtonBinding.test.ts`.
- Modified (surgical, shared with 5.5 in this worktree): `packages/shared/src/modules/index.ts` (barrel), `packages/shared/src/modules/registry.ts` (`MODULE_GENERATORS` + `TIER_POOLS`), `apps/client/src/modules/index.ts` (import + SANDBOX_MODULES entry + export), `apps/server/src/reducers/MODULE_REDUCERS.ts` (one entry), `apps/server/src/reducers/__tests__/moduleRegistration.test.ts` (presence), `apps/client/src/manual/devManualFixtures.ts` (Button chapter ← canonical).
- Untouched: `bombReducer.ts` dispatch logic, `interaction.ts`, `dispatch.ts`, client `registry.ts`, `gameStore`/`uiStore`, manual viewer components, `net/`, scenes/camera/chassis, server handlers, shared `events/`, Docker. Naming: id `"the-button"`, `ButtonState`/`ButtonAction`, kebab-case dir.

### Project Context Rules (from `_agent_docs/project-context.md` — binding)

- `generate(seed, bombCtx)` is the only place randomness is allowed; never `Math.random()`; never mutate `BombContext` (readonly).
- Reducers: pure, zero socket.io/ioredis/pg/fastify imports; immutable returns; unknown actions fall through unchanged; **no `Date.now()`/`setTimeout` in reducers or their tests** — the live timer enters as action input only.
- `MODULE_REDUCERS`/`MODULE_GENERATORS` registration — bomb reducer/assembly never change per-module (open/closed). `getManualPages()` returns structured data, never HTML/untyped JSX.
- R3F: data-driven geometry from generate output; rendering-only components; `useFrame`+`getState()` for any per-frame work; no per-frame allocations.
- Testing: pure logic unit-tested with zero infra; **never skip the frozen-state immutability test**; never mock the reducer.
- Build: `tsc --noEmit` 0 errors, no `@ts-ignore`, TypeScript only, no new dependencies (everything needed is in-repo; stack pinned at three 0.184 / fiber 8.18 / drei 9.122 / React 18.3 — never upgrade).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 5.4 + Epic 5 preamble] (ACs verbatim; FR22; AR4/AR5, NFR11, UX-DR8/UX-DR14)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Module 2: The Button (~L202–224)] (authoritative press/hold decision + release-strip tables)
- [Source: _agent_docs/implementation-artifacts/5-3-wires-module-walking-skeleton.md] (the real-module template; "For Story 5.4 (Button)" handoff; rule-data-shared-by-solver+manual; memoized-selector review patch; solutionIndex anti-cheat defer)
- [Source: _agent_docs/implementation-artifacts/5-1-module-plugin-scaffold-sandbox-and-click-primitive.md + 5-2-expert-manual-viewer.md] (plugin contract; type-erasure cast; `modulePressHoldHandlers`; viewer/PageRenderer capabilities)
- [Source: apps/client/src/modules/interaction.ts] (`modulePressHoldHandlers` press/hold gesture, capture + pointercancel safety)
- [Source: apps/client/src/scenes/timerLcd.ts] (`timerRemainingMs`/`formatTimerDisplay` — displayed-digit source for RELEASE)
- [Source: packages/shared/src/types/bomb.ts] (`BombContext.batteryCount`/`indicators`/`serialNumber`; `IndicatorLabel` incl. CAR/FRK)
- [Source: packages/shared/src/modules/registry.ts] (`MODULE_GENERATORS`, `MODULE_IDS`, `TIER_POOLS` re-expansion comment) + [memory: module-registry-two-registries-and-tier-pools]
- [Source: _agent_docs/implementation-artifacts/Sprint 4 — Easy modules + round framing parallelization analysis.md] (worktree plan; TIER_POOLS reconcile with 8.1; module bundling rationale)
- [Source: _agent_docs/project-context.md] (full binding rule set)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

- Red→green: wrote `the-button/__tests__/the-button.test.ts` against the planned API, implemented shared logic to green. The new suite passed first run; the only failures were three EXISTING tests that hard-coded the interim single-`wires` tier pool / used `'the-button'` as the example *unregistered* id — all legitimately invalidated by registering the-button. Updated them to use `'simon-says'` (still unregistered) and the new pool composition: `assembleBomb.test.ts` (×2), `layout.test.ts`, `initializeRoundBombs.test.ts`.
- Baseline (this worktree, branch `worktree-s4-modules` off f532aeb): shared 167 / server (pre-change) / client — re-measured after implementation.
- Gates (final): `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm -r test` → shared **170** ✓, server **376** ✓, client **272** ✓; `pnpm --filter @bomb-squad/client build` green (pre-existing three.js chunk-size note only).
- Runtime liveness smoke: `vite dev` boots; `GET /dev/sandbox` → 200; `/src/modules/the-button/index.ts` resolves in the module graph; no vite errors. (The 5.3 SwiftShader screenshot rig was ad-hoc/not in this worktree — full visual smoke folds into Jay's AC5.)

### Completion Notes List

- **Action-model decision (the one real design call):** implemented **PRESS + RELEASE**, not the story-draft's TAP/HOLD/RELEASE. `modulePressHoldHandlers` deliberately never measures hold duration (its contract: "what the pair means is the reducer's judgement"), so the client *cannot* classify tap-vs-hold — the reducer does, via `decideButton`. PRESS reveals the strip; RELEASE solves unconditionally for a tap-answer button (timer irrelevant) and conditionally on the displayed digit for a hold-answer button. This is exactly real KTANE and keeps zero game logic in the input layer.
- **Answer never stored/transmitted (wires AI1):** `ButtonState` carries the public `ctx`; the reducer recomputes `decideButton` at interaction time. No literal `correctAction`/`solutionIndex` in module data, so nothing to strip when bomb state crosses to clients in Epic 8.
- **Timer as state input (AC4):** the reducer is pure; the DefuserView reads the *displayed* timer digits at the release instant (4.4 `timerLcd` math + `serverNow()`) and passes them in via `RELEASE.timerDigits`. Tests pass digit arrays directly — no clock in logic or tests.
- **Sandbox clock control:** the bare `/dev/sandbox` has no running timer, so added a "Clock seconds" control that sets a paused `TimerState` and previews the displayed `M:SS` + digit set — lets the held-release path be driven deterministically (the production timer is 8.4, wired in Epic 8).
- **TIER_POOLS expanded** to `['wires','the-button']` for all tiers (each registered with generator + reducer). The authoritative Easy/Medium/Hard GATING is handed to **Story 8.1** (registry comment updated) — the planned Sprint-4 reconcile.
- **Scope unchanged from 5.3:** production `MODULE_INTERACT` backend stays Epic 8; solve chime stays Story 10.1. Neither bolted in.
- **AC5 — Jay interactive verification (2026-06-16, recorded):** Jay exercised The Button in `/dev/sandbox` (dev server running) and confirmed it works as expected — tap-solve and hold-release-solve paths (using the "Set clock" control to drive the displayed release digit), deliberate wrong action and wrong-digit release both produce strike + recovery, label/strip-letter legible at normal zoom. **AC5 satisfied; Task 8 checked.** Code review (ideally a different model) still recommended before merge.
- **For Story 5.5 (Passwords, sibling worktree):** the shared-registry files this story touched are the merge surface — `packages/shared/src/modules/{index.ts,registry.ts}` (`MODULE_GENERATORS` + `TIER_POOLS`), `apps/server/src/reducers/MODULE_REDUCERS.ts`, `apps/client/src/modules/index.ts`. Land 5.5 as a second commit and reconcile those additive lines locally. The PRESS/RELEASE-with-state-input pattern and the sandbox clock control are reusable if Passwords ever needs timer input (it does not — pure SUBMIT).

### File List

New (shared):
- packages/shared/src/modules/the-button/types.ts
- packages/shared/src/modules/the-button/generate.ts
- packages/shared/src/modules/the-button/solve.ts
- packages/shared/src/modules/the-button/reducer.ts
- packages/shared/src/modules/the-button/manual.ts
- packages/shared/src/modules/the-button/index.ts
- packages/shared/src/modules/the-button/__tests__/the-button.test.ts

New (client):
- apps/client/src/modules/the-button/index.ts
- apps/client/src/modules/the-button/DefuserView.tsx
- apps/client/src/modules/the-button/ManualPages.tsx
- apps/client/src/modules/the-button/types.ts
- apps/client/src/modules/the-button/generate.ts
- apps/client/src/modules/the-button/solve.ts
- apps/client/src/modules/the-button/reducer.ts
- apps/client/src/modules/__tests__/theButtonBinding.test.ts

Modified:
- packages/shared/src/modules/index.ts (the-button barrel line)
- packages/shared/src/modules/registry.ts (MODULE_GENERATORS + TIER_POOLS entries; re-expansion comment → 8.1)
- apps/server/src/reducers/MODULE_REDUCERS.ts (the-button entry)
- apps/server/src/reducers/__tests__/moduleRegistration.test.ts (the-button registration + PRESS/RELEASE through bombReducer)
- apps/server/src/round/__tests__/initializeRoundBombs.test.ts (unregistered-id example → simon-says)
- packages/shared/src/generation/__tests__/assembleBomb.test.ts (unregistered-id example → simon-says; tier-pool fallback now {wires,the-button})
- packages/shared/src/generation/__tests__/layout.test.ts (unregistered-id example → simon-says)
- apps/client/src/modules/index.ts (the-button import + SANDBOX_MODULES entry + export)
- apps/client/src/manual/devManualFixtures.ts (Button chapter ← canonical getButtonManualPages(); header comment)
- apps/client/src/sandbox/SandboxHarness.tsx (clock control for The Button's timed release)
- _agent_docs/implementation-artifacts/sprint-status.yaml (story status tracking)

## Change Log

- 2026-06-15: Story created (context engine analysis — comprehensive developer guide). Status: ready-for-dev.
- 2026-06-16: Story 5.4 implemented (claude-opus-4-8) — The Button module: shared pure logic (seeded colour/label/strip generation, 7-row decision table + release-strip table as shared rule data consumed by both solver and manual, PRESS/RELEASE reducer with the live timer entering only as RELEASE input, answer recomputed at interaction time), client module dir on the wires template (press/hold via the 5.1 primitive, label + lit release-strip R3F view), the-button registered in MODULE_REDUCERS + MODULE_GENERATORS + TIER_POOLS + sandbox (bombReducer untouched), canonical manual wired into /dev/manual, sandbox clock control for the timed release. Gates green (tsc 0; shared 170 / server 376 / client 272; build); runtime liveness smoke pass. Status: review (awaiting code review + Jay's AC5 interactive verification).
- 2026-06-16: AC5 satisfied — Jay verified The Button interactively in `/dev/sandbox` (tap-solve, hold-release-solve, wrong-action + wrong-digit strike/recovery, legibility); Task 8 checked. All tasks complete; awaiting code review before merge.
