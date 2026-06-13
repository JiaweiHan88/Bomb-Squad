---
title: 'Fix Wires solutionIndex answer-leak at the source'
type: 'refactor'
created: '2026-06-13'
status: 'done'
baseline_commit: '4765421'
context: ['{project-root}/_agent_docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `WiresState.solutionIndex` is computed by `generateWires` at generate time and persisted in module `data`. The wire colours + serial make the answer publicly derivable, but shipping it *pre-computed* in the Defuser's client payload is a literal cheat value the instant Epic 8 broadcasts bomb state (flagged in the 5.3 code review and `deferred-work.md`). Sprint 2 retro Action Item 1.

**Approach:** Stop storing the answer. `WiresState` carries the **public** `BombContext` (serial/batteries/ports/indicators — all visible on the bomb face) instead of `solutionIndex`; `wiresReducer` recomputes `solveWires(colors, ctx)` at cut-time to decide solved-vs-struck. Recompute-at-interaction-time means there is nothing to strip before broadcast. No module-reducer-contract change — the reducer stays pure (its inputs are all in `state.data`).

## Boundaries & Constraints

**Always:** Reducer stays pure (no `Date.now()`/`Math.random()`/I/O, immutable returns, frozen-input safe). `solveWires` remains the single rule source shared with the manual. `BombContext` is read, never mutated. Open/closed preserved — `bombReducer.ts` and the generic `Reducer<ModuleState,unknown>` signature untouched.

**Ask First:** Any change that would require threading `ctx` through the bomb reducer or altering the cross-module reducer contract (signals the contained approach failed — stop and renegotiate).

**Never:** Do not touch `dev-demo` (its `solution` field is the same pattern but sandbox-only / not in any tier pool — flagged as a separate follow-up, not fixed here). Do not change the GDD rule tables, wire-count generation, colours, or the client `DefuserView`/manual. Do not add the production `MODULE_INTERACT` server handler (Epic 8).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Correct cut | armed `WiresState{wires, ctx}`, `CUT` on `solveWires(colors,ctx)` | `status: 'solved'`, that wire `cut` | N/A |
| Wrong cut | armed, `CUT` on any other in-range index | `status: 'struck'` (transient), wire severed | N/A |
| Serial parity drives answer | same colours, `ctx` differing only in serial last-digit parity (where a rule branches on it) | correct index differs between the two ctx → reducer solves/strikes accordingly | N/A |
| Idempotent / guards | repeat cut on severed wire; OOB/NaN/non-integer index; unknown action | unchanged state (`===` input) | no throw |
| MODULE_RESET | dirtied state | wires uncut, re-armed, `ctx` + layout survive (still solvable) | N/A |

</frozen-after-approval>

## Code Map

- `packages/shared/src/modules/wires/types.ts` -- `WiresState`: replace `solutionIndex: number` with `ctx: BombContext` (+ import `BombContext`).
- `packages/shared/src/modules/wires/generate.ts` -- return `{ wires, ctx }`; drop the `solveWires` call/import.
- `packages/shared/src/modules/wires/reducer.ts` -- import `solveWires`; CUT branch computes `solveWires(state.data.wires.map(w=>w.color), state.data.ctx)` instead of reading `state.data.solutionIndex`.
- `packages/shared/src/modules/wires/__tests__/wires.test.ts` -- `armed()` helper, the two `solutionIndex` generate tests, and the MODULE_RESET assertion.
- `_agent_docs/implementation-artifacts/deferred-work.md` -- resolve the 5-3 `solutionIndex` review entry; add the "network-realism deferred class" grouping heading (retro AI3).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/modules/wires/types.ts` -- swap `solutionIndex` → `ctx: BombContext` with a doc comment stating it is public, non-secret bomb-face data and the answer is never stored.
- [x] `packages/shared/src/modules/wires/generate.ts` -- store `ctx`; remove `solutionIndex`/`solveWires` usage.
- [x] `packages/shared/src/modules/wires/reducer.ts` -- recompute via `solveWires` at cut-time; colours are cut-invariant so the result is stable across re-arms.
- [x] `packages/shared/src/modules/wires/__tests__/wires.test.ts` -- update helper + 3 assertions; all 17 rule-row, immutability/frozen, idempotency, guard, solved-inert, and MODULE_RESET tests green; the parity test now proves `ctx`-in-state drives the reducer (cut the odd-answer on an even-`ctx` module → struck).
- [x] `apps/server/src/handlers/__tests__/moduleHandlers.test.ts` + `apps/server/src/reducers/__tests__/moduleRegistration.test.ts` -- two server tests constructed/derived from `solutionIndex` (the 4.7 MODULE_INTERACT handler test and the registration test) updated to recompute via `solveWires`. **Discovery:** these revealed the production `MODULE_INTERACT`→`MODULE_UPDATE` + `BOMB_INIT` broadcast was wired by 4.7 with no stripping, so the leak was already LIVE (not pre-leak) as of `c46f5cf`.
- [x] `_agent_docs/implementation-artifacts/deferred-work.md` -- 5-3 `solutionIndex` item marked RESOLVED (recompute-at-cut-time; live-leak correction; dev-demo follow-up noted); network-realism deferred-class index added grouping the 4.7 reconcile, strike-before-`BOMB_INIT`, clock-offset-on-reconnect, two-team `resolveRound` concurrency, and socket.id-reconnect entries (owners 8-7 / 10-3 / 10-5).

**Acceptance Criteria:**
- Given a generated/armed Wires module, when its state is inspected or (future) broadcast, then no field holds the pre-computed answer (`solutionIndex` gone; only `wires` + public `ctx`).
- Given the same wire colours under two `BombContext`s differing only in serial parity on a parity-branching rule, when the reducer reduces a CUT, then the solved/struck outcome differs between them — proving the answer is recomputed from stored `ctx`, not baked.
- Given `tsc --noEmit`, `pnpm -r test`, and `pnpm --filter @bomb-squad/client build`, when run, then 0 type errors, all suites green (no regressions), build green.

## Design Notes

`solveWires(colors, ctx)` is pure and cheap (≤6 wires, ≤5 rules) and depends only on the colour layout (invariant across cuts) + public `ctx`, so recomputing per-CUT is safe and stable. Storing the whole `BombContext` (rather than just the serial digit) keeps the module self-contained and future-proof for rules that read batteries/ports/indicators, and it is exactly the public widget data both sides of the asymmetry already reference. This is the recommended pattern for every future real module — answers are recomputed, never stored.

## Verification

**Commands:**
- `pnpm -r exec tsc --noEmit` -- expected: 0 errors across all 3 workspaces, no `@ts-ignore`.
- `pnpm -r test` -- expected: all green, no regressions (shared gains/keeps its wires coverage; client/server unchanged).
- `pnpm --filter @bomb-squad/client build` -- expected: green (pre-existing three.js chunk-size note only).
- `grep -rn "solutionIndex" packages apps --include=*.ts --include=*.tsx` -- expected: no matches outside `dist/` build artifacts.

## Suggested Review Order

**The leak fix (read these to grasp the design)**

- The whole intent in one field: `WiresState` carries public `ctx`, never the answer.
  [`types.ts:52`](../../packages/shared/src/modules/wires/types.ts#L52)

- The mechanism: reducer recomputes `solveWires(colours, ctx)` at cut-time — nothing stored.
  [`reducer.ts:47`](../../packages/shared/src/modules/wires/reducer.ts#L47)

- Generation no longer computes/bakes the answer — just `{ wires, ctx }`.
  [`generate.ts:24`](../../packages/shared/src/modules/wires/generate.ts#L24)

**Proof it's governed by stored ctx, not a baked field**

- Parity test: same wires, opposite serial → reducer solves a *different* wire.
  [`wires.test.ts:103`](../../packages/shared/src/modules/wires/__tests__/wires.test.ts#L103)

- Controlled-bomb helper now builds a layout that *solves at* the index (verified via `solveWires`).
  [`moduleHandlers.test.ts:56`](../../apps/server/src/handlers/__tests__/moduleHandlers.test.ts#L56)

**Ledger**

- 5-3 item RESOLVED + live-leak correction; network-realism deferred-class index (retro AI3).
  [`deferred-work.md`](./deferred-work.md)
