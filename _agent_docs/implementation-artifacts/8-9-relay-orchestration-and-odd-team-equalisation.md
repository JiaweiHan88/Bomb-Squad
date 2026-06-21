---
baseline_commit: b536b01
---

# Story 8.9: Relay Orchestration & Odd-Team Equalisation

Status: done

<!-- 2026-06-21: Task 8 re-verification COMPLETE. Jay interactively verified the relay/equalisation behaviour during the Story 8.11 (Sequential Round Orchestration) Docker run — correct play order for even AND uneven teams, the uneven case adds a facilitator-chosen-Defuser equalisation round, identical layout per pair, correct next-round status. The relay spine 8.9 built (reshaped to Model B's per-team pointer by 8.11) is confirmed. See 8-11 Task 10 + bugs-epic8-2026-06-21.md. -->

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want the relay to rotate the Defuser across all players and equalise odd team sizes,
so that every player defuses at least once and the competition is fair.

## Acceptance Criteria

1. **Rotation covers every player (the relay's spine).** As rounds progress, the Defuser role rotates so that **every player on a team defuses at least once before the session ends**. The rotation pointer advance (`openPreparation` `+1` per team per round, Story 8.6) is the mechanism; this story adds the **completeness guarantee + a terminal "relay complete" check** on top of it. Concretely: a team of N players plays N natural rounds, its `currentDefuserIndex` walking `0 → 1 → … → N-1`, so each of its `relayOrder` entries is the committed Defuser exactly once.

2. **Odd-team equalisation (the shorter team plays one extra round).** When the two teams have **unequal player counts**, the shorter team would naturally finish its rotation first (fewer players → fewer natural rounds). To equalise round count, the shorter team plays **one extra round per shortfall round** with a **Facilitator-assigned volunteer Defuser** (a player who already defused, chosen by the Facilitator). The result is that **both teams play the same number of rounds**. The volunteer is an explicit Facilitator choice — the server never auto-picks the repeat Defuser (GDD: "Facilitator assigns a volunteer Defuser").

3. **Relay structure (per-round serialisation moved to Story 8.11).** This story guarantees the relay *structure* only: one shared round number and one between-rounds gate, never two independent relays. The per-round **serialisation** — only the active team's bomb is live while the non-active team spectates — is **owned by Story 8.11 (Sequential Round Orchestration)**, NOT this story; 8.9 must not contradict it. The resting team (one whose `relayOrder` is exhausted while the other is still equalising) must not be stranded or shown a dead surface. _Rationale: parallel defuse is explicitly deferred — `gdd.md:758`, `gdd.md:137`, `game-architecture.md:182`._
   > **CORRECTION 2026-06-20 (see `sprint-change-proposal-2026-06-20.md`):** the original wording of this AC — "both teams play the same rounds sequentially … honoured at the *relay-structure* level [while] the current V1 arms both teams' bombs concurrently" — reinterpreted "sequential" into the explicitly-deferred parallel-defuse behaviour. That serialisation gap is now Story 8.11's responsibility; this AC is descoped to relay-structure only. 8.9's interactive re-verification (Task 8) runs **after** 8.11 lands.

4. **Relay-complete terminal check → session may end.** When **every team has completed its full rotation** (including any equalisation rounds), the relay is **complete**: the server marks the relay terminal so that Story 8.10 (final scoreboard + session-end persistence) can transition the session to `'ended'`. This story OWNS the **terminal-detection predicate** (a pure `isRelayComplete(session)` reading `relayOrder` lengths + `currentDefuserIndex` + equalisation bookkeeping); it does NOT itself write Postgres, render the final scoreboard, or flip to `'ended'` — those are Story 8.10's. The Facilitator's "advance" affordance (the between-rounds `PREPARATION_OPEN`) is **gated**: once the relay is complete, advancing opens an **equalisation round** if one is owed, otherwise it surfaces "relay complete — end the session" rather than silently re-opening prep and wrapping the rotation back to player 0 (the current uncapped behaviour).

5. **No regression to the existing pointer advance or between-rounds flow.** The Story 8.6 simple `+1` rotation advance, the all-teams-resolved between-rounds gate (Story 8.5/8.6), `cancelPreparation`'s inverse restore, and `startRound`'s `relayOrder[currentDefuserIndex]` pick all remain correct. Round 1 (lobby → preparation, indices at 0) is unchanged. Equal-size teams (the common case) play the natural rotation with **zero** equalisation rounds and reach relay-complete together.

## Tasks / Subtasks

- [x] **Task 1 — Shared contract: equalisation bookkeeping on `TeamState` / relay model (AC: 1, 2, 4)**
  - [x] In `packages/shared/src/types/session.ts`, decide and add the minimal bookkeeping needed to (a) detect relay completion and (b) track owed/played equalisation rounds. Recommended: a per-team counter such as `equalisationRoundsPlayed: number` (default `0`) on `TeamState`, OR a derived model that compares `currentDefuserIndex + 1` against `relayOrder.length` and the two teams' player counts. **Keep the addition minimal and additive** — every new required field surfaces at every `TeamState` construction site (the typecheck enumerates them; see Task 2). Prefer a single counter over a richer structure unless completion detection genuinely needs more.
  - [x] Document the **natural round count** definition: a team's natural rounds = `relayOrder.length` (each player defuses once). Total rounds for the session = `max(teamA.length, teamB.length)`. The shorter team owes `max - min` equalisation rounds.
  - [x] Do **NOT** add new socket events. `PREPARATION_OPEN` / `PREPARATION_CANCEL` / `ROUND_START` / `SESSION_STATE` already carry everything. The volunteer assignment (Task 4) reuses an **existing** facilitator action — see Task 4 for the chosen mechanism; do not invent a `RELAY_VOLUNTEER`/`ASSIGN_VOLUNTEER` event without first confirming `TEAM_ASSIGN` cannot express it.
  - [x] Run `pnpm typecheck` — a new required `TeamState` field is a compile error at every literal until initialised. Fix them all; never leave a runtime `undefined`.

- [x] **Task 2 — Initialise the new field at every `TeamState` construction site (AC: 1, 5)**
  - [x] `apps/server/src/session/assignTeam.ts` — the **only production** `TeamState` constructor (~line 60, beside `currentDefuserIndex: 0` / `cumulativeTimeMs: 0` / `roundTimesMs: []`): add the new field's zero value.
  - [x] Grep the whole workspace for other `TeamState` literals (server `__tests__`, `apps/client/src/test/fixtures.ts`, any client fixture). Every literal adds the field. The Task-1 typecheck is the authority — do not hand-wave; Story 8.6 had ~8 such sites.

- [x] **Task 3 — Pure relay-completion predicate (AC: 1, 4)**
  - [x] Add a pure function (co-locate near `openPreparation.ts`, or a new `apps/server/src/session/relayComplete.ts`) `isRelayComplete(session: SessionState): boolean`. Returns `true` when **every** team has had its full rotation committed AND any owed equalisation rounds are played. Reads only `session.teams` (`relayOrder.length`, `currentDefuserIndex`, the Task-1 bookkeeping). No I/O, no clock, no randomness. Pure projection of `SessionState`.
  - [x] Define the predicate precisely against the **pointer semantics**: `currentDefuserIndex` points at the round currently in prep/about-to-start (Story 8.3/8.6 — it is advanced in `openPreparation` *before* `ROUND_START` reads it). So "team T has just finished its last natural round" is detectable when, after that round resolves, advancing would push the pointer to `relayOrder.length` (i.e. past the last player). Write a unit test table for: 1-player teams; equal 3v3; odd 3v2; odd 4v1; single-team session; empty team.
  - [x] Add a helper `equalisationRoundsOwed(session): Partial<Record<TeamId, number>>` (or similar) computing `max(len) - len` per team — the number of extra rounds the shorter team must play. The longer team owes 0. This feeds the Task-5 advance gate and the Task-4 volunteer surface.

- [x] **Task 4 — Odd-team volunteer Defuser assignment (AC: 2)**
  - [x] **Mechanism decision (make it explicitly, record it in Dev Notes + code):** the Facilitator must designate which already-defused player repeats as the volunteer for an equalisation round. Evaluate, in order: (a) reuse `TEAM_ASSIGN` to set that player back to `defuser` before the equalisation `ROUND_START` (rotation normally overrides the lobby pick — but for an equalisation round the pick must be *honoured*, so this requires `startRound` to consult an explicit override); (b) a small dedicated facilitator action. **Prefer (a) if it composes cleanly**; the deferred 8.6 decision (c) made rotation the sole defuser authority, so an equalisation round needs a deliberate, documented exception where the Facilitator's choice — not `relayOrder[currentDefuserIndex]` — selects the Defuser.
  - [x] Implement the chosen mechanism so that during an equalisation round, `startRound` commits the **Facilitator-chosen volunteer** (not the wrapped-around rotation pick) for the shorter team, while the longer team (if it has a natural round left) or the resting team behaves correctly. The volunteer MUST be a player already on that team's `relayOrder` (validate; refuse an off-team / unknown player with a typed `ERROR`, authority-gate-first).
  - [x] Increment the Task-1 equalisation counter when an equalisation round is committed, so `isRelayComplete` and `equalisationRoundsOwed` converge to "done" after the owed count is played.

- [x] **Task 5 — Gate the between-rounds advance on relay completion (AC: 4, 5)**
  - [x] In `apps/server/src/handlers/sessionHandlers.ts` `PREPARATION_OPEN` handler: after the existing authority gate + phase guard + `hasPopulatedTeam` guard, consult `isRelayComplete` / `equalisationRoundsOwed`. Three outcomes when advancing **from `'between-rounds'`**:
    1. A team still has natural rounds left → open prep as today (Story 8.6 `+1` advance).
    2. The shorter team owes equalisation rounds (and the longer team's rotation is done) → open prep for the **equalisation round**; the shorter team's Defuser is the Facilitator-assigned volunteer (Task 4), the longer team rests/spectates (no bomb armed for it — `round.defusers` must omit a team with no eligible Defuser; confirm `startRound` already skips a team whose pick is absent, and extend so a *resting* team is cleanly excluded).
    3. Relay fully complete (no natural rounds, no owed equalisation) → **refuse** the silent rotation-wrap with a typed `ERROR` (e.g. `RELAY_COMPLETE`, message "The relay is complete — end the session."). Story 8.10 owns the actual session-end transition; this story just stops the uncapped wrap-around the current code would do.
  - [x] Preserve the authority-gate-first ordering (a non-facilitator probe learns nothing), persist-then-emit, and every existing error code. Do not weaken the `hasPopulatedTeam` guard.
  - [x] **Reconcile with `openPreparation` purity:** the `+1` advance stays in `openPreparation` for natural rounds. The equalisation-round open must NOT blindly `+1` past the end (that is the wrap-around bug). Decide whether the equalisation path advances the pointer at all (it likely should NOT advance `currentDefuserIndex` — the volunteer is an explicit pick, not the next rotation slot) — keep `openPreparation` pure and make the handler choose the path.

- [x] **Task 6 — Resting-team spectate / no dead surface (AC: 3)**
  - [x] During an equalisation round only one team has an armed bomb. Confirm the resting team's players are not routed to a dead bomb surface: `ROUND_START` arms timers + emits `BOMB_INIT` only for teams in `round.defusers` (`sessionHandlers.ts` ~1050–1115). A resting team must be **absent** from `round.defusers`. Verify the client routes a player whose team is not in the active round to a spectate/standby view (reuse the between-rounds/spectator surface conventions; this story should NOT need a new client surface — confirm the existing `ActiveRound`/`Scoreboard` routing degrades gracefully, and add a minimal standby only if a genuine dead-screen is found).
  - [x] Cross-check the deferred item *"Stale `defuser` role on a skipped team after `ROUND_START`"* (deferred-work.md:108) and *"`currentDefuserIndex` not re-clamped when a player leaves relayOrder"* (deferred-work.md:78): this story OWNS rotation/index mechanics, so resolve or explicitly re-defer the index-clamp item with a note. A resting/skipped team must not retain a stale `defuser` that strands its players on the bomb surface.

- [x] **Task 7 — Tests (AC: 1–5)**
  - [x] `apps/server/src/session/__tests__/relayComplete.test.ts` (new): `isRelayComplete` + `equalisationRoundsOwed` truth tables — equal 3v3 (complete after 3 rounds, 0 owed), odd 3v2 (B owes 1; complete only after the equalisation round), odd 4v1, single-team, empty team, 1v1. Injected state only; pure.
  - [x] `apps/server/src/session/__tests__/openPreparation.test.ts` (extend): equalisation-round open does NOT advance the pointer past the end / does the right thing per the Task-5 decision; natural rounds still `+1`; round 1 unchanged.
  - [x] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` (extend): (a) full relay walk for an **odd** session (e.g. A=2, B=1) — natural rounds rotate every player once, then the advance offers B's equalisation round with the Facilitator-assigned volunteer, then a further advance is refused `RELAY_COMPLETE`; (b) **equal** session reaches relay-complete with zero equalisation rounds and the advance is refused `RELAY_COMPLETE`; (c) a non-facilitator advance is still `NOT_FACILITATOR` (authority gate unbroken); (d) the volunteer assignment refuses an off-team / unknown player. Use the existing `TestSocketServer` / in-memory store patterns; injected clock only — never `Date.now()`/`setTimeout`.
  - [x] `apps/server/src/session/__tests__/startRound.test.ts` (extend): an equalisation round commits the Facilitator-chosen volunteer (not the wrapped rotation pick); a resting team is absent from `round.defusers` and its players are not force-set to `defuser`.
  - [x] Client: if any routing change was needed (Task 6), add/extend a component or store test for the resting-team standby; if no client change was needed, record that decision (the `App.tsx` status routing already covers it).
  - [x] Run `pnpm typecheck` (the project quality gate — husky pre-commit `tsc --noEmit`, no ESLint) and the full suite; all green.

- [ ] **Task 8 — Human verification (per project rule [[human-verification-ac-rule]]) — Jay verifies interactively**
  - [ ] **MANDATORY — the story is NOT done until Jay's observed result is recorded in Completion Notes.** Verify live on the **full Docker stack** (browser at `http://localhost` via the Caddy dev override; server as the **built Docker image** — a stable process, NOT `tsx watch`, because a watch restart drops in-memory timer/expiry wakes [[timer-verification-tsx-watch-gotcha]]). Provision the gitignored worktree `.env` and always `--build` with a **worktree-scoped compose project name** so you exercise this worktree's code, not a stale main-built image [[worktree-fullstack-testing-gap]].
  - [ ] Use the TD-5 bot swarm ([[td-5-player-simulator-test-harness]]) to supply two teams. Verify two scenarios end-to-end:
    1. **Equal teams** (e.g. 2v2): every player defuses exactly once; after the last natural round the Facilitator's advance reports relay complete (no silent wrap to player 0); zero equalisation rounds.
    2. **Odd teams** (e.g. 2v1): every player defuses once in the natural rounds; the shorter team then plays one extra round with a Facilitator-assigned volunteer Defuser; both teams end on the same round count; the resting team can spectate (no dead screen); after the equalisation round the advance reports relay complete.
  - [ ] Record Jay's verbatim observed result + the date in Completion Notes (e.g. "Verified by Jay 2026-mm-dd: …"). Until then, status stays `review`, never `done`.

## Dev Notes

### Cross-Story Seam (READ FIRST — this is the integration hazard)

**8.9 is the FIRST story of a three-story Epic-8 server-state chain in this worktree** (suggested internal order `8-9 → 8-7 → 8-8`, by file-collision hygiene, not hard dependency — Sprint 5 analysis). All three read-modify-write `SessionState` and pile onto the same files (`session.ts`, `sessionHandlers.ts`, `session/*`, `round/*`). 8.9 is **"the relay's spine"**: rotation TERMINATION + odd-team equalisation.

**8.9 does NOT invent rotation from scratch.** The pointer advance ALREADY exists:
- `openPreparation.ts` advances every team's `currentDefuserIndex` by `+1` when opening prep from `'between-rounds'` (round-2+ rotation step). Round 1 (from `'lobby'`) leaves indices at 0.
- `startRound.ts` picks `relayOrder[((idx % len) + len) % len]` and commits the Defuser per team.
- Both files carry an explicit comment: this is **"the 8.6/8.9 seam"** — 8.6 did the simple `+1`; **8.9 layers "every player defuses once / relay complete" + odd-team equalisation on top** of that primitive. Do NOT re-implement the pointer; extend it.

**The current uncapped behaviour 8.9 must cap:** today the rotation **wraps indefinitely** — the non-negative modulo in `startRound`/`upcomingDefuserId` means after the last player it silently rolls back to player 0 and the between-round loop repeats forever (confirmed in 8.6's human-verification note: "the Defuser rotation wraps indefinitely … 'every player defuses once' round-count is Story 8.9"). 8.9 adds the **terminal check** so the relay stops after everyone has defused (plus equalisation), and the Facilitator's advance reports "relay complete" instead of wrapping.

**The "sequential, not parallel" AC vs. the V1 reality — CORRECTED 2026-06-20:** the current V1 `ROUND_START` arms a timer + emits `BOMB_INIT` for **every** team in `round.defusers` *simultaneously* (`sessionHandlers.ts` ~1050–1115), so both teams' bombs run concurrently within a round. **This is the explicitly-deferred parallel-defuse behaviour (`gdd.md:758`) and violates `game-architecture.md:182` ("only the active team's bomb is live").** Correcting it — making only the active team's bomb live while the other spectates — is now **Story 8.11 (Sequential Round Orchestration)**, which lands in this same worktree **after** 8.9 + 8.7. 8.9 still honours the relay *structure* (one shared `roundNumber`, one between-rounds gate). The equalisation round (only ONE team armed, resting team absent from `round.defusers`) is the partial precedent 8.11 generalises to every round. _(Prior guidance here said "do NOT serialise the two teams' bombs — not this story's scope"; that correctly scoped it OUT of 8.9 but the work was never given an owning story. 8.11 is that owner.)_

### Downstream dependency (note in the story — two Wave-2 stories are BLOCKED on 8.9)

- **`8-10` Scoring, final scoreboard & session-end persistence** is blocked on 8.9 producing the **relay-complete terminal check**. "Session ends" is *defined* by 8.9's `isRelayComplete`. 8.9 provides the predicate + gates the advance; 8.10 consumes it to flip `'ended'`, render the final scoreboard, and write Postgres. Keep `isRelayComplete` a clean pure export 8.10 can import.
- **`3-5` Token re-mint on role change** is blocked on 8.9's rotation **flipping a player's role** (Defuser ↔ Spectator/Expert on rotation). 3-5 cannot be verified until 8.9 rotates someone. 8.9 should ensure role changes are broadcast in `SESSION_STATE` as today (they already are — `startRound` flips roles and the handler broadcasts) so 3-5's client re-request trigger fires.

### Concurrent-landing heads-up (possible rebase)

**Story 8-1 (round config & difficulty gating) may land concurrently** and touches the same `sessionHandlers.ts` neighbourhood (`ROUND_CONFIGURE`). It is already `done` on master at this baseline (`b536b01` includes `feat(story-8.1)`), but if a parallel worktree re-touches it, **rebase on it** — same `sessionHandlers.ts` file. No logical conflict expected; it is a different handler.

### Reuse, don't re-create (pre-scaffolded contracts)

- **PAUSE / RETRY / SCOREBOARD / VOICE_TOKEN events are already in `packages/shared/src/events/*`** (`FACILITATOR_PAUSE`/`RESUME`, `ROUND_RETRY`, `SCOREBOARD`+`ScoreboardPayload`, `VOICE_TOKEN`+payloads). The shared-events reconcile that bit earlier sprints is gone. 8.9 needs **no new socket event** — it reuses `PREPARATION_OPEN`/`PREPARATION_CANCEL`/`ROUND_START`/`SESSION_STATE`/`TEAM_ASSIGN`. The one shared-**type** edit is the optional `TeamState` equalisation field (Task 1) — additive, inside this worktree.
- `buildScoreboard.ts` already projects a provisional leader; do not touch it (8.10 owns the final scoreboard).
- The client rotation helper `apps/client/src/ui/rotation.ts` (`upcomingDefuserId`) mirrors the server pick and MUST stay in lock-step — if the equalisation round uses an explicit volunteer (not the rotation slot), the prep surface's "upcoming Defuser" display must reflect the volunteer, not the wrapped rotation pick. Reconcile the client derivation if you change the server pick for equalisation rounds.

### Current state of files this story modifies (UPDATE files) — read each fully before editing

- **`apps/server/src/session/openPreparation.ts`** — *current:* pure `lobby | between-rounds → preparation`; `roundNumber + 1`; advances every team's `currentDefuserIndex` by `+1` ONLY on the `'between-rounds'` source path (round 1 from lobby stays at 0); same-reference no-op guard for any other status. *Change:* layer the relay-complete terminal check on top (the handler decides the path; keep this function pure). The natural-round `+1` stays; the equalisation path must NOT blindly `+1` past the end. *Preserve:* purity, the `roundNumber + 1`, the lobby-path-leaves-0, the same-reference no-op guard.
- **`apps/server/src/session/startRound.ts`** — *current:* pure `preparation → active`; picks `relayOrder[((idx % len) + len) % len]` per team; force-sets the picked player `defuser` and demotes any other `defuser` on that team to `expert`; skips a team whose pick is absent from `players`; refuses `NO_POPULATED_TEAM` if every team skipped. *Change:* for an equalisation round, commit the Facilitator-chosen volunteer instead of the wrapped rotation pick (Task 4); ensure a resting team is cleanly excluded from `round.defusers` (and its players not left as stale `defuser`). *Preserve:* the modulo read-normalisation, the role-flip discipline, the skip-absent-pick integrity guard, the discriminated `StartRoundResult`, purity (no I/O / clock / randomness).
- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* facilitator-gated `PREPARATION_OPEN` / `PREPARATION_CANCEL` / `ROUND_START` (authority-gate-first → phase guard → `hasPopulatedTeam` → pure transition → persist → broadcast). `PREPARATION_OPEN` already admits `'between-rounds'` and calls `openPreparation` + `hasPopulatedTeam`. *Change:* gate the between-rounds advance on `isRelayComplete`/`equalisationRoundsOwed` (Task 5: natural round / equalisation round / refuse `RELAY_COMPLETE`); wire the volunteer assignment mechanism (Task 4). *Preserve:* authority-gate-first (a non-facilitator probe learns nothing), persist-then-emit, every existing error code, the non-atomic-multi-key V1 posture, durable-`playerId` resolution (never `socket.id`).
- **`packages/shared/src/types/session.ts`** — *current:* `TeamState { teamId, relayOrder, currentDefuserIndex, cumulativeTimeMs, roundTimesMs }`; `SessionState.status` union includes `'ended'` (nothing transitions to it yet — 8.10 owns that); `roundNumber`. *Change:* add the minimal equalisation bookkeeping field (Task 1), additive. *Preserve:* `packages/shared` stays pure TS (no runtime deps on react/socket.io/server frameworks).
- **`apps/server/src/session/assignTeam.ts`** — *current:* the sole production `TeamState` constructor; carries `currentDefuserIndex` over via `...previous` unchanged on a cross-team move (the deferred-work.md:78 index-clamp item). *Change:* initialise the new field; **decide the index-clamp item** (this story owns rotation/index mechanics) — either clamp on move or explicitly re-defer with rationale. *Preserve:* the immutable-update / accepted-lobby-race posture.

### Rotation & completion model (the heart of AC-1/2/4)

- `relayOrder` = player IDs in join/assignment order. `currentDefuserIndex` indexes into it. Natural round count for a team = `relayOrder.length` (each entry is the committed Defuser exactly once across the natural rounds).
- Total session rounds = `max(teamA.relayOrder.length, teamB.relayOrder.length)`. The shorter team owes `max − min` equalisation rounds (one Facilitator-volunteer round each) so both teams play `max` rounds.
- **Pointer timing (critical):** `openPreparation` advances the index *before* `ROUND_START` reads it (8.3/8.6). So when prep opens for round K, `currentDefuserIndex` already points at round K's Defuser. "Team T's natural rotation is exhausted" ⟺ the next advance would push T's index to `relayOrder.length` (past the last player). The current modulo silently wraps this back to 0 — 8.9's terminal check is exactly the cap on that wrap.
- **Equal-size teams (common case):** both reach exhaustion on the same round → `isRelayComplete` true, zero equalisation rounds, advance refused `RELAY_COMPLETE`.
- **Odd teams:** the longer team exhausts after `max` rounds; the shorter team exhausts after `min` rounds and then plays `max − min` Facilitator-volunteer equalisation rounds. `isRelayComplete` is true only once BOTH the natural rotations AND the owed equalisation rounds are played.

### Decisions to make and record (do not leave implicit)

1. **Bookkeeping shape (Task 1):** single `equalisationRoundsPlayed` counter vs. derived. Prefer the counter — derivation alone can't distinguish "shorter team hasn't started its equalisation rounds yet" from "done" without it once both natural rotations are exhausted.
2. **Volunteer mechanism (Task 4):** reuse `TEAM_ASSIGN` to set the volunteer `defuser` + have `startRound` honour an explicit override for equalisation rounds, vs. a dedicated action. Record the choice and why. The 8.6 deferred decision (c) made rotation the *sole* defuser authority — the equalisation round is the **documented exception** where the Facilitator's explicit pick wins.
3. **Equalisation-round pointer behaviour (Task 5):** the equalisation open should NOT advance `currentDefuserIndex` (the volunteer is an explicit pick, not the next slot). Keep `openPreparation` pure; the handler routes natural-vs-equalisation.
4. **Index-clamp deferred item (deferred-work.md:78):** this story owns rotation/index mechanics — resolve or explicitly re-defer.

### Project Structure Notes

- New server file: `apps/server/src/session/relayComplete.ts` (+ `__tests__/relayComplete.test.ts`), beside `openPreparation.ts` / `startRound.ts` / `cancelPreparation.ts`. Co-locating in `openPreparation.ts` is acceptable if small.
- Shared change is additive (one field on `TeamState`). Keep `packages/shared` pure TS.
- No new socket events, no new client surface expected (confirm Task 6). Naming: events `SCREAMING_SNAKE_CASE`; types `PascalCase`; functions `camelCase` (`isRelayComplete`, `equalisationRoundsOwed`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative / pure-reducer pattern:** game logic in pure functions `(state) => newState` that never import `socket.io`/`ioredis`/`pg`/`fastify`; **handlers own all I/O** (parse → load → reduce → persist → emit). `openPreparation`/`startRound`/`isRelayComplete`/`equalisationRoundsOwed` are pure; the handler holds the `io`/`redis` refs.
- **State is never mutated in place** — return new objects via spread/map for `SessionState`/`TeamState` (incl. the new equalisation field).
- **NEVER emit a socket event from inside a reducer** — emission lives in the handler.
- **NEVER run the bomb timer on the client** — server owns the clock; equalisation/relay logic is server-authoritative.
- **NEVER write to PostgreSQL inside a Socket.IO handler** — session history is written at session end (Story 8.10). 8.9 must NOT add a Postgres write; it only provides the terminal predicate 8.10 will act on. `cumulativeTimeMs`/`roundTimesMs`/equalisation bookkeeping live in Redis session state during play.
- **Typed events only:** reuse `ServerToClientEvents`/`ClientToServerEvents`; `socket.emit(string, any)` is forbidden.
- **Authority gate first:** every facilitator action resolves the caller by the durable `socket.data.playerId` against freshly-loaded state, refusing non-facilitators before revealing anything (the `PREPARATION_OPEN`/`TEAM_ASSIGN` handlers already do this — do not weaken it for the advance gate or the volunteer assignment).
- **60fps / R3F:** no per-frame work added; any client routing change is DOM/state only.

### Testing standards summary

- Pure logic (`isRelayComplete`, `equalisationRoundsOwed`, `openPreparation`, `startRound`) → Jest unit tests with **injected state / `now`, never `Date.now()`/`setTimeout`**.
- Server effects → existing in-memory store / `TestSocketServer` patterns (`apps/server/src/handlers/__tests__/testSocketServer.ts`, `session/__tests__/`, `round/__tests__/`).
- Client: if a routing change lands, binding tests under `apps/client/src/net/__tests__/` + component tests via the TD-1 framework; otherwise record the no-change decision.
- The project quality gate is `pnpm typecheck` (`tsc --noEmit`, husky pre-commit; no ESLint configured). Keep the full suite green.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.9: Relay Orchestration & Odd-Team Equalisation] — the three ACs (rotation covers everyone; odd-team extra round with Facilitator volunteer; sequential play with resting team spectating).
- [Source: _agent_docs/planning-artifacts/epics.md#Epic 8] — FR43 (sequential relay; every player defuses once), FR44 (odd-team extra round equalisation), FR11 (Defuser rotation), FR41 (LiveKit re-mint on role change — the 3-5 downstream trigger).
- [Source: _agent_docs/implementation-artifacts/Sprint 5 — Relay, resilience & full voice parallelization analysis.md] — the 8-9 → 8-7 → 8-8 chain ordering; the "8.6/8.9 seam"; 8-10 & 3-5 blocked on 8-9; pre-scaffolded events; the rebase-on-8-1 heads-up; the human-verification + tsx-watch + worktree-.env gotchas.
- [Source: _agent_docs/implementation-artifacts/8-6-between-round-flow-and-scoreboard-preview.md] — the directly-preceding story: the `+1` rotation advance in `openPreparation`, the all-teams-resolved between-rounds gate, `cancelPreparation` inverse restore, the explicit "Story 8.9 owns every-player-defuses-once + odd-team equalisation" scope fence (Dev Notes "Rotation model"), and the human-verification note that the rotation currently "wraps indefinitely".
- [Source: apps/server/src/session/openPreparation.ts] — the pointer advance 8.9 layers on; the "8.6/8.9 seam" comment.
- [Source: apps/server/src/session/startRound.ts] — the rotation pick (`relayOrder[currentDefuserIndex]`, modulo-normalised); the role-flip + skip-absent-pick guard; "Pointer ADVANCEMENT belongs to 8.6/8.9".
- [Source: apps/server/src/handlers/sessionHandlers.ts:792-864 (PREPARATION_OPEN), :1003-1139 (ROUND_START), :690-787 (TEAM_ASSIGN)] — the authority-gate-first + persist-then-emit pattern every facilitator action copies; the per-team timer arm + BOMB_INIT only for teams in `round.defusers`.
- [Source: apps/server/src/round/resolveRound.ts] — the all-teams-resolved between-rounds gate + per-team timer-key fence (do not regress); where the session becomes `'between-rounds'`.
- [Source: packages/shared/src/types/session.ts] — `TeamState` (add equalisation field); `SessionState.status` union (`'ended'` present, unused until 8.10); `roundNumber`.
- [Source: packages/shared/src/events/client-to-server.ts + server-to-client.ts + payloads.ts] — confirm no new event needed; reuse `PREPARATION_OPEN`/`TEAM_ASSIGN`/`SESSION_STATE`; the pre-scaffolded `SCOREBOARD`/pause/retry/voice contracts.
- [Source: apps/client/src/ui/rotation.ts] — `upcomingDefuserId` must mirror the server pick; reconcile if the equalisation round uses an explicit volunteer.
- [Source: apps/server/src/session/assignTeam.ts:~60] — the sole `TeamState` constructor (add field; decide the index-clamp).
- [Source: apps/server/src/session/createSession.ts:51,60] — initial `status: 'lobby'`, `roundNumber: 0` (the pointer-timing base case).
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:78 (currentDefuserIndex not re-clamped), :108 (stale defuser on skipped team), :103 (lobby role pick RESOLVED by 8.6 — rotation is sole authority)] — items this story's rotation-mechanics ownership must resolve or re-defer.
- [Source: _agent_docs/project-context.md] — critical implementation rules (pure reducers, no PG in handlers, typed events, authority-gate-first, server-authoritative clock).

### Git Intelligence (recent commits)

- `b536b01 docs: Sprint 4 retrospective + close TD-5` (baseline) — Sprint 4 done; Sprint 5 (relay/resilience/full voice) starting. TD-5 bot swarm (`[[td-5-player-simulator-test-harness]]`) is the tool for the 8.9 human-verification two-team relay walk.
- `82df63c feat(story-8.6): between-round flow & scoreboard preview` — the direct predecessor: pure transition + thin effect, injected clock in tests, persist-then-emit, desync paths are logged no-ops (never throw), explicit scope-fence comments for the next story. Follow this pattern exactly. 8.6 left the rotation uncapped and explicitly handed "every player defuses once + odd-team equalisation" to 8.9.
- `80a582d feat(story-8.1): round configuration & difficulty gating` — concurrent-neighbourhood story in `sessionHandlers.ts` (`ROUND_CONFIGURE`); rebase if a parallel worktree re-touches it.
- Sprint-4 retro action item: **every story ships explicit human-validation instructions** — Task 8 honours this; do not skip it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story)

### Debug Log References

- `pnpm typecheck` (all 5 workspace packages) — clean.
- Server suite `apps/server`: 30 suites / 459 tests green.
- Client suite `apps/client`: 38 files / 309 tests green.
- Shared suite `packages/shared`: 9 suites / 211 tests green.

### Completion Notes List

**Implemented (Tasks 1–7). Task 8 (Jay's interactive verification) is still OPEN — status stays `review` until his observed result is recorded here.**

Key design decisions (recorded per Dev Notes "Decisions to make and record"):

1. **Bookkeeping (Decision 1):** added a per-team `equalisationRoundsPlayed: number` counter (required, default 0) to `TeamState`, plus an optional `equalisationVolunteerId?: string` for the Facilitator's explicit pick. The counter (not index derivation) drives `equalisationRoundsOwed` / `isRelayComplete` so "hasn't started its equalisation rounds" is distinguishable from "done".
2. **Volunteer mechanism (Decision 2 → option (a)):** REUSED `TEAM_ASSIGN` (no new socket event — Task 1). The handler routes a `between-rounds`/`preparation` `TEAM_ASSIGN` to the new pure reducer `designateEqualisationVolunteer`, which is a NARROW role-only designation (no team move, no `relayOrder` mutation — avoids the deferred-work between-rounds-assignment can of worms). `startRound` commits the stored volunteer for an equalisation round and REFUSES (`EQUALISATION_VOLUNTEER_REQUIRED`) if none is designated — the server never auto-picks (AC-2). Team MOVES stay lobby-only.
3. **Pointer behaviour (Decision 3) — deliberate deviation, documented:** `openPreparation` is UNCHANGED — it advances every team's `currentDefuserIndex` by `+1` uniformly on the between-rounds path (natural AND equalisation), which keeps `openPreparation`/`cancelPreparation` symmetric. The wrap-around bug is capped at its SOURCE instead: `startRound` dropped the non-negative modulo and reads the index RAW (`0 <= index < relayOrder.length` ⇒ natural pick; otherwise exhausted). So advancing an exhausted team's index past its `relayOrder` is harmless (it just marks exhaustion), and the equalisation pick is always the explicit volunteer, honouring the SPIRIT of "an explicit pick, not the next slot" without special-casing the pure reducer. The relay-complete GATE lives in the `PREPARATION_OPEN` handler (`isRelayComplete` ⇒ refuse `RELAY_COMPLETE`).
4. **Index-clamp deferred item (Decision 4):** RESOLVED at the read side (raw bounds in `startRound`) — documented in `assignTeam.ts` + `startRound.ts` and marked resolved in `deferred-work.md`. The "stale defuser on a skipped team" item (deferred-work.md) is also RESOLVED: `startRound`'s role pass now iterates EVERY populated team and demotes a resting/skipped team's stale `defuser` to `expert`.

**Relay model (the heart of AC-1/2/4):** all teams share the advance-together pointer (index = `roundNumber - 1`). A team of length `n` commits `relayOrder[0…n-1]` across its first `n` rounds (each player Defuser once — AC-1). Total natural rounds = `maxLen`; the shorter team owes `maxLen - len` Facilitator-volunteer equalisation rounds; `isRelayComplete = !naturalRoundRemains && totalEqualisationOwed === 0`. During the longer team's natural tail the shorter team rests; during the shorter team's equalisation rounds the longer team rests — each team plays `maxLen` rounds (AC-2/AC-3).

**Resting team / no dead surface (Task 6 / AC-3):** a resting team is absent from `round.defusers` (no bomb/timer armed — the existing per-team arm loop only iterates `round.defusers`), and its stale `defuser` is demoted to `expert`. No NEW client surface was needed: the role-gated `ActiveRound.tsx` already degrades — a non-defuser routes to the manual (expert) / standby panel (spectator), never a dead bomb. The client `upcomingDefuserId` helper (`apps/client/src/ui/rotation.ts`) was reconciled to the new raw-index + volunteer pick. A live cross-team spectator view is Epic 9 (Spectator Lounge), out of scope here.

**Downstream:** `isRelayComplete` is exported clean for Story 8.10 (it consumes the predicate to flip `'ended'`); roles still flip + broadcast in `SESSION_STATE` as before (the 3-5 token-remint trigger). No Postgres write added (8.10 owns session-end persistence).

---

**POST-HUMAN-VERIFICATION FIXES (2026-06-20) — Jay's interactive run exposed three CLIENT-integration gaps. The server logic was correct; the original "No NEW client surface was needed" claim above was WRONG.**

Jay's findings:
1. **2v2: "Start next round" did nothing with no message.** The server correctly refused the advance with `RELAY_COMPLETE`, but the Scoreboard's `ADVANCE_ERROR_CODES` filter did not include it → the error was silently swallowed → a dead button. (Also true of `EQUALISATION_VOLUNTEER_REQUIRED`/`NO_EQUALISATION_ROUND`/`INVALID_VOLUNTEER`.)
2. **Odd teams were undriveable from the UI.** The Facilitator had NO affordance to designate the equalisation volunteer (the server supports it via `TEAM_ASSIGN`, but the client team-assignment UI is lobby-only). So the equalisation `ROUND_START` refused `EQUALISATION_VOLUNTEER_REQUIRED` forever — also swallowed → "round won't start."
3. **A resting/exhausted team rendered as a bare `—`** in Preparation (`Preparation.tsx`), reading as "empty player (name = -)". A resting team correctly records no time, but the bare dash made it look broken.

Fixes (all client + a shared refactor; NO server-logic change):
- **Shared the relay predicates.** `maxRelayLength`/`naturalRoundRemains`/`equalisationRoundsOwed`/`totalEqualisationOwed`/`isRelayComplete` moved from `apps/server/src/session/relayComplete.ts` into `packages/shared/src/session/relay.ts`; the server module now re-exports them (every server import path + test unchanged). The client now reads the SAME predicates, so the relay UX can't drift from the server authority (the `rotation.ts` discipline, generalised).
- **Surfaced every relay error** on the Scoreboard (`RELAY_COMPLETE`, `EQUALISATION_VOLUNTEER_REQUIRED`, `NO_EQUALISATION_ROUND`, `INVALID_VOLUNTEER`) and the equalisation one on Preparation.
- **Built the Facilitator equalisation UI** on the between-rounds Scoreboard: when a team owes an equalisation round, a "choose the volunteer Defuser" picker (buttons over the owing team's `relayOrder`, emitting the existing `TEAM_ASSIGN`); "Start next round" is gated until a volunteer is chosen.
- **Relay-complete notice** replaces the dead "Start next round" button once the relay is complete (full session-end + final scoreboard remain Story 8.10).
- **Resting-team label**: Preparation now shows "Resting this round" instead of `—`.

### File List

**Production**
- `packages/shared/src/types/session.ts` — added `equalisationRoundsPlayed` (required) + `equalisationVolunteerId?` to `TeamState`.
- `apps/server/src/session/relayComplete.ts` — NEW: `maxRelayLength`, `naturalRoundRemains`, `equalisationRoundsOwed`, `totalEqualisationOwed`, `isRelayComplete`.
- `apps/server/src/session/equalisationVolunteer.ts` — NEW: `designateEqualisationVolunteer` pure reducer.
- `apps/server/src/session/startRound.ts` — raw-index natural pick (no modulo), equalisation volunteer commit + counter bump + volunteer clear, resting-team demotion; `hasPopulatedTeam` extended for the equalisation phase; new `EQUALISATION_VOLUNTEER_REQUIRED` reason.
- `apps/server/src/session/assignTeam.ts` — init `equalisationRoundsPlayed: 0`; documented index-clamp resolution.
- `apps/server/src/handlers/sessionHandlers.ts` — `PREPARATION_OPEN` relay-complete gate (`RELAY_COMPLETE`); `TEAM_ASSIGN` between-rounds/preparation volunteer-designation branch; `ROUND_START` maps the new reason.
- `apps/client/src/ui/rotation.ts` — `upcomingDefuserId` mirrors the new raw-index + volunteer pick.

**Tests**
- `apps/server/src/session/__tests__/relayComplete.test.ts` — NEW truth tables (1v1, equal 3v3, odd 3v2, odd 4v1, single-team, empty).
- `apps/server/src/session/__tests__/equalisationVolunteer.test.ts` — NEW reducer tests.
- `apps/server/src/session/__tests__/startRound.test.ts` — raw-index exhaustion + equalisation/resting cases.
- `apps/server/src/session/__tests__/openPreparation.test.ts` — uniform-advance decision test.
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — relay walk: equalisation open, volunteer designation + refusals, volunteer commit + resting demotion, `RELAY_COMPLETE` refusal (odd + equal), authority-before-completeness; updated the obsolete modulo test.
- `apps/client/src/ui/__tests__/rotation.test.ts` — rewrote for raw-index + volunteer (old modulo-wrap removed).
- Construction-site fixups (added `equalisationRoundsPlayed: 0`): `apps/client/src/test/fixtures.ts`, `apps/server/src/round/__tests__/buildScoreboard.test.ts`, `apps/server/src/round/__tests__/resolveRound.test.ts`, `apps/server/src/session/__tests__/{assignTeam,cancelPreparation,openPreparation,removePlayerFromSession}.test.ts`, `apps/server/src/timer/__tests__/timerScheduler.test.ts`, `apps/server/src/handlers/__tests__/sessionHandlers.test.ts`.

**Docs**
- `_agent_docs/implementation-artifacts/deferred-work.md` — marked the index-clamp + stale-defuser items RESOLVED by 8.9.
- `_agent_docs/implementation-artifacts/sprint-status.yaml` — 8-9 → in-progress → review.

**Post-verification fix files (2026-06-20)**
- `packages/shared/src/session/relay.ts` (NEW), `packages/shared/src/session/index.ts` (NEW), `packages/shared/src/index.ts` — relay predicates lifted into shared.
- `apps/server/src/session/relayComplete.ts` — now re-exports the predicates from `@bomb-squad/shared` (server import sites + tests unchanged).
- `apps/client/src/ui/Scoreboard.tsx` — surfaced relay/equalisation error codes; relay-complete notice; Facilitator equalisation-volunteer picker (gates "Start next round").
- `apps/client/src/ui/Preparation.tsx` — surfaced `EQUALISATION_VOLUNTEER_REQUIRED`; "Resting this round" label.
- `apps/client/src/ui/copy.ts` — equalisation/relay-complete/resting copy.
- `apps/client/src/ui/__tests__/Scoreboard.test.tsx`, `apps/client/src/ui/__tests__/Preparation.test.tsx` — new relay-UX tests; fixed a degenerate 8.6 fixture now detected as relay-complete.

### Change Log

- 2026-06-20 — Story 8.9 implemented (Tasks 1–7): odd-team equalisation bookkeeping, pure relay-completion predicate, raw-index rotation cap (removes the indefinite-wrap bug), Facilitator volunteer via reused `TEAM_ASSIGN`, between-rounds advance gated on `isRelayComplete` (`RELAY_COMPLETE`), resting-team demotion (no dead surface). Resolved two deferred items (index-clamp, stale-defuser). All typecheck + server/client/shared suites green. Task 8 (Jay's interactive verification) outstanding.
- 2026-06-20 — **Post-human-verification fixes** (Jay's run found three client-integration gaps): shared the relay predicates (client/server can't drift), surfaced every relay/equalisation error on the Scoreboard + Preparation, built the Facilitator equalisation-volunteer picker (the odd-team flow was previously undriveable from the UI), added the relay-complete notice + resting-team label. Server logic unchanged. typecheck clean; server 505 / client 326 / shared 211 green. Re-verification by Jay still outstanding.
- 2026-06-20 — **Min-team-size guard** (Jay's design call: a team of 1 is a lone Defuser with no Expert — unplayable). Added `MIN_TEAM_SIZE`/`undersizedTeams` to shared `relay.ts`; `PREPARATION_OPEN` (lobby) refuses `TEAM_TOO_SMALL` if any populated team has <2; the Lobby disables "Open Preparation" + shows the hint (mirrors the server). **Single-team sessions are allowed** (one team of ≥2, the other empty). Bot swarm gained `--sizes a,b` for asymmetric teams (e.g. `3,2`); updated the verify harness's single-team scenarios to 2 players. Fixed ~28 handler-test fixtures that used now-invalid 1-player teams (synthetic-Expert pad helper / valid 2-player setups). typecheck clean; server 508 / client 328 / shared 211 + sim verify 6/6 green.
