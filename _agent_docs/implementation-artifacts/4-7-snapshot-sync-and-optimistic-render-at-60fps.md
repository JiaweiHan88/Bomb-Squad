# Story 4.7: Snapshot Sync & Optimistic Render at 60fps

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want my clicks to feel instant and the bomb to stay authoritative,
so that play is responsive without ever showing a wrong "solved" state.

## Acceptance Criteria

1. **Authoritative snapshot sync.** When the server broadcasts a `MODULE_UPDATE` (full module `ModuleState`, by `moduleIndex`), the client applies it as the authoritative truth for the bomb, scoped to the team room `session:{id}:team:{teamId}`. Bomb-level changes (strikes, timer) continue to arrive via the dedicated `STRIKE` / `TIMER_UPDATE` events — they are NOT bundled into `MODULE_UPDATE` (the implemented contract; see Contract Note re: the epic's "optional bombDelta"). The round-start bomb snapshot arrives via `BOMB_INIT`.

2. **Optimistic pre-flash, never pre-commit `solved`.** A Defuser click may optimistically pre-flash a local affordance (e.g. a wire visibly severing) for perceived responsiveness, but the affordance MUST NOT flip the module's `solved` state / solve LED — only the server's snapshot flips the solve LED. A server rejection (no confirming snapshot, or a contradicting one) rolls the pre-flash back. The perceived round-trip for the pre-flash + reconcile stays within a ≤100ms perceived budget on a normal-latency connection.

3. **Sustained 60fps.** Over a 10-minute session on a mid-range laptop the bomb view sustains 60fps: tick-rate reads use `useGameStore.getState()` inside `useFrame` (never the reactive selector hook on the render loop), module components are memoized (`React.memo` + stable Zustand selectors), refs are reused (no per-frame object/array allocations in `useFrame`), and Three.js `Geometry`/`Material`/`Mesh` objects are disposed on unmount.

## Tasks / Subtasks

- [ ] **Task 1 — Close the round-start bomb seam: generate + broadcast `BOMB_INIT` (AC: 1)**
  - [ ] **Verify first:** `initializeRoundBombs` (`apps/server/src/round/initializeRoundBombs.ts`, Story 8.2) currently has **no production caller**, and **`BOMB_INIT` is emitted nowhere** in the server. The `ROUND_START` handler (`apps/server/src/handlers/sessionHandlers.ts` ~line 685) still carries the placeholder comment `// Story 8.2: per-team bomb generation slots in here … BOMB_INIT broadcasts to the team rooms joined below.` Snapshot sync has nothing to sync until this is wired. Confirm it is still unwired before implementing (a sibling Wave-3 story may have landed it first).
  - [ ] Wire one awaited `initializeRoundBombs(deps.redis, sessionId, roundNumber, config, teamIds)` call into the `ROUND_START` handler at that seam — **after** the session/round persistence and team-room joins (`teamRoom` membership must exist before the team-scoped emit), alongside the existing timer-mint loop. `teamIds` = `Object.keys(result.round.defusers)` (the populated teams, same set the timer loop uses).
  - [ ] Emit `BOMB_INIT(bombs[teamId])` to `teamRoom(sessionId, teamId)` per populated team (the bomb is team-private; never broadcast to `sessionRoom`). Follow the established persist-then-emit ordering and the non-atomic multi-key write posture already documented in that handler.
  - [ ] Respect 8.2's failure contract: `generateRoundBombs` throws on a bad config (unregistered/empty pool, out-of-range moduleCount) **before** any write — keep generation ahead of emits so a bad round never half-broadcasts.

- [ ] **Task 2 — Server `MODULE_INTERACT` handler (the production reduce/persist/broadcast path) (AC: 1, 2)**
  - [ ] Create the handler that the client `dispatch.ts` production backend targets (`MODULE_INTERACT` already exists in `ClientToServerEvents` with `ModuleInteractPayload = { teamId, moduleIndex, action }`). Register it in `apps/server/src/handlers/sessionHandlers.ts` alongside the other `socket.on(...)` registrations (follow that file's handler shape: authority/resolve socket→sessionId via `socket.data`, load fresh state from Redis, decide against loaded state, persist, emit). Consider a sibling module e.g. `apps/server/src/handlers/moduleHandlers.ts` if it keeps `sessionHandlers.ts` manageable — match whichever pattern the file already uses for cohesion.
  - [ ] **Untrusted input — bounds-check before reducing (project security rule):** validate `teamId` is a real team the socket belongs to; validate `0 <= moduleIndex < bomb.modules.length` (`Number.isInteger`); the module `action` is `unknown` — validate/shape it before it reaches a reducer. Reject invalid input with a typed `ERROR` (recoverable) — never throw, never trust the payload.
  - [ ] Load the team bomb (`bombKey(sessionId, teamId)`), run `bombReducer(bomb, { type: 'MODULE_ACTION', moduleIndex, payload: action })` (pure; `apps/server/src/reducers/bombReducer.ts`), persist the new `BombState`, then broadcast:
    - `MODULE_UPDATE { moduleIndex, state: newModules[moduleIndex] }` to `teamRoom`. Note `bombReducer` rolls a transient `'struck'` up into `'armed'` + increments team strikes — the broadcast module state is the post-rollup `'armed'` state; the **strike** travels separately.
    - When the reduce increments strikes (1 or 2): call `escalateOnStrike(deps, sessionId, teamId, newStrikes, now)` — it rebases the timer and emits `STRIKE` (single source of truth for the rebased timer; no separate `TIMER_UPDATE`).
  - [ ] **Resolution hooks (seam with Story 8.5, also on master):** when the reduce makes `BombState.solved` flip `false→true`, call 8.5's `onBombDefused(deps, sessionId, teamId, elapsedMs)`; when `newStrikes === 3`, call 8.5's `onThirdStrike(deps, sessionId, teamId, elapsedMs)` **instead of** `escalateOnStrike` (which deliberately early-returns at `strikes >= 3`). If 8.5's functions already exist on master, wire these call sites directly; if 8.5 isn't implemented yet, leave a clearly-marked seam (`// Story 8.5: resolution hook`) and a follow-up note in Completion Notes — do NOT re-implement the resolution ceremony here. See Cross-Story Seam.
  - [ ] Solved modules are inert in `bombReducer` (further interaction is a no-op) and `solved` never regresses — rely on that; do not re-implement the guard.

- [ ] **Task 3 — Install the production client dispatch backend (AC: 1, 2)**
  - [ ] In the app bootstrap (where `bindServerEvents` is wired — see `apps/client/src/net/`), call `setModuleActionDispatch((moduleIndex, action) => getSocket().emit('MODULE_INTERACT', { teamId, moduleIndex, action }))` for the production (non-sandbox) path. `teamId` comes from the session/self player (`session.players[selfId].teamId`). The seam already exists: `apps/client/src/modules/dispatch.ts` (`setModuleActionDispatch` / `dispatchModuleAction`) — DefuserViews already call `dispatchModuleAction`; today outside the sandbox it warns-and-drops. This task makes the production backend real.
  - [ ] Keep the sandbox's LOCAL backend (`apps/client/src/sandbox/devDispatch.ts`) untouched — `/dev/sandbox` runs the reducer client-side by design. The production backend must only be installed on the real session route, never the sandbox.
  - [ ] Tear down / reset the backend appropriately on unmount/disconnect so a stale socket reference can't be emitted into (mirror `bindServerEvents`' subscribe/unsubscribe symmetry).

- [ ] **Task 4 — Client snapshot application + scoping (AC: 1)**
  - [ ] `gameStore.applyModuleUpdate` already exists and is correct (immutable single-module replace, bounds-checked, does not touch strikes/timer). `bindServerEvents` already wires `MODULE_UPDATE → applyModuleUpdate`, `BOMB_INIT → setBomb`, `STRIKE → setStrike`, `TIMER_UPDATE → setTimer`. **Reuse these — do not reinvent.** Verify the production flow drives exactly these store actions (the dev harness already proves the scene is byte-identical against this path — `DevBombHarness.tsx`).
  - [ ] **Scoping:** the client receives only its own team's broadcasts because the socket is in `teamRoom(sessionId, teamId)` (joined in `ROUND_START`). The client does not filter by team itself — but it MUST handle a `MODULE_UPDATE` arriving before `BOMB_INIT` gracefully (the store already drops it with a warning). Confirm the warning path doesn't spam under normal ordering.
  - [ ] Authoritative truth: the snapshot is non-authoritative *display* state on the client (`gameStore` doc: "render-only, NON-authoritative snapshot"). Never derive `solved`/`strikes`/expiry locally — the solve LED flips only from the server snapshot (AC-2).

- [ ] **Task 5 — Optimistic pre-flash + rollback (AC: 2)**
  - [ ] Add an optimistic affordance layer in the module render path that, on a Defuser activation, can show a transient local pre-flash (e.g. wire severing animation, button depress) **without** mutating the authoritative `gameStore` module `status` and **without** flipping the solve LED. Keep optimistic visual state separate from the authoritative snapshot (a local component/ref or a dedicated non-authoritative UI slice) so the server snapshot remains the only thing that flips `solved`.
  - [ ] **Reconcile on snapshot:** when the confirming `MODULE_UPDATE` arrives, clear the pre-flash (the authoritative state now drives the visual). **Rollback:** if the server's snapshot contradicts the optimistic guess (e.g. a wire the player thought correct comes back `'armed'` after the transient `'struck'` rollup, or no confirming change arrives within a timeout window), revert the pre-flash to the authoritative state. Roll back cleanly — never leave a severed-wire visual on a still-armed module.
  - [ ] **≤100ms perceived budget:** the pre-flash must render on the same frame as the click (synchronous local visual), so perceived latency is independent of round-trip. Do not gate the affordance on the socket round-trip. Document the budget reasoning in a comment.
  - [ ] Respect the click primitive contract (`apps/client/src/modules/interaction.ts`): pre-flash hangs off the same `onActivate`/press-hold callbacks; do not add bomb-side keyboard shortcuts; do not measure hold duration on the client (hold semantics are reducer state).

- [ ] **Task 6 — 60fps hardening pass (AC: 3)**
  - [ ] Audit the bomb scene render path (`apps/client/src/scenes/BombScene.tsx`, `ModuleBay.tsx`, `TimerLcd.tsx`, `StrikeIndicator.tsx`, module `DefuserView`s) for the project performance rules: no new object/array allocation inside any `useFrame`; reuse refs; tick-rate reads via `getState()` only; reactive `useStore()` only for click-rate state (e.g. camera focus — already correct in `CameraRig`).
  - [ ] Memoize module components with `React.memo` and stable Zustand selectors so a `MODULE_UPDATE` to one module does not cascade re-renders across all bays. The scene already reads `modules` via a top-level selector — verify a single module change doesn't re-render unrelated bays.
  - [ ] Ensure every Three.js `Geometry`/`Material`/`Mesh` created imperatively is disposed on unmount (R3F does not GC Three.js objects). Audit for leaks across a round transition (mount/unmount of the scene).
  - [ ] Provide a way to validate 60fps over a long session (the dev harness `/dev/bomb` + browser performance profiler). Document the measurement method; this is the AC-3 evidence.

- [ ] **Task 7 — Tests (AC: 1, 2, 3)**
  - [ ] Server: `MODULE_INTERACT` handler integration test using the existing `TestSocketServer` wrapper (`apps/server/src/handlers/__tests__/testSocketServer.ts`): valid action → `MODULE_UPDATE` broadcast to the team room with the post-reduce module state; out-of-range `moduleIndex` / wrong team / malformed action → typed `ERROR`, no broadcast, no throw; a striking action → `STRIKE` via `escalateOnStrike` (strikes 1–2) and the module update reflects the `'struck'→'armed'` rollup; 3rd strike / full defuse → calls the 8.5 resolution hook (assert the seam is invoked, mock if 8.5 not yet implemented). Call the pure `bombReducer` directly (never mock it).
  - [ ] `ROUND_START` test (extend existing `apps/server/src/session/__tests__/startRound.test.ts` or the handler test): asserts bombs are generated/persisted under `bombKey` and `BOMB_INIT` is emitted to each populated team room.
  - [ ] Client: snapshot application is already covered by `gameStore`/`DevBombHarness` paths — add a test that the production dispatch backend emits `MODULE_INTERACT` with the correct `{ teamId, moduleIndex, action }`, and that optimistic pre-flash state never sets authoritative `status: 'solved'` and rolls back when no confirming snapshot arrives.
  - [ ] R3F components stay rendering-only → covered by visual/Playwright regression, not logic tests (project testing boundary). The 60fps AC is validated by profiling evidence, documented in Completion Notes — not a unit test.

- [ ] **Task 8 — Human verification (per project rule [[human-verification-ac-rule]])**
  - [ ] Jay verifies interactively: in a real session (not sandbox), a Defuser click pre-flashes instantly (feels ≤100ms), the solve LED only turns green after the server confirms, a wrong cut shows a strike (LED never wrongly greens), and the bomb view holds 60fps over a sustained session (show profiler). Not done until his observed result is in Completion Notes. Verification caveat — see [[timer-verification-tsx-watch-gotcha]]: don't run the server under `tsx watch` if a round timer/expiry is in play.

## Dev Notes

### Cross-Story Seam (READ FIRST — Wave 3 parallel integration)

This story is the **end-to-end glue** of Wave 3: it exercises the click primitive (5.1), a real module (5.3 Wires), and server snapshot broadcasts together. It has two seams with sibling Wave-3 stories (both on master):

1. **Story 8.5 — Round Resolution.** 8.5 builds the resolution ceremony (`resolveRound` + entry points `onBombDefused` / `onThirdStrike`) and wires the **timer-expiry** path itself. 4.7 owns the **defuse** and **3rd-strike** trigger call sites because they fire from *this* story's new `MODULE_INTERACT` handler (after `bombReducer` produces `solved===true` or `strikes===3`). Since both stories live on master, sequence them so the seam is wired directly: 4.7's handler calls 8.5's exported functions. If 8.5 isn't implemented yet when you build 4.7, stub the seam behind a clearly-marked comment and a Completion-Notes follow-up; do not re-implement resolution. Mirror how 8.4 left `escalateOnStrike` callable-but-uncalled and test-exercised.

2. **Stories 8.2/8.3 — bomb generation seam.** 8.2 shipped the pure generator + I/O wrapper (`initializeRoundBombs`) but **left it unwired** into `ROUND_START`, and `BOMB_INIT` is emitted nowhere (confirmed by grep: no `.emit('BOMB_INIT'`, no production caller of `initializeRoundBombs`). 4.7 must close this (Task 1) — snapshot sync is meaningless without a bomb snapshot to start from. Treat the placeholder comment in `sessionHandlers.ts` as your wiring point.

### Contract Note — the epic's "optional bombDelta"

AC text in epics.md says `MODULE_UPDATE (full module state + optional bombDelta)`. The **implemented** contract (Stories 1.2 / 4.4 / 4.5) deliberately split bomb-level state out: `ModuleUpdate = { moduleIndex, state }` ONLY, with strikes via `STRIKE` and timer via `TIMER_UPDATE` as the single sources of truth (see the doc comment on `ModuleUpdate` in `packages/shared/src/events/payloads.ts`: *"Bomb-level changes (strikes, timer) are NOT bundled here"*). **Follow the implemented split — do not re-add a `bombDelta` field.** The epic's "bombDelta" intent is already satisfied by the dedicated events. The client store enforces this: `applyModuleUpdate` explicitly does not touch strikes/timer. If you believe a genuine bomb-level delta is needed that isn't covered by `STRIKE`/`TIMER_UPDATE`/`BOMB_DEFUSED`/`BOMB_EXPLODED`, raise it rather than silently widening the type.

### Current-state of files this story modifies (UPDATE files)

- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* `ROUND_START` persists session+round, joins team rooms, emits `SESSION_STATE`, mints/arms per-team timers + emits `TIMER_UPDATE`. Has the `// Story 8.2: per-team bomb generation slots in here` seam (unwired). No `MODULE_INTERACT` handler exists. *Change:* wire `initializeRoundBombs` + `BOMB_INIT` (Task 1); register the `MODULE_INTERACT` handler (Task 2). *Preserve:* authority gates (facilitator-only `ROUND_START`), persist-then-emit ordering, team-room-join-before-emit, the existing timer loop, the typed-`ERROR` rejection pattern.
- **`apps/client/src/modules/dispatch.ts`** — *current:* dispatch seam with `setModuleActionDispatch`; production backend `null` → warns-and-drops outside sandbox. *Change:* install the real production backend at bootstrap (Task 3). *Preserve:* the seam abstraction (DefuserViews stay transport-agnostic); the sandbox local backend.
- **`apps/client/src/store/gameStore.ts`** — *current:* `applyModuleUpdate`/`setBomb`/`setStrike`/`setTimer` all correct and non-authoritative. *Change:* likely none for snapshot application; possibly add a non-authoritative optimistic-UI slice if you don't keep pre-flash in component-local state (Task 5). *Preserve:* immutability; never derive authoritative state on the client.
- **`apps/client/src/net/bindServerEvents.ts`** — *current:* `MODULE_UPDATE`/`BOMB_INIT`/`STRIKE`/`TIMER_UPDATE` wired to store actions; `BOMB_DEFUSED`/`BOMB_EXPLODED` are `console.info` stubs (Story 8.5 replaces those — not this story). *Change:* none required for snapshot sync; do not touch the 8.5-owned resolution stubs. *Preserve:* `on`/`off` symmetry.
- **`apps/client/src/scenes/*` + module `DefuserView`s** — *current:* rendering-only, 4.1–4.5 patterns (getState-in-useFrame for tick-rate, reactive selectors for click-rate). *Change:* memoization/dispose/alloc audit (Task 6); optimistic pre-flash hook in DefuserViews (Task 5). *Preserve:* zero game logic in components; the click-primitive contract.

### The snapshot path is already proven by the dev harness

`apps/client/src/scenes/DevBombHarness.tsx` drives the **exact** production store actions (`setBomb` / `applyModuleUpdate` / `setStrike` / `setTimer`) so "the scene under test is byte-identical to production." Its header comment names this story: *"the exact path snapshot sync (4.7) will ride."* Use it as your client-side reference and 60fps test surface. Do not build a parallel application path — make the server broadcasts feed the same store actions the harness already exercises.

### Server-clock / extrapolation (already built — don't duplicate)

`apps/client/src/net/serverClock.ts` (Story 4.4) estimates `serverNow()` from `TIMER_UPDATE`/`STRIKE` `startedAt` stamps; `bindServerEvents` already calls `noteTimerBroadcast` before storing timer/strike. The timer LCD extrapolates from this. 4.7 does not change clock logic — it relies on it. The optimistic budget (AC-2) is about *input* responsiveness, not the clock.

### Testing standards summary

- Server handlers → integration tests with `TestSocketServer`; call the pure `bombReducer` directly, never mock it. Pure logic uses injected `now` — never `Date.now()`/`setTimeout` in tests.
- R3F components → rendering-only; visual/Playwright regression only. If a component "needs" a logic test, the logic leaked — move it to the store/reducer.
- Test locations: server handler integration → `apps/server/src/handlers/__tests__/`; client → co-located `__tests__`; E2E/visual → `apps/client/e2e/`.
- 60fps (AC-3) is validated by profiling evidence in Completion Notes, not a unit test.

### Project Structure Notes

- New server handler may live in `sessionHandlers.ts` (match its registration pattern) or a sibling `moduleHandlers.ts` if cohesion warrants — `manualHandlers.ts` is the precedent for a separate handler module.
- Reuse existing key helpers: `bombKey(sessionId, teamId)`, `timerKey`, `sessionKey`, `roundKey` (`apps/server/src/state/keys.ts`). Reuse `teamRoom`, `SessionIOServer`, `SessionLog` from `sessionHandlers.ts`.
- Naming: events `SCREAMING_SNAKE_CASE` (reuse existing); the `MODULE_ACTION` bomb action type already exists in shared (`packages/shared/src/types/actions.ts`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **R3F:** geometry/layout data-driven from `generate(seed, ctx)` output — never hardcode positions/visual state in JSX. Tick-rate state via `useStore.getState()` in `useFrame`, not the reactive hook. `useFrame` for per-tick updates, never `useEffect`+`setInterval`. Components are dumb renderers — zero game logic.
- **Performance:** target 60fps, treat any frame-budget violation as a bug. Never trigger React re-renders from the game loop. No new objects/arrays inside `useFrame` — reuse refs. Memoize module components (`React.memo` + stable selectors) to prevent cascade re-renders. Dispose Three.js objects on unmount.
- **Server-authoritative / pure reducer:** all game logic in pure reducers; socket handlers own all I/O (parse → load → reduce → persist → emit); reducers never import socket.io/redis/pg/fastify and never emit. State never mutated in place.
- **Typed events only:** reuse `ClientToServerEvents`/`ServerToClientEvents`; `socket.emit(string, any)` is a compile error. Bomb timer never runs on the client — server owns the clock.
- **Security:** all game actions validated server-side; `moduleIndex`/`action` are untrusted — bounds-check before dereferencing/reducing.
- **Never write Postgres in a socket handler** — not on this path.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.7: Snapshot Sync & Optimistic Render at 60fps] — ACs (incl. the "optional bombDelta" wording reconciled above).
- [Source: packages/shared/src/events/payloads.ts] — `ModuleUpdate { moduleIndex, state }` (bomb-level changes NOT bundled), `ModuleInteractPayload`, `RoundEndPayload`.
- [Source: packages/shared/src/events/client-to-server.ts / server-to-client.ts] — `MODULE_INTERACT`, `MODULE_UPDATE`, `BOMB_INIT`, `STRIKE`, `TIMER_UPDATE` typed contracts.
- [Source: apps/server/src/handlers/sessionHandlers.ts ~660–735] — `ROUND_START` handler, the unwired 8.2 bomb seam, timer-mint loop, team-room joins, authority/ERROR patterns.
- [Source: apps/server/src/round/initializeRoundBombs.ts] — generator I/O wrapper to wire (no production caller today); `bombKey` keyspace.
- [Source: apps/server/src/reducers/bombReducer.ts] — `MODULE_ACTION` reduce, `'struck'→'armed'` rollup + strike increment, `solved` computation, solved-inert guard.
- [Source: apps/server/src/timer/escalateOnStrike.ts] — call on strikes 1–2; early-returns at ≥3 (3rd strike is 8.5's explosion).
- [Source: apps/client/src/modules/dispatch.ts] — production dispatch backend seam (`setModuleActionDispatch`).
- [Source: apps/client/src/modules/interaction.ts] — click primitive (gesture vocabulary; pre-flash hooks here).
- [Source: apps/client/src/store/gameStore.ts] — `applyModuleUpdate` (immutable, bounds-checked, non-authoritative); access-pattern doc.
- [Source: apps/client/src/net/bindServerEvents.ts] — event→store wiring; 8.5-owned resolution stubs (leave alone).
- [Source: apps/client/src/scenes/DevBombHarness.tsx + BombScene.tsx] — the byte-identical production store path; 60fps reference surface.
- [Source: apps/client/src/net/serverClock.ts] — `serverNow()` extrapolation (reuse, don't duplicate).
- [Source: _agent_docs/project-context.md] — R3F / performance / server-authoritative / security rules.

### Git Intelligence (recent commits)

- `fb067a2 Story 8.4` + `36412af review(8.4)` — server-authoritative timer/strike machinery (`STRIKE`/`TIMER_UPDATE` broadcasts, `escalateOnStrike`) you call from the interaction handler.
- `a9ed7d1 / 0294960 Story 8.2` — per-team bomb generation (`initializeRoundBombs`, `bombKey`); you wire its unwired caller.
- Pattern to follow: thin I/O handler over a pure reducer; persist-then-emit; typed `ERROR` for bad input (never throw); team-scoped emits to `teamRoom`; explicit cross-story seam comments.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
