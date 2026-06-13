# Story 8.5: Round Resolution

Status: ready-for-dev

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

- [ ] **Task 1 — Widen round/outcome contracts in `packages/shared` (AC: 1, 2)**
  - [ ] Widen `RoundState.status` from the literal `'active'` to `'active' | 'defused' | 'exploded' | 'time-expired'` in `packages/shared/src/types/round.ts`. Update the type's doc comment (it currently says "round resolution (Story 8.5) widens it" — fulfil that note).
  - [ ] Add a `RoundOutcome` type (`'defused' | 'exploded' | 'time-expired'`) co-located in `round.ts` and export it from the shared barrel (`packages/shared/src/index.ts` / `types/index.ts`) so server + client can name outcomes without re-deriving them.
  - [ ] Do NOT add new socket events: `BOMB_DEFUSED` and `BOMB_EXPLODED` already exist in `ServerToClientEvents` with `RoundEndPayload = { teamId, elapsedMs }`. Reuse them. (`TIME EXPIRED` vs `DETONATED` is a client-side label keyed off which event fired + round status; it does NOT need a third event.)
  - [ ] Run `tsc --noEmit` across the workspace — widening `RoundState.status` may surface exhaustiveness gaps at existing call sites; fix them.

- [ ] **Task 2 — `resolveRound` server effect (the resolution ceremony) (AC: 1, 2, 4, 5)**
  - [ ] Create `apps/server/src/round/resolveRound.ts` exporting `async function resolveRound(deps, sessionId, teamId, outcome, elapsedMs)`. This is the single ceremony all three outcome paths funnel through. Deps shape mirrors `TimerEffectDeps` plus the scheduler: `{ redis, io, log, timer }` (so it can cancel the wake).
  - [ ] **Once-only guard (AC-4):** load `RoundState` (`roundKey(sessionId, roundNumber)` — see keyspace note) first; if its `status !== 'active'`, log and return (already resolved). This is the idempotency fence.
  - [ ] **Persist-then-emit ordering (follow 8.4's `onTimerExpired` posture):** (a) cancel the scheduler wake (`deps.timer.cancel(sessionId, teamId)`) and delete the team timer key (`del(timerKey(sessionId, teamId))`); (b) record `elapsedMs` into the team's `TeamState.cumulativeTimeMs` and persist `SessionState`; (c) set `RoundState.status` to the resolved outcome and persist; (d) THEN emit `BOMB_DEFUSED` (outcome `'defused'`) or `BOMB_EXPLODED` (outcomes `'exploded'`/`'time-expired'`) to `teamRoom(sessionId, teamId)`. Clearing the live clock before announcing prevents a stray strike/re-arm from finding a "live" expired timer and double-firing (the exact reasoning documented in `onTimerExpired.ts`).
  - [ ] **`cumulativeTimeMs` update must be immutable** — spread a new `TeamState`/`SessionState`, never mutate in place (project rule). Guard the team's existence (`session.teams[teamId]` may be undefined per `Partial<Record<TeamId, TeamState>>`).
  - [ ] Keep `resolveRound` free of `setTimeout`/scene-hold logic — the 2s/3s holds are client-side presentation (Task 5). The server records and announces; it does not block on the cinematic.
  - [ ] **Do NOT** flip `SessionState.status` to `'between-rounds'` blindly here without reconciling with Story 8.6's between-rounds entry. Settle the seam: 8.5 records the outcome and emits the round-end event; the explicit `active → between-rounds` status flip + scoreboard belongs to 8.6. If 8.6 is not yet merged, flip `SessionState.status` to `'between-rounds'` here (it is the correct next phase and Story 8.6 will build on it) and leave a `// Story 8.6: scoreboard preview + ready gate hooks here` marker — but never emit `SCOREBOARD` (AC-3).

- [ ] **Task 3 — Wire the three trigger paths (AC: 1, 2)**
  - [ ] **Timeout path (already exists):** replace the `// Story 8.5: round-resolution ceremony hooks here` block in `apps/server/src/timer/onTimerExpired.ts`. Today it deletes the timer key and emits `BOMB_EXPLODED` directly. Refactor so the timeout path calls `resolveRound(deps, sessionId, teamId, 'time-expired', elapsedMs)` instead — moving the `del` + emit into the ceremony so all three outcomes share one code path. Keep the existing "displayed elapsed = `timerMs`" decision but reconcile per AC-5 (Task 4).
  - [ ] **3rd-strike path:** `escalateOnStrike` early-returns at `strikes >= 3` (it deliberately does not escalate on the terminal strike). 8.5 owns what happens on strike 3. Add a sibling entry point — e.g. extend the strike handling so that when the post-reduce strike total is `3`, the caller invokes `resolveRound(deps, sessionId, teamId, 'exploded', elapsedMs)` instead of `escalateOnStrike`. Because there is no server-side `MODULE_INTERACT` handler in the repo yet (see Cross-Story Seam), expose this as a named function (`onThirdStrike` or fold the branch into a small `applyStrike` orchestrator) and exercise it directly via tests, exactly as 8.4 did with `escalateOnStrike`.
  - [ ] **Defuse path:** expose `onBombDefused(deps, sessionId, teamId, elapsedMs)` (or fold into the same orchestrator) that calls `resolveRound(..., 'defused', ...)`. The trigger is `BombState.solved` transitioning `false → true` after a `bombReducer` reduce. The reduce + detection happens in the (not-yet-built) interaction handler — 8.5 provides the function and the detection contract; Story 4.7 wires the live call site (coordinate — see Cross-Story Seam). Exercise via tests now.

- [ ] **Task 4 — Honest elapsed-time reconciliation (AC: 5)**
  - [ ] **Defuse elapsed:** real elapsed = wall-clock since the timer's first segment began. The clean computation is from the live `TimerState`: `displayedElapsed = timerMs - displayedRemaining(timer, now)`, using the same per-segment formula in `timerCore`/`types/timer.ts` (`remaining = remainingAtStart - (now - startedAt) * speedMultiplier`). Reuse the existing `timerCore` helper (`displayedRemaining`/equivalent) — do NOT re-derive the segment math (check `apps/server/src/timer/timerCore.ts` for the exact exported helper name before writing your own).
  - [ ] **Timeout elapsed:** displayed clock is 0 by definition, so displayed elapsed = `config.timerMs` (8.4 decision 6, preserved). Confirm this is what gets summed — and that it is consistent with the defuse formula above (both express *displayed* elapsed, so per-round times are comparable for scoring).
  - [ ] **Strike-3 elapsed:** time at the moment of failure = displayed elapsed at the strike instant, computed via the same `timerCore` helper from the current (rebased) `TimerState`.
  - [ ] Document the chosen convention in a comment so Story 8.10 (scoring) sums a single consistent definition. Resolves deferred-work item: *"`elapsedMs` at expiry is the configured `timerMs`, not real wall-clock … Story 8.5 must reconcile real-vs-displayed before summing into `cumulativeTimeMs`"*.

- [ ] **Task 5 — Client resolution presentation (AC: 1, 2, 3)**
  - [ ] Replace the `console.info` stubs for `onBombDefused`/`onBombExploded` in `apps/client/src/net/bindServerEvents.ts` with handlers that drive a resolution UI state (add a `resolution` field to `gameStore` — e.g. `{ outcome: 'defused' | 'exploded' | 'time-expired'; elapsedMs: number } | null`). Distinguish DETONATED vs TIME EXPIRED on the client by reading the current `RoundState`/`SESSION_STATE` (or carry it via a follow-up `SESSION_STATE` broadcast). If the round status isn't readily available client-side, label `BOMB_EXPLODED` generically per the simplest correct mapping and note the limitation; do not invent a new event.
  - [ ] Render the result banner in the bomb scene area: **"DEFUSED."** (all-caps, terminal punctuation — EXPERIENCE.md), all LEDs green, ~2s hold, then transition. **"DETONATED."** / **"TIME EXPIRED."** — red scene tint, ~3s hold, then transition. No replay/freeze-frame in V1 (EXPERIENCE.md §"Detonated"). SFX cues (fanfare / explosion bass) are Epic 10 polish — wire a no-op/placeholder hook, do not block on audio assets.
  - [ ] **AC-3 enforcement:** the scoreboard surface must NOT appear while the round is active or during the hold; transition target is the between-rounds surface (Story 8.6). If 8.6's surface doesn't exist yet, transition to the existing post-round placeholder and leave a marker.
  - [ ] R3F discipline: the red tint / LED-green changes are rendering-only and must read from store via `getState()` patterns already established (4.4/4.5); no game logic in components; dispose any added Three.js material/objects on unmount.

- [ ] **Task 6 — Tests (AC: 1–5)**
  - [ ] `apps/server/src/round/__tests__/resolveRound.test.ts`: defuse records `cumulativeTimeMs` + emits `BOMB_DEFUSED` + cancels wake + deletes timer key + sets `RoundState.status='defused'`; timeout → `'time-expired'` + `BOMB_EXPLODED`; 3rd strike → `'exploded'` + `BOMB_EXPLODED`. **Idempotency (AC-4):** second call on an already-resolved round is a no-op (no second emit, no double time). **No-session / no-team / missing timer** desync paths are logged no-ops, never throw (mirror `escalateOnStrike`'s desync handling).
  - [ ] Elapsed-time reconciliation tests (AC-5): defuse mid-round computes displayed elapsed from `TimerState`; timeout sums `timerMs`; a strike-accelerated round does not over-count. Use injected `now`/clock — **never `Date.now()` or `setTimeout` in tests** (project rule).
  - [ ] Update `onTimerExpired` test (`apps/server/src/timer/__tests__/`) to assert it now delegates to `resolveRound` (records time + sets status), not just emits.
  - [ ] Client: assert `bindServerEvents` sets the resolution store state on `BOMB_DEFUSED`/`BOMB_EXPLODED` and that no scoreboard renders mid-round (AC-3). Keep R3F components to rendering-only (no logic tests — project testing boundary).

- [ ] **Task 7 — Human verification (per project rule [[human-verification-ac-rule]])**
  - [ ] Jay verifies interactively: run a round to (a) full defuse → sees "DEFUSED." + 2s hold + green LEDs; (b) 3rd strike → "DETONATED." + red tint + 3s hold; (c) timer expiry → "TIME EXPIRED." + red tint + 3s hold. Scoreboard never flashes mid-round. Confirm recorded round time looks right. Not done until his observed result is in Completion Notes. Verification caveat — see [[timer-verification-tsx-watch-gotcha]]: run the server WITHOUT `tsx watch` so in-memory expiry wakes survive; the timeout path depends on them.

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
