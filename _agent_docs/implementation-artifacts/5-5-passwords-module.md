---
baseline_commit: cbb2517
---

# Story 5.5: Passwords Module

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want to defuse the Passwords module,
So that we solve a verbal/language module by cycling letters to a valid word.

## Acceptance Criteria

1. **Seeded generation with a unique solution:** **Given** a generated Passwords module, **when** `generate(seed, ctx)` runs, **then** the five letter columns are seeded such that **exactly one** combination (one letter per column) spells a word from the 35-word valid list — and no other listed word is reachable from the columns.
2. **SUBMIT validates against the list:** **Given** the columns cycled to a valid word, **when** SUBMIT is pressed, **then** the module solves; SUBMIT on a non-listed word records a strike.
3. **Reducer test suite:** **Given** the reducer test suite, **when** it runs, **then** it covers happy-path, wrong-interaction, idempotency, immutability (frozen input), guard clauses, and reset.
4. **Human verification:** Jay exercises Passwords interactively in `/dev/sandbox` (cycle the columns to the valid word and SUBMIT → solve; SUBMIT a non-word → strike) and his observed results are recorded in Completion Notes before the story is marked done.

## Tasks / Subtasks

- [x] Task 1 — Shared pure logic: `packages/shared/src/modules/passwords/` (AC: 1, 2)
  - [x] Copy the **wires/the-button** directory shape: `types.ts`, `generate.ts`, `solve.ts`, `reducer.ts`, `manual.ts`, `index.ts`, `__tests__/`. Barrel-export from `packages/shared/src/modules/index.ts`; confirm it reaches `packages/shared/src/index.ts`. Module id = `'passwords'` (already reserved in `MODULE_IDS`).
  - [x] `types.ts`: `PASSWORDS_MODULE_ID = 'passwords'`; the canonical **35-word list** `PASSWORD_WORDS` (5-letter, lowercase, `as const`); `COLUMN_COUNT = 5`, `LETTERS_PER_COLUMN = 6`. `PasswordsState { columns: ReadonlyArray<ReadonlyArray<string>>; positions: ReadonlyArray<number> }` — `columns[i]` is that column's 6 cycleable letters; `positions[i]` is the currently-shown index into `columns[i]`. `PasswordsAction = { type: 'CYCLE'; columnIndex: number; direction: 'up' | 'down' } | { type: 'SUBMIT' }`; `PasswordsReset = { type: 'MODULE_RESET' }`; `isPasswordsAction` runtime guard (actions arrive as `unknown`).
  - [x] **No stored answer (wires/the-button AI1 pattern):** do NOT store the target word. The "answer" is public — it is whichever listed word the columns can spell, and generation guarantees exactly one. SUBMIT validates the *currently-shown* word against `PASSWORD_WORDS` membership; nothing secret rides in state.
  - [x] `generate.ts`: all randomness via `makeSeededRng(seed)` (no `Math.random()`). Algorithm: pick a target word from `PASSWORD_WORDS` (seeded); for each column place the target's letter at a seeded random position, fill the other 5 slots with seeded random letters; set each `positions[i]` to a seeded random start index (NOT necessarily the solution — the Defuser must cycle). **Solvability constraint (AC1 — the real risk):** after filling, verify with `countSpellableWords(columns)` (see solve.ts) that **exactly one** of the 35 words is spellable from the columns; if not (a filler accidentally enabled a second word, or duplicate letters), reject and re-roll the fillers from the same seeded stream until unique. Deterministic given the seed. CPU-cheap (35 words × 5 columns × 6 letters).
  - [x] `solve.ts`: `currentWord(state): string` = `positions.map((p, i) => columns[i][p]).join('')`. `isValidPassword(word): boolean` = `PASSWORD_WORDS.includes(word)`. `countSpellableWords(columns): number` = how many of `PASSWORD_WORDS` have, for every position, their letter present in that column (the generation uniqueness check). All pure; the 35-word list is the single source shared by solver, generator, and manual.
  - [x] `reducer.ts`: pure `Reducer<ModuleState<PasswordsState>, unknown>`. `CYCLE` → advance `positions[columnIndex]` by ±1 modulo `LETTERS_PER_COLUMN` (non-negative modulo); bounds/guard `columnIndex` and `direction`. `SUBMIT` → `isValidPassword(currentWord(state))` ? `status: 'solved'` : `status: 'struck'` (transient — bombReducer rolls it into a team strike and re-arms; the columns/positions are unchanged on a strike so the team can keep cycling). Contract obligations (copy from wires): unknown/malformed action → unchanged (no throw); out-of-bounds/NaN `columnIndex` → unchanged; solved-inert (post-solve actions no-op); `MODULE_RESET` → `positions` restored to the generated start (store the generated start so reset is faithful) **or** simply re-arm without moving columns — pick one and document it; status armed. Never `Date.now()`/`Math.random()` in the reducer.
  - [x] `manual.ts`: `getPasswordsManualPages(): ManualPage[]` — one `passwords` chapter: short intro ("cycle each column; the five visible letters must spell one of these words; press SUBMIT") + a `ManualTable` (or sectioned list) of all 35 `PASSWORD_WORDS`, rendered from the same constant the solver uses. Structured data only — no HTML/JSX.
- [x] Task 2 — Word-list fidelity (AC: 1, 2)
  - [x] Use the canonical KTANE Passwords 35-word list (5-letter words). Source the list once in `types.ts`; the generator, solver, and manual all read it. Write a test asserting `PASSWORD_WORDS.length === 35`, all entries are 5 lowercase letters, and the set is unique.
  - [x] **Uniqueness is the correctness crux:** write tests that sweep many seeds and assert `countSpellableWords(generate(seed).columns) === 1` for every seed (AC1). This is the property most likely to have a generation bug.
- [x] Task 3 — Client module directory: `apps/client/src/modules/passwords/` (AC: 1, 2)
  - [x] Copy the wires/the-button client dir: `index.ts` (IModule binding + import-time `registerModuleRenderer`), `DefuserView.tsx`, `ManualPages.tsx` (minimal typed render of `getPasswordsManualPages()`), re-export `types/generate/solve/reducer` from `@bomb-squad/shared`, `__tests__/`.
  - [x] `DefuserView.tsx` (R3F, rendering only, zero game logic): five columns, each showing its current letter (drei `Text` + vendored mono font) with an **up** and a **down** affordance; plus a SUBMIT affordance. Fully data-driven from `data.columns`/`data.positions` (never hardcode 5 columns in JSX — map over them). Memoized scoped zustand selector on `moduleIndex` (the 5.3 review pattern; the-button's `selectButtonData` is the template).
  - [x] Interaction: each up/down/SUBMIT is a single click via the existing `moduleClickHandlers` from `apps/client/src/modules/interaction.ts` (left-button only, drag-tolerant, stopPropagation — do NOT reimplement). Up → `{ type: 'CYCLE', columnIndex, direction: 'up' }`, down → `'down'`, SUBMIT → `{ type: 'SUBMIT' }`, all via `dispatchModuleAction`. No keyboard listeners (UX-DR13). No timer dependency (unlike the-button) — Passwords is pure cycle + submit.
  - [x] Registration: one import + one `SANDBOX_MODULES` entry in `apps/client/src/modules/index.ts`; one `passwords` entry in `apps/server/src/reducers/MODULE_REDUCERS.ts`. **Zero diff to `bombReducer.ts`.**
- [x] Task 4 — Generator + tier-pool registration (AC: 1) — **the shared-registry merge surface; reconcile with 5.4 (already merged in this worktree)**
  - [x] Add `passwords` to `MODULE_GENERATORS` (import `generatePasswords` directly from its file, not the barrel — the registry convention) and to `TIER_POOLS`. 5.4 already widened the pools to `['wires', 'the-button']`; **append `'passwords'`** → `['wires', 'the-button', 'passwords']` for all three tiers. Per `module-registry-two-registries-and-tier-pools`, a pool entry needs both a generator AND a reducer registered or `generateLayout` throws at ROUND_START — land all three (generator, reducer, pool) in the same commit.
  - [x] This completes the canonical **Easy** pool (Wires/Button/Passwords). The authoritative tier GATING surfaced in the dashboard is still **Story 8.1**'s job (the registry comment already hands it off there); these defaults feed it.
- [x] Task 5 — Canonical manual content into the 5.2 viewer (AC: 2)
  - [x] Replace the `passwords` stub in `apps/client/src/manual/devManualFixtures.ts` with `...getPasswordsManualPages()` (the same pattern 5.3/5.4 used). Verify in `/dev/manual` that the 35-word list renders through `PageRenderer` and matches `PASSWORD_WORDS`.
- [x] Task 6 — Sandbox proof of the loop (AC: 1, 2)
  - [x] Passwords appears in the `/dev/sandbox` picker; Generate from a seed renders five columns; same seed → identical, different seed → different.
  - [x] Cycle each column (up/down) until the five letters spell the listed word; SUBMIT → solve LED green. Cycle to a non-listed combination; SUBMIT → strike pulse + re-arm, columns unchanged (can keep trying). Repeat SUBMIT after solve is a no-op; Reset restores the generated start. **No clock needed** — unlike the-button, Passwords has no timer dependency, so the sandbox's existing chrome suffices.
- [x] Task 7 — Tests + gates (AC: 3, and all)
  - [x] Shared (jest, `packages/shared/src/modules/passwords/__tests__/`): `generate` determinism (same seed deep-equal twice; two seeds differ; sweep seed 0/1/large); **uniqueness sweep** (`countSpellableWords === 1` across many seeds — AC1); word-list integrity (35, 5-letter, lowercase, unique); `currentWord`/`isValidPassword`/`countSpellableWords` units; full reducer suite: happy (cycle to the word + SUBMIT solves), wrong (SUBMIT a non-word strikes, columns unchanged), idempotent (repeat SUBMIT after solve; CYCLE wraps modulo), **immutability (frozen state input — never skip)**, guards (out-of-bounds/NaN `columnIndex`, bad `direction`, unknown action), `MODULE_RESET`, solved-inert.
  - [x] One shared test asserting `getPasswordsManualPages()` lists exactly `PASSWORD_WORDS` (manual ↔ solver share the constant — divergence impossible, assert it anyway).
  - [x] Client (vitest): registry/binding test for `passwords` mirroring `theButtonBinding.test.ts`. Server (jest): extend `moduleRegistration.test.ts` for the `passwords` entry (solve + strike through the untouched bomb reducer — the injection rig exists).
  - [x] Gates: record the merged baseline first (`pnpm -r test` — this worktree already includes 5.4, so baseline ≈ shared 170 / server 376 / client 272; treat what you measure as the floor), then `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm -r test` green, no regressions; `pnpm --filter @bomb-squad/client build` green.
  - [x] Headless/runtime smoke (the SwiftShader screenshot rig was not committed — at minimum run the 5.4 liveness smoke: `vite dev` boots, `/dev/sandbox` serves 200, `passwords` resolves in the module graph; build transforms cleanly). Record honestly what was and wasn't run; full visual confirmation folds into Task 8.
- [x] Task 8 — Human verification (AC: 4)
  - [x] **Jay verifies interactively:** in `/dev/sandbox`, generate Passwords from a couple of seeds, read the valid words in `/dev/manual`, cycle the columns to the one reachable word and SUBMIT → solve; cycle to a non-word and SUBMIT → strike + recovery; confirm letters are legible at normal zoom. Record his observed results item-by-item in Completion Notes — story is not done without this.

## Dev Notes

### Scope decisions (read first)

- **This story = the Passwords module + canonical manual content, proven in the sandbox and `/dev/manual`** — the same envelope as 5.3/5.4. The production `MODULE_INTERACT` server handler is still **Epic 8** (5.3 resolved that; the sandbox's local backend is the sanctioned dev path). Leave the dispatch seam as is.
- **No timer, no colour.** Passwords is the simplest of the three Easy modules mechanically: pure cycle + submit, validated against a public word list. There is no live-timer dependency (unlike the-button) and no colorblind-floor concern (it's letters). Don't over-build it.
- **The whole difficulty is generation uniqueness (AC1).** A naive fill can accidentally make a second listed word spellable (shared letters across the 35 words are common). The generator MUST verify `countSpellableWords === 1` and re-roll fillers (deterministically, from the seeded stream) until unique. Test this hard — it's the one place a subtle bug hides.
- **No stored answer (anti-cheat, wires AI1):** the target word is never stored in state; SUBMIT recomputes the shown word and checks list membership. The 35-word list is public manual content, so nothing secret crosses to the client.
- **Solve chime** = Story 10.1 (deferred for wires/the-button too). Ship the LED-green visual; note chime as deferred-to-10.1 if you touch `deferred-work.md`.
- **Out of scope:** the-button (5.4 — already merged in this worktree), Preparation placeholder view (4.6), round config/difficulty gating (8.1 — owns authoritative tier gating), voice, optimistic pre-flash (4.7).

### Copy the template — do not redesign it

Wires (5.3) and The Button (5.4) are the proven real-module templates in this exact worktree. Copy the directory shape file-for-file with Passwords content, then add **exactly the sanctioned integration lines**: client barrel import + `SANDBOX_MODULES` entry, `MODULE_REDUCERS` entry, `MODULE_GENERATORS` + `TIER_POOLS` entries, and the `/dev/manual` fixture swap. Settled patterns inherited for free: import-time registration side effect, the single documented type-erasure cast at registry boundaries, `isXxxAction` runtime guards, `.js` extensions on shared relative imports (NodeNext), transient-`'struck'` semantics, **memoized** scoped zustand selectors in DefuserView, rule/data-shared-by-solver-and-manual.

### The 35-word valid list (authoritative — canonical KTANE Passwords)

```
about after again below could every first found great house
large learn never other place plant point right small sound
spell still study their there these thing think three water
where which world would write
```

Store lowercase in `PASSWORD_WORDS` (35 entries, 5 letters each). The generator picks the target from this list; the solver checks membership against it; the manual renders it. One constant, three consumers.

### Existing code you build on — read before writing

- `packages/shared/src/modules/the-button/*` and `.../wires/*` — the shared-side templates (types + runtime guard, seeded generate with a solvability/answer property, pure solve sharing data with the manual, contract-complete reducer, structured manual). Read both; Passwords is closest to wires in shape (single discrete interaction set, no timer).
- `apps/client/src/modules/the-button/*` and `.../wires/*` — the client-side templates (IModule binding, registration side effect, data-driven R3F DefuserView with drei `Text`, memoized selector, re-export files).
- `apps/client/src/modules/interaction.ts` — `moduleClickHandlers` (each cycle button + SUBMIT is exactly this), `isPrimaryActivation`, `CLICK_DRAG_TOLERANCE_PX`. Use as-is; do NOT fork.
- `packages/shared/src/modules/registry.ts` — `MODULE_GENERATORS`, `MODULE_IDS` (`'passwords'` reserved), `TIER_POOLS` (currently `['wires','the-button']` after 5.4 — append `'passwords'`). `apps/server/src/reducers/MODULE_REDUCERS.ts` — one new entry. `bombReducer.ts` untouched.
- `packages/shared/src/seeding/` — `makeSeededRng(seed)` (mulberry32), the only approved RNG. Non-negative integer seeds.
- `apps/client/src/manual/devManualFixtures.ts` — replace the `passwords` stub (Task 5). 5.4 already swapped Wires + The Button to canonical; follow the same `...getXManualPages()` spread.
- `packages/shared/src/types/{module,actions,bomb}.ts` — `IModule`, `ModuleState`, `ManualPage/Section/Table`, `MODULE_RESET` forwarding. **No shared-type change expected** beyond the new module's own `types.ts`; justify in Completion Notes if you believe one is needed.

### Merge surface (sibling of 5.4 in this worktree)

5.4 (committed `cbb2517`) already edited the shared-registry files. 5.5 appends to the same lines — land it as a **second commit on `worktree-s4-modules`** and reconcile additively (these are append-only maps/arrays, so conflicts are trivial):
- `packages/shared/src/modules/index.ts` (barrel) — add the `passwords` export line.
- `packages/shared/src/modules/registry.ts` — `MODULE_GENERATORS` + `TIER_POOLS` (append `'passwords'`).
- `apps/server/src/reducers/MODULE_REDUCERS.ts` — add the `passwords` entry.
- `apps/client/src/modules/index.ts` — add the import + `SANDBOX_MODULES` entry + export.
- `apps/client/src/manual/devManualFixtures.ts` — replace the `passwords` stub with canonical.
- `apps/server/src/reducers/__tests__/moduleRegistration.test.ts` — add a `passwords` registration case.

### Previous story intelligence (5.4 — The Button, status review)

- **Recompute-at-interaction, never store the answer** (wires AI1): 5.4 carried the public `ctx` and recomputed the decision; Passwords carries no secret either — SUBMIT checks the public word list. Keep it that way (5.3 review flagged stored answers as a transmitted-state cheat).
- **Memoized scoped selectors** in DefuserView (`useMemo(() => selectX(moduleIndex), [moduleIndex])`) — the 5.3 review patch; 5.4 followed it. Do the same.
- **`'struck'` is transient** — return it on a wrong SUBMIT; the bombReducer rolls it into a team strike and re-arms. Don't mutate columns on a strike (the team keeps their cycled positions to retry).
- **Tier-pool / unregistered-id tests:** 5.4 had to update three existing tests that hard-coded the interim pool or used the now-registered id as an "unregistered" example. Registering `passwords` may trip the same kind of assertion — if a test uses `'passwords'` as its example *unregistered* id, switch it to a still-unregistered id (e.g. `'simon-says'`). Grep for `'passwords'` in `__tests__` before finalizing.
- **Honest smoke notes:** record each smoke item individually; the SwiftShader screenshot rig is not in this worktree, so the runtime liveness smoke + Jay's interactive check are the confidence steps (don't claim an unexecuted visual smoke).
- **Red→green TDD is the house cadence:** write the shared Passwords suite first (it fails on the missing module), then implement. Reviews verify gate numbers — record real ones.

### Project Structure Notes

- New (shared): `packages/shared/src/modules/passwords/{types,generate,solve,reducer,manual,index}.ts` + `__tests__/passwords.test.ts`; barrel line in `packages/shared/src/modules/index.ts`.
- New (client): `apps/client/src/modules/passwords/{index.ts,DefuserView.tsx,ManualPages.tsx,types.ts,generate.ts,solve.ts,reducer.ts}` + `apps/client/src/modules/__tests__/passwordsBinding.test.ts`.
- Modified (surgical): `packages/shared/src/modules/{index.ts,registry.ts}`, `apps/server/src/reducers/MODULE_REDUCERS.ts`, `apps/server/src/reducers/__tests__/moduleRegistration.test.ts`, `apps/client/src/modules/index.ts`, `apps/client/src/manual/devManualFixtures.ts`. (No `SandboxHarness.tsx` change — Passwords needs no clock, unlike 5.4.)
- Untouched: `bombReducer.ts` dispatch logic, `interaction.ts`, `dispatch.ts`, client `registry.ts`, `gameStore`/`uiStore`, manual viewer components, `net/`, scenes/camera/chassis, server handlers, shared `events/`, Docker. Naming: id `"passwords"`, `PasswordsState`/`PasswordsAction`, kebab-case dir.

### Project Context Rules (from `_agent_docs/project-context.md` — binding)

- `generate(seed, bombCtx)` is the only place randomness is allowed; never `Math.random()`; never mutate `BombContext` (readonly).
- Reducers: pure, zero socket.io/ioredis/pg/fastify imports; immutable returns (spread/map); unknown actions fall through unchanged; no `Date.now()`/`setTimeout` in reducers or their tests.
- `MODULE_REDUCERS`/`MODULE_GENERATORS` registration — bomb reducer/assembly never change per-module (open/closed). `getManualPages()` returns structured data, never HTML/untyped JSX.
- R3F: data-driven geometry from generate output; rendering-only components ("if a component requires a logic test, the logic has leaked"); no per-frame allocations (Passwords is static between snapshots — likely no `useFrame` at all).
- Testing: pure logic unit-tested with zero infra; **never skip the frozen-state immutability test**; never mock the reducer; security — untrusted client input, bounds-check `columnIndex`/`direction` server-side.
- Build: `tsc --noEmit` 0 errors, no `@ts-ignore`, TypeScript only, no new dependencies (everything needed is in-repo; stack pinned at three 0.184 / fiber 8.18 / drei 9.122 / React 18.3 — never upgrade).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 5.5 (~L915–933) + Epic 5 preamble] (ACs verbatim; FR23; AR4/AR5, NFR11, UX-DR8/UX-DR14)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Module 5: Passwords (if present) + the canonical KTANE 35-word list] (verbal/language module; cycle-to-word mechanic)
- [Source: _agent_docs/implementation-artifacts/5-4-the-button-module.md] (sibling template in this worktree; recompute-no-stored-answer; memoized selector; tier-pool/unregistered-id test gotcha; merge surface)
- [Source: _agent_docs/implementation-artifacts/5-3-wires-module-walking-skeleton.md] (the real-module template; rule/data-shared-by-solver+manual; transient-struck; solvability-by-construction)
- [Source: apps/client/src/modules/interaction.ts] (`moduleClickHandlers` — each cycle/submit is a single click)
- [Source: packages/shared/src/modules/registry.ts] (`MODULE_GENERATORS`, `MODULE_IDS`, `TIER_POOLS` now `['wires','the-button']`) + [memory: module-registry-two-registries-and-tier-pools]
- [Source: _agent_docs/implementation-artifacts/Sprint 4 — Easy modules + round framing parallelization analysis.md] (worktree plan; 5.5 is the second module in worktree A; TIER_POOLS reconcile handed to 8.1)
- [Source: _agent_docs/project-context.md] (full binding rule set)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- `pnpm --filter @bomb-squad/shared test` → 8 suites, 201 passed (incl. new `passwords.test.ts`).
- `pnpm --filter @bomb-squad/server test` → 26 suites, 377 passed (incl. new passwords registration case).
- `pnpm --filter @bomb-squad/client test` → 35 files, 275 passed (incl. new `passwordsBinding.test.ts`).
- `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`).
- `pnpm --filter @bomb-squad/client build` → green (758 modules transformed, incl. passwords).
- Runtime liveness smoke: `vite dev` boots; `GET /dev/sandbox` → 200; `/src/modules/passwords/index.ts` resolves in the module graph; no vite errors.

### Completion Notes List

**Implemented (AC1–AC3):**

- **Shared pure logic** (`packages/shared/src/modules/passwords/`): `types.ts` (PASSWORDS_MODULE_ID, the canonical 35-word `PASSWORD_WORDS`, `COLUMN_COUNT=5`/`LETTERS_PER_COLUMN=6`, `PasswordsState`/`PasswordsAction`/`PasswordsReset`, `isPasswordsAction` guard); `solve.ts` (`currentWord`, `isValidPassword`, `countSpellableWords`); `generate.ts` (seeded target pick + per-column placement, re-roll fillers until `countSpellableWords === 1` — AC1); `reducer.ts` (CYCLE ±1 non-negative modulo with bounds/NaN guards, SUBMIT validates the shown word, transient `'struck'` leaves columns intact, solved-inert, MODULE_RESET restores `startPositions`); `manual.ts` (single chapter, 35-word table from the same constant).
- **No stored answer (wires AI1):** the target word is never persisted — `PasswordsState` carries only `columns`/`positions`/`startPositions`. SUBMIT recomputes the visible word and checks public list membership. `startPositions` is added (beyond the story's minimal `PasswordsState` sketch) solely so MODULE_RESET is faithful; it is not the answer (it is a random non-solution start) — justified per the Dev Notes "store the generated start so reset is faithful" subtask.
- **MODULE_RESET decision:** restores `positions` to the generated `startPositions` (the faithful-reset option, not the "leave columns" option) — documented in `reducer.ts`.
- **generate signature:** `generatePasswords(seed)` takes no `ctx` (Passwords has no bomb-context rule); it remains assignable to `ModuleGenerator`/`IModule.generate` (fewer params is legal) and is registered via the direct-from-file import convention.
- **Client module dir** (`apps/client/src/modules/passwords/`): re-export `types/generate/solve/reducer`; `DefuserView.tsx` (R3F rendering-only, five columns mapped from `data.columns` — never hardcoded — each with up/▲ + down/▼ + a SUBMIT control, all single-click via `moduleClickHandlers`, memoized scoped selector on `moduleIndex`); `ManualPages.tsx`; `index.ts` (IModule binding + import-time `registerModuleRenderer`).
- **Integration (additive merge surface over 5.4):** shared barrel `+passwords`; `MODULE_GENERATORS` + `TIER_POOLS` (all three tiers now `['wires','the-button','passwords']` — completing the canonical Easy trio); server `MODULE_REDUCERS` `+passwords`; client barrel + `SANDBOX_MODULES` `+PASSWORDS_MODULE`; `/dev/manual` fixture stub swapped for canonical `...getPasswordsManualPages()`. **`bombReducer.ts` untouched.**
- **Test gotcha handled:** `assembleBomb.test.ts`'s no-override pool assertion was widened to include `'passwords'`. Grep confirmed no test uses `'passwords'` as an *unregistered* example (the unregistered-id tests use `'simon-says'`), so no other test edits were needed.
- **No shared-type change** beyond the module's own `types.ts` (as predicted in Dev Notes).

**Gates:** tsc 0 errors; shared 201 / server 377 / client 275 (all above the 170/376/272 floor, no regressions); client build green; runtime liveness smoke pass. The SwiftShader screenshot rig is not in this worktree — full visual confirmation folds into Jay's Task 8 (AC4).

**AC4 — Jay interactive verification (2026-06-16, recorded):** Jay exercised Passwords in `/dev/sandbox` (dev server running) and confirmed it works as expected — generation renders the five columns, cycling to a reachable word + SUBMIT solves (green LED), SUBMIT on a non-word strikes and recovers with columns unchanged, letters legible at normal zoom. The "Set clock" control is The Button's (5.4) and correctly has no effect on Passwords. **AC4 satisfied; Task 8 checked.** Code review (ideally a different model) still recommended before merge.

### File List

**New (shared):**
- `packages/shared/src/modules/passwords/types.ts`
- `packages/shared/src/modules/passwords/generate.ts`
- `packages/shared/src/modules/passwords/solve.ts`
- `packages/shared/src/modules/passwords/reducer.ts`
- `packages/shared/src/modules/passwords/manual.ts`
- `packages/shared/src/modules/passwords/index.ts`
- `packages/shared/src/modules/passwords/__tests__/passwords.test.ts`

**New (client):**
- `apps/client/src/modules/passwords/types.ts`
- `apps/client/src/modules/passwords/generate.ts`
- `apps/client/src/modules/passwords/solve.ts`
- `apps/client/src/modules/passwords/reducer.ts`
- `apps/client/src/modules/passwords/DefuserView.tsx`
- `apps/client/src/modules/passwords/ManualPages.tsx`
- `apps/client/src/modules/passwords/index.ts`
- `apps/client/src/modules/__tests__/passwordsBinding.test.ts`

**Modified:**
- `packages/shared/src/modules/index.ts` (barrel `+passwords`)
- `packages/shared/src/modules/registry.ts` (`MODULE_GENERATORS` + `TIER_POOLS` `+passwords`)
- `apps/server/src/reducers/MODULE_REDUCERS.ts` (`+passwords`)
- `apps/server/src/reducers/__tests__/moduleRegistration.test.ts` (`+passwords` registration case)
- `apps/client/src/modules/index.ts` (import + `SANDBOX_MODULES` + export `+PASSWORDS_MODULE`)
- `apps/client/src/manual/devManualFixtures.ts` (passwords stub → canonical)
- `packages/shared/src/generation/__tests__/assembleBomb.test.ts` (pool assertion `+passwords`)
- `_agent_docs/implementation-artifacts/sprint-status.yaml` (5-5 → in-progress → review)

## Change Log

- 2026-06-16: Story created (context engine analysis — comprehensive developer guide). Status: ready-for-dev.
- 2026-06-16: Story 5.5 implemented (claude-opus-4-8) — Passwords module: shared pure logic (seeded unique-solution generation with a `countSpellableWords === 1` re-roll guard, `currentWord`/`isValidPassword`/`countSpellableWords` shared by solver + manual, CYCLE/SUBMIT reducer with no stored answer, faithful MODULE_RESET via `startPositions`), client module dir on the wires/the-button template (data-driven five-column R3F view, single-click cycle/submit, memoized selector), passwords registered in MODULE_REDUCERS + MODULE_GENERATORS + TIER_POOLS (Easy trio complete) + sandbox (bombReducer untouched), canonical 35-word manual wired into /dev/manual. Gates green (tsc 0; shared 201 / server 377 / client 275; build); runtime liveness smoke pass. Status: review (awaiting code review + Jay's AC4 interactive verification).
- 2026-06-16: AC4 satisfied — Jay verified Passwords interactively in `/dev/sandbox` (solve, strike+recovery, legibility); Task 8 checked. All 8 tasks complete; awaiting code review before merge.
