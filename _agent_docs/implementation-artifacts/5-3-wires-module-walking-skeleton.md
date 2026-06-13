---
baseline_commit: ab52d52
---

# Story 5.3: Wires Module (Walking Skeleton)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want to defuse the Wires module over voice,
So that we prove the core information-asymmetry loop end-to-end.

## Acceptance Criteria

1. **Deterministic generation:** **Given** a generated Wires module, **when** `generate(seed, ctx)` runs, **then** it deterministically produces 3–6 coloured wires from the seed alone (no `Math.random()`).
2. **Correct cut solves:** **Given** a wire configuration and bomb context, **when** the correct wire (per the per-wire-count rule tables for 3/4/5/6 wires) is cut, **then** the module solves (LED green; solve chime is Story 10.1 — see Dev Notes "Scope decisions") with no strike.
3. **Wrong cut strikes, idempotent:** **Given** an incorrect wire is cut, **when** the action is reduced, **then** a team strike is recorded and the module is not solved; repeating the same cut is a no-op (idempotent).
4. **Manual completeness + colorblind floor:** **Given** the manual pages, **when** an Expert reads Wires, **then** all four per-wire-count rule tables are present and wires carry pattern/label redundancy (not colour alone).
5. **Reducer test suite:** **Given** the reducer test suite, **when** it runs, **then** it covers happy-path, wrong-interaction, idempotency, immutability (frozen input), guard clauses, and reset.
6. **Human verification:** Jay exercises Wires interactively in `/dev/sandbox` and the canonical manual in `/dev/manual` (see Task 7) and his observed results are recorded in Completion Notes before the story is marked done.

## Tasks / Subtasks

- [x] Task 1 — Shared pure logic: `packages/shared/src/modules/wires/` (AC: 1, 2, 3)
  - [x] Copy the `dev-demo` directory shape verbatim: `types.ts`, `generate.ts`, `solve.ts`, `reducer.ts`, `manual.ts`, `index.ts`, `__tests__/`. Barrel-export from `packages/shared/src/modules/index.ts` and confirm it reaches `packages/shared/src/index.ts`.
  - [x] `types.ts`: `WiresState` (e.g. `{ wires: ReadonlyArray<{ color: WireColor; cut: boolean }> }` — colours are `'red' | 'white' | 'blue' | 'yellow' | 'black'`, the only five the GDD rules reference), `WiresAction` (`{ type: 'CUT'; wireIndex: number }` discriminated union), and an `isWiresAction` runtime guard (actions arrive at reducers as `unknown` — dev-demo precedent).
  - [x] `generate.ts`: all randomness via `makeSeededRng(seed)` from `packages/shared/src/seeding/` — seeded wire count (3–6, inclusive, uniform) and seeded colour per wire. All wires start `cut: false`. Pure, synchronous, CPU-cheap. `BombContext` is an input but generation itself only needs the RNG (the *solution* depends on ctx, not the layout).
  - [x] `solve.ts`: `solveWires(wires, ctx): number` returns the index of the one correct wire by evaluating the GDD rule tables **first-match top-to-bottom** for the actual wire count. Encode each table as ordered rule data — `{ when: (wires, ctx) => boolean, cut: (wires) => index, conditionText, actionText }` — so `solve.ts` and `manual.ts` consume the **same array** and cannot diverge (the dev-demo lesson: shared rule source = manual and solver provably agree). "Last serial digit odd" reads `ctx.serialNumber` last char (guaranteed a digit per `BombContext` JSDoc). Positions in rules are 1-based ("cut the 2nd"); convert carefully to 0-based indices.
  - [x] `reducer.ts`: pure `Reducer<ModuleState<WiresState>, WiresAction>`. CUT on the correct wire → `status: 'solved'`, wire marked cut. CUT on a wrong wire → `status: 'struck'` (transient, per the 1.6/4.3 roll-up contract — bombReducer's `applyModuleResult` converts it to a team strike and re-arms) and the wire stays permanently severed in `data`. CUT on an already-cut wire → state unchanged (no second strike — AC3). Contract obligations: unknown action → unchanged (no throw); out-of-bounds/NaN `wireIndex` → unchanged; solved-inert (post-solve actions no-op); `MODULE_RESET` (forwarded whole by bombReducer — discriminate on `action.type`) → all `cut` flags restored to false, status armed. Never `Date.now()`/`Math.random()` in the reducer.
  - [x] `manual.ts`: `getWiresManualPages(): ManualPage[]` — one `wires` chapter built from the same rule data as `solve.ts`: intro section ("count the wires first; apply the first matching rule top-to-bottom") + four `ManualTable` sections (3/4/5/6 wires), matching the GDD tables exactly. Include a short section documenting the wire letter-labels (R/W/B/Y/K) so the Expert can confirm colours with a colorblind Defuser (AC4). Structured data only — no HTML/JSX.
- [x] Task 2 — GDD rule fidelity check (AC: 2, 4)
  - [x] The GDD (`_agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Module 1: Wires`) is the **authoritative** rule source. The mockup/`devManualFixtures.ts` tables were hand-copied — verify every row of your rule data against the GDD before writing tests, and write one test per rule row asserting `solveWires` honours it (build a minimal wire config that triggers exactly that rule).
  - [x] Watch the compound conditions: 4-wires rule 1 (">1 red AND last serial digit odd → cut **last red**"), 5-wires rule 1 ("last wire black AND serial odd → cut 4th"), 6-wires rule 1 ("no yellow AND serial odd → cut 3rd"). "Last blue"/"last red" means highest index of that colour.
- [x] Task 3 — Client module directory: `apps/client/src/modules/wires/` (AC: 1, 2, 3, 4)
  - [x] Copy the dev-demo client dir shape: `index.ts` (IModule binding + import-time `registerModuleRenderer` — the established once-per-bundle side-effect pattern), `DefuserView.tsx`, `ManualPages.tsx` (minimal typed render of `getWiresManualPages()` — the real viewer is 5.2's, already built), `types.ts`/`generate.ts`/`solve.ts`/`reducer.ts` as pure re-exports from `@bomb-squad/shared`, `__tests__/`.
  - [x] `DefuserView.tsx` (R3F, rendering only, zero game logic): wires laid out as horizontal rows fully data-driven from `data.wires` (never hardcoded count/positions in JSX); per-wire colour material; **mono letter label per wire row (R, W, B, Y, K — K for black, B for blue)** rendered with drei `Text` + the vendored mono font, exactly the mockup's `wire-lab` treatment — this is the AC4 pattern/label redundancy on the bomb side; cut wires render as two severed stubs with a gap (mockup `.wire.cut` shows the visual: two halves with angled break). Read state via a scoped snapshot-rate zustand selector on `moduleIndex` (dev-demo's selector is the template).
  - [x] Interaction: wire cut = single click via the existing `moduleClickHandlers`/`isPrimaryActivation` from `apps/client/src/modules/interaction.ts` (left-button only, 4px drag tolerance, stopPropagation — do NOT reimplement; the 5.1 review patch already fixed handler ordering there). Click dispatches `{ type: 'CUT', wireIndex }` through `dispatchModuleAction`. No keyboard listeners (UX-DR13).
  - [x] Registration: one import + one `SANDBOX_MODULES` entry in `apps/client/src/modules/index.ts` (with the single documented `as ModuleReducer`-style erasure cast — 5.1's settled pattern); one `wires` entry in `apps/server/src/reducers/MODULE_REDUCERS.ts`. **Zero diff to `bombReducer.ts`** — open/closed is the whole point.
- [x] Task 4 — Canonical manual content into the 5.2 viewer (AC: 4)
  - [x] Replace the hand-copied Wires chapter in `apps/client/src/manual/devManualFixtures.ts` with the canonical `getWiresManualPages()` output from shared (the fixture file's own header says canonical Wires content ships via `getManualPages()` in this story). Other chapters stay as stubs.
  - [x] Verify in `/dev/manual` that all four rule tables render through `PageRenderer` (tables + colour-word tinting already work — 5.2 exercised them with the same shape) and that the rule text matches the GDD.
- [x] Task 5 — Sandbox proof of the loop (AC: 1, 2, 3)
  - [x] Wires appears in the `/dev/sandbox` module picker; Generate from a seed renders the wire config; same seed → identical config; different seed → different config (already provided by the harness once `SANDBOX_MODULES` has the entry — verify, don't rebuild).
  - [x] Correct cut → solve LED flips green (4.3's LED, driven by `status: 'solved'` through the real gameStore path); wrong cut → strike pulse (devDispatch's transient struck→armed roll-up) + wire stays severed; repeat-click on a severed wire does nothing; Reset restores all wires.
- [x] Task 6 — Tests + gates (AC: 5, and all)
  - [x] Shared (jest, `packages/shared/src/modules/wires/__tests__/`): `generate` determinism (same seed deep-equal twice; two seeds differ; wire count always 3–6; colours always in the legal set; sweep seed 0 / 1 / large), per-rule `solveWires` tests for **all 17 GDD rule rows** incl. serial-odd/even variants, and the full reducer suite: happy path, wrong cut (transient `'struck'` + wire severed), idempotent repeat cut, **immutability (frozen state input — never skip)**, guard clauses (out-of-bounds/NaN index, unknown action), `MODULE_RESET`, solved-inert.
  - [x] One shared test asserting `getWiresManualPages()` rows are generated from the same rule data as `solveWires` (e.g. table row count and text derive from the rule arrays — divergence becomes structurally impossible, but assert it anyway).
  - [x] Client (vitest): registry/binding test for the `wires` id mirroring `devDemoBinding.test.ts`. Server (jest): `MODULE_REDUCERS` has a `wires` entry (extend `moduleRegistration.test.ts` — the open/closed injection rig already exists; do not duplicate it).
  - [x] Gates: record the merged-master baseline first (`pnpm -r test` — expected ≈ shared 53 / client 143 / server 169 after the 5.1+5.2 merge; treat whatever you measure as the regression floor), then: `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm -r test` green, no regressions; `pnpm --filter @bomb-squad/client build` green.
  - [x] Headless smoke (reuse the `/tmp/pw-smoke` playwright-core + SwiftShader rig from 4.2–5.2 against `vite dev`; record each item honestly): (a) generate Wires from seed, (b) same-seed reproduction, (c) correct cut solves + LED green, (d) wrong cut strikes + wire severed + module re-arms, (e) repeat cut no-op, (f) reset restores, (g) drag-orbit over a wire ≠ cut, (h) `/dev/manual` Wires chapter shows all 4 tables.
- [x] Task 7 — Human verification (AC: 6)
  - [x] **Jay verifies interactively:** in `/dev/sandbox`, generate Wires from a couple of seeds, solve one by actually reading the rules from `/dev/manual` (the real information-asymmetry loop, single-screen variant), make a deliberate wrong cut, confirm the strike pulse + severed wire + recovery, confirm letter labels are legible at normal zoom. Record his observed results item-by-item in Completion Notes — story is not done without this.

## Dev Notes

### Scope decisions (read first)

- **This story = the Wires module + canonical manual content, proven in the sandbox and `/dev/manual`.** The production `MODULE_INTERACT` server handler is **NOT in scope**: the server has no bomb lifecycle yet (no `BOMB_INIT`, no round state in Redis — that's Epic 8.2/8.3), so a handler would have nothing to load or reduce against. `dispatch.ts` says "Story 5.3 / Epic 8 installs it" — the resolution is **Epic 8**. Leave the dispatch seam exactly as is; the sandbox's local backend is the sanctioned dev path. Note this resolution in Completion Notes so 8.x picks it up.
- **"Solve chime" in the epic AC:** game-state SFX is Story 10.1 (no audio infrastructure exists; EXPERIENCE.md specs module-typed chime pitches — an audio-design concern). Ship the LED-green visual confirmation (already built, 4.3); record the chime explicitly as deferred-to-10.1 in Completion Notes and `deferred-work.md`. Do not bolt in a one-off audio call.
- **Focus-gating** (must a module be camera-focused before accepting clicks?) was deliberately not implemented in 5.1 — clicks interact from any camera pose. 5.1's Completion Notes ask this story to revisit with real Wires: have Jay judge it during Task 7 and record the verdict; only implement gating if he asks for it.
- **Out of scope:** voice (Epic 3), optimistic pre-flash + rollback (4.7), bomb generation/seed-chain orchestration (8.2 — sandbox feeds a raw integer seed), timer (4.4/8.4), The Button/Passwords (5.4/5.5), `custom/` dirs (V2).

### Copy the template — do not redesign it

Story 5.1 built `dev-demo` explicitly as the exemplar this story copies. The fastest correct path is: replicate `packages/shared/src/modules/dev-demo/` and `apps/client/src/modules/dev-demo/` file-for-file with Wires content, then add **exactly three integration lines**: client barrel import + `SANDBOX_MODULES` entry (`apps/client/src/modules/index.ts`) and the `MODULE_REDUCERS` entry (`apps/server/src/reducers/MODULE_REDUCERS.ts`). Settled patterns you inherit for free — registration as import-time side effect (HMR/StrictMode-safe), the single documented type-erasure cast at registry boundaries, `isXxxAction` runtime guards, `.js` extensions on shared relative imports (NodeNext), transient-`'struck'` semantics, scoped zustand selectors in DefuserView.

### The GDD rule tables (authoritative — `solve.ts` implements these verbatim)

Serial-digit rules read the **last character** of `ctx.serialNumber` (always a digit). First matching rule wins, top to bottom. 1-based positions.

- **3 wires:** ① no red → cut 2nd ② last wire white → cut last ③ >1 blue → cut **last blue** ④ otherwise → cut last
- **4 wires:** ① >1 red AND serial-last-digit odd → cut **last red** ② last wire yellow AND no red → cut 1st ③ exactly one blue → cut 1st ④ >1 yellow → cut last ⑤ otherwise → cut 2nd
- **5 wires:** ① last wire black AND serial odd → cut 4th ② exactly one red AND >1 yellow → cut 1st ③ no black → cut 2nd ④ otherwise → cut 1st
- **6 wires:** ① no yellow AND serial odd → cut 3rd ② exactly one yellow AND >1 white → cut 4th ③ no red → cut last ④ otherwise → cut 4th

Every table ends in "otherwise", so **every generated config has exactly one solution** — no solvability constraint needed in `generate`. Conditional cuts ("last blue"/"last red") only fire when that colour exists, by their own preconditions.

### Existing code you build on — read before writing (all reviewed & done)

- `packages/shared/src/modules/dev-demo/*` — the shared-side template: types + runtime action guard, seeded generate, rule-driven solve shared with the manual, reducer with every contract obligation, structured `manual.ts`.
- `apps/client/src/modules/dev-demo/*` — the client-side template (IModule binding, registration side effect, data-driven R3F DefuserView with drei Text labels, re-export files).
- `apps/client/src/modules/interaction.ts` — `moduleClickHandlers` (wire cut = exactly this), `isPrimaryActivation`, `CLICK_DRAG_TOLERANCE_PX`. Post-review state: stopPropagation before button guard, `onPointerCancel` handled. Use as-is.
- `apps/client/src/modules/dispatch.ts` + `apps/client/src/sandbox/devDispatch.ts` — dispatch seam + dev backend reproducing `applyModuleResult`'s struck→armed roll-up. No changes.
- `apps/client/src/modules/index.ts` — registration barrel + `SANDBOX_MODULES`; `apps/client/src/sandbox/SandboxHarness.tsx` — picker/seed/inspector/reset, drives the real gameStore. Your module appears by adding the entry; the line-159 comment about production dispatch can gain "(resolved: Epic 8)".
- `apps/server/src/reducers/MODULE_REDUCERS.ts` — one new entry. `bombReducer.ts` — untouched (its output guard from 5.1 is your runtime backstop).
- `apps/client/src/manual/` — 5.2's finished viewer: `buildChapters` groups `ManualPage[]` by `chapterId`; `PageRenderer` renders `ManualTable` + tints colour words while the word stays the signal (your tables get the colorblind treatment in the viewer for free); `devManualFixtures.ts` is where the canonical wires chapter plugs in (Task 4).
- `packages/shared/src/types/module.ts` (`IModule`, `ModuleState`, `ManualPage/ManualSection/ManualTable`), `types/actions.ts` (`MODULE_ACTION`/`MODULE_RESET` forwarding), `types/bomb.ts` (`BombContext.serialNumber` last-char-digit guarantee, readonly). **No shared-type changes expected**; justify in Completion Notes if you believe one is needed.
- `packages/shared/src/seeding/` — `makeSeededRng(seed)` (mulberry32), the only approved RNG. Non-negative integer seeds.

### Visual spec (mockup `3. Defuser Bomb View.html`, the Wires module ~L158–170, 297–306)

Horizontal wire rows with end grommets; wire = rounded bar with the colour gradient; **left mono letter label per row** (`wire-lab`); cut wire = two stubs with angled clip and a gap. Reproduce this in R3F primitives (boxes/cylinders + drei Text) — the mockup is the look, not the tech. Colours pair with labels everywhere (DESIGN.md: "Don't use color alone for Wires … patterns/labels required — accessibility floor"). Letter K for black avoids the B collision with blue; document the lettering in the manual (Task 1) so both sides of the asymmetry share it. Solve confirmation = bay LED green (4.3) — the module face itself needs no extra solved chrome.

### Worktree & environment (sprint-1 retro + memory)

This story runs in worktree `.claude/worktrees/story-5-3` (branch `story-5-3`). Worktrees start without `node_modules` and without gitignored `.env` files — run `pnpm install` first; nothing in this story needs docker or env secrets (pure logic + vite dev). If you do touch docker, use a worktree-scoped compose project name and `--build`. Merge discipline: one story commit + review patches, merged to master as a unit (see git log pattern).

### Previous story intelligence (5.1, 5.2 — both reviewed → done 2026-06-12)

- **Red→green TDD is the house cadence:** write the shared wires suite first (it fails on missing module), then implement. Reviews verify gate claims — record real numbers.
- **Reviews sweep edge domains:** expect the reviewer to probe seed 0/large seeds, repeat actions after solve, reset-after-solve, NaN/out-of-bounds indices, and every rule-table boundary (exactly-one vs more-than-one colour counts; odd vs even serial). Test them preemptively — the 17 rule rows plus count boundaries are your sweep.
- **5.1 review patch lesson:** pointer-handler ordering and `pointercancel` were the only real defect — and they live in `interaction.ts`, already fixed. Don't fork that file.
- **5.2 lessons:** flex scrollers need `min-h-0` (already fixed in the viewer); manual tables render correctly with exactly the `headers`/`rows` shape the fixtures use — keep your `ManualTable` rows as 3 columns (`#`, condition, action) to match what `PageRenderer` is proven to render.
- **Honest smoke notes:** every prior story records smoke items individually; an unexecuted-smoke claim was once caught in review. Same standard here (Task 6/7).
- **Type narrowing recurs in review:** `status` is `ModuleState<unknown>['status']`; actions are discriminated unions; never widen to `string`.

### Project Structure Notes

- New (shared): `packages/shared/src/modules/wires/{types,generate,solve,reducer,manual,index}.ts` + `__tests__/wires.test.ts` (co-located, like dev-demo); barrel line in `packages/shared/src/modules/index.ts`.
- New (client): `apps/client/src/modules/wires/{index.ts,DefuserView.tsx,ManualPages.tsx,types.ts,generate.ts,solve.ts,reducer.ts}` + `__tests__/wiresBinding.test.ts`.
- Modified (keep surgical): `apps/client/src/modules/index.ts` (import + SANDBOX_MODULES entry), `apps/server/src/reducers/MODULE_REDUCERS.ts` (one entry), `apps/client/src/manual/devManualFixtures.ts` (wires chapter ← canonical), `apps/server/src/reducers/__tests__/moduleRegistration.test.ts` (wires presence), `_agent_docs/implementation-artifacts/deferred-work.md` (chime → 10.1 note).
- Untouched: `bombReducer.ts` dispatch logic, `interaction.ts`, `dispatch.ts`, `registry.ts`, `gameStore`/`uiStore`, `manual/` viewer components, `net/`, scenes/camera/chassis, server handlers, shared `events/`, Docker. Naming: id `"wires"`, `WiresState`/`WiresAction`, kebab-case dirs.

### Project Context Rules (from `_agent_docs/project-context.md` — binding)

- `generate(seed, bombCtx)` is the only place randomness is allowed; never `Math.random()`; never mutate `BombContext` (readonly).
- Reducers: pure, zero socket.io/ioredis/pg/fastify imports; immutable returns (spread/map); unknown actions fall through unchanged; no `Date.now()`/`setTimeout` in reducers or their tests.
- `MODULE_REDUCERS` registration — bomb reducer never changes per-module (open/closed). `getManualPages()` returns structured data, never HTML/untyped JSX.
- R3F: data-driven geometry from generate output; rendering-only components ("if a component requires a logic test, the logic has leaked"); `useFrame`+`getState()` for per-frame work (this module likely needs none — wires are static between snapshots); no per-frame allocations.
- Testing: pure logic unit-tested with zero infra; **never skip the frozen-state immutability test**; never mock the reducer.
- Build: `tsc --noEmit` 0 errors, no `@ts-ignore`, TypeScript only, per-workspace tsconfigs untouched, no new dependencies (verified: everything needed is in-repo — no web research required; stack pinned at three 0.184/fiber 8.18/drei 9.122/React 18.3, never upgrade to fiber 9/drei 10).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 5.3 + Epic 5 preamble] (ACs verbatim; walking-skeleton intent; FR21, AR4/AR5, NFR11, UX-DR8/UX-DR14)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Module 1: Wires (~L171–199)] (authoritative rule tables; wire colours; edge widget definitions)
- [Source: _agent_docs/game-architecture.md#Pattern 3 — IModule Plugin Contract + ADR-003/ADR-004 + Consistency Rules] (open/closed registry; per-module file contract; naming; deterministic generation)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/3. Defuser Bomb View.html ~L158–170, 297–306] (wire visual spec: rows, grommets, letter labels, cut stubs)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md ~L240 + EXPERIENCE.md ~L74, 94, 106, 153, 194–204] (colorblind floor for Wires; click primitive; solve LED+chime spec; the Maya/Devon Wires walkthrough — the experience this story creates)
- [Source: _agent_docs/project-context.md] (full binding rule set)
- [Source: _agent_docs/implementation-artifacts/5-1-module-plugin-scaffold-sandbox-and-click-primitive.md#Completion Notes + Review Findings] (template handoff "For Story 5.3"; type-erasure pattern; focus-gating revisit; interaction.ts patch)
- [Source: _agent_docs/implementation-artifacts/5-2-expert-manual-viewer.md#Completion Notes] (viewer/PageRenderer capabilities; fixture-replacement handoff; colour-word tinting)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (4.3 LED transient-struck contract; 1.6 output guard now active; no wires-relevant open items)
- [Source: packages/shared/src/types/{module,actions,bomb}.ts + packages/shared/src/seeding/] (contract types; serialNumber digit guarantee; makeSeededRng)
- [Source: apps/client/src/modules/{interaction.ts,dispatch.ts,index.ts} + apps/client/src/sandbox/* + apps/client/src/manual/*] (surfaces this story plugs into)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD: `packages/shared/src/modules/wires/__tests__/wires.test.ts` written first and confirmed failing (modules absent), then implemented → green. One test expectation corrected during green (the manual has FIVE tables — 4 rule tables + the colour-label table; the test now distinguishes rule tables by their `#` header).
- Worktree provisioned with `pnpm install` (known worktree gap, sprint-1 retro). No docker, no env needed for this story's surface.
- Baseline captured on merged master (ab52d52) before implementation: shared 53 / client 143 / server 169, tsc 0 errors.
- Gates (final state): `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm -r test` → shared 95 ✓ (53 baseline + 42 new), client 146 ✓ (143 baseline + 3 new), server 170 ✓ (169 baseline + 1 new); `pnpm --filter @bomb-squad/client build` green (pre-existing three.js chunk-size note only).
- Headless smoke (playwright-core chromium + SwiftShader against `vite dev --port 5199`, 1920×1080, screenshots in `/tmp/pw-smoke/shots-5-3/`, inspected): 10/10 PASS — see Completion Notes. Lone console 404 verified to be the pre-existing `/favicon.ico` noise (the vendored mono font for wire labels loads 200).
- One visual defect caught by screenshot inspection and fixed: severed-wire stubs rendered near-vertical (cylinder axis is Y; the stubs needed the π/2 base rotation ± droop that the intact wire already had). Re-ran smoke after the fix — all green, severed wires now read as two drooping halves with a gap.

### Completion Notes List

- **Task 1 — shared pure logic (`packages/shared/src/modules/wires/`):** `types.ts` (WiresState/WiresAction, `WIRE_COLORS` five-colour domain, `WIRE_COLOR_LABELS` R/W/B/Y/K, `isWiresAction` runtime guard), `generate.ts` (makeSeededRng only; seeded count 3–6 + seeded colours; solutionIndex derived via solveWires — every layout is solvable because every table ends in Otherwise), `solve.ts` (all 17 GDD rules as ordered `WiresRule` data: predicate + 0-based cut + the exact conditionText/actionText the manual renders), `reducer.ts` (every contract obligation: guards incl. NaN/fractional index, idempotent repeat-cut, transient 'struck' with the severed wire persisting, solved-inert, MODULE_RESET restoring cuts only), `manual.ts` (chapter built FROM `WIRES_RULES` + the colour-label table). 42 jest tests.
- **Design note (follows the dev-demo precedent):** `solutionIndex` is baked into `WiresState` at generate time because the reducer signature has no `BombContext`. Not an answer leak in substance — the manual rules are public, so the answer is always derivable from the visible colours + serial — but it does ride in module `data` that will reach clients via MODULE_UPDATE in Epic 8; flagged for the 8.x snapshot design to decide whether client-bound payloads should strip solution fields.
- **Task 2 — GDD fidelity:** every rule row verified against gdd.md #Module 1: Wires; fixture/mockup tables matched the GDD (no divergence found). One test per rule row (17) plus serial-parity contrast tests for 4①/5①/6① proving the odd-digit conditions fall through correctly on even serials.
- **Task 3 — client module dir (`apps/client/src/modules/wires/`):** dev-demo template copied file-for-file. `DefuserView.tsx` is fully data-driven (row count/spacing from `data.wires`, mono letter label per row via drei Text + vendored font, mockup-style grommets, severed stubs with gap); cut = `moduleClickHandlers` → `dispatchModuleAction({type:'CUT', wireIndex})`; zero keyboard, zero game logic. Integration = exactly the three sanctioned lines: barrel import + SANDBOX_MODULES entry, MODULE_REDUCERS entry. **bombReducer.ts untouched.**
- **Task 4 — canonical manual:** `devManualFixtures.ts` wires chapter replaced with `...getWiresManualPages()` (header comment updated; dead RULE_HEADERS constant removed). Verified in /dev/manual: paper sheet renders all four rule tables + the Confirming-colours label table, colour-word tinting active with the word as the signal.
- **Tasks 5/6 — sandbox proof + smoke (10/10, screenshots inspected):** (a) wires generates from seed (seed 1 → 5 wires R/B/K/K/W, solutionIndex 0 — manually re-derived per GDD: black present, rules 1–3 fail → otherwise → cut the 1st ✓); (b) same seed byte-identical, different seed differs; (c) correct cut → status solved, bomb.solved true, no extra strike; (d) wrong cut → strike 1, wire severed, module re-armed (transient-struck roll-up); (e) repeat cut on severed wire is a no-op; (f) reset restores all wires uncut + armed; (g) drag-orbit across a wire is not a cut; (h) /dev/manual renders the canonical chapter; (i) keyboard does nothing to the module. NOTE: the sandbox mounts the DefuserView without ModuleBay, so "LED green" is confirmed as `status: 'solved'` through the real gameStore — the LED itself is 4.3's generically-proven rendering of that status.
- **Scope resolutions (recorded in deferred-work.md):** solve chime → Story 10.1 (no audio infra; module-typed pitches are audio design); production MODULE_INTERACT backend → Epic 8 (no server bomb lifecycle exists yet) — `dispatch.ts`'s "5.3 / Epic 8" ambiguity resolved, SandboxHarness footer comment updated.
- **AC6 — human verification (Jay, 2026-06-13):** confirmed — interactively exercised Wires in `/dev/sandbox` against the canonical manual in `/dev/manual`; behaviour as documented. Focus-gating (open question from 5.1): no change requested — clicks-from-any-camera-pose stands; revisit only if a future playtest demands it.
- **For Story 5.4 (Button):** the wires dir confirms the dev-demo template scales to a real module with zero friction; the rule-data-shared-by-solver-and-manual pattern (`WiresRule[]`) is recommended for the Button's press/hold decision table too.

### File List

New (shared):
- packages/shared/src/modules/wires/types.ts
- packages/shared/src/modules/wires/generate.ts
- packages/shared/src/modules/wires/solve.ts
- packages/shared/src/modules/wires/reducer.ts
- packages/shared/src/modules/wires/manual.ts
- packages/shared/src/modules/wires/index.ts
- packages/shared/src/modules/wires/__tests__/wires.test.ts

New (client):
- apps/client/src/modules/wires/index.ts
- apps/client/src/modules/wires/DefuserView.tsx
- apps/client/src/modules/wires/ManualPages.tsx
- apps/client/src/modules/wires/types.ts
- apps/client/src/modules/wires/generate.ts
- apps/client/src/modules/wires/solve.ts
- apps/client/src/modules/wires/reducer.ts
- apps/client/src/modules/__tests__/wiresBinding.test.ts

Modified:
- packages/shared/src/modules/index.ts (wires barrel line)
- apps/client/src/modules/index.ts (wires import + SANDBOX_MODULES entry + export)
- apps/server/src/reducers/MODULE_REDUCERS.ts (wires entry)
- apps/server/src/reducers/__tests__/moduleRegistration.test.ts (wires registration + solve/strike-through-bombReducer test)
- apps/client/src/manual/devManualFixtures.ts (wires chapter ← canonical getWiresManualPages(); header comment; dead constant removed)
- apps/client/src/sandbox/SandboxHarness.tsx (footer comment: dispatch resolution → Epic 8)
- _agent_docs/implementation-artifacts/deferred-work.md (solve-chime → 10.1; MODULE_INTERACT → Epic 8)
- _agent_docs/implementation-artifacts/sprint-status.yaml (story status tracking)

### Review Findings

_Code review 2026-06-13 (gds-code-review, 3 adversarial layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). Edge Hunter: zero defects. Auditor: all 6 ACs PASS, no GDD rule-table divergence. 7 Blind-Hunter findings dismissed as noise (transient-struck contract, mulberry32 [0,1) range, Number.isInteger guard, CUT-only idempotency, BombContext digit guarantee, idiomatic re-export, satisfied table count)._

- [x] [Review][Defer] `solutionIndex` baked into transmitted module state — `WiresState.solutionIndex` is computed at generate time (`packages/shared/src/modules/wires/{generate,types}.ts`); it must be stripped before bomb state crosses to clients (anti-cheat in an information-asymmetry game). Verified absent from all in-flight Epic 8 worktrees (8-2, 8-3-8-4) — none broadcasts bomb state yet (8.3 leaves the `BOMB_INIT` emit as an unfilled seam at `sessionHandlers.ts:678-680`). **Deferred — owner: whoever fills the `BOMB_INIT` broadcast seam (8.2↔8.3 merge wiring) must add a solution-stripping client-safe projection; the future `MODULE_UPDATE` handler reuses it.** Recorded in `deferred-work.md` under "code review of story 5-3".
- [x] [Review][Patch] DefuserView selector factory allocates a new closure per render [apps/client/src/modules/wires/DefuserView.tsx] — **FIXED 2026-06-13:** selector now memoized via `useMemo(() => selectWiresData(moduleIndex), [moduleIndex])`, so the reference is stable across renders and zustand only re-subscribes when `moduleIndex` changes; comment aligned. `tsc --noEmit` clean.

## Change Log

- 2026-06-13: Story created (ultimate context engine analysis completed — comprehensive developer guide created). Status: ready-for-dev.
- 2026-06-13: Story 5.3 implemented (claude-fable-5) — Wires module: shared pure logic (seeded 3–6 wire generation, all 17 GDD rules as shared rule data consumed by both solver and manual, contract-complete reducer), client module dir on the dev-demo template (data-driven R3F wires with R/W/B/Y/K letter labels, click-to-cut via the 5.1 primitive), wires registered in MODULE_REDUCERS + sandbox (bombReducer untouched), canonical manual content wired into /dev/manual. Gates green (tsc 0; shared 95 / client 146 / server 170; build); headless smoke 10/10 with screenshot inspection. Solve chime deferred to 10.1; MODULE_INTERACT backend resolved to Epic 8. Status: review (awaiting code review + Jay's AC6 interactive verification).
