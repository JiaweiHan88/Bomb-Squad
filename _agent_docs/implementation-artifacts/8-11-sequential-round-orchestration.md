---
baseline_commit: 8980de2
---

# Story 8.11: Sequential Round Orchestration

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator and players,
I want each round played by **one team at a time** while the other team spectates, with the teams **alternating** across rounds,
so that attention stays on one bomb, the competition is a clean comparison, and the spectator experience works as designed.

## Acceptance Criteria

> **Orchestration model — DECIDED (Jay, 2026-06-21): Model B — one active team per round, snake turn order, identical layout per pair with independent values.**
> Each round has **exactly one** active team (its bomb live, its Defuser, its timer); the other team **rests/spectates** and is **absent from `round.defusers`** (reusing the Story 8.9 resting-team machinery). A team's rotation pointer advances **only when that team plays** (NOT 8.9's "all teams advance together"). Turn hand-off is **Facilitator-driven** and reuses the **existing `between-rounds → PREPARATION_OPEN` advance** — each turn IS a full round, so no new socket event or session status is added. This **replaces** today's behaviour, where a natural `ROUND_START` arms **every** populated team's bomb concurrently (`sessionHandlers.ts` ROUND_START arm loop) — the explicitly-deferred parallel defuse (`gdd.md:758`) that violates `game-architecture.md:182`.
>
> **Two load-bearing specifics of Model B (the corrections that distinguish it from a naive alternation):**
> 1. **Identical layout per pair, independent values (preserves FR19 — do NOT change the seed-chain pledge).** Turns are grouped into **pairs**; `pairIndex = ceil(roundNumber / 2)`. The layout seed is keyed by the **pair**, not the turn: `templateSeed = hash(sessionId + ":" + pairIndex)`, **shared** by both teams' matched turns ⇒ **identical module layout** for the pair. `deriveTeamSeed(templateSeed, teamId)` still diverges ⇒ **independent values**. This is exactly FR19 / `gdd.md:77,615` / Story 8.2's verified contract — keep it intact. (Independent values mean spectating does not hand the other team the *answer*, only the shared layout.)
> 2. **Snake turn order `A, B, B, A, A, B…` (balances the second-mover spectating advantage).** Within a pair, the team that plays **second** has watched the first team solve the same layout; the snake alternates who goes second each pair. **Odd `pairIndex` → A then B; even `pairIndex` → B then A** (A = lower `teamId`). So `R1=A1 · R2=B1 · R3=B2 · R4=A2 · R5=A3 · R6=B3 …`. NOT a naive `A,B,A,B`.

1. **Exactly one team armed per round (the core fix).** **Given** a round starts, **When** `ROUND_START` fires, **Then** exactly one team — the **active team** — has its bomb generated, its timer armed, and `BOMB_INIT`/`TIMER_UPDATE` emitted; `round.defusers` contains **only** the active team. The non-active (resting) team has **no** bomb, **no** timer, and is **absent from `round.defusers`** (its stale `defuser`, if any, is demoted to `expert` — the 8.9 resting posture). Corrects 8.3/8.9's all-populated-teams arming. (`game-architecture.md:182`.)

2. **Snake turn order; identical layout per pair; every player defuses once; shared round number preserved.** **Given** a round resolves and the relay is not complete, **When** the Facilitator advances (`PREPARATION_OPEN` from `between-rounds`), **Then** the **next** active team is selected by the **snake rule** — `pairIndex = ceil(roundNumber / 2)`; odd pair → A then B, even pair → B then A (A = lower `teamId`), giving `A,B,B,A,A,B…` — its **next** rotation player becomes the Defuser, and the single shared `roundNumber` increments by one (never two independent relays). **Both teams' matched turns in a pair use the same `templateSeed` = `hash(sessionId + ":" + pairIndex)`** ⇒ **identical layout, independent values** (FR19; do not change the seed chain). Across the full relay **every player on every team is the committed Defuser exactly once** in a natural round.

3. **Per-team pointer advances only when that team plays.** **Given** the snake order, **When** team T is the active team for a round, **Then** only T's rotation pointer advances for that round; the resting team's pointer is untouched. A team of `n` players therefore plays `n` natural rounds (its pointer walking its `relayOrder` once), interleaved with the other team's rounds via the snake. Each team plays each `pairIndex` exactly once, so team T's defuser for pair `p` is `relayOrder[p − 1]`. (This **replaces** the 8.9 "all teams advance together / `index === roundNumber − 1`" invariant.)

4. **Odd-team equalisation still holds, now as alternating turns.** **Given** unequal team sizes, **When** the shorter team has exhausted its natural rotation but owes equalisation rounds, **Then** it plays its owed extra round(s) — each as its own alternating turn — with the **Facilitator-assigned volunteer Defuser** (reusing 8.9's `TEAM_ASSIGN`-based designation + the Scoreboard volunteer picker). Both teams end on the **same total round count** (`maxLen`). The server never auto-picks the volunteer.

5. **Resting team is routed to a spectate/standby surface — never a dead bomb.** **Given** a team is not the active team for the live round, **When** the round is active, **Then** **all** of that team's players (Defuser-that-was, Experts, Spectators) are routed to a clear "resting / spectating this round" surface — **not** a bomb they cannot defuse and **not** a manual for a bomb nobody on their team is solving. (Full split-pane lounge view is Story 9.4; the Bomb Room → lounge audio bridge is Story 3.7 — both out of scope here. This story routes the resting team to the existing standby/spectate surface and makes the alternation legible.)

6. **Exactly one authoritative clock per round.** **Given** a single active team, **When** the timer runs, **Then** there is exactly one live server-authoritative timer key for the round (the active team's) — not one per team. (Naturally satisfied by AC-1: only the active team is armed.)

7. **Relay-complete terminal check + advance gate preserved.** **Given** every team has completed its full natural rotation **and** all owed equalisation rounds, **When** the Facilitator advances, **Then** `isRelayComplete` is true and the advance is refused with `RELAY_COMPLETE` (Story 8.10 owns the actual session-end transition). Equal-size teams reach relay-complete with zero equalisation rounds.

8. **No regression to retry, pause/disconnect, between-rounds, or round 1.** **Given** the existing Epic-8 flows, **When** 8.11 lands, **Then**: Story 8.8 retry (single-team re-arm, better-of-two) still works; Story 8.7 pause/disconnect reattach re-arms/`BOMB_INIT`-restores **only** the active team and routes a reconnecting resting player to spectate; the all-resolved between-rounds gate + scoreboard preview still fire; round 1 (lobby → preparation → first active team) is correct.

## Tasks / Subtasks

- [ ] **Task 1 — Shared contract: `activeTeamId` + redefined pointer semantics (AC: 1, 2, 3)**
  - [ ] In `packages/shared/src/types/session.ts`, add `activeTeamId?: TeamId` to `SessionState` (transient per-round intent — set when prep opens, consumed by `startRound`, delivered to the client for routing). Model it on the **existing `retryingTeamId` precedent** (same "explicit intent on `SessionState`, consumed by `startRound`" pattern) — document it the same way. `undefined` in `lobby`/`between-rounds` before a team is selected.
  - [ ] **Redefine `TeamState.currentDefuserIndex` semantics** (document at the type + in `relay.ts`): under Model B it is the **index of the team's NEXT natural Defuser = the count of natural rounds that team has already played** (starts 0; advances only when that team plays a natural round). This **replaces** 8.9's "all-advance-together / `index === roundNumber − 1` / last-played-slot" meaning. `equalisationRoundsPlayed` is unchanged.
  - [ ] Do **NOT** add new socket events. The hand-off reuses `PREPARATION_OPEN`; the volunteer reuses `TEAM_ASSIGN`; the client reads `activeTeamId` off the existing `SESSION_STATE` broadcast. Run `pnpm typecheck` — the new optional field is non-breaking; the construction sites do not all need it (optional), but verify.

- [ ] **Task 2 — Pure active-team selection + advance model (AC: 2, 3, 4, 7)**
  - [ ] Add a pure `selectActiveTeam(state: SessionState): TeamId | undefined` (co-locate in `packages/shared/src/session/relay.ts` so client + server share it — same discipline as the other relay predicates). It returns the next active team by the **snake rule**: a team is **eligible** iff it still owes a **natural** round (`currentDefuserIndex < relayOrder.length`) **or** an **equalisation** round (`equalisationRoundsOwed[team] > 0`). For the round about to open, compute `pairIndex = ceil(roundNumber / 2)` (use the *next* round's number — i.e. the `roundNumber` after `openPreparation`'s `+1`). The pair's **intended order** is odd pair → `[A, B]`, even pair → `[B, A]` (A = lower `teamId`). Pick the **first intended team that is eligible** for this turn (so the second team of a pair is chosen on the second turn). When the other team is exhausted, the eligible team simply plays out its tail. Returns `undefined` when no team is eligible (⟺ `isRelayComplete`). **NOT** a "fewest rounds played" rule — that yields `A,B,A,B`; the decision is the snake `A,B,B,A` (Jay, 2026-06-21). Pure; unit-test the full truth table incl. the snake order and odd-team tails.
  - [ ] **Rework the `relay.ts` predicates for the new pointer semantics.** `equalisationRoundsOwed` / `totalEqualisationOwed` (depend on `relayOrder.length` + `equalisationRoundsPlayed`, **not** the index) carry over **unchanged**. `naturalRoundRemains` changes from `currentDefuserIndex + 1 < len` (old last-played-slot meaning) to **`currentDefuserIndex < len`** (new next-slot meaning) for some team. `isRelayComplete = !naturalRoundRemains && totalEqualisationOwed === 0` keeps its **shape**. Re-derive every truth-table test (1v1, equal 3v3, odd 3v2, odd 4v1, single-team, empty) for the new semantics.
  - [ ] **DECISION TO RECORD — pointer-advance timing.** **Recommended:** advance the active team's `currentDefuserIndex` (natural round) / `equalisationRoundsPlayed` (equalisation round) **at resolution** (in `resolveRound`, the team that just played), and **REMOVE** `openPreparation`'s uniform `+1` and `cancelPreparation`'s uniform `−1` entirely (nothing to reverse, so the retry-reconcile simplifies). This keeps every team's first turn reading `relayOrder[0]` and decouples selection from advance. The alternative (advance in `openPreparation` for the active team only) breaks a team's first turn under the new semantics — see Dev Notes. **Record the chosen approach in code + Completion Notes.** Note 8.9 currently bumps `equalisationRoundsPlayed` inside `startRound`; reconcile to a single advance site.

- [ ] **Task 3 — `openPreparation`: select the active team; stop advancing all teams (AC: 2, 3)**
  - [ ] `apps/server/src/session/openPreparation.ts`: on `lobby|between-rounds → preparation`, call `selectActiveTeam` and set `state.activeTeamId`. **Remove** the uniform per-team `currentDefuserIndex + 1` advance (it encoded the old all-advance-together model). Keep `roundNumber + 1` (the Story 8.2 seed chain must not skip). Keep the same-reference no-op guard. The retry path (`retryingTeamId` set) keeps `activeTeamId = retryingTeamId`.
  - [ ] `apps/server/src/session/cancelPreparation.ts`: **remove** the uniform `currentDefuserIndex − 1` reversal (Task 2 moved the advance out of `openPreparation`, so there is nothing to reverse). Keep `roundNumber − 1` and the originating-phase restore (lobby vs between-rounds). Clear `activeTeamId` on cancel. Preserve the retry-prep reconcile (clear `retryingTeamId`, leave `roundNumber`/pointers untouched).

- [ ] **Task 4 — `startRound`: arm only the active team (AC: 1, 4, 5, 6)**
  - [ ] `apps/server/src/session/startRound.ts`: replace the "iterate every populated team" natural-pick loop with **single-active-team** selection driven by `state.activeTeamId`. Commit a Defuser for **only** the active team: natural round → `relayOrder[currentDefuserIndex]` (raw, new next-slot semantics); equalisation round → the Facilitator `equalisationVolunteerId` (refuse `EQUALISATION_VOLUNTEER_REQUIRED` if absent — never auto-pick). `round.defusers` therefore has **one** entry. Every **other** team rests: absent from `round.defusers`, its stale `defuser` demoted to `expert` (reuse the existing role pass — it already iterates every populated team).
  - [ ] Keep the discriminated `StartRoundResult`, the integrity skip (missing pick → refuse), purity (no I/O/clock/randomness). The **retry branch** (`startRetryRound`) already arms only the retrying team — set `activeTeamId = retryingTeamId` semantics consistent; verify it still works unchanged. If pointer-advance moved to resolve (Task 2), `startRound` no longer bumps `equalisationRoundsPlayed` — move that bump to `resolveRound`.
  - [ ] Update `hasPopulatedTeam` to the single-active-team precondition: openable iff `selectActiveTeam(state) !== undefined` **and** the selected team's pick (natural player or designated volunteer) exists in `players`.

- [ ] **Task 5 — `resolveRound`: advance the active team's pointer; keep the all-resolved gate correct (AC: 2, 3, 8)**
  - [ ] `apps/server/src/round/resolveRound.ts`: after recording the active team's elapsed time, **advance** that team's pointer per Task 2 (natural → `currentDefuserIndex + 1`; equalisation → `equalisationRoundsPlayed + 1`; retry → advance **nothing**, same as today). Immutable spread; never mutate in place.
  - [ ] **Verify the between-rounds gate still fires correctly.** The gate enters `between-rounds` when no **other** team in `round.defusers` still has a live timer. Under Model B `round.defusers` has **one** team, so the active team resolving immediately completes the round → `between-rounds` + scoreboard preview. That is exactly the desired hand-off point (the Facilitator then advances to the next team). Confirm no path treats a resting team (absent from `defusers`, no timer key) as "still live."

- [ ] **Task 6 — `ROUND_START` handler: arm only the active team (AC: 1, 5, 6)**
  - [ ] `apps/server/src/handlers/sessionHandlers.ts` `ROUND_START`: `teamIds` derives from `result.round.defusers` (now one team) — so the bomb-generation, timer-arm, and `BOMB_INIT` loops already arm **only** that team with **no code change** beyond `startRound` returning a single-team `defusers`. **Verify** end-to-end: only the active team gets `initializeRoundBombs`, `timer.arm`, `TIMER_UPDATE`, `BOMB_INIT`. The resting team's sockets still `join(teamRoom)` (harmless) but receive no bomb/timer. Preserve authority-gate-first, persist-then-emit, the catch-cancels-armed-timers cleanup, durable-`playerId` resolution.
  - [ ] **Seed by `pairIndex`, not the turn `roundNumber` (AC: 2 — identical layout per pair).** Where the bomb is generated (`initializeRoundBombs` → `generateRoundBombs(sessionId, roundNumber, …)`), feed `pairIndex = ceil(roundNumber / 2)` as the round identifier for `templateSeed` so a pair's two turns reproduce an **identical layout** (FR19). Add a pure `pairIndexFor(roundNumber)` helper in `packages/shared/src/session/relay.ts` (one line, unit-tested) and use it on both server (generation) and any client that previews layout. `deriveTeamSeed`/`deriveModuleSeed` are unchanged. Cross-check Story 8.2's determinism tests still pass for the same `(sessionId, pairIndex, teamId)`. **Retry note:** a retry must regenerate the **same** bomb — ensure the retry path resolves the same `pairIndex` (it reuses the same `roundNumber`, so `pairIndexFor` returns the same value — verify).
  - [ ] `PREPARATION_OPEN` handler: the relay-complete gate (`isRelayComplete ⇒ RELAY_COMPLETE`) + equalisation-owed path stay; confirm they still hold under the reworked predicates. The `TEAM_TOO_SMALL`/`CANNOT_OPEN_PREP`/`hasPopulatedTeam` guards stay.

- [ ] **Task 7 — Pause / disconnect reattach respects the single active team (AC: 8)**
  - [ ] `apps/server/src/handlers/sessionHandlers.ts` reconnect-restore (~L450) + Story 8.7 resume re-arm (~L1468–1510): re-send `BOMB_INIT` + re-arm timers **only** for the **active team**. A reconnecting **resting** player must be routed to spectate, **not** sent `BOMB_INIT`. Because only the active team's bomb/timer keys exist in Redis (Task 4/6), the existing `if (bomb !== null)` / per-team re-arm loops naturally skip a resting team — **verify** this holds and add an explicit `activeTeamId` guard if any path could resend a stale resting-team bomb from a prior round. Cross-check the 8.7 disconnect-pause + `disconnectedPlayerIds` flow.

- [ ] **Task 8 — Client: route resting team to spectate; make alternation legible (AC: 2, 5)**
  - [ ] `apps/client/src/ui/ActiveRound.tsx`: route by **active team first, role second**. If the player's team is **not** `session.activeTeamId` → render the resting/spectating standby surface for **all** roles (reuse `WATCHING_THE_BOMB_ROOM` / `RESTING_THIS_ROUND` copy; the full lounge is Epic 9). If the player's team **is** active → existing role routing (defuser→bomb, expert→manual, spectator→standby). Derive `myTeamId` from the durable `selfId` (Story 2.7), never `socket.id`.
  - [ ] `apps/client/src/ui/rotation.ts` (`upcomingDefuserId`) + `Preparation.tsx`: the prep surface must show **the active team's** upcoming Defuser and label the resting team "Resting this round" (`RESTING_THIS_ROUND` already exists). Reconcile `upcomingDefuserId` to the new next-slot index semantics (it currently reads the raw index — confirm it still mirrors `startRound`'s pick).
  - [ ] `apps/client/src/ui/Scoreboard.tsx` (between-rounds): surface **"Up next: <Team>"** (from `selectActiveTeam` on the broadcast state) so the Facilitator's advance is legible as a hand-off. Keep the existing relay-complete notice, the equalisation-volunteer picker, and the surfaced relay error codes (`RELAY_COMPLETE`, `EQUALISATION_VOLUNTEER_REQUIRED`, `NO_EQUALISATION_ROUND`, `INVALID_VOLUNTEER`). Add `data-testid` hooks consistent with the existing surfaces.
  - [ ] Voice (note only — full work is Story 3-5/3-7, out of scope): the resting team's voice should move to the Spectator Lounge on rotation. Do **not** implement the bridge here; just ensure the resting routing does not assume Bomb Room membership. Record the dependency.

- [ ] **Task 9 — Tests (AC: 1–8)**
  - [ ] `packages/shared/src/session/__tests__/relay.test.ts` (or the server `relayComplete.test.ts`): `selectActiveTeam` **snake** truth tables (equal 2v2 → A,B,B,A; odd 2v1 → A,B,B(equalisation),A; 4v1; single-team → A,A; empty → `undefined`); `pairIndexFor` (1→1, 2→1, 3→2, 4→2); reworked `naturalRoundRemains`/`isRelayComplete`/`equalisationRoundsOwed` for the new next-slot semantics. Pure, injected state.
  - [ ] `apps/server/src/session/__tests__/startRound.test.ts`: `round.defusers` has **exactly one** team (the active team); the resting team is absent and its stale `defuser` demoted; equalisation round commits the volunteer; retry branch unchanged.
  - [ ] `apps/server/src/session/__tests__/openPreparation.test.ts` + `cancelPreparation.test.ts`: `openPreparation` sets `activeTeamId` and no longer advances all teams; `cancelPreparation` no longer reverses indices; open∘cancel identity holds under the new model; retry-prep reconcile intact.
  - [ ] `apps/server/src/round/__tests__/resolveRound.test.ts`: the active team's pointer advances on resolve (natural vs equalisation vs retry); single-team `defusers` enters `between-rounds` immediately; cumulative-time invariant preserved.
  - [ ] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts`: full **snake** relay walk — equal 2v2 (R1 A armed/B resting → between-rounds → R2 B armed/A resting → R3 B armed/A resting → R4 A armed/B resting → advance refused `RELAY_COMPLETE`); assert R1 and R2 share a layout (same `templateSeed`/`pairIndex=1`) with different values, R3/R4 share pair 2; odd 2v1 (snake A,B then B's equalisation round with volunteer, then A's tail, then `RELAY_COMPLETE`); only the active team gets bomb/timer/`BOMB_INIT`; authority-gate-first intact; reconnect during a resting turn routes to spectate.
  - [ ] Client: `ActiveRound.test.tsx` — a resting-team player (any role) renders standby, an active-team defuser renders the bomb. `Scoreboard`/`Preparation` tests — "Up next" + "Resting this round" + volunteer picker. Update the 8.9 client tests that assumed both teams active.
  - [ ] Run `pnpm typecheck` (the project quality gate — husky `tsc --noEmit`, no ESLint) and the full server/client/shared suites + the sim-clients verify; all green.

- [ ] **Task 10 — Human verification (per [[human-verification-ac-rule]]) — Jay verifies interactively**
  - [ ] **MANDATORY — the story is NOT done until Jay's observed result is in Completion Notes.** Verify on the **full Docker stack** (browser at `http://localhost` via the Caddy dev override; server as the **built Docker image**, a stable process — NOT `tsx watch`, whose restarts drop in-memory timer/expiry wakes [[timer-verification-tsx-watch-gotcha]]). Provision the gitignored worktree `.env`; always `--build` with a **worktree-scoped compose project name** so you exercise THIS worktree's code, not a stale main-built image [[worktree-fullstack-testing-gap]].
  - [ ] Drive two teams with the sim-clients bot swarm ([[td-5-player-simulator-test-harness]]; `--sizes a,b` for asymmetric teams). Verify end-to-end:
    1. **Equal teams (e.g. 2v2):** each round, **only one team's bomb is live** and the other team sees a "resting / spectating" surface (no dead bomb, no manual-for-nobody); teams follow the **snake** A,B,B,A; the two teams' matched turns in a pair show the **same module layout with different values** (FR19); every player defuses exactly once; after the last turn the advance reports relay complete (no silent wrap).
    2. **Odd teams (e.g. 2v1):** natural turns alternate; the shorter team then plays its equalisation turn with a Facilitator-assigned volunteer; both teams end on the same round count; the resting team always has a clean spectate surface.
  - [ ] **Re-run Story 8.9's outstanding Task 8 verification AFTER this lands** (the relay/equalisation interactive walk) — 8.9 stays `review` until both it and 8.11 verify. Record Jay's verbatim observed result + date in Completion Notes; until then status stays `review`, never `done`.

## Dev Notes

### The model (READ FIRST) — Model B, decided by Jay 2026-06-21

This story corrects the **parallel-defuse** behaviour that 8.3/8.9 shipped: today a natural `ROUND_START` arms **every** populated team's bomb concurrently (`sessionHandlers.ts` ROUND_START arm loop iterates all of `round.defusers`, which `startRound` populates with both teams). That is the explicitly-deferred parallel defuse (`gdd.md:758`, `gdd.md:137`) and violates `game-architecture.md:182` ("sequential relay means **only the active team's bomb is live**").

**Model B (chosen):** every round has **exactly one** active team. Teams **alternate** as active. A team plays `n` natural rounds (one per player). The resting team is **absent from `round.defusers`** and routed to spectate. Turn hand-off is the **existing `between-rounds → Facilitator advance`** — each turn is a full round, so **no new socket event and no new session status**. This generalises the single-active-team pattern 8.9 already built for **equalisation rounds** and 8.8 built for **retry rounds** to **every** round.

Worked examples (the **snake** = odd pair → A then B, even pair → B then A; `pairIndex = ceil(roundNumber/2)` keys the shared layout `Lp`):

```
Equal A=[a0,a1], B=[b0,b1]:
  R1 A(a0,L1) · R2 B(b0,L1) · R3 B(b1,L2) · R4 A(a1,L2) → RELAY_COMPLETE   (4 rounds; layouts L1,L2 each played by both; B second in L1, A second in L2)
Odd   A=[a0,a1], B=[b0]:       (maxLen 2 ⇒ B owes 1 equalisation; 2 pairs)
  R1 A(a0,L1) · R2 B(b0,L1) · R3 B(equalisation: volunteer,L2) · R4 A(a1,L2) → COMPLETE
Single team A=[a0,a1], B=[]:  (no second team ⇒ no snake)
  R1 A(a0,L1) · R2 A(a1,L2) → RELAY_COMPLETE
```
Note: with an **odd** number of pairs the "who plays second" balance is imperfect (e.g. 3 pairs ⇒ one team is second twice) — inherent and accepted.

**The invariant 8.11 REPLACES:** 8.9's "all teams advance together, `currentDefuserIndex === roundNumber − 1`, index = last-played slot." Under Model B the pointer is **per-team** and advances **only when that team plays**. This is the single biggest source of regression risk — it touches `openPreparation`, `cancelPreparation`, `relay.ts` predicates, `startRound`, `resolveRound`, and every 8.9 test that injected the all-advance-together shape.

### Pointer-advance timing — the recommended approach (and why the alternative breaks)

**Recommended (Option 2): index = "next natural Defuser slot = count of natural rounds played", advance at RESOLVE.**
- `currentDefuserIndex` starts `0`; `startRound` reads `relayOrder[currentDefuserIndex]` for the active team; `resolveRound` increments the active team's index after a **natural** round (and `equalisationRoundsPlayed` after an **equalisation** round).
- `openPreparation` then only **selects** the active team (no index mutation); `cancelPreparation` has **nothing to reverse** (simpler — the 8.6 inverse-restore + 8.8 retry-reconcile collapse to just the `roundNumber ∓ 1` + phase restore).
- Every team's **first** turn correctly reads `relayOrder[0]`.

**Why NOT advance in `openPreparation` (the old site):** under the old model `openPreparation` advanced **all** teams each round because all played each round. Under Model B a team's first turn happens on round 2+ (between-rounds source) for the second team — advancing "the active team" in `openPreparation` would push its index `0 → 1` and **skip `relayOrder[0]`**. Working around that needs a "has this team played before" sentinel; moving the advance to resolve avoids it entirely. **Record whichever you choose**, but Option 2 is strongly recommended.

### Current state of the files this story changes (UPDATE files — read each fully first)

- **`apps/server/src/session/startRound.ts`** — *current:* iterates every populated team, commits `relayOrder[idx]` per team (raw index, Story 8.9), demotes other defusers, equalisation/retry branches already arm a single team, bumps `equalisationRoundsPlayed` on commit. *Change:* commit a Defuser for **only** `state.activeTeamId`; `round.defusers` becomes single-entry; resting teams demoted (role pass already covers them). If advance moved to resolve, drop the `equalisationRoundsPlayed` bump here. *Preserve:* discriminated result, integrity skip, purity, the retry branch.
- **`apps/server/src/session/openPreparation.ts`** — *current:* `roundNumber + 1`; **uniform** `currentDefuserIndex + 1` on the between-rounds path. *Change:* set `activeTeamId = selectActiveTeam(state)`; **remove** the uniform advance. *Preserve:* `roundNumber + 1`, lobby-leaves-round-1, same-reference no-op guard.
- **`apps/server/src/session/cancelPreparation.ts`** — *current:* reverses the uniform `−1` + decrements `roundNumber`; retry reconcile. *Change:* drop the index reversal; clear `activeTeamId`. *Preserve:* `roundNumber − 1`, lobby/between-rounds restore, retry reconcile.
- **`apps/server/src/round/resolveRound.ts`** — *current:* records elapsed → `cumulativeTimeMs`/`roundTimesMs`; the per-team-timer fence + all-resolved `between-rounds` gate; retry better-of-two. *Change:* advance the active team's pointer (Task 2). *Preserve:* the fence, the gate (now trivially single-team), the retry replace-in-place, persist-then-emit, `cumulativeTimeMs === sum(roundTimesMs)`.
- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* `ROUND_START` arms every team in `round.defusers`; `PREPARATION_OPEN` relay-complete gate + `TEAM_TOO_SMALL`/`hasPopulatedTeam` guards; reconnect-restore (~L450) + 8.7 resume re-arm (~L1468). *Change:* none needed in the arm loop itself (single-entry `defusers` arms one team) — **verify**; ensure reattach/resume re-arm only the active team. *Preserve:* authority-gate-first, persist-then-emit, catch-cancels-timers, durable-`playerId`.
- **`packages/shared/src/types/session.ts`** — add `activeTeamId?: TeamId`; redocument `TeamState.currentDefuserIndex` semantics. Keep `packages/shared` pure TS (no react/socket.io/server deps).
- **`packages/shared/src/session/relay.ts`** — add `selectActiveTeam`; rework `naturalRoundRemains` (→ `index < len`); keep `equalisationRoundsOwed`/`totalEqualisationOwed`/`MIN_TEAM_SIZE`/`undersizedTeams`. `apps/server/src/session/relayComplete.ts` re-exports these — keep the re-export so server import sites/tests are stable.
- **`apps/client/src/ui/ActiveRound.tsx`** — *current:* routes purely by role (defuser→bomb, expert→manual, else standby). *Change:* gate on `session.activeTeamId` first — non-active team → standby for ALL roles. *Preserve:* durable-id self-resolution, the ResolutionBanner/PauseOverlay/VoiceController wrappers.
- **`apps/client/src/ui/rotation.ts` + `Preparation.tsx` + `Scoreboard.tsx`** — show the active team's upcoming Defuser, "Resting this round" for the other, and "Up next: <Team>" between rounds. Reuse the 8.9 volunteer picker + relay-complete notice + surfaced error codes. `upcomingDefuserId` must mirror `startRound` under the new index semantics.

### Reuse, don't re-create

- **Single-active-team arming already exists** — equalisation rounds (8.9) and retry rounds (8.8) both arm exactly one team with the resting team absent from `round.defusers` and its stale `defuser` demoted. 8.11 makes that the **default** path. Lean on `startRound`'s existing role pass (it already iterates every populated team) and the ROUND_START arm loop (already iterates only `round.defusers`).
- **Relay predicates are already SHARED** (`packages/shared/src/session/relay.ts`, re-exported by the server) so client + server can't drift — add `selectActiveTeam` there. The `rotation.ts` "client mirrors server pick" discipline applies.
- **The Scoreboard between-rounds surface** already renders the relay-complete notice, the equalisation-volunteer picker (over the owing team's `relayOrder`, emitting `TEAM_ASSIGN`), and the surfaced relay error codes — extend it with "Up next", don't rebuild it.
- **No new socket events.** Hand-off = `PREPARATION_OPEN`; volunteer = `TEAM_ASSIGN`; active-team delivery = the existing `SESSION_STATE` broadcast carrying the new `activeTeamId`.

### Seed model (identical layout per pair, independent values — FR19 preserved)

**CORRECTED 2026-06-21 (Jay's decision).** Under Model B each `roundNumber` is one team's turn, so keying `templateSeed` by `roundNumber` directly would give the two teams **different layouts** — which breaks FR19 / `gdd.md:77,615` / Story 8.2's verified "both teams identical layout" contract. The fix: key the layout by the **pair**, not the turn.

- `pairIndex = ceil(roundNumber / 2)`. Both teams' matched turns share a pair ⇒ `templateSeed = hash(sessionId + ":" + pairIndex)` is **identical** for the pair ⇒ **same module layout**.
- `deriveTeamSeed(templateSeed, teamId)` still **diverges** per team ⇒ **independent values**. (Per-`moduleSeed` derivation is unchanged.)
- Result: both teams face the **same layout with different values** (FR19 verbatim). The contest is **cumulative defuse time** (`gdd.md:137`); independent values mean the spectating team gets the shared layout but not the literal answer, and the **snake order** balances the residual second-mover advantage.

**Do NOT change the seed-chain functions** (`deriveTemplateSeed`/`deriveTeamSeed`/`deriveModuleSeed` in `packages/shared/src/seeding`); only change **what round identifier is fed to `templateSeed`** — pass `pairIndex`, not the raw turn `roundNumber`. Story 8.2's `generateRoundBombs(sessionId, roundNumber, …)` currently takes `roundNumber`; 8.11 must call it with `pairIndex` (or thread a `pairIndex` param) so the matched pair reproduces an identical layout. Verify against 8.2's determinism tests.

### Cross-story seam & downstream

- This is the **third** story of the relay worktree chain (`8-9 → 8-7 → 8-11`); it lands **after** 8.9 + 8.7 so master only ever sees Model B (sequential). **8.9's outstanding human-verification (its Task 8) re-runs AFTER this story** — 8.9 stays `review` until both verify.
- **Story 8.10** (final scoreboard + session-end) imports `isRelayComplete` — keep it a clean shared export. Round count under Model B: each team plays **`maxLen`** rounds (natural + any equalisation), so a two-team session is **`2 × maxLen`** turns over **`maxLen`** layout pairs; a single-team session is `maxLen`. (NOT `sum(relayOrder lengths)` — that undercounts the shorter team's equalisation turns.) Note for 8.10's scoreboard + per-round breakdown.
- **Story 9.2 / 9.4** (lifelines, Spectator Lounge view) depend on this story's "single active bomb"; **Story 3.7** (Bomb Room → lounge audio bridge) and **3-5** (voice re-mint on rotation) own the resting-team voice routing. 8.11 routes the resting team to a **visual** standby only — it does **not** build the lounge view or the audio bridge (deferred-work.md:8–10).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Pure reducers, handlers own I/O:** `selectActiveTeam`/`startRound`/`openPreparation`/`cancelPreparation`/`relay.ts`/the pointer advance are pure `(state) => state`; never import `socket.io`/`ioredis`/`pg`. The handler does parse → load → reduce → persist → emit.
- **Never mutate state in place** — spread/map new `SessionState`/`TeamState` (incl. `activeTeamId`, the advanced index).
- **Never emit from a reducer; never run the bomb timer on the client; never write Postgres in a handler** (session-end persistence is Story 8.10). Typed events only — no `socket.emit(string, any)`.
- **Authority-gate-first:** every facilitator action resolves the caller by the durable `socket.data.playerId` against freshly-loaded state and refuses non-facilitators **before** revealing anything — do not weaken it for the advance/volunteer paths.
- **Never `Math.random()`/`Date.now()` outside the seed chain / injected clock;** reducer tests pass time as input.
- **`packages/shared` stays pure TS** — zero runtime deps on react/socket.io/server frameworks (the new `selectActiveTeam` is pure TS).

### Testing standards

- Pure logic (`selectActiveTeam`, the reworked predicates, `openPreparation`, `cancelPreparation`, `startRound`, the resolve-time advance) → Jest unit tests, **injected state / `now`, never `Date.now()`/`setTimeout`**.
- Server effects → existing in-memory store / `TestSocketServer` patterns (`apps/server/src/handlers/__tests__/`, `session/__tests__/`, `round/__tests__/`).
- Client → component tests via the TD-1 framework (`apps/client/src/ui/__tests__/`).
- Quality gate: `pnpm typecheck` (`tsc --noEmit`, husky pre-commit; no ESLint). Keep the full suite + sim-clients verify green.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.11: Sequential Round Orchestration] — the ACs + the "reuses 8.9 / changes startRound + ROUND_START handler" implementation note; Epic 8 intro ("Rounds play sequentially — one team's bomb is live at a time").
- [Source: _agent_docs/planning-artifacts/sprint-change-proposal-2026-06-20.md + sprint-status.yaml line 38] — the correct-course that created this story; Jay's confirmed "sequential, one team at a time" intent; the 8-9 → 8-7 → 8-11 sequencing and the 8.9 re-verification ordering.
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md:137 (relay format), :758 (parallel defuse deferred)] — "Both teams play the same rounds sequentially. Every player defuses at least once. Cumulative defuse time determines the winner."
- [Source: _agent_docs/game-architecture.md:182] — "sequential relay means only the active team's bomb is live … do not implement concurrent (parallel) arming"; the team-room scoping the resting team relies on.
- [Source: _agent_docs/implementation-artifacts/8-9-relay-orchestration-and-odd-team-equalisation.md] — the relay spine this story rebuilds onto a per-team pointer: rotation/`isRelayComplete`/equalisation, the resting-team machinery, the shared `relay.ts` predicates, the Scoreboard volunteer picker + surfaced error codes, the post-verification client fixes.
- [Source: _agent_docs/implementation-artifacts/8-8-retry-a-failed-round.md] + apps/server/src/session/startRound.ts (`startRetryRound`) — the single-team retry arm 8.11 generalises; do not regress better-of-two.
- [Source: _agent_docs/implementation-artifacts/8-7-pause-facilitator-and-disconnect.md] + sessionHandlers.ts (~L450 reconnect-restore, ~L1468 resume re-arm) — reattach must re-arm/`BOMB_INIT` only the active team.
- [Source: apps/server/src/session/{startRound,openPreparation,cancelPreparation}.ts, apps/server/src/round/resolveRound.ts, apps/server/src/handlers/sessionHandlers.ts (ROUND_START arm loop, PREPARATION_OPEN gate), packages/shared/src/session/relay.ts, packages/shared/src/types/{session,round}.ts] — the UPDATE files above.
- [Source: apps/client/src/ui/{ActiveRound,Preparation,Scoreboard,rotation,copy}.tsx/.ts] — client routing + the active-team/resting/Up-next surfaces; `WATCHING_THE_BOMB_ROOM`/`RESTING_THIS_ROUND`/`ROUND_IN_PROGRESS` copy already exist.
- [Source: packages/shared/src/seeding/* + __tests__/seeding.test.ts] — `templateSeed` shared, `deriveTeamSeed` diverges; do not change.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:7–10] — the 8.11 touch points + the 3-5/3-7 voice/lounge dependencies this story does NOT implement.
- [Source: _agent_docs/project-context.md] — pure reducers, no PG in handlers, typed events, authority-gate-first, server-authoritative clock, `packages/shared` pure TS.

### Git Intelligence (recent commits)

- `8980de2 docs(epic-8): story 8.8 file + 8.9 post-verification/guard notes + tracking` (baseline HEAD).
- `e5f4a6a feat(epic-8): story 8.8 retry + 8.9 relay-UX fixes + min-team-size guard` — the single-team retry arm + the shared `relay.ts` predicates + the Scoreboard volunteer picker 8.11 builds on.
- `62e9032 feat(story-8.9): relay orchestration & odd-team equalisation` — the relay spine (rotation cap, `isRelayComplete`, equalisation, resting-team demotion) 8.11 reworks from all-advance-together to per-team alternation.
- `d55c37b feat(story-8.7): pause — facilitator & disconnect` — the reattach/resume re-arm paths 8.11 must keep active-team-only.
- Follow the established pattern: pure transition + thin effect, injected clock in tests, persist-then-emit, no-throw reducers, explicit scope-fence comments. Sprint-4 retro action item: **every story ships explicit human-validation instructions** — Task 10 honours it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story)

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-06-21 — Story 8.11 created (ready-for-dev) via gds-create-story: Model B sequential orchestration (one active team/round, per-team pointer, single clock, resting-team spectate routing).
- 2026-06-21 — **Review correction (Amelia, after Jay's decision).** Two fixes to the original draft, which had (a) keyed `templateSeed` by the per-turn `roundNumber` → different layouts per team, breaking FR19/8.2; and (b) specified a naive `A,B,A,B` alternation. Corrected to Jay's decision: **identical layout per pair** (`templateSeed = hash(sessionId + ":" + pairIndex)`, `pairIndex = ceil(roundNumber/2)`, values still diverge via `deriveTeamSeed` — FR19 preserved, seed-chain functions unchanged) and **snake turn order** `A,B,B,A` (odd pair → A then B, even pair → B then A) to balance the second-mover spectating advantage. Updated the model note, AC2/AC3, `selectActiveTeam` (Task 2), the seed Dev Note, worked examples, the bomb-gen task (Task 6 — feed `pairIndex`, add `pairIndexFor` helper), the 8.10 round-count note (`2 × maxLen`), and the test/human-verify walks (A,B,B,A + same-layout-per-pair assertion). No new socket events; no GDD/FR amendment needed.
