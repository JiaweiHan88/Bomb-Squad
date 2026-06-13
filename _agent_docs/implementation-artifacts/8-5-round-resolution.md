---
baseline_commit: 6416aa5a91f233c7a020179bbaeda09841bf0b23
---

# Story 8.5: Round Resolution

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want each round to end clearly on defuse, explosion, or time-out,
so that our result and time are recorded correctly.

## Acceptance Criteria

1. **Defuse outcome.** When the last armed module on a team's bomb becomes `solved` (i.e. `BombState.solved` transitions `false → true`), the round resolves as **DEFUSED**: the elapsed defuse time is recorded into that team's `TeamState.cumulativeTimeMs`, `BOMB_DEFUSED { teamId, elapsedMs }` is emitted to the team room, the team's live timer wake is cancelled and its Redis timer key deleted, and the round's `RoundState.status` becomes `'defused'`. The Defuser scene holds ~2s with the defuse fanfare cue, then the session transitions toward between-rounds.

2. **Failure outcomes.** When a team takes a 3rd strike (`BombState.strikes` reaches `3`) the round resolves as **DETONATED**; when the server-authoritative timer expires the round resolves as **TIME EXPIRED**. In both cases: the time at the moment of failure is recorded into `cumulativeTimeMs`, `BOMB_EXPLODED { teamId, elapsedMs }` is emitted, the timer wake is cancelled and the Redis timer key deleted, and `RoundState.status` becomes `'exploded'` (3rd strike) or `'time-expired'` (timeout). The explosion cue plays (red scene tint) and holds ~3s before transitioning toward between-rounds.

3. **No mid-round scoreboard.** While `SessionState.status === 'active'` (round active), `SCOREBOARD` must never be emitted and no scoreboard surface is shown. The scoreboard preview is owned by Story 8.6 (between-rounds) — 8.5 stops at recording the result and flipping toward the between-rounds phase; it does not render or emit the scoreboard.

4. **Idempotent, once-only resolution.** A round resolves exactly once per team. A second trigger for an already-resolved team (e.g. a late strike arriving after a defuse, or a timer wake firing after an early defuse) is a logged no-op — never a second `BOMB_DEFUSED`/`BOMB_EXPLODED`, never a double time entry, never a status regression.

5. **Honest elapsed time.** `elapsedMs` recorded into `cumulativeTimeMs` is reconciled against the strike-rebased segment model so per-round time is not over-counted under strikes (see deferred-work item below). The recorded value is consistent with the value carried in the `BOMB_DEFUSED`/`BOMB_EXPLODED` payload.

## Tasks / Subtasks

- [x] **Task 1 — Widen round/outcome contracts in `packages/shared` (AC: 1, 2)**
  - [x] Widen `RoundState.status` from the literal `'active'` to `'active' | 'defused' | 'exploded' | 'time-expired'` in `packages/shared/src/types/round.ts`. Update the type's doc comment (it currently says "round resolution (Story 8.5) widens it" — fulfil that note).
  - [x] Add a `RoundOutcome` type (`'defused' | 'exploded' | 'time-expired'`) co-located in `round.ts` and export it from the shared barrel (`packages/shared/src/index.ts` / `types/index.ts`) so server + client can name outcomes without re-deriving them.
  - [x] Do NOT add new socket events: `BOMB_DEFUSED` and `BOMB_EXPLODED` already exist in `ServerToClientEvents` with `RoundEndPayload = { teamId, elapsedMs }`. Reuse them. (`TIME EXPIRED` vs `DETONATED` is a client-side label keyed off which event fired + round status; it does NOT need a third event.)
  - [x] Run `tsc --noEmit` across the workspace — widening `RoundState.status` may surface exhaustiveness gaps at existing call sites; fix them. (No gaps surfaced — `status` was only ever constructed as `'active'`, never matched exhaustively.)

- [x] **Task 2 — `resolveRound` server effect (the resolution ceremony) (AC: 1, 2, 4, 5)**
  - [x] Create `apps/server/src/round/resolveRound.ts` exporting `async function resolveRound(deps, sessionId, teamId, outcome, now)`. This is the single ceremony all three outcome paths funnel through. Deps `{ redis, io, log, timer }` (`timer: Pick<TimerScheduler, 'cancel'>`). NOTE: takes `now` (not a pre-computed `elapsedMs`) so the displayed-elapsed reconciliation (Task 4) has ONE definition computed inside the ceremony.
  - [x] **Once-only guard (AC-4):** the team's LIVE TIMER KEY is the per-team fence (load it first; null → logged no-op). SETTLED SEAM: a single `RoundState` is shared by both racing teams, so its round-level `status` cannot express per-team resolution — using it as the fence would block team B after team A resolves. The timer key is per-team, deleted on first resolution, and matches the existing `onTimerExpired`/`escalateOnStrike` desync posture. `RoundState.status` is still recorded as the round-level outcome (last-writer-wins across teams). Documented in `round.ts` + `resolveRound.ts` headers.
  - [x] **Persist-then-emit ordering:** (a) `deps.timer.cancel` + `del(timerKey)`; (b) record `elapsedMs` into `cumulativeTimeMs` + flip session toward between-rounds + persist; (c) set `RoundState.status` + persist; (d) emit `BOMB_DEFUSED`/`BOMB_EXPLODED` to `teamRoom`.
  - [x] **`cumulativeTimeMs` update is immutable** — spread new `TeamState`/`SessionState`. Team existence guarded (`session.teams[teamId]` undefined → logged no-op).
  - [x] No `setTimeout`/scene-hold logic in `resolveRound` — holds are client-side (Task 5).
  - [x] Flip `SessionState.status` to `'between-rounds'` (8.6 not yet merged) only from `'active'`; left a `// Story 8.6` marker + the two-team caveat + the `cancelPreparation`-returns-to-lobby follow-up note. Never emit `SCOREBOARD` (AC-3).

- [x] **Task 3 — Wire the three trigger paths (AC: 1, 2)**
  - [x] **Timeout path:** `onTimerExpired` now delegates to `resolveRound(..., 'time-expired', now)`; the `del` + emit moved into the ceremony. Scheduler passes `now` + itself as the `timer` dep. The 8.5 hook-marker block is gone.
  - [x] **3rd-strike path:** exported `onThirdStrike(deps, sessionId, teamId, now)` → `resolveRound(..., 'exploded', ...)`. `escalateOnStrike`'s strike-3 early-return is unchanged; 4.7's interaction handler calls `onThirdStrike` instead of `escalateOnStrike` at the terminal strike. Exercised by tests.
  - [x] **Defuse path:** exported `onBombDefused(deps, sessionId, teamId, now)` → `resolveRound(..., 'defused', ...)`. 4.7 wires the live call site (no `MODULE_INTERACT` handler in repo yet — see Completion Notes for the landed-seam status). Exercised by tests.

- [x] **Task 4 — Honest elapsed-time reconciliation (AC: 5)**
  - [x] **Single definition:** `elapsedMs = max(0, config.timerMs - remainingMs(timer, now))`, computed once inside `resolveRound` reusing `timerCore.remainingMs` (no re-derived segment math).
  - [x] **Timeout elapsed:** `remainingMs` clamps to 0 at/after the deadline → displayed elapsed = `timerMs` (8.4 decision 6 preserved), and it falls out of the SAME formula as defuse/strike-3.
  - [x] **Strike-3 elapsed:** displayed elapsed at the strike instant from the rebased `TimerState` — same formula.
  - [x] Convention documented in `resolveRound.ts` header for Story 8.10. Resolves the `deferred-work.md` "elapsedMs at expiry is timerMs, not real wall-clock" item; the strike-accelerated test proves no over-count.

- [x] **Task 5 — Client resolution presentation (AC: 1, 2, 3)**
  - [x] `gameStore` gains `resolution: { outcome; elapsedMs } | null` + `setResolution`; `setBomb` clears it (new round). `bindServerEvents`: `onBombDefused` → `'defused'`; `onBombExploded` → `'exploded'` if snapshot `strikes >= 3` else `'time-expired'` (simplest correct client mapping; limitation noted in code — depends on 4.7 broadcasting the terminal strike count). `onScoreboard` left a stub (8.6).
  - [x] `ResolutionBanner.tsx` (rendering-only DOM overlay) renders **"DEFUSED."** (green, 2s hold) / **"DETONATED."** / **"TIME EXPIRED."** (red tint, 3s hold), then an interim post-round surface. Defuse LEDs are already green (all modules solved → 4.3 solve LEDs). SFX = no-op `playResolutionCue` placeholder (Epic 10). Wired into `ActiveRound` as an overlay across all role surfaces.
  - [x] **AC-3:** no scoreboard surface exists on this path; banner self-hides while `resolution === null`; interim transition target marked for 8.6.
  - [x] R3F discipline: banner is a plain DOM overlay (no Three.js objects added/to-dispose); no game logic in the component (outcome comes from the store).

- [x] **Task 6 — Tests (AC: 1–5)**
  - [x] `apps/server/src/round/__tests__/resolveRound.test.ts`: defuse / timeout / 3rd-strike outcomes (cumulativeTimeMs + event + cancel + timer-key del + RoundState.status); idempotency (late strike after defuse = no-op); desync no-ops (no timer / no session / no round / unknown team) never throw; named wrappers.
  - [x] Elapsed reconciliation tests (AC-5): strike-accelerated round records displayed (not wall) elapsed and ≤ `timerMs`; clamp-at-0; payload matches recorded value. Injected `now` only — no `Date.now()`/`setTimeout`.
  - [x] Updated the timeout path tests (`timerScheduler.test.ts` + the `sessionHandlers.test.ts` ROUND_START→expiry integration test) to assert delegation to `resolveRound` (records time + flips status), not just an emit.
  - [x] Client: `apps/client/src/net/__tests__/resolutionBinding.test.ts` asserts the binding sets resolution state for DEFUSED/EXPLODED (both labels), resolution stays null mid-round (AC-3), SCOREBOARD never touches it, and `setBomb` clears a stale resolution.

- [ ] **Task 7 — Human verification (per project rule [[human-verification-ac-rule]])**
  - [ ] Jay verifies interactively: run a round to (a) full defuse → sees "DEFUSED." + 2s hold + green LEDs; (b) 3rd strike → "DETONATED." + red tint + 3s hold; (c) timer expiry → "TIME EXPIRED." + red tint + 3s hold. Scoreboard never flashes mid-round. Confirm recorded round time looks right. Not done until his observed result is in Completion Notes. Verification caveat — see [[timer-verification-tsx-watch-gotcha]]: run the server WITHOUT `tsx watch` so in-memory expiry wakes survive; the timeout path depends on them. **PENDING — automated coverage is green; awaiting Jay's observed result. NOTE: defuse and 3rd-strike paths have no live server caller until Story 4.7 wires the `MODULE_INTERACT` interaction handler to `onBombDefused`/`onThirdStrike`; only the TIME EXPIRED path is end-to-end runnable today. Defuse/DETONATED interactive verification unblocks once 4.7 lands.**

### Review Findings

_Code review 2026-06-13 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Auditor confirmed all 5 ACs satisfied and the two documented deviations (per-team timer-key fence; client label derivation) correctly implemented._

- [x] [Review][Patch] Shared `SessionState` lost-update race on concurrent two-team resolution [apps/server/src/round/resolveRound.ts] — FIXED: `resolveRound` is now a per-session serialization wrapper (`sessionChains` promise chain) around `resolveRoundCeremony`; concurrent two-team resolutions queue so neither read-modify-write clobbers the other's `cumulativeTimeMs`. No CAS primitive exists on `RedisStore`, so this matches the documented single-process posture (multi-instance would need a Redis-side atomic increment/WATCH — noted in code). Added a concurrent two-team regression test asserting both teams' times land.
- [x] [Review][Defer] `between-rounds` status flip strands the banner on any re-sync [apps/server/src/round/resolveRound.ts:113; apps/client/src/App.tsx] — deferred to 8.6: 8.6 owns the between-rounds surface and will route it to a real screen + carry resolution across re-sync; reconnect-during-hold losing the cosmetic banner is acceptable for V1. `ActiveRound`/`ResolutionBanner` mount only while `session.status === 'active'`; `resolveRound` flips Redis to `'between-rounds'` but emits no `SESSION_STATE`, so the verdict shows only on a stale snapshot — any re-sync (reconnect/late-join) routes to `<Lobby/>` and unmounts the banner.
- [x] [Review][Patch] ResolutionBanner `held` not reset on outcome change [apps/client/src/ui/ResolutionBanner.tsx:40-49] — FIXED: the hold effect now calls `setHeld(false)` unconditionally at the top, so any outcome change (incl. value→value) restarts the hold from the un-held state instead of carrying a stale `held=true` straight to the interim surface.
- [x] [Review][Defer] Crash window between `del(timerKey)` and session persist [apps/server/src/round/resolveRound.ts:96-119] — deferred, single-process V1 (wakes don't survive restart anyway); del-before-emit is the intentional desync-safe posture. A crash after `del` but before persisting `cumulativeTimeMs` trips the fence on restart → silent no-op losing the round result.
- [x] [Review][Defer] `session.config.timerMs` finite-guard dropped [apps/server/src/round/resolveRound.ts:88] — deferred, config is always present on an active session with a live timer. Old `onTimerExpired` used `?? 0`; new ceremony dereferences unconditionally → NaN into `cumulativeTimeMs` if a malformed/legacy session ever reaches this seam.
- [x] [Review][Defer] ResolutionBanner interim surface is terminal [apps/client/src/ui/ResolutionBanner.tsx:55-63] — deferred, Story 8.6 owns the between-rounds transition. If the next round never starts (session ends/errors), the `z-50` "round over" overlay has no exit until a future `BOMB_INIT`.
- [x] [Review][Defer] Test gaps: no two-team concurrent-resolution test; idempotency test is sequential not concurrent [apps/server/src/round/__tests__/resolveRound.test.ts] — deferred, ties to the lost-update decision above. The fence is proven only for sequential double-fire (key already deleted), not the concurrent in-flight double-fire it's meant to guard.

## Dev Notes

### Cross-Story Seam (READ FIRST — this is the integration hazard)

There is **no server-side `MODULE_INTERACT` handler in the repo yet.** `apps/server/src/handlers/` contains only `sessionHandlers.ts` and `manualHandlers.ts`. `escalateOnStrike.ts` documents this explicitly: *"There is no caller in this worktree yet (no bomb, no interaction handler) — the coupling is exercised directly by tests."*

Consequences for 8.5:
- The **defuse** and **3rd-strike** triggers fire from inside the server `MODULE_INTERACT` handler (after `bombReducer` runs and produces `solved===true` or `strikes===3`). That handler is built by **Story 4.7** (Snapshot Sync & Optimistic Render — "the glue that exercises … server `ModuleUpdate` broadcasts end-to-end"). Both 8.5 and 4.7 live on **master** together — sequence them so the seam is wired directly, not coordinated across branches.
- **Do the same thing 8.4 did:** ship 8.5 as pure, well-named server functions (`resolveRound`, `onBombDefused`, `onThirdStrike`) with their full ceremony, fully covered by direct unit tests. Wire the **timeout path** end-to-end (it has a real caller — the scheduler). Leave the defuse/strike-3 call sites as exported functions the interaction handler calls.
- **Wire the seam directly:** 4.7's interaction handler must, after reducing a `MODULE_INTERACT`, (i) call `onThirdStrike` when the new strike total is 3 (instead of `escalateOnStrike`), and (ii) call `onBombDefused` when `solved` flips `false→true`. If 4.7's handler already exists on master when you implement 8.5, add these two call sites into it as part of this story; if not, export the functions and leave a marked seam for 4.7 to call. Either way both ends end up wired on master — note in Completion Notes which story landed the call sites.

### Current-state of files this story modifies (UPDATE files)

- **`apps/server/src/timer/onTimerExpired.ts`** — *current:* deletes `timerKey`, emits `BOMB_EXPLODED { teamId, elapsedMs }`, logs; `elapsedMs = session.config.timerMs`. Has an explicit `// Story 8.5: round-resolution ceremony hooks here` marker. *Change:* delegate to `resolveRound(..., 'time-expired', elapsedMs)`; the `del` + emit move into the ceremony. *Preserve:* persist-then-emit ordering and the desync-safe `del`-before-emit reasoning.
- **`apps/server/src/timer/escalateOnStrike.ts`** — *current:* early-returns at `strikes >= 3` ("3rd strike ends the round (Story 8.5) — no timer escalation"); rebases timer + emits `STRIKE` for strikes 1–2. *Change:* none to this function's escalation body; add the strike-3 → `resolveRound('exploded')` branch in the orchestrating caller (or a thin `applyStrike` that chooses escalate-vs-resolve). *Preserve:* `STRIKE` remains the single source of truth for the rebased timer on strikes 1–2 (no separate `TIMER_UPDATE`).
- **`packages/shared/src/types/round.ts`** — *current:* `RoundState.status: 'active'`. *Change:* widen to the 4-outcome union; this is the contract 8.3 deferred to 8.5 (see its doc comment).
- **`apps/client/src/net/bindServerEvents.ts`** — *current:* `onBombDefused`/`onBombExploded`/`onScoreboard` are `console.info` stubs. *Change:* defuse/exploded drive resolution UI state; **leave `onScoreboard` a stub** (Story 8.6 owns it). *Preserve:* the precise `socket.on`/`socket.off` symmetry in the returned unsubscribe (add matching off() for any new listeners; do not touch unrelated ones).
- **`apps/client/src/store/gameStore.ts`** — *current:* render-only non-authoritative snapshot store. *Change:* add a `resolution` field + setter. *Preserve:* the store is non-authoritative; never derive solved/strikes/expiry on the client. Keep immutable `set` updates.
- **`apps/client/src/ui/ActiveRound.tsx`** — *current:* role-gated surface routing; comment notes "in-round facilitator dashboard arrives with 8.5+". *Change:* surface the resolution banner/hold for the Defuser scene; route to between-rounds placeholder on transition.

### Deferred-work items this story OWNS (from `deferred-work.md`)

1. *"`elapsedMs` at expiry is the configured `timerMs`, not real wall-clock … Story 8.5 must reconcile real-vs-displayed before summing `BOMB_EXPLODED.elapsedMs` into `TeamState.cumulativeTimeMs`."* → Task 4 / AC-5.
2. *"`cancel`/`cancelSession` are unwired for normal round-end / defuse … a defuse/early-resolution path that cancels a live timer is **Story 8.5**."* → Task 2 calls `deps.timer.cancel(sessionId, teamId)` in the ceremony. (Today only `dispose`/re-`arm` clear wakes; `fire` reload-no-ops on a deleted key, but cancelling on defuse is cleaner and avoids a needless wake.)
3. *"`cancelPreparation` always returns to `'lobby'` … When `'between-rounds' → preparation` becomes reachable (Stories 8.5/8.6), cancel must restore the originating phase."* → This is primarily 8.6's concern (between-rounds → preparation). Note it; do NOT expand 8.5's scope to rework `cancelPreparation` unless 8.5's status flip makes between-rounds reachable in a way that breaks it. If you flip `SessionState.status` to `'between-rounds'` (Task 2), flag the `cancelPreparation` hard-coded `'lobby'` as a follow-up for 8.6 in Completion Notes.

### Redis keyspace & helpers

- Timer key: `timerKey(sessionId, teamId)`; session key: `sessionKey(sessionId)` — both in `apps/server/src/state/keys.ts`. **Verify the round key helper** (`roundKey(sessionId, roundNumber)` or similar) exists in `keys.ts` before use; 8.3 created the round state at `session:{sessionId}:round:{n}` — reuse that exact helper, do not hardcode the key string.
- `RedisStore` API: `getJSON<T>(key)`, `setJSON(key, value)`, `del(key)` (see `apps/server/src/state/redis.ts` and how `onTimerExpired`/`escalateOnStrike` use them).
- `teamRoom(sessionId, teamId)`, `SessionIOServer`, `SessionLog` types are exported from `apps/server/src/handlers/sessionHandlers.ts` (same imports `onTimerExpired` uses).

### Testing standards summary

- Pure logic (the resolution decision, elapsed reconciliation) unit-tested in Jest with **injected `now`/clock — never `Date.now()`/`setTimeout`** in tests (project rule + 8.4 precedent). Server effect functions tested with the existing in-memory/`TestSocketServer` patterns (`apps/server/src/handlers/__tests__/testSocketServer.ts`, `apps/server/src/timer/__tests__/`).
- R3F components are rendering-only → visual coverage only; if a resolution component "needs" a logic test, the logic has leaked into the component — move it to the store/reducer (project testing boundary).
- Test file locations: server round logic → `apps/server/src/round/__tests__/`; client → `apps/client/src/...` co-located `__tests__` (mirror existing).

### Project Structure Notes

- New server file: `apps/server/src/round/resolveRound.ts` (+ `__tests__/resolveRound.test.ts`) — sits beside the existing `round/initializeRoundBombs.ts` (8.2). Keep `resolveRound` a pure-ish effect (I/O confined to redis/io/timer deps); the *decision* of which outcome should be derivable without I/O where practical.
- Shared contract changes are additive (widen a union, add a type) — `packages/shared` must stay free of runtime deps on react/socket.io/server frameworks (it is pure TS).
- Naming: socket events `SCREAMING_SNAKE_CASE` (reusing existing `BOMB_DEFUSED`/`BOMB_EXPLODED`); types `PascalCase` (`RoundOutcome`); functions `camelCase` (`resolveRound`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative state / pure reducer pattern:** all game logic in pure reducers `(state, event) => newState`; reducers never import `socket.io`/`ioredis`/`pg`/`fastify`; **socket handlers own all I/O** (parse → load → reduce → persist → emit). `resolveRound` is an effect (I/O), not a reducer — keep the decision logic it contains pure where you can.
- **State is never mutated in place** — return new objects via spread/map (`SessionState`, `TeamState`, `RoundState` updates).
- **NEVER emit a socket event from inside a reducer** — reducers have no socket reference; emission lives in the effect/handler.
- **NEVER run the bomb timer on the client** — server owns the clock; the client renders/extrapolates only. The resolution hold (2s/3s) is presentation, not authority.
- **NEVER write to PostgreSQL inside a Socket.IO handler** — session history is written at session end (Story 8.10), never on this path. `cumulativeTimeMs` lives in Redis session state during play.
- **Typed events only:** reuse `ServerToClientEvents`; `socket.emit(string, any)` is forbidden. Event types live in `packages/shared/src/events/` and are imported on both ends.
- **Bounds/trust:** all triggers are server-derived (solved/strikes/expiry from authoritative state), so there's no untrusted client field on this path — but the future interaction handler (4.7) that feeds defuse/strike-3 MUST bounds-check `moduleIndex` before reducing.
- **60fps / R3F:** target 60fps on the bomb view; resolution visuals update via Zustand → R3F (`getState()` in `useFrame`), no React re-renders from the loop, reuse refs, dispose Three.js objects on unmount.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.5: Round Resolution] — ACs.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md] — round-result copy ("DEFUSED."/"DETONATED."/"TIME EXPIRED.", all-caps), Defused = LEDs green + 2s hold, Detonated = red tint + 3s hold + no replay; scoreboard never mid-round; defuse fanfare / explosion cues are Epic 10.
- [Source: apps/server/src/timer/onTimerExpired.ts] — timeout path + explicit 8.5 hook marker + `elapsedMs=timerMs` decision.
- [Source: apps/server/src/timer/escalateOnStrike.ts] — strike-3 terminal early-return ("the explosion, owned by Story 8.5"); STRIKE-carries-timer invariant.
- [Source: apps/server/src/timer/timerScheduler.ts] — `cancel`/`cancelSession`/`fireNow`; persist-then-emit + revalidate-on-fire posture.
- [Source: apps/server/src/reducers/bombReducer.ts] — `solved = modules.length>0 && every solved`; strikes clamp to 3; solved modules inert (solved never regresses).
- [Source: packages/shared/src/types/round.ts] — `RoundState.status` to widen (doc comment defers it to 8.5).
- [Source: packages/shared/src/types/session.ts] — `TeamState.cumulativeTimeMs`, `SessionState.status` union incl. `'between-rounds'`.
- [Source: packages/shared/src/events/payloads.ts + server-to-client.ts] — `RoundEndPayload`, `ScoreboardPayload`, `BOMB_DEFUSED`/`BOMB_EXPLODED`/`SCOREBOARD` events.
- [Source: apps/client/src/net/bindServerEvents.ts] — current `console.info` stubs to replace; off()-symmetry contract.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] — three 8.5-owned items (elapsed reconciliation; cancel-on-defuse; cancelPreparation phase restore).
- [Source: _agent_docs/project-context.md] — critical implementation rules.

### Git Intelligence (recent commits)

- `0294960 review(story-8.2)` / `a9ed7d1 Merge story 8.2` — per-team bomb generation (`round/initializeRoundBombs.ts`); your new `round/resolveRound.ts` sits beside it.
- `36412af review(story-8.4): apply 7 review patches + 4 regression tests` / `fb067a2 Story 8.4: server-authoritative timer & strike escalation` — the timer/strike machinery you extend. Pattern to follow: pure decision + thin effect, injected clock in tests, persist-then-emit, desync paths are logged no-ops (never throw), explicit scope-fence comments for the next story.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- One pre-existing 8.4 integration test (`sessionHandlers.test.ts` "authoritative expiry … status stays active (8.5 fence)") asserted the timeout path leaves `SessionState.status === 'active'` — that was the explicit 8.4 fence documenting "8.5 will flip it." Updated to assert the 8.5 ceremony now records `cumulativeTimeMs` and flips to `'between-rounds'`. No production regression — the assertion was a forward-reference to this story.

### Completion Notes List

- **Idempotency fence (settled seam, deviates from the literal spec):** The story's Task 2 said "load `RoundState`; if `status !== 'active'`, return — this is the idempotency fence." But a single `RoundState` is shared by BOTH racing teams (one `roundKey(sessionId, roundNumber)`, one `status` field — confirmed in `startRound.ts`), so a round-level status cannot express per-team resolution and would block team B after team A resolves. AC-4 requires "resolves exactly once **per team**." Resolved by using the **team's live timer key** as the per-team once-only fence (load first; null → logged no-op) — it exists once per active team and is deleted on first resolution, matching the existing `onTimerExpired`/`escalateOnStrike` desync posture. `RoundState.status` is still recorded as the round-level outcome (last-writer-wins across teams); the authoritative per-team result is the emitted event + that team's `cumulativeTimeMs`, exactly as the `ScoreboardPayload` contract already states. Documented in `round.ts` and `resolveRound.ts` headers. A future per-team round-outcome model (8.6/8.10) may widen `RoundState`.
- **`resolveRound` takes `now`, not a pre-computed `elapsedMs`:** so the displayed-elapsed reconciliation (AC-5) has ONE definition computed inside the ceremony from the live `TimerState` via `timerCore.remainingMs`. At timeout `remainingMs` clamps to 0 → displayed elapsed = `timerMs` (preserves 8.4 decision 6); under strikes the accelerated countdown is baked into `remainingMs` so per-round time never over-counts (proven by the strike-accelerated test: ×1.5625 round records 156 250 ms displayed at 100 000 ms wall, ≤ `timerMs`). The emitted payload and the recorded `cumulativeTimeMs` are the same value.
- **Cross-story seam — which story lands the call sites:** there is still NO server-side `MODULE_INTERACT` handler in the repo (only `sessionHandlers.ts` + `manualHandlers.ts`). 8.5 ships `resolveRound` + the named entry points `onBombDefused` / `onThirdStrike`, fully unit-tested. The **TIME EXPIRED** path is wired end-to-end (the scheduler is its real caller). **Story 4.7 must land the defuse + 3rd-strike call sites:** after reducing a `MODULE_INTERACT`, call `onBombDefused` when `BombState.solved` flips false→true, and `onThirdStrike` (instead of `escalateOnStrike`) when the new strike total reaches 3. 8.5 did NOT land those call sites (the handler doesn't exist yet).
- **Deferred-work items:** (1) "elapsedMs at expiry is `timerMs`, not real wall-clock" → RESOLVED by the single displayed-elapsed definition. (2) "`cancel`/`cancelSession` unwired for defuse/round-end" → RESOLVED: `resolveRound` calls `deps.timer.cancel`. (3) "`cancelPreparation` hard-codes return to `'lobby'`" → NOT in 8.5 scope; flagged as an 8.6 follow-up in a `resolveRound.ts` comment (8.5 makes `'between-rounds'` reachable; 8.6 owns the `between-rounds → preparation` cancel restore).
- **Client DETONATED vs TIME EXPIRED:** derived from the non-authoritative bomb snapshot strike count (`strikes >= 3` → DETONATED, else TIME EXPIRED). No third socket event (Task 1). Limitation noted in `bindServerEvents.ts`: until 4.7 broadcasts the terminal strike-3 bomb state, a 3rd-strike loss may fall back to the TIME EXPIRED label. Acceptable for V1.
- **Validation:** `pnpm typecheck` clean (the project's quality gate — no ESLint configured; the husky pre-commit runs `tsc --noEmit`). Full suite green: shared 136, client 195 (incl. 8 new resolution-binding tests), server 289 (incl. new `resolveRound.test.ts`) = 620 tests.
- **Human verification: PENDING** (Task 7). Automated coverage is complete and green, but per [[human-verification-ac-rule]] the story is not "done" until Jay's observed result is recorded here. Only the TIME EXPIRED path is interactively runnable today; defuse + DETONATED need Story 4.7's interaction handler. Run the server WITHOUT `tsx watch` ([[timer-verification-tsx-watch-gotcha]]) so the in-memory expiry wake survives.

### File List

**Shared**
- `packages/shared/src/types/round.ts` — widened `RoundState.status` to `'active' | RoundOutcome`; added `RoundOutcome` type; documented the round-level-vs-per-team status seam.
- `packages/shared/src/types/index.ts` — export `RoundOutcome`.

**Server**
- `apps/server/src/round/resolveRound.ts` — NEW: `resolveRound` ceremony + `onBombDefused` / `onThirdStrike` entry points.
- `apps/server/src/round/__tests__/resolveRound.test.ts` — NEW: full ceremony / idempotency / desync / elapsed-reconciliation / wrapper coverage.
- `apps/server/src/timer/onTimerExpired.ts` — refactored to delegate to `resolveRound('time-expired', now)`; `TimerEffectDeps` now aliases `ResolveRoundDeps`; takes `now`.
- `apps/server/src/timer/timerScheduler.ts` — `fire` passes `now` to `onTimerExpired`; `effectDeps` now includes the scheduler as the `timer` dep (built after the scheduler object).
- `apps/server/src/timer/__tests__/timerScheduler.test.ts` — `seedSession` seeds an active round + team A + `RoundState`; timeout test asserts the 8.5 ceremony (time recorded + status flipped).
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — updated the ROUND_START→expiry integration test for the 8.5 ceremony.

**Client**
- `apps/client/src/store/gameStore.ts` — `resolution` field + `setResolution`; `setBomb` clears resolution on a new round; `ResolutionState` type.
- `apps/client/src/net/bindServerEvents.ts` — `onBombDefused`/`onBombExploded` drive `setResolution` (DETONATED vs TIME EXPIRED label derivation); `onScoreboard` left a stub.
- `apps/client/src/ui/ResolutionBanner.tsx` — NEW: rendering-only result-banner overlay (holds + tint + interim post-round surface + Epic-10 SFX placeholder).
- `apps/client/src/ui/ActiveRound.tsx` — overlay `ResolutionBanner` across all role surfaces.
- `apps/client/src/ui/copy.ts` — `RESULT_DEFUSED` / `RESULT_DETONATED` / `RESULT_TIME_EXPIRED` / `BETWEEN_ROUNDS_PLACEHOLDER`.
- `apps/client/src/net/__tests__/resolutionBinding.test.ts` — NEW: binding + store resolution tests.

## Change Log

| Date       | Change                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 2026-06-13 | Story 8.5 implemented: `resolveRound` ceremony (defuse / 3rd-strike / timeout) with per-team timer-key idempotency fence, honest displayed-elapsed reconciliation, `RoundState`/`RoundOutcome` contract widening, timeout path delegated to the ceremony, and the client result banner. 620 tests green; `tsc --noEmit` clean. Status → review (human verification pending; defuse/strike-3 live call sites land with Story 4.7). |
| 2026-06-13 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 5 ACs confirmed satisfied. 2 patches applied: (1) per-session serialization in `resolveRound` to close a concurrent two-team `cumulativeTimeMs` lost-update race (+ regression test); (2) `ResolutionBanner` resets `held` on every outcome change. 1 finding deferred to 8.6 (between-rounds status flip strands the banner on re-sync); 4 items deferred to `deferred-work.md`; 6 dismissed. `pnpm typecheck` clean; server 103 + client 195 affected tests green. Status → in-progress (awaiting Jay's Task 7 interactive verification per human-verification rule). |
