---
baseline_commit: d55c37b
---

# Story 8.8: Retry a Failed Round

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to offer a retry of a failed round with the same bomb,
so that a learnable round can be re-attempted fairly.

## Acceptance Criteria

1. **Retry regenerates the IDENTICAL bomb and re-enters Preparation (the reused-seed guarantee).** After a round in which a team **failed** (`exploded` / `time-expired`), the Facilitator can trigger a retry of that round via a **single action with a single confirm**. The retry reuses the **same `roundNumber`**, so the seed chain (`templateSeed = hash(sessionId + ":" + roundNumber)`, `teamSeed = hash(templateSeed + ":" + teamId)`) reproduces the **bit-for-bit identical bomb layout and per-team values** (Story 8.2 / NFR10), and the session re-enters **`preparation`** for that round — the same Defuser, the same module layout. The retry does **NOT** advance the relay rotation pointer (`currentDefuserIndex`) or `roundNumber` — it is a re-attempt of the *same* round, not the next one.

2. **Better-of-two times is kept for scoring.** When a retried round resolves, the team's recorded time for that round is the **better (lower) of the original attempt and the retry** — never appended as a second round, never double-counted. The maintained invariant `cumulativeTimeMs === sum(roundTimesMs)` and the per-round-history shape (`roundTimesMs[i]` = the team's recorded time for round `i+1`) both survive a retry: a retry **replaces in place**, it does not lengthen `roundTimesMs`. (GDD: "if retried, the better of the two times is recorded.")

3. **Retry is gated to FAILED rounds only, Facilitator-only, and between rounds.** The retry affordance/action is available **only** when the targeted team's most-recent round outcome was a **failure** (`exploded` or `time-expired`) and the session is **`between-rounds`**. A defused round cannot be retried (nothing to re-attempt). The action is **authority-gated** (only the Facilitator) exactly like every other facilitator action — a non-facilitator probe learns nothing and the server refuses before revealing state.

4. **No regression to the relay (8.9), pause (8.7), between-rounds (8.6), resolution (8.5), or generation (8.2).** The 8.9 `PREPARATION_OPEN` relay-complete gate, `ROUND_START` rotation/volunteer commit, `openPreparation`/`startRound`/`cancelPreparation` purity, the 8.7 pause orthogonality + mid-round disconnect path, the 8.6 between-rounds gate + scoreboard preview, the 8.5 per-team resolution fence (live-timer-key once-only), and the 8.2 deterministic generation all remain correct. Critically, this story **reconciles the pre-flagged `cancelPreparation` roundNumber/rotation-reversal hazard** (deferred-work.md:7 — "Already flagged in-code for 8.8 reconciliation; resolve when retry lands") so a cancel of a *retry* preparation does **not** corrupt `roundNumber`/`currentDefuserIndex`.

5. **A retry round runs only the retried team; the other team rests (reuses the 8.9 resting-team machinery).** Because the round already fully resolved (the session reached `between-rounds`, which requires every participating team to have resolved — 8.6 gate), a retry re-runs only the **targeted failed team**: its bomb regenerates and its timer arms; the non-retried team is **absent from `round.defusers`** (no bomb armed, its stale `defuser` demoted to `expert`) — the exact resting-team posture Story 8.9 established for equalisation rounds. No client is stranded on a dead bomb surface. After the retry resolves, the session returns to `between-rounds` (where a further retry, the other team's retry, or the normal advance is available).

## Tasks / Subtasks

> **READ the Dev Notes "Cross-Story Seam" and "Recommended design" FIRST.** This story makes several genuine design decisions (retry granularity, where the per-team outcome lives, the retry pointer/roundNumber path). The recommended design below is internally consistent and reuses existing 8.9 machinery; record any deviation in the Dev Agent Record. **See also the OPEN QUESTION at the very end — confirm the per-team-retry interpretation with Jay if uncertain before building the client affordance.**

- [x] **Task 1 — Shared contract: per-team round outcome + retry markers (AC: 1, 2, 3, 5)**
  - [x] Added `outcomes: Partial<Record<TeamId, RoundOutcome>>` (required) to `RoundState` in `round.ts`; `status` semantics unchanged; the "future per-team round-outcome model" note widened to document `outcomes`. `retry: boolean` kept (true on a re-attempt).
  - [x] Added transient `SessionState.retryingTeamId?: TeamId` (optional, additive) — set by `retryRound`, consumed/cleared by `startRound`/`cancelPreparation`. Mirrors `equalisationVolunteerId`.
  - [x] Confirmed `ROUND_RETRY` + `RoundRetryPayload { teamId }` are pre-scaffolded; not redeclared. No new socket event.
  - [x] `pnpm typecheck` surfaced exactly 3 `RoundState` literal sites (see Task 2).

- [x] **Task 2 — Initialise the new required `RoundState.outcomes` at every construction site (AC: 1, 5)**
  - [x] `startRound.ts` production literal: added `outcomes: {}`.
  - [x] Typecheck-driven sweep: only `resolveRound.test.ts` + `timerScheduler.test.ts` had `RoundState` literals (added `outcomes: {}`). (`sessionHandlers.test.ts` had a `toEqual` shape assertion updated too; `voiceHandlers.test.ts`/fixtures build no `RoundState` literal.) Full typecheck clean.

- [x] **Task 3 — Pure retry transition + cancelPreparation reconcile (AC: 1, 4)**
  - [x] New `apps/server/src/session/retryRound.ts` — pure `between-rounds → preparation` setting `retryingTeamId`, `roundNumber`/pointers UNCHANGED; same-reference guard for any other status.
  - [x] `cancelPreparation.ts` reconciled: a retry prep (marker set) cancels to `between-rounds`, clears the marker, leaves `roundNumber`/every pointer untouched (no blind `−1`/`roundNumber--`). Non-retry identity preserved. In-code note updated.
  - [x] Unit tests: `retryRound.test.ts` (new) + `cancelPreparation.test.ts` (extended).

- [x] **Task 4 — `startRound` retry path: arm only the retried team, same Defuser, `retry: true` (AC: 1, 2, 5)**
  - [x] Added a `retryingTeamId`-gated `startRetryRound` branch (priority over natural/equalisation): only the retried team in `defusers`, same Defuser via the raw unadvanced index, `retry: true`, `outcomes: {}`, `roundNumber` unchanged, marker cleared, `equalisationRoundsPlayed`/pointers untouched.
  - [x] Role pass reuses the 8.9 single-Defuser reconciliation: retried team's pick is `defuser`; every other `defuser` (incl. the resting team) demoted to `expert`.
  - [x] All existing branches preserved (natural / equalisation / `EQUALISATION_VOLUNTEER_REQUIRED` / rest / `NO_POPULATED_TEAM` / `NOT_IN_PREPARATION`).
  - [x] **Edge case — Decision (b) taken & documented:** retry of a *failed equalisation round* (original Defuser was a volunteer) is **deferred** in V1 — the exhausted raw index yields no pick, so `startRetryRound` refuses `NO_POPULATED_TEAM`. Equalisation rounds are the rare odd-team tail; the common retry target is a natural round. Documented in the `startRound.ts` header + a `startRound.test.ts` case.

- [x] **Task 5 — `resolveRound` retry reconcile: record per-team outcome + better-of-two in place (AC: 2, 3, 5)**
  - [x] `resolveRound.ts` now writes `outcomes[teamId] = outcome` into the persisted `RoundState` (alongside last-writer-wins `status`).
  - [x] Retry-aware time recording: on `round.retry === true`, replaces `roundTimesMs[roundNumber-1]` with `min(previous, elapsedMs)` and shifts `cumulativeTimeMs` by the (≤0) delta; first attempts append as before. `roundTimesMs.length` stable; invariant preserved.
  - [x] Desync guard: a retry with no existing slot logs + falls back to append (no throw). Documented.
  - [x] Everything else preserved (per-team fence, between-rounds gate, announce + scoreboard emit, serialization chain, immutability).

- [x] **Task 6 — `ROUND_RETRY` handler: gate on failure + Facilitator, then re-enter preparation (AC: 1, 3, 4)**
  - [x] Added `socket.on('ROUND_RETRY', …)` + `parseRoundRetryPayload`: validate → `NOT_IN_SESSION` → authority-gate-first (`NOT_FACILITATOR`) → phase guard (`CANNOT_RETRY` outside between-rounds) → failure gate (loads `RoundState`, refuses `ROUND_NOT_FAILED` unless `outcomes[teamId]` is a failure) → pure `retryRound` → persist-then-emit `SESSION_STATE`.
  - [x] **Decision (recorded):** two-click flow (`ROUND_RETRY` → preparation, then the Facilitator's `ROUND_START` regenerates the identical bomb via the `startRound` retry branch) — reuses the whole prep→active pipeline with zero duplication.
  - [x] Every 8.9/8.7/8.6 handler path preserved; authority-gate-first, persist-then-emit, durable-`playerId`, error codes intact.

- [x] **Task 7 — Client: the "Retry round" affordance on the between-rounds surface (AC: 1, 3, 5)**
  - [x] `Scoreboard.tsx`: a confirm-gated "Retry round" `ConfirmButton` per failed team, facilitator-only, emitting `ROUND_RETRY { teamId }`. Single failed team → unlabelled `RETRY_ROUND`; both failed → per-team labels.
  - [x] **Decision (recorded):** extended `ScoreboardPayload` with `failedTeams?: TeamId[]` (additive); `resolveRound` computes it from the now-complete per-team `outcomes` and includes it in the between-rounds `SCOREBOARD` broadcast. Server remains the authority (handler re-gates).
  - [x] Added `CANNOT_RETRY`/`ROUND_NOT_FAILED`/`ROUND_RETRY_FAILED` to the Scoreboard's owned `ERROR` code set (paints the inline alert; not cleared on broadcasts).
  - [x] Added `RETRY_ROUND` + `RETRY_ROUND_TEAM` copy.
  - [x] **`App.tsx` routing UNCHANGED** (confirmed via `git status` — not touched). Retry rides the existing `between-rounds → preparation → active` status flow; the resting team reuses the 8.9 standby (no new client surface).

- [x] **Task 8 — Tests (AC: 1–5)**
  - [x] `retryRound.test.ts` (new): truth table + immutability.
  - [x] `cancelPreparation.test.ts` (extended): retry-prep cancel leaves roundNumber/pointer untouched; non-retry inverse still reverses.
  - [x] `startRound.test.ts` (extended): retry branch — only retried team, same Defuser, `retry: true`, `outcomes: {}`, marker cleared, resting demotion, counters/pointers untouched, exhausted-team refusal.
  - [x] `resolveRound.test.ts` (extended): per-team `outcomes` recorded; first-attempt append; faster-retry replace-in-place; slower-retry unchanged; no length growth; desync append fallback; invariant.
  - [x] `sessionHandlers.test.ts` (extended): failed-team retry → preparation @ same roundNumber; retry `ROUND_START` regenerates the **identical bomb** (deep-equal) + arms only the retried team (resting team no timer); defused-team → `ROUND_NOT_FAILED` byte-identical; non-facilitator → `NOT_FACILITATOR` byte-identical; outside between-rounds → `CANNOT_RETRY`; invalid teamId → `INVALID_PAYLOAD`. Full 8.9/8.7 regression suite in the file still green.
  - [x] `buildScoreboard.test.ts`: no change needed — `failedTeams` is computed in `resolveRound` (covered by `resolveRound.test.ts` SCOREBOARD assertion), not in `buildScoreboard`.
  - [x] Client `Scoreboard.test.tsx` (extended): facilitator sees Retry for a failed team + emits `ROUND_RETRY`; none for a defused round; never for a non-facilitator; both-failed → per-team controls.
  - [x] `pnpm typecheck` clean; server 505, client 319, shared 211 — all green.

- [ ] **Task 9 — Human verification (per project rule [[human-verification-ac-rule]]) — Jay verifies interactively**
  - [ ] **MANDATORY — the story is NOT done until Jay's observed result is recorded in Completion Notes.** Verify live on the **full Docker stack** (browser at `http://localhost` via the Caddy dev override; server as the **built Docker image** — a stable process, NOT `tsx watch`, because a watch restart drops in-memory timer/expiry wakes [[timer-verification-tsx-watch-gotcha]]). Provision the gitignored worktree `.env` and always `--build` with a **worktree-scoped compose project name** so you exercise this worktree's code, not a stale main-built image [[worktree-fullstack-testing-gap]].
  - [ ] Use the TD-5 bot swarm ([[td-5-player-simulator-test-harness]]) for two teams. Verify end-to-end:
    1. **Failed-round retry, identical bomb:** drive a team to **fail** a round (let the timer expire or force a 3rd strike). At between-rounds, the Facilitator clicks **"Retry round"** (single confirm) → the team re-enters Preparation and, on start, faces the **bit-for-bit identical bomb** (same module layout, same values — visually confirm the same modules/positions). The rotation does NOT advance (the same Defuser); the non-retried team rests (no dead screen).
    2. **Better-of-two scoring:** complete the retry. Confirm the scoreboard records the **better** of the two attempt times for that round (a faster retry replaces the failure time; a slower/again-failed retry leaves the recorded time unchanged), the round is **not** double-listed, and the cumulative total reflects the single best time.
    3. **Gating:** confirm a **defused** round offers no retry, and a non-facilitator never sees the control.
  - [ ] Record Jay's verbatim observed result + the date in Completion Notes (e.g. "Verified by Jay 2026-mm-dd: …"). Until then, status stays `review`, never `done`.

## Dev Notes

### Cross-Story Seam (READ FIRST — this is the integration hazard)

**8.8 is the THIRD and LAST story of the three-story Epic-8 server-state chain in this worktree** (internal order `8-9 → 8-7 → 8-8`, by file-collision hygiene — Sprint 5 analysis). Stories **8.9 (relay orchestration)** and **8.7 (pause)** already landed on this branch (`62e9032`, `d55c37b`). All three read-modify-write `SessionState` and pile onto the same files (`session.ts`, `round.ts`, `sessionHandlers.ts`, `session/*`, `round/*`). 8.8 adds **retry**:

- 8.9 added: the `PREPARATION_OPEN` relay-complete gate (`isRelayComplete` → `RELAY_COMPLETE`), the `ROUND_START` raw-index rotation + equalisation-volunteer commit + resting-team demotion, the `TEAM_ASSIGN` volunteer branch, and `TeamState.equalisationRoundsPlayed`/`equalisationVolunteerId`.
- 8.7 added: `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers, the mid-round `disconnect` auto-pause + `restoreReattachedSocket` restore, `PLAYER_READY` paused-phase widening, and `SessionState.pausedAt`/`pauseKind`/`disconnectedPlayerIds`.
- 8.8 adds: the `ROUND_RETRY` handler, the pure `retryRound` transition, the `cancelPreparation` retry reconcile, the `startRound` retry branch, the `resolveRound` better-of-two reconcile, `RoundState.outcomes`/`retry`, and (transient) `SessionState.retryingTeamId`.

**These are DIFFERENT concerns on the same files — additive, not conflicting.** 8.9 owns the rotation pick; 8.7 freezes the clock orthogonally; 8.8 re-runs a resolved round at the same number. **Rule: 8.8's additions must NOT refactor 8.9's or 8.7's paths.** Task 8(f) regression-tests that both still pass.

**8.8 reuses 8.9's resting-team machinery wholesale (AC-5).** A retry round runs only ONE team — identical to an odd-team equalisation round where only the shorter team plays. The `round.defusers` "one team only", the resting-team `defuser→expert` demotion, and the "ROUND_START arms only teams in `round.defusers`" loop all already exist (8.9). Do not reinvent them; route the retry into them.

**8.8 owns the pre-flagged `cancelPreparation` reconcile (deferred-work.md:7).** `cancelPreparation` infers its phase from `roundNumber >= 2` and blindly reverses `currentDefuserIndex` by `−1`. A retry preparation reuses `roundNumber` and does NOT advance the pointer, so the blind inverse would corrupt the relay if a retry prep is cancelled. Task 3 makes `cancelPreparation` retry-aware (clear the marker, no decrements). The in-code note in `cancelPreparation.ts` (lines 20–22) explicitly hands this to 8.8.

### The reused-seed guarantee is already built — 8.8 just re-runs the same roundNumber (AC-1)

Generation is **deterministic and reproducible from `(sessionId, roundNumber, config, teamId)`** (Story 8.2 / NFR10), and the generator headers say so explicitly:
- `assembleBomb.ts:40-43` — `templateSeed = deriveTemplateSeed(sessionId, roundNumber)`; layout drawn once from it (identical for all teams); per team a distinct `teamSeed = deriveTeamSeed(templateSeed, teamId)`. "Same inputs always reproduce the same bombs, which is what round retry (8.8) depends on (AC3)."
- `bombContext.ts:60-62` — "the same teamSeed always reproduces the same context (retry semantics, AC3)."
- `bombKey(sessionId, teamId)` is **per-team, NOT per-round** (`state/keys.ts:9`) — so a retry's `initializeRoundBombs` writes the regenerated (identical) bomb back to the same key, overwriting the stale failed-round bomb with a bit-for-bit copy. No per-round bomb key to clean up.

So 8.8 does **NOT** touch generation at all. It only ensures the retry `ROUND_START` runs with the **same `roundNumber`** (Task 3 keeps it unchanged) so `initializeRoundBombs(redis, sessionId, roundNumber, config, [retryingTeamId])` reproduces the identical bomb. The whole "identical bomb" AC is satisfied by *not incrementing the round number* and *re-running the existing prep→start pipeline*.

### Better-of-two times: replace in place, never append (AC-2)

`resolveRound` maintains `cumulativeTimeMs === sum(roundTimesMs)` and `roundTimesMs[i]` = the team's time for round `i+1` (session.ts:42-50). A first attempt appends. A **retry** must NOT append a second entry for the same round — it must replace `roundTimesMs[roundNumber-1]` with `min(previous, retryElapsed)` and shift `cumulativeTimeMs` by the (≤0) delta. This is the ONE behavioural change to `resolveRound`'s time spread; everything else (the per-team live-timer fence, the between-rounds gate, the announce + scoreboard emit) is untouched. The `RoundState.retry` flag (set true by the retry `startRound`, persisted, read back in `resolveRound`) is the discriminator.

### Why per-team retry (not whole-round) — and the open question

The session reaches `between-rounds` only after **every** participating team resolved (8.6 gate). A round can mix outcomes (A defused, B exploded). The pre-scaffolded `RoundRetryPayload { teamId }` and the GDD framing ("retry of a **failed** round", "the **team** re-enters Preparation", "better of the two **times**" — inherently per-team) all point to a **per-team retry**: the failed team re-plays the identical bomb while the other team rests (reusing 8.9's resting machinery). A team that already defused is never forced to replay. **This is the recommended interpretation and the design above is built on it.** A whole-round-both-teams retry is the alternative; it would force a defused team to replay (its better-of-two protects its score, but it is wasted effort) and does not match the `{ teamId }` payload. **If Jay prefers whole-round retry, the `startRound`/`resolveRound`/handler scope shifts — confirm before building the client affordance (see OPEN QUESTION at the end).**

### Per-team round outcome must be recorded to gate retry (AC-3)

`RoundState.status` is **last-writer-wins across teams** (round.ts:18-26) — it cannot tell you that team B specifically failed. To gate "only a failed round is retryable" the server needs the **per-team** outcome. Task 1 adds `RoundState.outcomes: Partial<Record<TeamId, RoundOutcome>>`, set in `resolveRound`. This resolves the round.ts in-code note about a "future per-team round-outcome model (Story 8.6/8.10)" and is the clean, additive way to gate retry server-side (the authority, not the client). The client learns which team failed via the between-rounds broadcast (Task 7 decision).

### Current state of files this story modifies (UPDATE files) — read each fully before editing

- **`packages/shared/src/types/round.ts`** — *current:* `RoundState { roundNumber, status: 'active'|RoundOutcome, defusers, retry: boolean }`; `retry` already present and documented as "Story 8.8 owns it"; the in-code note "a future per-team round-outcome model may widen this." *Change:* add `outcomes: Partial<Record<TeamId, RoundOutcome>>` (required). *Preserve:* `status` semantics (last-writer-wins; 8.5/8.6 read it), the `defusers` `Partial` shape, pure-TS no-runtime-deps.
- **`packages/shared/src/types/session.ts`** — *current:* `SessionState` with 8.7's `pausedAt`/`pauseKind`/`disconnectedPlayerIds` and `TeamState` with 8.9's `equalisationRoundsPlayed`/`equalisationVolunteerId?`. *Change:* add optional transient `retryingTeamId?: TeamId` to `SessionState` (additive, no construction-site sweep). *Preserve:* every 8.7/8.9 field; pure-TS.
- **`apps/server/src/session/startRound.ts`** — *current:* pure `preparation → active`; raw-index natural pick (no modulo), equalisation-volunteer commit (`EQUALISATION_VOLUNTEER_REQUIRED`) + counter bump + volunteer clear, resting-team `defuser→expert` demotion, integrity skip, `NO_POPULATED_TEAM`; builds `RoundState { …, retry: false }`. *Change:* add a `retryingTeamId`-gated retry branch (only the retried team in `defusers`, same Defuser via the unadvanced index, `retry: true`, marker cleared, no pointer/counter change); add `outcomes: {}` to the `RoundState` literal. *Preserve:* every existing branch, purity, the discriminated result, the role-reconciliation pass.
- **`apps/server/src/session/cancelPreparation.ts`** — *current:* pure `preparation → (lobby|between-rounds)`; derives originating phase from `roundNumber >= 2`; reverses pointer `−1` on the between-rounds path; `roundNumber--`; the in-code 8.8 note (lines 20-22). *Change:* retry-aware branch — when `retryingTeamId` set, return to `between-rounds` clearing the marker with `roundNumber`/pointer UNCHANGED. *Preserve:* the existing non-retry open∘cancel identity exactly.
- **`apps/server/src/session/openPreparation.ts`** — *current:* pure `lobby|between-rounds → preparation`; `roundNumber + 1`; pointer `+1` on the between-rounds path. *Change:* **none expected** — retry uses the new `retryRound` transition, NOT `openPreparation` (which would wrongly `+1` both). Read it to understand the contrast; do not edit unless a shared helper genuinely warrants it.
- **`apps/server/src/round/resolveRound.ts`** — *current:* the single resolution ceremony; per-team live-timer-key fence; displayed-elapsed convention; appends to `roundTimesMs` + `cumulativeTimeMs`; sets `RoundState.status` last-writer-wins; between-rounds gate; per-session serialization chain. *Change:* set `outcomes[teamId]`; make the time spread retry-aware (replace-in-place min on `retry === true`). *Preserve:* the fence, the gate, the announce/scoreboard emit, the serialization chain, immutability.
- **`apps/server/src/round/initializeRoundBombs.ts`** — *current:* generates + persists each team's bomb from `(sessionId, roundNumber, config, teamIds)`; per-team `bombKey`. *Change:* **none** — it already regenerates identically for the same `roundNumber`; the retry `ROUND_START` calls it with `teamIds = [retryingTeamId]`. Read to confirm.
- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* all the 8.6/8.9/8.7 facilitator handlers (`TEAM_ASSIGN`/`PREPARATION_OPEN`/`PREPARATION_CANCEL`/`ROUND_CONFIGURE`/`ROUND_START`/`FACILITATOR_PAUSE`/`FACILITATOR_RESUME`/`PLAYER_REMOVE`), the connection-time `restoreReattachedSocket`, the disconnect handler; ROUND_START's bomb-gen + timer-arm + BOMB_INIT loop; authority-gate-first + persist-then-emit throughout. *Change:* add the `ROUND_RETRY` handler (validate → authority-gate → between-rounds guard → failure gate via loaded `RoundState.outcomes` → `retryRound` → persist → broadcast). *Preserve:* EVERY existing handler/path, the pipeline conventions, durable-`playerId` resolution, error codes.
- **`apps/server/src/round/buildScoreboard.ts`** — *current:* pure `ScoreboardPayload` projection (per-team `cumulativeTimeMs` + `rounds` + provisional `winnerTeamId`). *Change (only if you take the recommended client path):* project the per-team last outcome / failed-teams so the Facilitator client can show retry per failed team. *Preserve:* the provisional-leader rule (8.10 owns the real winner).
- **Client:** `apps/client/src/ui/Scoreboard.tsx` (add the "Retry round" `ConfirmButton` + emit `ROUND_RETRY`; extend the owned `ERROR` code set), `apps/client/src/ui/copy.ts` (retry copy), and — if extending the payload — `apps/client/src/store/gameStore.ts`/`net/bindServerEvents.ts` already wire `SCOREBOARD`→`setScoreboard`. *Preserve:* the role-gated rendering, the `ConfirmButton` single-confirm pattern, the advance-error filter discipline (don't clear on broadcasts), status-driven `App.tsx` routing.

### Decisions to make and record (do not leave implicit)

1. **Retry granularity (Dev Notes above):** per-team retry (recommended — matches `{ teamId }` payload, GDD "failed round", reuses 8.9 resting machinery) vs whole-round. **Confirm with Jay if unsure (OPEN QUESTION).**
2. **Per-team outcome storage (Task 1):** `RoundState.outcomes` (recommended) — additive, resolves the round.ts deferred note, server-authoritative retry gate.
3. **Retry intent marker (Task 1):** transient `SessionState.retryingTeamId?` consumed by `startRound` (mirrors `equalisationVolunteerId`). Record if you choose another carrier.
4. **Retry flow shape (Task 6):** two-click (`ROUND_RETRY` → prep, then `ROUND_START`) reusing the whole pipeline (recommended) vs one-click "retry now". The AC-1 "single action + single confirm" = the `ROUND_RETRY` trigger.
5. **`cancelPreparation` reconcile (Task 3):** retry-aware clear-marker-no-decrement; resolves deferred-work.md:7.
6. **Better-of-two mechanics (Task 5):** replace-in-place `min` at `roundTimesMs[roundNumber-1]`, shift `cumulativeTimeMs` by the ≤0 delta; desync fallback = log + best-effort append, never throw.
7. **Retry-of-an-equalisation-round (Task 4 edge):** reuse persisted `defusers[teamId]` OR explicitly defer; record.
8. **Client failure signal (Task 7):** extend `ScoreboardPayload` with per-team outcome/`failedTeams` (recommended) vs always-show + server refuse.

### Project Structure Notes

- New server files: `apps/server/src/session/retryRound.ts` (+ `__tests__/retryRound.test.ts`), beside `openPreparation.ts`/`cancelPreparation.ts`/`relayComplete.ts`/`equalisationVolunteer.ts`/`pauseSession.ts`. Everything else is additive edits to existing files.
- No new socket events (`ROUND_RETRY` + `RoundRetryPayload` are pre-scaffolded). The shared-type edits are additive (`RoundState.outcomes`, `SessionState.retryingTeamId?`, optional `ScoreboardPayload` extension). Naming: events `SCREAMING_SNAKE_CASE`; types `PascalCase`; functions `camelCase` (`retryRound`).
- No new client surface — retry rides the existing `between-rounds → preparation → active` status routing; the resting team reuses the 8.9 standby behaviour.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative / pure-reducer pattern:** game logic in pure functions `(state) => newState` that never import `socket.io`/`ioredis`/`pg`/`fastify`; **handlers own all I/O** (parse → load → reduce → persist → emit). `retryRound`/`cancelPreparation`/`startRound`/`resolveRound`'s reducer parts are pure; the `ROUND_RETRY` handler holds the `io`/`redis` refs.
- **State is never mutated in place** — return new objects via spread/map for `SessionState`/`TeamState`/`RoundState` (incl. the new `outcomes`, the replace-in-place `roundTimesMs`, the `retryingTeamId` set/clear).
- **NEVER emit a socket event from inside a reducer** — emission lives in the handler.
- **NEVER run the bomb timer on the client** — server owns the clock; the retry timer arms server-side via the existing ROUND_START path.
- **NEVER write to PostgreSQL inside a Socket.IO handler** — retry adds NO Postgres write (session history is Story 8.10's at session end); the better-of-two lives in Redis session state during play.
- **Typed events only:** reuse `ServerToClientEvents`/`ClientToServerEvents`; `socket.emit(string, any)` is forbidden.
- **Authority gate first:** `ROUND_RETRY` resolves the caller by the durable `socket.data.playerId` against freshly-loaded state, refusing non-facilitators before revealing anything (before the round load).
- **Injected clock:** never `Date.now()`/`setTimeout` in pure logic or tests — pass `now` / inject `deps.timer.now()` (the retry's resolution dates its elapsed via the injected clock, the 8.5 path).
- **60fps / R3F:** the retry button + resting standby are DOM/state only — no per-frame work, no Three.js change.

### Testing standards summary

- Pure logic (`retryRound`, `cancelPreparation`, `startRound`, the `resolveRound` reducer parts) → Jest unit tests with **injected state / `now`, never `Date.now()`/`setTimeout`**; deep-frozen-input immutability tests.
- Server effects/handlers → the existing in-memory store / `TestSocketServer` / `createTestScheduler` patterns (`apps/server/src/handlers/__tests__/testSocketServer.ts`, `round/__tests__/`, `session/__tests__/`); assert the regenerated retry bomb deep-equals the original (same seeds).
- Client: `Scoreboard` component test via the TD-1 framework / vitest; confirm `App.tsx` routing unchanged.
- Quality gate is `pnpm typecheck` (`tsc --noEmit`, husky pre-commit; no ESLint). Keep the full server/client/shared suites green.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.8: Retry a Failed Round] — the two ACs (failed round → single action + single confirm → identical bomb from reused seed + re-enter Preparation; better of the two times kept).
- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.2: Per-Team Bomb Generation] — "the same `(sessionId, roundNumber, teamId)` reproduces the identical bomb (supporting retry)" — the reused-seed guarantee 8.8 relies on.
- [Source: _agent_docs/planning-artifacts/epics.md (FR14, NFR10)] — Facilitator retry of a failed round (same layout/values via reused seed), better of two times recorded; deterministic seeded generation reproducible from `(sessionId, roundNumber, teamId)`.
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md:108, :525, :531] — "Facilitator may optionally trigger a retry of the same round; if retried, the better of the two times is recorded"; "Retry … same layout, same values … Better of the two times is recorded"; "Failed rounds contribute time at the moment of failure."
- [Source: _agent_docs/implementation-artifacts/Sprint 5 — Relay, resilience & full voice parallelization analysis.md:14, :26] — "8-8 has a pre-flagged reconcile waiting for it" (cancelPreparation); "8-8 wires `ROUND_RETRY` … reconciles `cancelPreparation.ts` … reuses `startRound`'s templateSeed/teamSeed to regenerate the identical bomb"; the `8-9 → 8-7 → 8-8` chain ordering.
- [Source: _agent_docs/implementation-artifacts/8-9-relay-orchestration-and-odd-team-equalisation.md] — the resting-team machinery (`round.defusers` one-team-only, `defuser→expert` demotion, ROUND_START arms only `round.defusers`) 8.8 reuses; the raw-index Defuser pick; the `equalisationVolunteerId` "explicit intent consumed by startRound" precedent.
- [Source: _agent_docs/implementation-artifacts/8-7-pause-facilitator-and-disconnect.md] — the additive-not-refactor discipline on the shared `sessionHandlers.ts`/`session.ts`; the authority-gate-first + persist-then-emit + pure-transition-then-thin-effect pipeline; injected-clock testing.
- [Source: apps/server/src/session/startRound.ts] — the rotation/equalisation/resting branches + the `RoundState { …, retry: false }` literal to extend; the role-reconciliation pass.
- [Source: apps/server/src/session/openPreparation.ts + cancelPreparation.ts] — the `roundNumber`±1 + pointer ±1 the retry path must NOT do; the in-code 8.8 reconcile note (cancelPreparation.ts:20-22).
- [Source: apps/server/src/round/resolveRound.ts] — the append → replace-in-place change point; the `RoundState.status` set (add `outcomes`); the per-team fence + between-rounds gate to preserve.
- [Source: apps/server/src/round/initializeRoundBombs.ts + packages/shared/src/generation/assembleBomb.ts + bombContext.ts] — deterministic regeneration from `(sessionId, roundNumber, config, teamIds)`; the per-team `bombKey` (not per-round) so a retry overwrites with an identical bomb.
- [Source: apps/server/src/handlers/sessionHandlers.ts:779 (TEAM_ASSIGN), :916 (PREPARATION_OPEN), :1148 (ROUND_START)] — the facilitator-action pipeline the `ROUND_RETRY` handler copies; the ROUND_START bomb-gen + timer-arm + BOMB_INIT loop the retry start reuses.
- [Source: packages/shared/src/types/round.ts] — `RoundState` (add `outcomes`; `retry` already present + flagged for 8.8); the "future per-team round-outcome model" note this story resolves.
- [Source: packages/shared/src/types/session.ts] — `SessionState`/`TeamState` (add transient `retryingTeamId?`; preserve 8.7/8.9 fields); `roundTimesMs`/`cumulativeTimeMs` invariant.
- [Source: packages/shared/src/events/client-to-server.ts:59 + payloads.ts:75] — the pre-scaffolded `ROUND_RETRY` + `RoundRetryPayload { teamId }` (do not redeclare).
- [Source: apps/client/src/ui/Scoreboard.tsx + ConfirmButton.tsx + copy.ts] — the between-rounds surface to add "Retry round" to; the single-action-single-confirm pattern; the owned-`ERROR`-code filter; the copy conventions.
- [Source: apps/client/src/store/gameStore.ts + net/bindServerEvents.ts] — `resolution` is the SELF-team outcome only (why the Facilitator needs the between-rounds broadcast to learn which team failed); `SCOREBOARD`→`setScoreboard` wiring.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:7, :104] — the `cancelPreparation` reconcile this story OWNS ("resolve when retry lands"); mark it RESOLVED.
- [Source: _agent_docs/project-context.md] — critical implementation rules (pure reducers, no PG in handlers, typed events, authority-gate-first, server-authoritative clock, injected clock).

### Git Intelligence (recent commits)

- `d55c37b feat(story-8.7): pause — facilitator & disconnect` (baseline, this worktree) — modified `sessionHandlers.ts` (added pause/resume + disconnect), `session.ts` (`SessionState` pause fields), new `pauseSession.ts`/`pauseTimers.ts`. **8.8 must preserve every 8.7 path** — its changes are additive to the same files.
- `62e9032 feat(story-8.9): relay orchestration & odd-team equalisation` — added the resting-team machinery + raw-index rotation + `equalisationVolunteerId` precedent 8.8 reuses; modified `startRound.ts`/`sessionHandlers.ts`/`session.ts`/`assignTeam.ts`, new `relayComplete.ts`/`equalisationVolunteer.ts`. **Preserve every 8.9 path.**
- `82df63c feat(story-8.6): between-round flow & scoreboard preview` — the all-teams-resolved between-rounds gate (`resolveRound.ts`), `buildScoreboard.ts`, the `Scoreboard.tsx` surface 8.8 adds the retry button to. Persist-then-emit; desync paths logged, never thrown — follow exactly.
- Sprint-4 retro action item: **every story ships explicit human-validation instructions** — Task 9 honours this; do not skip it. The recurring load-modify-store/concurrency theme: the retry handler's load→reduce→persist is single-key (session) + a read of the round; keep it on the accepted single-process V1 posture (the resolution serialization chain already covers concurrent resolutions).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story)

### Debug Log References

- `pnpm typecheck` (all 5 workspace packages) — clean.
- Server `apps/server`: 32 suites / **505** tests green (was 480; +25 for retry).
- Client `apps/client`: 39 files / **319** tests green (was 315; +4 Scoreboard retry).
- Shared `packages/shared`: 9 suites / 211 tests green.

### Completion Notes List

**Implemented (Tasks 1–8). Task 9 (Jay's interactive verification) — ❌ FAILED 2026-06-21, status stays `review`.**

**Bug found by Jay 2026-06-21 (interactive Docker run):** after "Retry round", the **WRONG PLAYER** was armed as Defuser — the rotation had moved to the **next** player in line instead of re-arming the player who just failed. (Initially mis-described as a bomb-layout difference; it was the Defuser, not the bomb.) Violates AC-1's "the rotation does NOT advance (the same Defuser)".

**ROOT CAUSE (confirmed):** a Story-8.11 (Model B) regression in the 8.8 retry path. 8.8 was written assuming `retryRound` "left the pointer unadvanced, so it still points at the original round's Defuser" — true under 8.9's model, where the pointer advanced in `openPreparation`. But **8.11 moved the per-team pointer advance into `resolveRound`** (advance only when a team plays). So when a natural round FAILS, `resolveRound` increments `currentDefuserIndex` to the NEXT slot; by retry time `startRetryRound`'s `relayOrder[currentDefuserIndex]` read returned the next player. 8.11 reworked the pointer timing and never reconciled this 8.8 retry pick.

**FIX (2026-06-21):** replay the **EXACT** Defuser the failed round recorded, not an index recomputation (which is also ambiguous at the rotation boundary / for an equalisation round). Added a transient `SessionState.retryDefuserId` (optional, like `retryingTeamId`): the `ROUND_RETRY` handler reads `RoundState.defusers[teamId]` (the player who actually played the failed round) and passes it to `retryRound(state, teamId, defuserId)`; `startRetryRound` commits `state.retryDefuserId` (validated against the roster + the retrying team's `relayOrder`) and clears both markers; `cancelPreparation` clears them too. Pointers/`roundNumber`/counters remain untouched, so the bomb is still the identical reused-seed bomb. New unit regression (`startRound.test.ts`): with the pointer already advanced past the failed player, the retry still arms the failed player (not the next). typecheck clean; shared 216 / server 539 / client 396 + sim-verify 7/7 green.

**Status stays `review`** — awaiting Jay's interactive re-verification of (a) the SAME Defuser re-arms on retry with the identical bomb, and (b) better-of-two scoring (which he did not reach on the first run).

Per-team retry granularity confirmed correct by Jay ("your decision is right"). Key design decisions (as recorded in Dev Notes "Decisions to make and record"):

1. **Per-team retry (Decision 1):** only the FAILED team re-plays the identical bomb; the other team rests (reusing the Story 8.9 resting-team machinery — absent from `round.defusers`, no timer armed, stale `defuser` demoted to `expert`). Matches the pre-scaffolded `RoundRetryPayload { teamId }` and the per-team "better of two times".
2. **Per-team outcome storage (Decision 2):** added `RoundState.outcomes` (set in `resolveRound`) — the authoritative per-team result the `ROUND_RETRY` failure gate reads. Resolves the round.ts "future per-team round-outcome model" note.
3. **Retry intent marker (Decision 3):** transient `SessionState.retryingTeamId?`, set by the pure `retryRound` transition and consumed by `startRound` (mirrors `equalisationVolunteerId`).
4. **Retry flow (Decision 4):** two-click (`ROUND_RETRY` re-enters preparation at the SAME `roundNumber`, then the Facilitator's `ROUND_START` regenerates the identical bomb via `startRound`'s retry branch). Reuses the whole prep→active pipeline (bomb gen, timer arm, team rooms, BOMB_INIT) — zero duplication. AC-1's "single action + single confirm" = the confirm-gated `ROUND_RETRY` button.
5. **`cancelPreparation` reconcile (Decision 5, deferred-work.md:7 — RESOLVED):** a retry prep is detected by `retryingTeamId` and cancelled cleanly (return to between-rounds, clear marker, NO `roundNumber--`/pointer `−1`). Non-retry open∘cancel identity preserved.
6. **Better-of-two (Decision 6):** `resolveRound` replaces `roundTimesMs[roundNumber-1]` with `min(previous, elapsed)` on `retry === true` and shifts `cumulativeTimeMs` by the (≤0) delta — never appends a second entry. Invariant `cumulativeTimeMs === sum(roundTimesMs)` preserved. Desync (no prior slot) → logged append fallback, never throws.
7. **Retry-of-equalisation-round (Decision 7 → option (b)):** DEFERRED in V1. The same-Defuser pick uses the raw unadvanced index; an exhausted index (the original was a volunteer/equalisation round) yields no pick → `NO_POPULATED_TEAM`. Common retry target is a natural round; documented in `startRound.ts` + a test.
8. **Client failure signal (Decision 8):** extended `ScoreboardPayload` with `failedTeams?: TeamId[]` (additive), computed in `resolveRound` from the complete per-team `outcomes` and broadcast on the between-rounds `SCOREBOARD`. The Scoreboard shows a confirm-gated "Retry round" per failed team (facilitator-only). The server re-gates regardless (authority).

**Reused-seed guarantee (AC-1):** verified by a handler test that runs round 1 to active, captures Team A's generated bomb, seeds a failed between-rounds snapshot (same `roundNumber`), retries, and asserts the regenerated bomb `toEqual`s the original — bit-for-bit identical because the retry reuses the same `roundNumber` (same `templateSeed`/`teamSeed`). No change to generation code; `bombKey` is per-team (not per-round) so the retry overwrites with an identical bomb.

**Regression:** every 8.9 (relay/equalisation) and 8.7 (pause/disconnect) path in `sessionHandlers.ts` is preserved and still green in the same file; the `ROUND_RETRY` handler is a pure addition. `App.tsx` routing untouched.

### File List

**Production**
- `packages/shared/src/types/round.ts` — added `RoundState.outcomes` (required); documented `retry`.
- `packages/shared/src/types/session.ts` — added transient `SessionState.retryingTeamId?`.
- `packages/shared/src/events/payloads.ts` — added `ScoreboardPayload.failedTeams?`.
- `apps/server/src/session/retryRound.ts` — NEW: pure `retryRound` transition.
- `apps/server/src/session/cancelPreparation.ts` — retry-aware reconcile (clear marker, no decrements).
- `apps/server/src/session/startRound.ts` — `retryingTeamId`-gated `startRetryRound` branch; `outcomes: {}` on the normal literal.
- `apps/server/src/round/resolveRound.ts` — per-team `outcomes` record; retry better-of-two replace-in-place; `failedTeams` in the SCOREBOARD emit.
- `apps/server/src/handlers/sessionHandlers.ts` — `ROUND_RETRY` handler + `parseRoundRetryPayload`; `RoundState` type import.
- `apps/client/src/ui/Scoreboard.tsx` — facilitator "Retry round" affordance (per failed team); retry error codes; `ROUND_RETRY` emit.
- `apps/client/src/ui/copy.ts` — `RETRY_ROUND` + `RETRY_ROUND_TEAM`.

**Tests**
- `apps/server/src/session/__tests__/retryRound.test.ts` — NEW.
- `apps/server/src/session/__tests__/cancelPreparation.test.ts` — retry-prep cancel reconcile.
- `apps/server/src/session/__tests__/startRound.test.ts` — retry branch + exhausted-team refusal.
- `apps/server/src/round/__tests__/resolveRound.test.ts` — outcomes + better-of-two + desync + SCOREBOARD failedTeams; literal fixups.
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — `ROUND_RETRY` block (identical-bomb, gates, authority); `RoundState` shape fixup.
- `apps/server/src/timer/__tests__/timerScheduler.test.ts` — `RoundState` literal fixup.
- `apps/client/src/ui/__tests__/Scoreboard.test.tsx` — retry affordance block.

**Docs**
- `_agent_docs/implementation-artifacts/deferred-work.md` — marked the `cancelPreparation` reconcile RESOLVED by 8.8.
- `_agent_docs/implementation-artifacts/sprint-status.yaml` — 8-8 → in-progress → review.

### Change Log

- 2026-06-20 — Story 8.8 implemented (Tasks 1–8): retry a failed round — `RoundState.outcomes` + per-team retry gate, pure `retryRound` (same `roundNumber` → identical bomb), `startRound` retry branch (arm only the failed team, rest the other), `resolveRound` better-of-two replace-in-place, `ROUND_RETRY` handler (authority + failure-gated), `cancelPreparation` reconcile (deferred-work.md:7 resolved), and the client "Retry round" affordance driven by `ScoreboardPayload.failedTeams`. All typecheck + server/client/shared suites green. Task 9 (Jay's interactive verification) outstanding.
- 2026-06-21 — **Post-verification fix (Jay's run exposed a Model-B regression):** the retry armed the NEXT player, not the one who failed — `startRetryRound` recomputed the Defuser from `currentDefuserIndex`, but Story 8.11 moved the pointer advance into `resolveRound`, so the index had already advanced. Fix: carry the exact failed-round Defuser explicitly via a new transient `SessionState.retryDefuserId` (handler reads `RoundState.defusers[teamId]` → `retryRound` → `startRetryRound` commits it; `cancelPreparation` clears it). Files: `packages/shared/src/types/session.ts`, `apps/server/src/session/{retryRound,startRound,cancelPreparation}.ts`, `apps/server/src/handlers/sessionHandlers.ts`; tests `apps/server/src/session/__tests__/{retryRound,startRound}.test.ts` (+ new advanced-pointer regression). typecheck clean; shared 216 / server 539 / client 396 + sim-verify 7/7 green. Re-verification by Jay still outstanding.

---

## OPEN QUESTION FOR JAY (raised during story creation — confirm before/while building Task 7)

**Retry granularity: per-team or whole-round?** This story is written for a **per-team retry** — only the team that *failed* re-plays the identical bomb; a team that defused keeps its result and rests during the retry (reusing Story 8.9's resting-team machinery). This matches the pre-scaffolded `RoundRetryPayload { teamId }`, the GDD's "retry of a **failed** round", and the inherently-per-team "better of the two **times**". The alternative — **both teams replay the round together** — would force a defused team to re-run a bomb it already solved (its better-of-two protects its score, but it's wasted effort) and doesn't fit the `{ teamId }` payload. If you intended whole-round retry, the `startRound`/`resolveRound`/handler scope shifts (both teams in `round.defusers`, two better-of-two reconciles) — flag it and the dev agent will adjust before wiring the client affordance.
