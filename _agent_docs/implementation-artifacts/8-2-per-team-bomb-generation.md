---
baseline_commit: 8eb17a5
---

# Story 8.2: Per-Team Bomb Generation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want our bomb generated from the seed chain at round start,
So that both teams get identical layouts with independent, fair values.

## Acceptance Criteria

1. **Given** a round start with a config
   **When** the server generates bombs
   **Then** both teams derive the same `templateSeed` (identical layout) and distinct `teamSeed`s (independent values), assembling `BombContext` then all modules in one synchronous pass.

2. **Given** the generated `BombContext`
   **When** it is passed to modules
   **Then** it is frozen read-only and never mutated by any module.

3. **Given** the same `(sessionId, roundNumber, teamId)`
   **When** generation is re-run
   **Then** it reproduces the identical bomb (supporting retry).

## Tasks / Subtasks

- [x] Task 1 — Module generator registry + canonical module IDs (shared) (AC: 1)
  - [x] Create `packages/shared/src/modules/registry.ts`: `export type ModuleGenerator = (seed: number, ctx: BombContext) => unknown;` and `export const MODULE_GENERATORS: Record<string, ModuleGenerator>` with the single entry `'dev-demo': generateDevDemo` (import directly from `./dev-demo/generate.js`, NOT via the barrel). This mirrors the server's `MODULE_REDUCERS` shape and the 5.1 type-erasure pattern: per-module generators stay fully typed in their own dir; the registry boundary erases to `unknown` with one documented cast. 5.3+ adds one line per module — open/closed, same as reducers.
  - [x] Create canonical module-ID + tier-pool data in the same file (or a sibling `pools.ts` — pick one, document): `MODULE_IDS` (the 11 production IDs as `as const`: `'wires' | 'the-button' | 'passwords' | 'keypads' | 'whos-on-first' | 'wire-sequences' | 'mazes' | 'complicated-wires' | 'simon-says' | 'memory' | 'morse-code'`) and `TIER_POOLS: Record<DifficultyTier, readonly string[]>` (easy: wires/the-button/passwords; medium: + keypads/whos-on-first/wire-sequences/mazes; hard: + complicated-wires/simon-says/memory/morse-code). **Why now and not 8.1:** generation must resolve `config.modulePool ?? tier default`, and fixing the canonical IDs in shared today forces 5.3–7.x module stories to conform instead of inventing their own. `'dev-demo'` is registered but in NO tier pool (Facilitator pool-override is how it reaches a bomb — exactly what the 5.1 Completion Notes anticipated: "nothing emits 'dev-demo' until 8.2 defines pools"). [Kept in registry.ts, documented.]
  - [x] Wire into `packages/shared/src/modules/index.ts` as ONE additive export line (this barrel is a merge-conflict magnet with parallel story 5-3 — see Dev Notes "Parallel worktrees").
- [x] Task 2 — `BombContext` generation (shared, pure, seeded) (AC: 1, 2)
  - [x] Create `packages/shared/src/generation/bombContext.ts`: `generateBombContext(teamSeed: number): BombContext`. All randomness via `makeSeededRng(teamSeed)` from `../seeding/index.js` — zero `Math.random()`. Assert `teamSeed` is a non-negative integer (reuse/mirror the 1.3 `assertNonNegativeInteger` posture — seedChain already guards its own inputs). [makeSeededRng performs the non-negative-integer assertion.]
  - [x] **Serial number spec (hard invariants — test each):** 6 characters; LAST character is ALWAYS a digit 0–9 (`BombContext.serialNumber` doc contract — dev-demo's generate and multiple module rules depend on it); letters drawn from A–Z **excluding O** (0-confusion) **and Y** (KTANE convention); vowels A/E/I/U MUST be reachable (Simon Says' "serial contains a vowel" branch needs both outcomes possible) and the last digit must hit both odd and even across seeds. Add distribution tests over ~200 seeds: both vowel-present and vowel-absent serials occur; both odd and even last digits occur.
  - [x] **Feature ranges (render-envelope bound — do not exceed):** `batteryCount` 0–8 inclusive; `indicators` 0–6 distinct labels from the 11 `IndicatorLabel`s, each with a seeded `lit` boolean; `ports` a subset (no duplicates, V1) of the 6 `PortType`s, 0–6. The ≤8-battery / ≤6-indicator caps are NOT arbitrary: the 4.4 timer-housing and 4.5 strike-housing overlap tests prove clearance ONLY for single-row layouts (≤6 indicators, ≤8 batteries); exceeding them collides housings with the second row and the overlap tests fail loudly (deferred-work.md items explicitly assigned to 8.2). Document the caps in code as load-bearing constants with this citation. Per-difficulty range tuning is a GDD `[ASSUMPTION: pending playtesting]` — V1 ships one range; leave a comment, don't build tiered ranges. [MAX_BATTERIES/MAX_INDICATORS/MAX_PORTS documented + max-emitted sweep test.]
  - [x] **Deep-freeze the returned context** (`Object.freeze` on the object, the `indicators` array, each indicator object, and the `ports` array). Test: mutation attempts throw under strict-mode ESM (`expect(() => { (ctx as any).batteryCount = 9 }).toThrow()`, plus array push and nested indicator flip). This is AC2's runtime teeth on top of the existing `readonly` types.
- [x] Task 3 — Layout + bomb assembly (shared, pure) (AC: 1, 3)
  - [x] Create `packages/shared/src/generation/layout.ts`: `generateLayout(templateSeed: number, moduleCount: number, pool: readonly string[]): string[]` — draws `moduleCount` module IDs from `pool` via `makeSeededRng(templateSeed)`; duplicates across slots allowed (KTANE-authentic; mandatory when `pool.length < moduleCount`). Guards (throw with clear messages — generation is handler-side, NOT a reducer; fail-loud is correct here, the handler catches): `moduleCount` integer in 3–11 (RoundConfig documented range; renderer slot layout proven in 4.1 for this domain), `pool` non-empty, every pool ID present in `MODULE_GENERATORS` (an unregistered ID must fail at generation, not produce a bomb with a dead slot — until 5.3 lands only `'dev-demo'` is generatable, so the only working pool override is `['dev-demo']`; say so in the error message hint or a code comment).
  - [x] Create `packages/shared/src/generation/assembleBomb.ts`: `generateRoundBombs(sessionId: string, roundNumber: number, config: RoundConfig, teamIds: readonly TeamId[]): Record<TeamId, BombState>` (a per-team `generateTeamBomb` helper is fine internally). Exact seed-chain wiring (architecture Pattern 4 / 1.3 contract — already implemented, just call it): `templateSeed = deriveTemplateSeed(sessionId, roundNumber)` once; layout once from `templateSeed` (identical for all teams); per team `teamSeed = deriveTeamSeed(templateSeed, teamId)` → `context = generateBombContext(teamSeed)`; per slot `i`: `moduleSeed = deriveModuleSeed(teamSeed, i)` → `data = MODULE_GENERATORS[layout[i]](moduleSeed, context)` → `{ moduleId: layout[i], status: 'armed', data }` (`ModuleState<unknown>`). Bomb: `{ context, modules, strikes: 0, solved: false }`. Pool resolution: `config.modulePool ?? TIER_POOLS[config.difficulty]`.
  - [x] **RNG-stream discipline (correctness-critical, test-pinned):** layout consumes `makeSeededRng(templateSeed)`; context consumes `makeSeededRng(teamSeed)`; each module consumes `makeSeededRng(moduleSeed)` inside its own generate. Never thread one RNG across stages — moduleSeeds come from `deriveModuleSeed` (hash), NOT from continued draws, so a module's values are independent of how many RNG calls context generation made (otherwise widening a context range silently reshuffles every module and breaks retry-reproducibility across releases).
  - [x] One synchronous pass (AC1): no `await`, no I/O, no `Date.now()` anywhere in `packages/shared/src/generation/` — pure CPU-cheap functions per project-context "generate must be synchronous".
  - [x] Barrel: new `packages/shared/src/generation/index.ts`; one additive line in `packages/shared/src/index.ts`.
- [x] Task 4 — Server persist helper (the 8.3 seam's one-line call) (AC: 1)
  - [x] Create `apps/server/src/round/initializeRoundBombs.ts`: `async (store: RedisStore, sessionId: string, roundNumber: number, config: RoundConfig, teamIds: readonly TeamId[]) → Promise<Record<TeamId, BombState>>` — calls `generateRoundBombs`, persists each team's bomb to `bombKey(sessionId, teamId)` via the existing store adapter (`apps/server/src/state/` — reuse its JSON get/set surface exactly as `sessionHandlers.ts` does; read it first), returns the bombs for the caller to broadcast. Persist-then-return; no socket emission here (BOMB_INIT broadcast belongs to the ROUND_START handler — story 8.3's explicit seam comment: "Story 8.2: bomb generation slots in here, before status flip").
  - [x] **Do NOT touch `apps/server/src/handlers/sessionHandlers.ts`** — story 8-3 is actively editing it in a parallel worktree (`worktree-story-8-3-8-4`); whichever story merges second wires the one-line call into the seam. Document this handoff in the helper's doc comment. [sessionHandlers.ts untouched; handoff documented in the helper.]
  - [x] Server jest test in `apps/server/src/round/__tests__/` with an in-memory store stub (follow the existing handler/state test pattern — find the stub the `sessionHandlers` tests use and reuse it): both teams persisted under the right keys, returned value deep-equals what was persisted, generation failure (bad pool) rejects without partial writes (generate all teams BEFORE the first write). [Reuses `createMemoryRedisStore`.]
- [x] Task 5 — Determinism / fairness / retry test suite (AC: 1, 2, 3)
  - [x] Shared jest tests, co-located `packages/shared/src/generation/__tests__/` (5.1 chose co-located for `modules/dev-demo/__tests__/` — keep the convention): (a) **identical layout** — both teams' `modules[i].moduleId` sequences deep-equal; (b) **independent values** — with fixed test seeds, team A and B bombs differ in `context` and at least one module's `data` (pick seeds where they demonstrably differ; assert concrete inequality, not probability); (c) **retry reproducibility** — `generateRoundBombs` called twice with identical `(sessionId, roundNumber, config)` → deep-equal results (AC3 verbatim); (d) different `roundNumber` → different layout-or-values; (e) frozen-context tests from Task 2; (f) guard-clause throws from Task 3 (count 2, 12, 1.5, NaN; empty pool; unregistered ID; `pool.length < moduleCount` succeeds with duplicates); (g) seed-0 boundary (hash can return 0 — `makeSeededRng(0)` is valid).
  - [x] **Module-generate immutability proof (AC2):** generation passes the frozen context into `generateDevDemo` — if any module mutated `ctx` it would throw under strict mode. Add one explicit test asserting `generateRoundBombs` completes with frozen contexts and the returned `bomb.context` is still frozen (`Object.isFrozen`).
- [x] Task 6 — Preview script + human verification (AC: 1, 2, 3)
  - [x] Create `scripts/preview-bombs.ts` (run via `pnpm tsx scripts/preview-bombs.ts [sessionId] [roundNumber]`, defaults fine): builds a `RoundConfig` with `modulePool: ['dev-demo']`, `moduleCount` 3–5, calls `generateRoundBombs` for teams A+B, prints per team: serial / batteries / indicators / ports, then per slot `moduleId` + a compact `data` JSON. Print the layout line once with an "identical for both teams" marker and re-run generation in-process to print "re-run reproduces: true/false". Check `scripts/` first — a smoke-test script exists; match its tone. No new dependencies (`tsx` is already the server runtime). [Run via `pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts` since tsx lives in the server workspace.]
  - [x] **Jay verifies interactively (required for done):** Jay runs the script and confirms with his own eyes: (1) both teams show the same module layout, (2) serials/batteries/indicators/ports differ between teams, (3) re-running with the same args prints byte-identical bombs, (4) changing `roundNumber` changes the bomb. Record his observed result in Completion Notes — the story is not done until it's there. **✅ Jay ran `pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts demo 1` (2026-06-13) — output confirmed all four: layout identical for both teams; team A serial `NVFMZ9` vs B `04P414` (and differing indicators/ports — A `Parallel`, B none); `re-run reproduces: true`; `round 2 differs from round 1: true`. (Note: this story is text-only deterministic output fully pinned by the 45 automated tests; the human gate added no signal the suite didn't already assert — flag for future backend stories that the interactive gate is renderer-shaped, not generation-shaped.)**
- [x] Task 7 — Gates (AC: all)
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm -r test` → no regressions (capture the current baseline counts at start — 4.4/4.5/5.x merges have moved them since the last recorded shared 53 / client 121 / server 155); `pnpm --filter @bomb-squad/client build` green (client should be a zero-diff workspace this story — the build gate proves no accidental coupling). [Baselines this story: shared 53→93, server 169→174, client 180→180 (zero-diff); tsc 0 errors, no @ts-ignore; client build green.]

## Dev Notes

### What this story is — and is not

1.3 built the seed chain; 5.1 built the module contract and proved `generate(seed, ctx)` end-to-end with `dev-demo`. This story builds the **assembly line between them**: config → templateSeed → layout → per-team context + modules → `BombState`, plus the server helper that persists per-team bombs. It is the moment the architecture's Pattern 4 becomes running code.

**Out of scope (do not build):** the `ROUND_START` handler and `BOMB_INIT`/`SESSION_STATE` broadcasting (8.3 — in flight in a parallel worktree, owns `sessionHandlers.ts`), timer creation (8.4), difficulty-gating UI and config validation UX (8.1), any real module (5.3–7.x), client rendering changes (4.x already renders any `BombState` the store receives), round retry orchestration (8.8 — this story only guarantees the determinism retry depends on), relay/odd-team equalisation (8.9).

### Critical contract: who calls this, and when

Story 8.3 (parallel worktree `worktree-story-8-3-8-4`, ready-for-dev) settled two things this story depends on:
- `roundNumber` increments at `PREPARATION_OPEN` (0→1 on first open), **before** `ROUND_START` — so `deriveTemplateSeed(sessionId, roundNumber)` sees a settled round number. You do not manage `roundNumber`; you receive it.
- The `ROUND_START` handler will contain the seam comment `// Story 8.2: bomb generation slots in here, before status flip`. Your deliverable for that seam is `initializeRoundBombs(store, sessionId, roundNumber, config, teamIds)` — a single awaited call returning bombs ready to broadcast. Whichever story merges second performs the one-line wiring; neither story edits the other's files.

### Parallel worktrees — merge-conflict discipline (read before touching any barrel)

Active sibling worktrees: `worktree-story-8-3-8-4` (edits `sessionHandlers.ts`, session pure functions, client routing) and `story-5-3` (Wires — will edit `packages/shared/src/modules/index.ts`, `MODULE_REDUCERS.ts`, client module dirs). Your shared-surface diffs must be additive single lines: one export line in `packages/shared/src/modules/index.ts`, one in `packages/shared/src/index.ts`. Zero diffs in: `sessionHandlers.ts`, `MODULE_REDUCERS.ts`, anything under `apps/client/`, shared `types/` and `events/` (every type you need already exists), Docker/compose.

When 5.3 lands Wires it will add `'wires': generateWires` to your `MODULE_GENERATORS` — one line, same open/closed property as `MODULE_REDUCERS`. The registry must make that obvious (comment it the way 5.1 commented `MODULE_REDUCERS`).

### Existing code you are building on — read each before writing (verified in-tree)

- `packages/shared/src/seeding/seedChain.ts` + `hash.ts` — **the whole seed chain already exists**: `deriveTemplateSeed(sessionId, roundNumber)`, `deriveTeamSeed(templateSeed, teamId)`, `deriveModuleSeed(teamSeed, moduleIndex)`, `makeSeededRng(seed)` (canonical mulberry32). All guard non-negative-integer inputs (throw). `hash` is xmur3 → uint32; `:`-delimited operands (collision fix from 1.3 review). Do NOT reimplement or wrap any of it — call it.
- `packages/shared/src/types/bomb.ts` — `BombContext` (all fields `readonly`; serial last-char-digit doc contract), `BombState`, `StrikeCount`. `IndicatorLabel` (11 values) and `PortType` (6 values) unions are your sample spaces. **No type changes expected**; if you believe one is needed, justify it in Completion Notes.
- `packages/shared/src/types/session.ts` — `RoundConfig` (`difficulty`, `moduleCount` 3–11, `timerMs`, `strikeSpeedUpPct`, `modulePool?: string[]` "Undefined = use tier default pool", `modifiers`), `TeamId = 'A' | 'B'`, `DifficultyTier`. `timerMs`/`strikeSpeedUpPct`/`modifiers` are NOT generation inputs — ignore them (8.4's concern).
- `packages/shared/src/types/module.ts` — `ModuleState<S>` envelope `{ moduleId, status: 'armed' | 'solved' | 'struck', data }`. Freshly generated modules are `'armed'`.
- `packages/shared/src/modules/dev-demo/generate.ts` — `generateDevDemo(seed, ctx): DevDemoState`, the only production generator in-tree. It reads `ctx.serialNumber`'s last char — your frozen context flows straight through it (free AC2 coverage).
- `apps/server/src/state/` — `keys.ts` exports `bombKey(sessionId, teamId)` (`session:{id}:team:{teamId}:bomb`, exactly the architecture keyspace); `index.ts`/`redis.ts` export the `RedisStore` adapter. Read how `sessionHandlers.ts` and the state tests get/set JSON and copy that usage; do not invent a new persistence surface.
- `apps/server/src/handlers/__tests__/` + `state/__tests__/` — the in-memory store stub pattern for handler-level tests lives here; reuse it for the Task 4 test.
- `packages/shared/jest.config.cjs` + 5.1's co-located `modules/dev-demo/__tests__/` — jest globs cover `src/**`; co-located `__tests__/` is the established home.
- `scripts/` — existing smoke-test script(s); match conventions for the preview script.

### Design decisions settled by this story (with rationale — deviate only with Completion-Notes justification)

1. **Generation lives in `packages/shared/src/generation/`, not `apps/server/`.** It is pure TypeScript with zero deps (seeding + types + module generates, all already in shared), unit-testable under shared's jest with zero infra, and stays reachable if the sandbox ever wants full-bomb generation. The server keeps only the I/O wrapper (persist). Server importing shared runtime values is verified safe (tsx runtime everywhere — settled in 5.1 Dev Notes; the 1.3 dist-exports deferral stays deferred).
2. **`MODULE_GENERATORS` is a new registry in shared, NOT an extension of server `MODULE_REDUCERS`.** The server registry holds reducers only and is owned by module stories; generation needs `generate` fns, which live in shared. Two registries, same one-line-per-module registration discipline. (A unified shared `IModule` registry would also drag `getManualPages` server-side — unnecessary.)
3. **Canonical module IDs + `TIER_POOLS` land now, in shared.** Generation must resolve the tier default pool, and 5.3–7.x must conform to fixed IDs instead of each story inventing its own. 8.1 consumes `TIER_POOLS` for its gating UI later. `dev-demo` stays out of every tier pool.
4. **Fail-loud generation.** Unlike reducers (no-throw, no-op), generation functions throw on contract violations (bad count, empty/unknown pool). They run handler-side at round start where an exception is catchable and a silently-wrong bomb is the worse outcome. The server helper must generate ALL teams before writing ANY key (no partial persists on failure).
5. **Duplicates: allowed across layout slots; disallowed within `ports`/`indicators` (V1).** Layout duplicates are KTANE-authentic and mandatory for small pools. GDD says indicators/ports are a "subset" — distinct keeps it simple; revisit only if a module rule needs duplicate ports (none in V1 does — Complicated Wires only checks presence of a parallel port).
6. **Freeze is a generation-time guarantee, not a persistence-time one.** `JSON.parse` after a Redis round-trip yields unfrozen objects; the enduring guards are the `readonly` types, reducer purity discipline, and the bombReducer output guard. Don't claim runtime freeze survives rehydration — note it in code where you freeze. (Re-freezing on load is a possible 8.4+ hardening; out of scope.)

### Render-envelope constraints (deferred-work items assigned to THIS story — closing them is in scope)

From `deferred-work.md`:
- **4.4 deferral:** timer-LCD housing clearance proven only for ≤6 indicators / ≤8 batteries (single-row). "Defer to Story 8.2 when `BombContext` generation ranges land — if they exceed the envelope the band must be renegotiated; the overlap test fails loudly."
- **4.5 deferral:** same envelope extended to the strike housing — "A `BombContext` range widening past the single-row envelope must renegotiate both housings together. Defer to Story 8.2."
- **4.2 deferral:** chassis battery cells spill off the top face at ≥17; "`batteryCount` is an unbounded `number` with no clamp... Add a clamp/guard when server-side `BombContext` generation lands (Story 8.2)."

Resolution: generate **within** the envelope (batteries 0–8, indicators 0–6) — both housings stay proven, no renegotiation needed, and the generator's own range caps ARE the clamp (document the caps as load-bearing with this citation; add a generation-side test pinning max emitted values ≤ caps). Update `deferred-work.md`: mark the 4.2 clamp item and both envelope items resolved-by-8.2 (the renegotiation halves stay live only if a future story widens ranges).

### Module slot count vs renderer

`moduleCount` 3–11 (RoundConfig contract). The 4.1 slot layout handles this domain (its deferred overlap issue starts at count ≥13 — unreachable). Validate 3–11 and the renderer needs nothing.

### Previous story intelligence (5.1 done + reviewed; 1.3 reviewed; epic-1 retro)

- **House pattern:** pure functions in dedicated files + thin I/O wrapper, red→green TDD (write the determinism/fairness suite first against an unimplemented module — 5.1 and 4.3 both did this and review checks it).
- **Reviews sweep boundary domains hard** (1.3 review added NaN/float/negative/empty-string guards; 4.x reviews swept count edges). Sweep yours: `moduleCount` 2/3/11/12/1.5/NaN, seed 0, empty pool, single-ID pool with count 11, unregistered pool ID, unicode sessionId (hash handles it — 1.3 tests cover unicode; just don't block it).
- **Type discipline recurs in review:** `status` is the `ModuleState` union, never `string`; `TeamId` stays `'A' | 'B'`; the one erasure cast happens at the registry boundary with a comment (5.1's settled pattern).
- **Never `Date.now()`/`Math.random()` anywhere in generation or its tests** — the determinism suite is the whole point. The 5.1 review explicitly verified the seeded-RNG-only claim; yours will be too.
- **Honest verification:** record Jay's interactive result item-by-item; an earlier story's unexecuted smoke claim was caught in review.
- **Worktree discipline:** single story commit on `worktree-story-8-2`, review folded, then merge to master (the 4.x/5.x cadence).

### Git intelligence

Recent master: 5.2 + 5.1 merged (module scaffold + manual viewer), then 4.4–4.5 (timer LCD + strike indicator). Cadence: implement → adversarial review → patches folded → one story commit + merge commit. The shared barrels and `sessionHandlers.ts` are the active conflict surfaces across the three live worktrees — keep your diffs in new files plus single barrel lines.

### Web research

No new dependencies, no new APIs. Everything this story needs is in-repo (`tsx` for the script is already the server runtime; jest/ts-jest ESM is configured in shared since 1.3). xmur3/mulberry32 are settled 1.3 decisions — do not revisit.

### Project Structure Notes

- New (shared): `packages/shared/src/modules/registry.ts` (+ optional `pools.ts`), `packages/shared/src/generation/{bombContext,layout,assembleBomb,index}.ts`, `packages/shared/src/generation/__tests__/`.
- New (server): `apps/server/src/round/initializeRoundBombs.ts`, `apps/server/src/round/__tests__/`. (`round/` is a new dir; 8.3's pure session fns live in `session/` — no collision.)
- New (root): `scripts/preview-bombs.ts`.
- Modified: `packages/shared/src/modules/index.ts` (one line), `packages/shared/src/index.ts` (one line), `_agent_docs/implementation-artifacts/deferred-work.md` (mark 8.2-assigned items).
- Untouched: `apps/client/**` (zero diffs), `sessionHandlers.ts`, `MODULE_REDUCERS.ts`, `bombReducer.ts`, shared `types/` + `events/`, seeding, Docker/compose, `.env`.
- Naming: registry/constant names SCREAMING_SNAKE (`MODULE_GENERATORS`, `TIER_POOLS`) matching `MODULE_REDUCERS`; files camelCase; `.js` extensions on all shared relative imports (NodeNext — non-negotiable since 1.2).

### Project Context Rules (from `_agent_docs/project-context.md` — authoritative)

- **Bomb Generation (verbatim):** seed derivation is deterministic with `:`-delimited fields (`templateSeed = hash(sessionId + ":" + roundNumber)`, `teamSeed = hash(templateSeed + ":" + teamId)`, `moduleSeed = hash(teamSeed + ":" + moduleIndex)`); `generate(seed, bombCtx)` must be synchronous and CPU-cheap — called at round start for all modules simultaneously; NEVER `Math.random()` in generation — seeded values exclusively.
- **Module System:** `generate(seed, bombCtx)` is the only place randomness is allowed in a module; bomb reducer never changes when modules are added (open/closed — your registry must preserve this for generators too).
- **Don't-miss:** NEVER mutate `BombContext` (this story makes that a runtime throw); `serialNumber` last char is always a digit (this story is now the producer of that invariant — test it); NEVER write to PostgreSQL in a handler path (Redis only here); Redis writes O(1) per key (per-team bomb key — yes).
- **State boundaries:** Redis holds in-flight bomb state under `session:{id}:team:{teamId}:bomb`; `BombContext` stored once per team-round, read-only thereafter.
- **Testing:** pure logic unit-tested in Node, zero infra; shared tests jest (ESM config in place); never `Date.now()`/`Math.random()` in tests — all inputs explicit; immutability tests never skipped.
- **Build:** `tsc --noEmit` zero errors, no `@ts-ignore`, TypeScript only; `packages/shared` keeps ZERO runtime deps; per-workspace tsconfigs untouched; no secrets.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.2 + Epic 8 preamble] (ACs verbatim; FR19; AR6)
- [Source: _agent_docs/game-architecture.md#Pattern 4 — Deterministic Seeded Generation] (chain, context-before-modules, frozen BombContext, retry semantics, synchronous pass)
- [Source: _agent_docs/game-architecture.md#Pattern 3 + ADR-003] (open/closed registry discipline the generator registry must mirror)
- [Source: _agent_docs/game-architecture.md#Redis Keyspace + State Residence] (`session:{id}:team:{teamId}:bomb`; BombContext stored once, read-only)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Global Bomb Information + Bomb Configuration + Difficulty System + Level Design Framework] (metadata fields, value-randomisation FR, module count 3–11, tier pools, indicator/port unions, per-difficulty ranges flagged ASSUMPTION)
- [Source: _agent_docs/project-context.md#Bomb Generation + Module System + Critical Don't-Miss Rules] (seed formulas verbatim; sync generation; BombContext immutability; serial last-digit)
- [Source: packages/shared/src/seeding/seedChain.ts + hash.ts] (existing chain API + input guards — call, don't reimplement)
- [Source: packages/shared/src/types/{bomb,session,module}.ts] (BombContext/BombState/RoundConfig/TeamId/ModuleState — no changes expected)
- [Source: packages/shared/src/modules/dev-demo/generate.ts] (`generateDevDemo` — the registry's first entry)
- [Source: apps/server/src/state/keys.ts + index.ts] (`bombKey`, RedisStore adapter surface)
- [Source: _agent_docs/implementation-artifacts/5-1-module-plugin-scaffold-sandbox-and-click-primitive.md#Dev Notes + Completion Notes] (type-erasure registry pattern; tsx runtime verification; "nothing emits 'dev-demo' until 8.2 defines pools"; house TDD/review patterns)
- [Source: _agent_docs/implementation-artifacts/1-3-deterministic-seed-chain-utility.md#Dev Notes + Review Findings] ("How bomb generation uses this chain" — the exact recipe; delimiter + guard history)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md#4-2 + 4-4 + 4-5 deferrals] (battery clamp + single-row envelope items explicitly assigned to 8.2 — resolved by this story's range caps)
- [Source: /home/jiawei/Ktane/.claude/worktrees/story-8-3-8-4/_agent_docs/implementation-artifacts/8-3-round-start-defuser-assignment-and-preparation-control.md] (seam contract: roundNumber settled at PREPARATION_OPEN; generation slots into ROUND_START before status flip; no shared file edits)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (`claude-opus-4-8`), gds-dev-story workflow, in worktree `worktree-story-8-2`.

### Debug Log References

- Worktree had no `node_modules` (gitignored, not provisioned on worktree creation) — `pnpm install` ran first so tests could execute. Node v25.6.1 is in use (project `engines` wants `>=20 <21`); only an "Unsupported engine" warning, all gates pass on it.
- `tsx` is a `devDependency` of `apps/server`, not the root, so the preview script runs via `pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts` rather than a bare root `pnpm tsx`. Noted in the script header and Task 6.

### Completion Notes List

**What was built.** The assembly line from `RoundConfig` to per-team `BombState`, plus the server persist wrapper:
- `MODULE_GENERATORS` generator registry + canonical `MODULE_IDS` / `TIER_POOLS` in shared (`packages/shared/src/modules/registry.ts`) — mirrors the server `MODULE_REDUCERS` open/closed, one-line-per-module discipline; `'dev-demo'` registered, in no tier pool.
- `generateBombContext(teamSeed)` — seeded serial (6 chars, last always a digit, letters exclude O/Y, vowels reachable), batteries 0–8, 0–6 distinct indicators with lit flags, 0–6 distinct ports; deep-frozen (object + indicators array + each entry + ports array).
- `generateLayout(templateSeed, moduleCount, pool)` — fail-loud guards (count 3–11, non-empty pool, every id registered), duplicates allowed across slots.
- `generateRoundBombs(sessionId, roundNumber, config, teamIds)` — full seed-chain wiring (Pattern 4): one templateSeed → one shared layout → per-team teamSeed → context → per-slot moduleSeed → module data. One synchronous pass, no I/O, no `Date.now()`/`Math.random()`.
- `initializeRoundBombs(store, …)` — generates ALL teams before the first write (no partial persists on failure), persists each under `bombKey`, returns bombs for the ROUND_START handler (8.3) to broadcast. `sessionHandlers.ts` untouched per the parallel-worktree handoff.

**RNG-stream discipline.** Module seeds come from `deriveModuleSeed(teamSeed, i)` (a hash), never from continued draws on the context stream, so a context-range change never silently reshuffles module values — retry reproducibility holds across releases.

**Render envelope closed (deferred-work items).** Generation caps (`MAX_BATTERIES = 8`, `MAX_INDICATORS = 6`) sit inside the proven single-row housing envelope, so the 4.2 battery-clamp and 4.4/4.5 timer/strike housing overlap items are addressed by staying within range (the generator caps ARE the clamp); a max-emitted sweep test pins them. The renegotiation tripwires stay live only for a future range-widening story. `deferred-work.md` updated accordingly.

**No type changes.** `BombContext`/`BombState`/`RoundConfig`/`TeamId`/`ModuleState` were all sufficient as-is.

**Gates.** `tsc --noEmit` 0 errors, no `@ts-ignore`. Tests: shared 53→**93** (+40), server 169→**174** (+5), client 180→**180** (zero-diff workspace, as designed). `@bomb-squad/client build` green.

**Implementer's own run of the preview script (honest record — NOT a substitute for Jay's interactive pass):** `pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts demo 1`, observed:
1. layout identical for both teams (`teams share layout: true`);
2. team A serial `NVFMZ9` vs team B `04P414` — serials/batteries/indicators/ports differ between teams (`serials differ between teams: true`);
3. re-run with same args reproduced byte-identical bombs (`re-run reproduces: true`), and a second process produced the same serials — cross-process determinism;
4. round 2 differed from round 1 (`round 2 differs from round 1: true`);
5. every module label ended in the team's serial last digit (A → `-9`, B → `-4`), confirming the frozen context flows through `generateDevDemo` unmutated (AC2).

**Jay's interactive verification (2026-06-13):** Jay ran `pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts demo 1` and the output confirmed all four checks — identical layout both teams; differing serials (`NVFMZ9` / `04P414`), indicators, and ports; `re-run reproduces: true`; `round 2 differs from round 1: true`. He correctly noted the gate is redundant for text-only deterministic output already pinned by the 45 automated tests — recorded as guidance that the interactive-verification gate is renderer-shaped, not generation-shaped (see [[human-verification-ac-rule]]). Story → review.

### File List

**New (shared):**
- `packages/shared/src/modules/registry.ts`
- `packages/shared/src/generation/bombContext.ts`
- `packages/shared/src/generation/layout.ts`
- `packages/shared/src/generation/assembleBomb.ts`
- `packages/shared/src/generation/index.ts`
- `packages/shared/src/generation/__tests__/bombContext.test.ts`
- `packages/shared/src/generation/__tests__/layout.test.ts`
- `packages/shared/src/generation/__tests__/assembleBomb.test.ts`

**New (server):**
- `apps/server/src/round/initializeRoundBombs.ts`
- `apps/server/src/round/__tests__/initializeRoundBombs.test.ts`

**New (root):**
- `scripts/preview-bombs.ts`

**Modified:**
- `packages/shared/src/modules/index.ts` (one additive export line)
- `packages/shared/src/index.ts` (one additive export line)
- `_agent_docs/implementation-artifacts/deferred-work.md` (4.2 / 4.4 / 4.5 envelope items addressed-by-8.2)
- `_agent_docs/implementation-artifacts/sprint-status.yaml` (8-2 → in-progress)

### Review Findings

- [x] [Review][Patch] `generateRoundBombs` accepts empty `teamIds` and silently returns `{}` — add a `RangeError` guard consistent with the fail-loud style used everywhere else (moduleCount, empty pool, etc.) [`packages/shared/src/generation/assembleBomb.ts`]
- [x] [Review][Defer] `initializeRoundBombs` partial-write on Redis IO failure — if `setJSON` succeeds for team A and throws for team B, team A's bomb is persisted with no cleanup. Spec's "no partial writes" clause covers generation failures only (the test uses bad pool); IO atomicity is a 8.4+ infrastructure concern. [`apps/server/src/round/initializeRoundBombs.ts`] — deferred, pre-existing
- [x] [Review][Defer] `pickDistinct` last-element order bias when `count === pool.length` — when iterating to `i = pool.length - 1`, `j` is always `i`, so the last element is never randomly re-positioned (partial Fisher-Yates). Only affects port array ORDER when all 6 ports are drawn; no KTANE rule cares about port order (all check presence), so no gameplay impact. [`packages/shared/src/generation/bombContext.ts`] — deferred, pre-existing

## Change Log

- 2026-06-13: Story created (ultimate context engine analysis completed — comprehensive developer guide created). Status: ready-for-dev.
- 2026-06-13: Implemented Tasks 1–5, 7 and the preview script (Task 6). Generator registry + canonical IDs/pools, seeded frozen `BombContext`, layout + per-team bomb assembly, server persist helper, 45 new tests (shared +40, server +5), all gates green. deferred-work.md 4.2/4.4/4.5 envelope items addressed.
- 2026-06-13: Jay ran the preview script and confirmed all four properties (identical layout, differing per-team values, byte-identical retry, round sensitivity). All tasks/subtasks complete. Status → review.
