# Sprint 4 — Easy modules complete + round framing: parallelization analysis

Sprint 4 stories: `5-4` The Button, `5-5` Passwords, `4-6` Preparation placeholder bomb view, `8-1` Round configuration & difficulty gating, `8-6` Between-round flow & scoreboard preview.

## What's already in place that shapes the waves

- **The events contracts are already scaffolded** — unlike Sprint 3. `ROUND_CONFIGURE` + `RoundConfigurePayload` (client-to-server.ts:46, payloads.ts) and `SCOREBOARD` + `ScoreboardPayload` (server-to-client.ts:44, payloads.ts:120) already exist, and the client already binds `onScoreboard` (bindServerEvents.ts:42). So the usual `packages/shared/src/events/*` merge surface that bit Sprints 2–3 is largely pre-built and additive-free this time.
- **The module plugin pattern is fully trodden.** Wires (5.3) ships the whole contract: `generate/solve/reducer/types/manual` in `packages/shared/src/modules/wires/` + `DefuserView/ManualPages/index` in `apps/client/src/modules/wires/`. 5-4 and 5-5 are copies of that shape.
- **`resolveRound.ts` already flips status → `'between-rounds'`** and leaves an explicit TODO at lines 142–153: between-rounds entry, the ready-gate, and the `SCOREBOARD` emit "is owned by 8.6 and is not yet merged." 8-6 fills exactly that hole. It also notes `cancelPreparation` hard-codes a return to `'lobby'` that 8-6 should reconcile.
- **`TIER_POOLS` is deliberately stubbed to `['wires']` for all three tiers** (registry.ts) with a loud comment: *"RE-EXPAND these as modules land: 5.4 the-button, 5.5 passwords."* `generateLayout` fails loud if a pool lists an unregistered module — this is the central sequencing constraint (per module-registry-two-registries-and-tier-pools).
- **No story-context files exist yet** for any of these five (only 4-1…4-7 are written). `gds-create-story` needs to run for each before dev.

## Wave 1 — start now, two parallel worktrees

### Worktree A — Modules: `5-4` The Button + `5-5` Passwords

The classic additive-module track. Each is a self-contained new directory (shared pure-logic + client R3F), but they **collide on the same 3–4 shared registry files**, so they chain in one worktree exactly like Sprint 3's voice pair:

- `packages/shared/src/modules/registry.ts` — both add a `MODULE_GENERATORS` entry **and** a `TIER_POOLS` easy-pool entry
- `apps/server/src/reducers/MODULE_REDUCERS.ts` — both add a reducer
- `packages/shared/src/modules/index.ts` barrel + `apps/client/src/modules/registry.ts` registration

Per module-registry-two-registries-and-tier-pools: each module needs generator + reducer + tier-pool entry or `ROUND_START` throws. **Gotcha for 5-4:** its reducer must take the live timer value as *state input*, never `Date.now()` (release-strip rule, AC). The 8.4 server timer is already merged, so that input exists.

### Worktree B — Round framing & phase views: `4-6` Preparation placeholder + `8-6` Between-round flow

Bundled because both are phase-view work that **edits `App.tsx` phase routing and the `Preparation`/post-round surfaces** — splitting them just manufactures an `App.tsx` reconcile. 4-6 is client-only (render module *types* on a placeholder bomb during Preparation, no randomized values, role-gated). 8-6 is full-stack: it fills `resolveRound`'s between-rounds TODO, adds the ready-gate + `SCOREBOARD` emit + an advance→preparation handler in `sessionHandlers.ts`, and adds the client scoreboard-preview screen. Neither depends on the modules track.

Two worktrees is the honest width — same as Sprint 3. You *could* split 4-6 out as a third (it's pure client), but it's small and shares `App.tsx`/`Preparation.tsx` with 8-6.

## Wave 2 — blocked on Wave 1

**`8-1` Round configuration & difficulty gating** — do last, on master, after A (and B) merge.

The config machinery (the `ROUND_CONFIGURE` handler — event already scaffolded — and the operator-world dashboard UI, which doesn't exist yet) *could* be built in parallel. But its core AC — *"Easy: Wires/Button/Passwords; Medium adds…"* — **is the `TIER_POOLS` re-expansion that worktree A also edits.** Running both in parallel guarantees a conflict on the exact pool lines, and worse, risks a pool listing a not-yet-registered module → `generateLayout` throws at `ROUND_START`. Sequencing 8-1 after the modules lets it own the tier-pool expansion in one place and actually *test* the gating against real registered modules. It also dodges a second `sessionHandlers.ts` collision with 8-6's advance handler. This mirrors Sprint 3's "do 2-5 last" call.

> **If you'd rather widen Wave 1 to three worktrees:** 8-1's dashboard UI + `ROUND_CONFIGURE` handler can start in parallel and only the `TIER_POOLS` expansion reconciles at merge. I'd keep it in Wave 2 — the gain is one UI screen of lead time against a near-certain registry conflict plus an untestable difficulty-gate.

## Merge surface

Much smaller than Sprint 2/3 because the events are pre-scaffolded. The hot spots:

- **`TIER_POOLS` (registry.ts)** — A expands easy to `['wires','the-button','passwords']`; 8-1 owns the medium/hard gating. *The* reason 8-1 is Wave 2.
- **`sessionHandlers.ts`** — 8-6 (advance/between-rounds) vs 8-1 (`ROUND_CONFIGURE`); separated by the wave boundary.
- **`App.tsx` routing + `Preparation.tsx`** — 4-6 and 8-6, kept inside one worktree (B).
- Module barrel + `MODULE_REDUCERS` — internal to worktree A, additive.

## Execution gotchas (from past sprints)

- **Worktree B is full-stack** (8-6 server between-rounds + ready-gate): provision the gitignored `.env` and always `--build` with a worktree-scoped compose project name, or you'll test stale code (worktree-fullstack-testing-gap).
- **Human-verification ACs:** 4-6 (Defuser sees types, not values), 8-6 (scoreboard preview between rounds + manual advance), 8-1 (dashboard gating), and 5-4/5-5 (defuse the new modules over voice) are all user-visible — each needs the explicit "Jay verifies interactively" subtask, not done until his observed result is in Completion Notes (human-verification-ac-rule).

## TL;DR

Kick off **A = 5-4+5-5** (modules) and **B = 4-6+8-6** (prep view + between-round flow) in two parallel worktrees now; finish with **8-1** on master once A lands, because its difficulty gating *is* the `TIER_POOLS` re-expansion the module worktree edits and can't be tested until Button/Passwords are registered. Run `gds-create-story` for all five first — none have context files yet.
