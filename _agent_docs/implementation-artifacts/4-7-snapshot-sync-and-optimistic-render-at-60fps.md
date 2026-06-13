---
baseline_commit: 657e7993c8205766145b5cf24536708d3f30c102
---

# Story 4.7: Snapshot Sync & Optimistic Render at 60fps

Status: done

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

- [x] **Task 1 — Close the round-start bomb seam: generate + broadcast `BOMB_INIT` (AC: 1)**
  - [x] **Verify first:** `initializeRoundBombs` (`apps/server/src/round/initializeRoundBombs.ts`, Story 8.2) currently has **no production caller**, and **`BOMB_INIT` is emitted nowhere** in the server. The `ROUND_START` handler (`apps/server/src/handlers/sessionHandlers.ts` ~line 685) still carries the placeholder comment `// Story 8.2: per-team bomb generation slots in here … BOMB_INIT broadcasts to the team rooms joined below.` Snapshot sync has nothing to sync until this is wired. Confirm it is still unwired before implementing (a sibling Wave-3 story may have landed it first).
  - [x] Wire one awaited `initializeRoundBombs(deps.redis, sessionId, roundNumber, config, teamIds)` call into the `ROUND_START` handler at that seam — **after** the session/round persistence and team-room joins (`teamRoom` membership must exist before the team-scoped emit), alongside the existing timer-mint loop. `teamIds` = `Object.keys(result.round.defusers)` (the populated teams, same set the timer loop uses).
  - [x] Emit `BOMB_INIT(bombs[teamId])` to `teamRoom(sessionId, teamId)` per populated team (the bomb is team-private; never broadcast to `sessionRoom`). Follow the established persist-then-emit ordering and the non-atomic multi-key write posture already documented in that handler.
  - [x] Respect 8.2's failure contract: `generateRoundBombs` throws on a bad config (unregistered/empty pool, out-of-range moduleCount) **before** any write — keep generation ahead of emits so a bad round never half-broadcasts.

- [x] **Task 2 — Server `MODULE_INTERACT` handler (the production reduce/persist/broadcast path) (AC: 1, 2)**
  - [x] Create the handler that the client `dispatch.ts` production backend targets (`MODULE_INTERACT` already exists in `ClientToServerEvents` with `ModuleInteractPayload = { teamId, moduleIndex, action }`). Register it in `apps/server/src/handlers/sessionHandlers.ts` alongside the other `socket.on(...)` registrations (follow that file's handler shape: authority/resolve socket→sessionId via `socket.data`, load fresh state from Redis, decide against loaded state, persist, emit). Consider a sibling module e.g. `apps/server/src/handlers/moduleHandlers.ts` if it keeps `sessionHandlers.ts` manageable — match whichever pattern the file already uses for cohesion.
  - [x] **Untrusted input — bounds-check before reducing (project security rule):** validate `teamId` is a real team the socket belongs to; validate `0 <= moduleIndex < bomb.modules.length` (`Number.isInteger`); the module `action` is `unknown` — validate/shape it before it reaches a reducer. Reject invalid input with a typed `ERROR` (recoverable) — never throw, never trust the payload.
  - [x] Load the team bomb (`bombKey(sessionId, teamId)`), run `bombReducer(bomb, { type: 'MODULE_ACTION', moduleIndex, payload: action })` (pure; `apps/server/src/reducers/bombReducer.ts`), persist the new `BombState`, then broadcast:
    - `MODULE_UPDATE { moduleIndex, state: newModules[moduleIndex] }` to `teamRoom`. Note `bombReducer` rolls a transient `'struck'` up into `'armed'` + increments team strikes — the broadcast module state is the post-rollup `'armed'` state; the **strike** travels separately.
    - When the reduce increments strikes (1 or 2): call `escalateOnStrike(deps, sessionId, teamId, newStrikes, now)` — it rebases the timer and emits `STRIKE` (single source of truth for the rebased timer; no separate `TIMER_UPDATE`).
  - [x] **Resolution hooks (seam with Story 8.5, also on master):** when the reduce makes `BombState.solved` flip `false→true`, call 8.5's `onBombDefused(deps, sessionId, teamId, elapsedMs)`; when `newStrikes === 3`, call 8.5's `onThirdStrike(deps, sessionId, teamId, elapsedMs)` **instead of** `escalateOnStrike` (which deliberately early-returns at `strikes >= 3`). If 8.5's functions already exist on master, wire these call sites directly; if 8.5 isn't implemented yet, leave a clearly-marked seam (`// Story 8.5: resolution hook`) and a follow-up note in Completion Notes — do NOT re-implement the resolution ceremony here. See Cross-Story Seam.
  - [x] Solved modules are inert in `bombReducer` (further interaction is a no-op) and `solved` never regresses — rely on that; do not re-implement the guard.

- [x] **Task 3 — Install the production client dispatch backend (AC: 1, 2)**
  - [x] In the app bootstrap (where `bindServerEvents` is wired — see `apps/client/src/net/`), call `setModuleActionDispatch((moduleIndex, action) => getSocket().emit('MODULE_INTERACT', { teamId, moduleIndex, action }))` for the production (non-sandbox) path. `teamId` comes from the session/self player (`session.players[selfId].teamId`). The seam already exists: `apps/client/src/modules/dispatch.ts` (`setModuleActionDispatch` / `dispatchModuleAction`) — DefuserViews already call `dispatchModuleAction`; today outside the sandbox it warns-and-drops. This task makes the production backend real.
  - [x] Keep the sandbox's LOCAL backend (`apps/client/src/sandbox/devDispatch.ts`) untouched — `/dev/sandbox` runs the reducer client-side by design. The production backend must only be installed on the real session route, never the sandbox.
  - [x] Tear down / reset the backend appropriately on unmount/disconnect so a stale socket reference can't be emitted into (mirror `bindServerEvents`' subscribe/unsubscribe symmetry).

- [x] **Task 4 — Client snapshot application + scoping (AC: 1)**
  - [x] `gameStore.applyModuleUpdate` already exists and is correct (immutable single-module replace, bounds-checked, does not touch strikes/timer). `bindServerEvents` already wires `MODULE_UPDATE → applyModuleUpdate`, `BOMB_INIT → setBomb`, `STRIKE → setStrike`, `TIMER_UPDATE → setTimer`. **Reuse these — do not reinvent.** Verify the production flow drives exactly these store actions (the dev harness already proves the scene is byte-identical against this path — `DevBombHarness.tsx`).
  - [x] **Scoping:** the client receives only its own team's broadcasts because the socket is in `teamRoom(sessionId, teamId)` (joined in `ROUND_START`). The client does not filter by team itself — but it MUST handle a `MODULE_UPDATE` arriving before `BOMB_INIT` gracefully (the store already drops it with a warning). Confirm the warning path doesn't spam under normal ordering.
  - [x] Authoritative truth: the snapshot is non-authoritative *display* state on the client (`gameStore` doc: "render-only, NON-authoritative snapshot"). Never derive `solved`/`strikes`/expiry locally — the solve LED flips only from the server snapshot (AC-2).

- [x] **Task 5 — Optimistic pre-flash + rollback (AC: 2)**
  - [x] Add an optimistic affordance layer in the module render path that, on a Defuser activation, can show a transient local pre-flash (e.g. wire severing animation, button depress) **without** mutating the authoritative `gameStore` module `status` and **without** flipping the solve LED. Keep optimistic visual state separate from the authoritative snapshot (a local component/ref or a dedicated non-authoritative UI slice) so the server snapshot remains the only thing that flips `solved`.
  - [x] **Reconcile on snapshot:** when the confirming `MODULE_UPDATE` arrives, clear the pre-flash (the authoritative state now drives the visual). **Rollback:** if the server's snapshot contradicts the optimistic guess (e.g. a wire the player thought correct comes back `'armed'` after the transient `'struck'` rollup, or no confirming change arrives within a timeout window), revert the pre-flash to the authoritative state. Roll back cleanly — never leave a severed-wire visual on a still-armed module.
  - [x] **≤100ms perceived budget:** the pre-flash must render on the same frame as the click (synchronous local visual), so perceived latency is independent of round-trip. Do not gate the affordance on the socket round-trip. Document the budget reasoning in a comment.
  - [x] Respect the click primitive contract (`apps/client/src/modules/interaction.ts`): pre-flash hangs off the same `onActivate`/press-hold callbacks; do not add bomb-side keyboard shortcuts; do not measure hold duration on the client (hold semantics are reducer state).

- [x] **Task 6 — 60fps hardening pass (AC: 3)**
  - [x] Audit the bomb scene render path (`apps/client/src/scenes/BombScene.tsx`, `ModuleBay.tsx`, `TimerLcd.tsx`, `StrikeIndicator.tsx`, module `DefuserView`s) for the project performance rules: no new object/array allocation inside any `useFrame`; reuse refs; tick-rate reads via `getState()` only; reactive `useStore()` only for click-rate state (e.g. camera focus — already correct in `CameraRig`).
  - [x] Memoize module components with `React.memo` and stable Zustand selectors so a `MODULE_UPDATE` to one module does not cascade re-renders across all bays. The scene already reads `modules` via a top-level selector — verify a single module change doesn't re-render unrelated bays.
  - [x] Ensure every Three.js `Geometry`/`Material`/`Mesh` created imperatively is disposed on unmount (R3F does not GC Three.js objects). Audit for leaks across a round transition (mount/unmount of the scene).
  - [x] Provide a way to validate 60fps over a long session (the dev harness `/dev/bomb` + browser performance profiler). Document the measurement method; this is the AC-3 evidence.

- [x] **Task 7 — Tests (AC: 1, 2, 3)**
  - [x] Server: `MODULE_INTERACT` handler integration test using the existing `TestSocketServer` wrapper (`apps/server/src/handlers/__tests__/testSocketServer.ts`): valid action → `MODULE_UPDATE` broadcast to the team room with the post-reduce module state; out-of-range `moduleIndex` / wrong team / malformed action → typed `ERROR`, no broadcast, no throw; a striking action → `STRIKE` via `escalateOnStrike` (strikes 1–2) and the module update reflects the `'struck'→'armed'` rollup; 3rd strike / full defuse → calls the 8.5 resolution hook (assert the seam is invoked, mock if 8.5 not yet implemented). Call the pure `bombReducer` directly (never mock it).
  - [x] `ROUND_START` test (extend existing `apps/server/src/session/__tests__/startRound.test.ts` or the handler test): asserts bombs are generated/persisted under `bombKey` and `BOMB_INIT` is emitted to each populated team room.
  - [x] Client: snapshot application is already covered by `gameStore`/`DevBombHarness` paths — add a test that the production dispatch backend emits `MODULE_INTERACT` with the correct `{ teamId, moduleIndex, action }`, and that optimistic pre-flash state never sets authoritative `status: 'solved'` and rolls back when no confirming snapshot arrives.
  - [x] R3F components stay rendering-only → covered by visual/Playwright regression, not logic tests (project testing boundary). The 60fps AC is validated by profiling evidence, documented in Completion Notes — not a unit test.

- [x] **Task 8 — Human verification (per project rule [[human-verification-ac-rule]])**
  - [x] Jay verifies interactively: in a real session (not sandbox), a Defuser click pre-flashes instantly (feels ≤100ms), the solve LED only turns green after the server confirms, a wrong cut shows a strike (LED never wrongly greens), and the bomb view holds 60fps over a sustained session (show profiler). Verified 2026-06-13 — results in Completion Notes. Ran via full Docker stack (built server, not `tsx watch` — [[timer-verification-tsx-watch-gotcha]]).

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

claude-opus-4-8 (gds-dev-story workflow, implemented directly on master per user request — no worktree/feature branch).

### Debug Log References

- Full regression after implementation: shared 136, server 300, client 204 — all green. `tsc --noEmit` clean across all workspaces.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Both Wave-3 seams verified before implementing.** 8.2's `initializeRoundBombs` was still unwired and `BOMB_INIT` emitted nowhere (confirmed by grep) → Task 1 closed it. 8.5's `onBombDefused` / `onThirdStrike` already exist on master → wired **directly** (no stub), as the story's "if 8.5 is on master, wire directly" branch directs.
- **Task 1 — BOMB_INIT seam closed.** `ROUND_START` (`sessionHandlers.ts`) now awaits one `initializeRoundBombs(...)` after session/round persistence + team-room joins, then emits team-private `BOMB_INIT` to each populated `teamRoom`. Generation runs (and can throw on a bad config) before any `BOMB_INIT` emit, so a bad round never half-broadcasts. The timer-mint loop now shares the same `teamIds`.
- **Task 2 — MODULE_INTERACT handler** added as a sibling `apps/server/src/handlers/moduleHandlers.ts` (mirrors `manualHandlers.ts`; registered in `index.ts`). Thin I/O over the pure `bombReducer` (never mocked): boundary-shape parse → authority gate (must be the **committed defuser of the claimed team** — role + team checked against fresh session state, closing the teammate-Expert hole) → range-check `moduleIndex` against the loaded bomb → reduce → persist → broadcast `MODULE_UPDATE` (post-`struck→armed` rollup) to the team room → couple bomb-level transitions: strikes 1–2 → `escalateOnStrike`, strike 3 → `onThirdStrike`, `solved` false→true → `onBombDefused`. Invalid input → typed recoverable `ERROR`, never throws.
  - **No-op detection refined:** `bombReducer` rebuilds a fresh `BombState` via `applyModuleResult` even when a module reducer returns its input unchanged (e.g. an out-of-bounds `wireIndex`), so `next === bomb` is insufficient. The handler instead skips persist/broadcast when the **targeted module slot** is referentially unchanged (`next.modules[i] === bomb.modules[i]`) — strikes/solved only move as a consequence of the module changing.
- **Task 3 — production dispatch backend** (`apps/client/src/net/productionDispatch.ts`) installed at App bootstrap alongside `bindServerEvents`, with teardown symmetry (`setModuleActionDispatch(null)` on cleanup). NOT installed on `/dev/sandbox` (route guard) so the sandbox's LOCAL reducer backend is untouched. `teamId` is resolved **lazily at emit time** from the self player in the store (bootstrap runs before any session exists).
- **Task 4 — snapshot application** needed no new code: `applyModuleUpdate`/`setBomb`/`setStrike`/`setTimer` and their `bindServerEvents` wiring already exist and are correct, and `BOMB_INIT` is emitted before any `MODULE_UPDATE`, so the pre-init drop-with-warning path doesn't spam. The production flow drives exactly the store actions the dev harness (`DevBombHarness`) already proves byte-identical.
- **Task 5 — optimistic pre-flash.** A cut wire shows severed on the click's own frame (≤100ms perceived, independent of the round-trip): `useOptimisticPreFlash` marks the wire locally and synchronously before the emit. It NEVER touches authoritative `status`/the solve LED (structurally — its state is a key-set only, see `preFlashCore.ts`). Reconcile drops a marker once the server snapshot confirms the cut; a 2s rollback timer reverts an unconfirmed pre-flash so a severed wire is never left on a still-armed module. Reconcile/rollback logic extracted to the pure `preFlashCore.ts` and unit-tested (the React-free core the project's testing boundary asks for).
- **Task 6 — 60fps audit (no changes required).** The 4.1–4.5 scene already complies: `useFrame` only in `ModuleBay` (LED flash) and `TimerLcd`, both early-out and allocation-free with `getState()` tick-rate reads; `StrikeIndicator` is static; all components `React.memo` with scoped primitive selectors (a `MODULE_UPDATE` to module N re-renders only bay N); all geometry is declarative JSX → R3F auto-disposes on unmount (no imperative Three.js objects anywhere — grep confirmed). The added optimistic layer is snapshot-rate React state, zero per-frame work.
- **CROSS-STORY FIX (decision needed → resolved with Jay, Option A): module generator registry.** Story 5.3 registered the wires *reducer* but left the wires *generator* unregistered in shared `MODULE_GENERATORS` (the documented one-liner was missed), and the difficulty `TIER_POOLS` listed `the-button`/`passwords` (5.4/5.5, backlog) whose generators don't exist — and `generateLayout` validates the *entire* pool upfront. So once Task 1 wired generation in, a **default-config `ROUND_START` threw**. Per Jay's decision: registered `generateWires` in `MODULE_GENERATORS` **and** trimmed all three tier pools to `['wires']` for now (commented to re-expand as 5.4/5.5+ land). This makes default rounds generate a real wires bomb end-to-end. Three sibling tests that used `'wires'` as their "unregistered id" example were updated to `'the-button'`.
- **AC-3 (60fps) evidence — DEFERRED to human verification (Task 8).** Sustained-60fps over a 10-min session is validated by profiling, not a unit test (project testing boundary). Measurement method for Jay: open `/dev/bomb` (or a real session), open the browser Performance panel, record ~30–60s while orbiting/zooming and cutting wires, confirm the frame chart holds ~16.7ms/60fps with no GC sawtooth. Record the observed result here.
- **HUMAN VERIFICATION — DONE (Jay, 2026-06-13).** Ran the full Docker stack (built server — not `tsx watch`, per [[timer-verification-tsx-watch-gotcha]]; redis+postgres+server+client+caddy, voice omitted), two browser contexts (facilitator + incognito defuser) at `https://localhost`. Observed:
  - ✅ **Pre-flash instant** — a cut wire severs on the click's own frame.
  - ✅ **Solve LED server-gated** — confirmed via the wrong-cut case: the wire severs optimistically but the LED never greens on a wrong cut (only the server snapshot greens it). On localhost the correct-cut round-trip is ~1ms so the green looks instant.
  - ✅ **Wrong cut → strike** — each wrong wire is its own strike (authentic; 3 = explode); the LED never wrongly greens.
  - ✅ **60fps** — confirmed via the `?stats` overlay (~60fps / ~16ms while orbiting + cutting).
  - ✅ **3rd-strike loss labels DETONATED** (was the documented limitation; fixed this story — see below).
- **VERIFICATION-PHASE FIXES (all retested green):**
  - **Phantom-sever on inert clicks (UX).** The Wires pre-flash now fires only when the click can change state — it skips an already-cut wire or a solved (inert) module, which the server no-ops; previously such a click severed optimistically and lingered until the 2s rollback. (`wires/DefuserView.tsx`.)
  - **3rd-strike mislabel (the bindServerEvents-documented limitation, now closed).** `BOMB_EXPLODED` is one event for both failure modes; the client labels DETONATED vs TIME EXPIRED from `bomb.strikes`. Because the terminal strike calls `onThirdStrike` instead of `escalateOnStrike` (the usual `STRIKE` emitter), the client never learned `strikes===3` and mislabelled the loss TIME EXPIRED. Fix: the handler now broadcasts `STRIKE { strikes: 3, timer: <live, un-rebased> }` before the explosion ceremony (no timer rebase — escalation still skipped at the terminal strike). (`moduleHandlers.ts` + test updated.)
  - **FPS overlay (verification aid).** Opt-in `?stats` drei `<Stats/>` panel in `BombScene` for AC-3 measurement; never shown in normal play.
- **STRIKE INDICATOR — 2-dot design confirmed (not a bug).** The chassis shows only 2 strike dots by DESIGN (`strikeIndicator.ts`: "the third strike IS the explosion; at strikes===3 both dots stay lit as a display floor"). No 3rd dot exists.
- **DEFECTS DISCOVERED, DEFERRED TO STORY 8.5 (Jay's call — outside 4.7 ACs; 4.7's interactive path merely exposed them):**
  1. **Timer LCD keeps counting after a round resolves** — the client never freezes the LCD on `BOMB_DEFUSED`/`BOMB_EXPLODED`; it should stop extrapolating while `resolution !== null`.
  2. **ResolutionBanner dim overlay flickers on browser scroll** — the semi-transparent banner compositing over the WebGL canvas repaints on scroll (layout/compositing). Logged as 8.5 follow-ups.

### File List

**Server (production):**
- `apps/server/src/handlers/sessionHandlers.ts` — wired `initializeRoundBombs` + per-team `BOMB_INIT` into `ROUND_START` (Task 1); shared `teamIds` with the timer loop.
- `apps/server/src/handlers/moduleHandlers.ts` — NEW. `MODULE_INTERACT` handler + `parseModuleInteractPayload` (Task 2).
- `apps/server/src/index.ts` — register `registerModuleHandlers`.

**Shared (cross-story fix):**
- `packages/shared/src/modules/registry.ts` — register `generateWires` in `MODULE_GENERATORS`; trim `TIER_POOLS` to `['wires']` (interim).

**Client (production):**
- `apps/client/src/net/productionDispatch.ts` — NEW. Production `MODULE_INTERACT` dispatch backend (Task 3).
- `apps/client/src/App.tsx` — install/teardown the production backend at bootstrap, sandbox-route guarded (Task 3).
- `apps/client/src/modules/preFlashCore.ts` — NEW. Pure optimistic pre-flash state core (Task 5).
- `apps/client/src/modules/useOptimisticPreFlash.ts` — NEW. React hook over the core (Task 5).
- `apps/client/src/modules/wires/DefuserView.tsx` — optimistic severed-wire pre-flash on cut (Task 5); verification fix: skip pre-flash on inert clicks (solved module / already-cut wire).
- `apps/client/src/scenes/BombScene.tsx` — opt-in `?stats` FPS overlay for AC-3 measurement (verification aid).
- `apps/server/src/handlers/moduleHandlers.ts` — verification fix: broadcast `STRIKE { strikes: 3 }` before the explosion so the client labels the loss DETONATED (closes the bindServerEvents-documented limitation).

**Tests:**
- `apps/server/src/handlers/__tests__/moduleHandlers.test.ts` — NEW. MODULE_INTERACT integration tests (Task 7).
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — added BOMB_INIT-per-team test (Task 7).
- `apps/client/src/net/__tests__/productionDispatch.test.ts` — NEW. Production dispatch backend tests (Task 7).
- `apps/client/src/modules/__tests__/preFlashCore.test.ts` — NEW. Pre-flash reconcile/rollback tests (Task 7).
- `apps/server/src/round/__tests__/initializeRoundBombs.test.ts`, `packages/shared/src/generation/__tests__/assembleBomb.test.ts`, `packages/shared/src/generation/__tests__/layout.test.ts` — updated the `'wires'`-as-unregistered-id examples to `'the-button'`.

### Change Log

- 2026-06-13 — Story 4.7 implemented on master (Tasks 1–7): closed the 8.2 `BOMB_INIT` seam in `ROUND_START`; added the server `MODULE_INTERACT` reduce/persist/broadcast handler wired to 8.4 strike escalation + 8.5 resolution; installed the production client dispatch backend; added optimistic pre-flash with reconcile/rollback on the Wires module; verified the 60fps render path. Cross-story fix (Jay-approved Option A): registered the wires generator and trimmed tier pools to `['wires']` so default rounds generate. Full regression green (shared 136 / server 300 / client 204). Status → review.
- 2026-06-13 — Human verification (Jay) PASSED on the full Docker stack. Verification-phase fixes: skip optimistic pre-flash on inert clicks; broadcast `STRIKE(3)` so a 3rd-strike loss labels DETONATED (closing the documented limitation); added `?stats` FPS overlay. Two non-4.7 defects discovered and deferred to Story 8.5 (timer LCD not freezing on resolution; ResolutionBanner overlay flicker on scroll). Status → done.
