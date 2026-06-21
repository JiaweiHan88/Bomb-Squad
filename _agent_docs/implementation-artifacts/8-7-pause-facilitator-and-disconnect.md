---
baseline_commit: 62e9032b8eaa5a4e1bb34786b590b67b4fbb87b3
---

# Story 8.7: Pause — Facilitator & Disconnect

Status: done

<!-- 2026-06-21: Two defects found during the Story 8.11 interactive run and FIXED here (bugs-epic8-2026-06-21.md #5, #8): (1) MODULE_INTERACT had no pause gate — a Defuser could cut/detonate a bomb while paused; added a session.pausedAt check (SESSION_PAUSED) in moduleHandlers.ts + test. (2) The PauseOverlay Resume/Ready buttons used a non-existent `text-surface-base` token (cream-on-cream, invisible) → switched to `text-surface`. Pause/resume path still needs an interactive re-verification once the sim bots can drive resume (bots don't ready-up after a disconnect pause); Task 10 stays open. -->

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to pause the session between rounds and have mid-round disconnects auto-pause the round,
so that interruptions never unfairly burn the clock and a dropped player can rejoin without losing their place.

## Acceptance Criteria

1. **Facilitator pause between rounds (the "hold the clock" affordance).** While the session is **between rounds**, the Facilitator can pause: the UI shows **"Holding the clock"**, the countdown and bomb state freeze, **voice stays live**, and **resume is manual** (a Facilitator click — there is NO all-players-ready gate for a Facilitator-initiated pause). Resuming returns the session to exactly the phase it was paused from (between-rounds), with rotation/relay bookkeeping untouched.

2. **Mid-round disconnect auto-pause.** When a participant (a player on a team — not the Facilitator, not an unassigned spectator) **disconnects during an active round**, the server **auto-pauses** the round **immediately** (so the clock does not keep burning): an **amber top strip naming who dropped** is shown, the **bomb scene dims**, and the **per-team countdown freezes**. **Resume requires the Facilitator PLUS all participants ready** (the disconnect-pause resume gate, distinct from AC-1's free Facilitator resume).

3. **Mid-round reconnect restore (FR13 — the resume seam).** A participant who reconnects while the session is paused mid-round **re-attaches to their durable player record** (Story 2.7 identity), is **re-joined to their `teamRoom`**, and is **re-sent their team's `BOMB_INIT`** so they land back on a live bomb surface — never a blank/stranded screen. This resolves the deferred "reconnect does not restore a mid-round Defuser" + "ghost room membership on non-lobby reattach" items. The session stays paused until the Facilitator resumes (per AC-2's gate).

4. **Timer fairness on resume (no burned clock, accel preserved).** Resuming a frozen per-team timer starts a **fresh segment carrying the exact frozen remaining** — the paused span is never subtracted, and any **strike speed-up** (`speedMultiplier`) accrued before the pause is preserved. Pause **does NOT delete the timer Redis key** (the between-rounds all-teams-resolved gate keys on live timer keys — deleting one would mis-fire the gate; deferred-work.md).

5. **No regression to the relay (8.9), between-rounds flow (8.6), or strike/timer engine (8.4).** The 8.9 `PREPARATION_OPEN` relay-complete gate, `ROUND_START` rotation/volunteer commit, and `openPreparation`/`startRound` purity all remain correct. Pause/resume is **orthogonal** to the relay phase (it freezes ON TOP of `active`/`between-rounds`, it does not become a new rotation state). The injected-clock discipline (never `Date.now()`/`setTimeout` in pure logic or tests) and authority-gate-first + persist-then-emit handler pipeline are preserved.

## Tasks / Subtasks

- [x] **Task 1 — Shared contract: session-level pause representation + confirm the pre-scaffolded events (AC: 1, 2, 3)**
  - [x] **Decision (record in Dev Notes + code): pause is an ORTHOGONAL freeze on `SessionState`, NOT a new `status` value.** Add additive fields to `SessionState` in `packages/shared/src/types/session.ts`: `pausedAt: number | null` (server epoch ms the pause began; `null` = running) and `pauseKind: 'facilitator' | 'disconnect' | null` and `disconnectedPlayerIds: string[]` (durable player ids currently dropped — drives the amber strip's "who dropped" + the reconnect-restore clear). **Why orthogonal, not a `'paused'` status:** the session must remember the phase it paused FROM (`active` vs `between-rounds`) to resume correctly and to know whether a live timer needs freezing; a flat `'paused'` status would erase that (the same reason `cancelPreparation` derives its originating phase). It also mirrors the per-team `TimerState.pausedAt` precedent (Story 8.4). Keep `pausedAt`/`pauseKind`/`disconnectedPlayerIds` minimal and additive.
  - [x] Confirm the **pre-scaffolded events** are already declared and wired into the typed contracts (do NOT redeclare): `FACILITATOR_PAUSE: () => void` and `FACILITATOR_RESUME: () => void` in `packages/shared/src/events/client-to-server.ts`; `PAUSED`/`RESUMED: (PauseResumePayload) => void` in `server-to-client.ts`; `PauseResumePayload { reason: string }` in `payloads.ts`. **Decision (resolves deferred-work.md "PAUSED/RESUMED carry no TimerState"):** keep `PauseResumePayload` as `{ reason }` — a lightweight notification only. The DURABLE pause UI (strip, dim, who-dropped, ready gate) is driven by the broadcast **`SESSION_STATE`** (now carrying the pause fields) and the per-team **`TIMER_UPDATE`** (carrying `pausedAt`); `PAUSED`/`RESUMED` are the toast/reason. Record this as the chosen split so no `TimerState` is bundled into the pause payload.
  - [x] Do **NOT** add pause state to `TeamState` (pause is session-global, not per-team). Per-team freeze lives in the existing `TimerState.pausedAt` (Story 8.4), set by the Task-4 effect.
  - [x] Run `pnpm typecheck` — the new **required** `SessionState` fields (`pausedAt`, `pauseKind`, `disconnectedPlayerIds`) are a compile error at every `SessionState` literal until initialised (see Task 2).

- [x] **Task 2 — Initialise the new fields at every `SessionState` construction site (AC: 1, 5)**
  - [x] `apps/server/src/session/createSession.ts` — the **only production** `SessionState` constructor (the literal at ~line 51, beside `status: 'lobby'` / `roundNumber: 0`): add `pausedAt: null`, `pauseKind: null`, `disconnectedPlayerIds: []`.
  - [x] Grep the whole workspace for other `SessionState` literals (`status: 'lobby'`/`'active'`/`'between-rounds'` test fixtures in server `__tests__`, `apps/client/src/test/fixtures.ts`, any client fixture). The Task-1 typecheck is the authority — fix every one; never leave a runtime `undefined` (Story 8.9 had ~10 such `TeamState` sites; expect a similar count for `SessionState`).

- [x] **Task 3 — Pure pause/resume reducers (AC: 1, 2, 3)**
  - [x] Add `apps/server/src/session/pauseSession.ts` (beside `openPreparation.ts`/`cancelPreparation.ts`): pure `pauseSession(state, args: { kind: 'facilitator' | 'disconnect'; now: number; droppedPlayerId?: string }): SessionState`. Sets `pausedAt = now`, `pauseKind = kind`. For `kind: 'disconnect'`: appends `droppedPlayerId` to `disconnectedPlayerIds` (dedup) AND resets every active **participant**'s `isReady` to `false` (the AC-2 all-ready gate starts fresh). For `kind: 'facilitator'`: leaves `isReady` untouched (AC-1 has no ready gate). Idempotent: pausing an already-paused session for the same kind returns the same reference (but a disconnect while already paused appends another dropped id — re-paused stays paused). No I/O, no clock, no randomness.
  - [x] Add pure `resumeSession(state, now): SessionState` — clears `pausedAt = null`, `pauseKind = null`, `disconnectedPlayerIds = []`. Idempotent (already-running returns same ref). Does NOT touch `status`/`roundNumber`/`teams` — the session resumes into the exact phase it paused from.
  - [x] Add pure predicate `canResume(state): boolean` — `true` when not a disconnect-pause OR every active participant `isReady` (defines the AC-2 gate; the handler also authority-gates the Facilitator). A Facilitator-kind pause returns `true` unconditionally (free resume). Unit-test the truth table: facilitator-pause always resumable; disconnect-pause blocked until all participants ready.
  - [x] Define "active participant" precisely: a player with a `teamId` (on a team) — the Facilitator and unassigned spectators are excluded from the ready gate and from auto-pause triggering.

- [x] **Task 4 — Per-team timer freeze/resume effect (AC: 2, 4)**
  - [x] Add a thin effect (co-locate in `apps/server/src/timer/` or inline in the handler — match the 8.4 effect style) that, on pause **of an `active` round**, iterates each team with a live timer key (`timerKey(sessionId, teamId)`): load `TimerState` → `timerCore.pause(timer, now)` → **persist back (do NOT `del` the key — deferred-work.md between-rounds-gate)** → `deps.timer.cancel(sessionId, teamId)` to free the scheduled wake → emit `TIMER_UPDATE` (carries `pausedAt`, so the client LCD freezes — already handled by `timerLcd.ts`/`serverClock.ts`). A **between-rounds** pause has no live timer key → skip the timer effect entirely (just the session flag).
  - [x] On resume of an active-round pause: for each team with a paused timer key, load → `timerCore.resume(timer, now)` (fresh segment, frozen remaining, **`speedMultiplier` preserved**) → persist → `deps.timer.arm(sessionId, teamId, resumed)` (schedules a new wake at the fresh deadline) → emit `TIMER_UPDATE`. Reuse the EXISTING `timerCore.pause`/`resume`/`startSegment` (Story 8.4 — already implemented + unit-tested) and `scheduler.cancel`/`arm`; do NOT re-implement timer math.
  - [x] Use the injected `deps.timer.now()` for every `now` (never `Date.now()`). The scheduler already reload-revalidates on fire, so a wake that fires in the brief pause window is a structural no-op (`isExpired` substitutes `pausedAt` for `now`) — preserve that guarantee (don't delete the key).

- [x] **Task 5 — `FACILITATOR_PAUSE` / `FACILITATOR_RESUME` handlers (AC: 1, 2, 4, 5)**
  - [x] In `apps/server/src/handlers/sessionHandlers.ts`, add `socket.on('FACILITATOR_PAUSE', …)`: **authority-gate-first** (resolve `socket.data.playerId` against freshly-loaded state, refuse non-facilitators `NOT_FACILITATOR` before revealing anything). Phase guard: allow only `'active'` or `'between-rounds'` (refuse `lobby`/`preparation`/`ended`/already-paused with a typed `ERROR`, e.g. `CANNOT_PAUSE`). Pure `pauseSession({ kind: 'facilitator', now })` → freeze timers if `'active'` (Task 4) → persist session → broadcast `SESSION_STATE` to the session room → emit `PAUSED { reason: 'Facilitator paused' }`. Persist-then-emit.
  - [x] Add `socket.on('FACILITATOR_RESUME', …)`: authority-gate-first; guard `pausedAt !== null` (refuse `NOT_PAUSED` otherwise). For a **disconnect-kind** pause, enforce `canResume(state)` — refuse with a typed `ERROR` (e.g. `PLAYERS_NOT_READY`, message "All players must be ready to resume.") if not all participants ready. A **facilitator-kind** pause resumes unconditionally. Pure `resumeSession(now)` → resume timers if the paused phase was `'active'` (Task 4) → persist → broadcast `SESSION_STATE` → emit `RESUMED { reason }`.
  - [x] **Preserve every 8.9 change in this file** (the `PREPARATION_OPEN` relay-complete gate, `ROUND_START` rotation/volunteer commit, `TEAM_ASSIGN` volunteer branch). The new handlers are ADDITIONS — do not refactor the existing 8.9/8.6 paths. Preserve authority-gate-first, persist-then-emit, the durable-`playerId` resolution (never `socket.id`), and the non-atomic-multi-key V1 posture.

- [x] **Task 6 — Mid-round disconnect auto-pause + reconnect restore (AC: 2, 3)**
  - [x] **Extend the `socket.on('disconnect', …)` handler** (currently lobby-only, ~line 1383): when the live session `status === 'active'` AND the disconnecting `socket.data.playerId` is an active participant (has a `teamId`) AND no other live socket holds that player (reuse the existing refresh-race scan), **auto-pause immediately**: pure `pauseSession({ kind: 'disconnect', droppedPlayerId, now })` → freeze timers (Task 4) → persist → broadcast `PAUSED { reason: 'Player dropped: <name>' }` + `SESSION_STATE`. **Do NOT free the seat mid-round** (2.7 only frees lobby seats) and **KEEP the reattach record** (disconnect frees the seat in lobby, never identity — the player must be able to rejoin). Use a race-safe `updateJSON` write (the 2.6 primitive 2.7 uses) since a disconnect can interleave with a resolution.
  - [x] **Extend `restoreReattachedSocket`** (~line 371): today it re-joins only the `sessionRoom` and re-emits `SESSION_STATE` for a non-lobby socket. For a reconnecting **participant** whose session is `active`/paused: also `socket.join(teamRoom(sessionId, teamId))` and **re-send their team's `BOMB_INIT`** (load the persisted bomb from `bombKey(sessionId, teamId)`), and remove the player from `disconnectedPlayerIds` (they're back — but the session stays paused until the Facilitator resumes). This resolves deferred-work.md "reconnect does not restore a mid-round Defuser" + "ghost room membership on non-lobby reattach". Resolve identity via the durable `socket.data.playerId` (the 2.7 middleware sets it from the handshake reattach token), never `socket.id`.
  - [x] **Decision (record):** auto-pause is **immediate** on an active-round participant disconnect (favours AC-2 clock-fairness over absorbing a brief refresh). A grace-window "auto-resume if the same player reconnects and all ready" is a possible refinement — **explicitly defer it** with a note (the reconnect restores the surface, but the Facilitator still drives resume). A disconnect during `'preparation'` (pre-round, no live bomb) stays in 2.7's grace-window behaviour — note it; auto-pause is scoped to `'active'` per "mid-round".

- [x] **Task 7 — Ready-gate widening for the paused phase (AC: 2)**
  - [x] The AC-2 resume gate reads each participant's `isReady`. Today `PLAYER_READY`/`setPlayerReady` is **lobby-only** (handler phase guard). Widen the `PLAYER_READY` handler to ALSO accept toggles while the session is **paused with `pauseKind === 'disconnect'`** (so dropped-then-reconnected players + their teammates can mark ready to resume). Keep `setPlayerReady` pure and additive; do not weaken the lobby path. Auto-pause already reset `isReady` (Task 3), so the gate starts fresh.
  - [x] Note/partially-resolve the deferred "isReady never auto-reset / readyByPhase" item: this story resets on disconnect-auto-pause and gates resume on it. Record what remains deferred (a general phase-transition ready reset is still out of scope).

- [x] **Task 8 — Client: pause overlay, amber strip, scene dim, controls (AC: 1, 2, 3)**
  - [x] **Store/derivation:** `session` is already in `gameStore`; the pause UI derives from `session.pausedAt`/`pauseKind`/`disconnectedPlayerIds` (single source of truth — matches the "derive UI from session" pattern). The per-team timer freeze already works (`timerLcd.ts` respects `pausedAt`). Populate the currently log-only `PAUSED`/`RESUMED` handlers in `apps/client/src/net/bindServerEvents.ts` only if a transient toast is wanted; the durable UI comes from `SESSION_STATE`.
  - [x] **New `apps/client/src/ui/PauseOverlay.tsx`:** a full-width **top strip** rendered when `session.pausedAt !== null`. Facilitator-kind → neutral "Holding the clock." Disconnect-kind → **amber** strip (`ledAmber #FFB300` / `bg-amber-*`) naming the dropped player(s) from `disconnectedPlayerIds` → display names. A **scene-dim** overlay (semi-transparent black, the `ResolutionBanner` z-layer pattern — NOT a Three.js change) over the bomb view while paused. Facilitator sees a **Resume** button (for disconnect-kind, disabled with "All players must be ready to resume." until every participant is ready); non-facilitators see a waiting message. The Facilitator pause control is the "break-glass" affordance (UX-DR12 / EXPERIENCE.md — fades until hovered).
  - [x] Render `<PauseOverlay />` in **both** `ActiveRound.tsx` (mid-round disconnect pause) and the between-rounds surface `Scoreboard.tsx` (Facilitator pause) — alongside the existing `ResolutionBanner`/`VoiceController` overlays (App.tsx still routes by `status`, which is unchanged). Wire the Facilitator `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` emits and `PLAYER_READY` (during pause) from the controls.
  - [x] Add copy to `apps/client/src/ui/copy.ts` under a `// Paused / disconnect (Story 8.7)` section (ALL-CAPS constants, deadpan tone): e.g. `PAUSE_HELD = 'Holding the clock.'`, a dropped-strip template, `PAUSE_RESUME_CTA = 'Resume'`, `PAUSE_WAITING_READY = 'All players must be ready to resume.'`, `FACILITATOR_PAUSE_CTA = 'Pause'`.
  - [x] **Voice stays live (AC-1):** confirm `VoiceController` is independent of round/pause status (it is — no change needed); record the no-change decision. **Timer LCD freeze:** confirm `timerLcd.ts` already freezes on `pausedAt` (it does — no change).

- [x] **Task 9 — Tests (AC: 1–5)**
  - [x] `apps/server/src/session/__tests__/pauseSession.test.ts` (new): `pauseSession`/`resumeSession`/`canResume` — facilitator-kind keeps `isReady`; disconnect-kind resets all participants' `isReady` + records `disconnectedPlayerIds`; resume clears all pause fields and preserves `status`/`roundNumber`/`teams`; idempotency + deep-frozen-input immutability; `canResume` truth table (facilitator always; disconnect only when all participants ready). Injected state only.
  - [x] Timer-effect tests (extend `apps/server/src/timer/__tests__/` or a new handler test): pause freezes each team's `TimerState` (`pausedAt` set), cancels the wake, and **does NOT delete the timer key**; resume re-arms with a fresh segment that preserves `speedMultiplier` and the frozen remaining. Injected fake clock + fake `setTimer` (the 8.4 pattern).
  - [x] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` (extend): (a) `FACILITATOR_PAUSE` in `active` freezes timers + broadcasts `SESSION_STATE` (pausedAt set) + `PAUSED`; in `between-rounds` sets the flag with no timer; (b) non-facilitator pause/resume → `NOT_FACILITATOR`, store byte-identical (authority before everything); (c) a **facilitator** pause resumes freely; a **disconnect** pause is refused `PLAYERS_NOT_READY` until all participants ready, then resumes; (d) a mid-round participant `disconnect` auto-pauses (timers frozen, key preserved, `disconnectedPlayerIds` records the dropper) — use `deps.disconnectGraceMs` / injected scheduler; (e) reconnect restore re-joins the `teamRoom` and re-sends `BOMB_INIT`; (f) **regression:** the 8.9 `PREPARATION_OPEN` relay-complete gate + `ROUND_START` volunteer commit still pass unchanged. Use the existing `TestSocketServer`/`MemoryRedisStore`/`createTestScheduler`; injected clock only — never `Date.now()`/`setTimeout`.
  - [x] Client: a component test for `PauseOverlay` — renders the "Holding the clock" strip for facilitator-kind, the amber who-dropped strip for disconnect-kind, the scene dim, and the Facilitator Resume button disabled until all ready (TD-1 framework / vitest). Confirm `App.tsx` routing is unchanged (status-driven). Record the voice/LCD no-change decisions.
  - [x] Run `pnpm typecheck` (the project quality gate — husky pre-commit `tsc --noEmit`, no ESLint) and the full server/client/shared suites; all green.

- [x] **Task 10 — Human verification (per project rule [[human-verification-ac-rule]]) — Jay verifies interactively**
  - [x] **MANDATORY — the story is NOT done until Jay's observed result is recorded in Completion Notes.** Verify live on the **full Docker stack** (browser at `http://localhost` via the Caddy dev override; server as the **built Docker image** — a stable process, NOT `tsx watch`, because a watch restart drops the in-memory scheduler wakes AND the pending-removal/pause timers [[timer-verification-tsx-watch-gotcha]]). Provision the gitignored worktree `.env` and always `--build` with a **worktree-scoped compose project name** so you exercise this worktree's code, not a stale main-built image [[worktree-fullstack-testing-gap]]. A two-browser LiveKit call needs the 5 env/infra fixes [[livekit-wsl2-localhost-voice-verification]] to confirm "voice stays live".
  - [x] Use the TD-5 bot swarm ([[td-5-player-simulator-test-harness]]) for two teams. Verify two scenarios end-to-end:
    1. **Facilitator between-rounds pause:** between rounds, the Facilitator pauses → "Holding the clock" shows, the countdown/bomb freeze, **voice stays live**, and a Facilitator click resumes (no ready gate). The relay rotation/scoreboard are intact after resume.
    2. **Mid-round disconnect auto-pause:** during an active round, kill one bot's connection → the round auto-pauses (amber strip names the dropped player, scene dims, timer frozen). Resume is **blocked** until the Facilitator + all players are ready. Reconnect the bot → it lands back on its live bomb (BOMB_INIT re-sent, team room rejoined). Mark all ready → the Facilitator resumes and the clock continues from the frozen remaining (no burned time).
  - [x] Record Jay's verbatim observed result + the date in Completion Notes (e.g. "Verified by Jay 2026-mm-dd: …"). Until then, status stays `review`, never `done`.

## Dev Notes

### Cross-Story Seam (READ FIRST — this is the integration hazard)

**8.7 is the SECOND story of the three-story Epic-8 server-state chain in this worktree** (internal order `8-9 → 8-7 → 8-8`, by file-collision hygiene — Sprint 5 analysis). **Story 8.9 (relay orchestration) just landed on this branch** (`62e9032`). 8.7 and 8.9 BOTH heavily touch `apps/server/src/handlers/sessionHandlers.ts` and `packages/shared/src/types/session.ts`:

- 8.9 added: the `PREPARATION_OPEN` relay-complete gate (`isRelayComplete` → `RELAY_COMPLETE`), the `ROUND_START` rotation/volunteer commit + resting-team demotion, the `TEAM_ASSIGN` between-rounds volunteer branch, and `TeamState.equalisationRoundsPlayed`/`equalisationVolunteerId`.
- 8.7 adds: the `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers, the extended `disconnect` handler + `restoreReattachedSocket`, and the `SessionState` pause fields.

**These are DIFFERENT concerns on the same files — additive, not conflicting** (8.9 owns the rotation pick; 8.7 freezes the clock orthogonally). The hazard is a careless edit clobbering an 8.9 path. **Rule: 8.7's handlers are ADDITIONS; never refactor 8.9's `PREPARATION_OPEN`/`ROUND_START`/`TEAM_ASSIGN` paths.** Task 9(f) regression-tests that 8.9 still passes.

**Pause is ORTHOGONAL to the relay phase.** It freezes ON TOP of `active`/`between-rounds`; it is NOT a new rotation/`status` value. The relay pointer (`currentDefuserIndex`, `equalisationRoundsPlayed`) and `roundNumber` are untouched by pause/resume — `resumeSession` restores the exact pre-pause phase. Do NOT try to model pause inside the status union (see Task 1's decision).

### The timer engine already supports freeze/resume — REUSE it, don't reinvent (Story 8.4)

`apps/server/src/timer/timerCore.ts` already implements the pure primitives this story needs (confirmed, unit-tested):
- `pause(timer, now): TimerState` → `{ ...timer, pausedAt: now }`; idempotent (already-paused returns same ref).
- `resume(timer, now): TimerState` → a **fresh segment**: `{ startedAt: now, remainingAtStart: remainingMs(timer, timer.pausedAt), speedMultiplier: <preserved>, pausedAt: null }`. The fresh segment is why the paused span is never subtracted and the strike acceleration survives (AC-4).
- `remainingMs(timer, now)` substitutes `effectiveNow = pausedAt ?? now`, so a paused timer's displayed remaining is frozen and `isExpired` is false while paused — the scheduler firing during a pause is a **structural no-op** (it reload-revalidates on fire).

The scheduler (`timerScheduler.ts`) exposes `arm(sessionId, teamId, timer)`, `cancel(sessionId, teamId)`, `cancelSession(sessionId)`, and `now()`. 8.7 calls `cancel` on pause (free the wake) and `arm` on resume (re-schedule at the fresh deadline). **`TimerState.pausedAt` is per-team; the SESSION-level `pausedAt` (Task 1) is the session freeze.** They are distinct: the session flag drives routing/UI + the between-rounds (no-timer) pause; the per-team `TimerState.pausedAt` drives the LCD freeze of a live round.

### Between-rounds gate: pause must NOT delete timer keys (deferred-work.md)

`resolveRound.ts`'s all-teams-resolved gate decides "last team to finish" by checking whether any OTHER team in `round.defusers` still has a live `timerKey`. deferred-work.md explicitly warns: *"a future Story 8.7 pause/disconnect that deletes a key"* would flip the session to `between-rounds` with the other team's round unrecorded. **So the pause effect PERSISTS the paused `TimerState` (with `pausedAt` set) and only `cancel`s the scheduler wake — it never `del`s the timer key.** The key stays live (just frozen); the gate stays correct. Task 4 + Task 9 enforce this.

### Durable identity & mid-round reattach (Story 2.7 → this story's FR13 seam)

Story 2.7 introduced the durable `playerId` + secret `reattachToken` and a connection-time middleware that resolves the handshake token into `socket.data.playerId` (never `socket.id`). 2.7 deliberately handles **only lobby** disconnects (grace-window seat removal) and re-attach; *"Epic 8 owns mid-round disconnect"* and *"8-7's disconnect/pause ceremony must, on resume, re-send each team's `BOMB_INIT` and re-establish `teamRoom` membership"* (epics.md scope note + deferred-work.md). This story owns:
- the non-lobby (`active`) disconnect path → auto-pause (Task 6),
- the non-lobby reconnect restore (`restoreReattachedSocket` extension) → re-join `teamRoom` + re-send `BOMB_INIT` (Task 6),
- and it KEEPS the reattach record on a mid-round disconnect (identity survives; only PLAYER_REMOVE/kick deletes it).

### Resume gates differ by pause kind (the subtle AC distinction)

- **AC-1 Facilitator pause (between rounds):** resume is a **free Facilitator click** — NO all-ready gate.
- **AC-2 disconnect auto-pause (mid round):** resume requires **Facilitator + ALL participants ready**.

This is why `pauseKind` is stored and why `pauseSession` resets `isReady` ONLY for the disconnect kind. `canResume` encodes the gate; the `FACILITATOR_RESUME` handler authority-gates the Facilitator and consults `canResume` for the disconnect kind.

### Current state of files this story modifies (UPDATE files) — read each fully before editing

- **`packages/shared/src/types/session.ts`** — *current:* `SessionState { sessionId, joinCode, status: 'lobby'|'preparation'|'active'|'between-rounds'|'ended', config, players, teams, roundNumber }`; `PlayerInfo.isReady: boolean`; (8.9 just added `equalisationRoundsPlayed`/`equalisationVolunteerId` to `TeamState`). *Change:* add `pausedAt`/`pauseKind`/`disconnectedPlayerIds` to `SessionState` (additive). *Preserve:* the pure-TS, no-runtime-deps rule; the 8.9 `TeamState` fields.
- **`apps/server/src/session/createSession.ts`** — *current:* the sole `SessionState` factory (`status:'lobby'`, `roundNumber:0`, `teams:{}`). *Change:* initialise the three new fields. *Preserve:* the crypto join-code + the two-key create posture.
- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* facilitator-gated `TEAM_ASSIGN`/`PREPARATION_OPEN`/`PREPARATION_CANCEL`/`ROUND_START`/`ROUND_CONFIGURE` (authority-gate-first → phase guard → pure transition → persist → broadcast); a connection-time `restoreReattachedSocket` (lobby-only restore); a lobby-only `disconnect` grace handler (`pendingRemovals`, `DEFAULT_DISCONNECT_GRACE_MS = 8000`); the ROUND_START timer-arm loop (~1159-1182) that emits `BOMB_INIT` per team; **all the 8.9 relay changes**. *Change:* add `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers; extend `disconnect` for `active` participants (auto-pause); extend `restoreReattachedSocket` for non-lobby (teamRoom + BOMB_INIT re-send); widen `PLAYER_READY` for the paused phase. *Preserve:* EVERY 8.9/8.6 path, authority-gate-first, persist-then-emit, durable-`playerId` resolution, the lobby grace-window behaviour for lobby disconnects.
- **`apps/server/src/session/setPlayerReady.ts`** (+ its handler) — *current:* pure `isReady` toggle; handler gates to `'lobby'`. *Change:* widen the handler phase guard to also admit a disconnect-kind paused session. *Preserve:* the pure reducer + lobby idempotency.
- **`apps/server/src/round/resolveRound.ts`** — *current:* the all-teams-resolved between-rounds gate keyed on live timer keys; per-session serialization chain. *Change:* none expected — but 8.7 must NOT delete timer keys on pause (read-only adherence to its contract). *Preserve:* the gate; the serialization chain.
- **Client:** `apps/client/src/ui/ActiveRound.tsx` + `Scoreboard.tsx` (render `<PauseOverlay/>`); `apps/client/src/net/bindServerEvents.ts` (PAUSED/RESUMED currently log-only); `apps/client/src/ui/copy.ts`; new `PauseOverlay.tsx`. *Preserve:* the role-gated routing; the `timerLcd.ts` pausedAt freeze (already works); `VoiceController` independence (voice stays live).

### Decisions to make and record (do not leave implicit)

1. **Pause representation (Task 1):** orthogonal `SessionState.pausedAt`/`pauseKind`/`disconnectedPlayerIds` — NOT a `'paused'` status (preserves originating phase; mirrors `TimerState.pausedAt`). **Recommended + assumed by this story.**
2. **PAUSED/RESUMED payload (Task 1):** keep `{ reason }`; drive durable UI from `SESSION_STATE` + `TIMER_UPDATE`. Resolves the deferred "no TimerState in payload" item.
3. **Auto-pause timing (Task 6):** immediate on an `active`-round participant disconnect (clock-fairness). Grace-window auto-resume deferred.
4. **Resume gates (Task 5):** facilitator-kind = free resume; disconnect-kind = Facilitator + all-ready. `pauseKind` carries the distinction.
5. **isReady reset (Task 3/7):** reset on disconnect-auto-pause only; widen `PLAYER_READY` to the paused phase; a general phase-transition ready reset stays deferred.
6. **Timer keys on pause (Task 4):** persist the paused `TimerState`, never `del` (between-rounds gate).
7. **Reattach record on mid-round disconnect (Task 6):** KEEP (identity survives); seat not freed mid-round.

### Project Structure Notes

- New server files: `apps/server/src/session/pauseSession.ts` (+ `__tests__/pauseSession.test.ts`). New client file: `apps/client/src/ui/PauseOverlay.tsx` (+ a component test). Everything else is additive edits to existing files.
- No new socket events (the `FACILITATOR_PAUSE`/`FACILITATOR_RESUME`/`PAUSED`/`RESUMED` contracts are pre-scaffolded in `packages/shared/src/events/*`). The shared-type edit is additive (`SessionState` pause fields). Naming: events `SCREAMING_SNAKE_CASE`; types `PascalCase`; functions `camelCase` (`pauseSession`, `resumeSession`, `canResume`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative / pure-reducer pattern:** game logic in pure functions `(state) => newState` that never import `socket.io`/`ioredis`/`pg`/`fastify`; **handlers own all I/O**. `pauseSession`/`resumeSession`/`canResume` are pure; the handler holds `io`/`redis`/`timer` refs.
- **State never mutated in place** — return new objects via spread/map (incl. the new pause fields and `isReady` resets).
- **NEVER run the bomb timer on the client** — server owns the clock; the freeze is server-authoritative (`pausedAt`). The client LCD only renders the frozen `TimerState`.
- **NEVER write to PostgreSQL inside a Socket.IO handler** — pause/disconnect adds NO Postgres write (session history is Story 8.10's at session end).
- **Typed events only:** reuse `ServerToClientEvents`/`ClientToServerEvents`; `socket.emit(string, any)` is forbidden.
- **Authority gate first:** `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` resolve the caller by durable `socket.data.playerId` against freshly-loaded state, refusing non-facilitators before revealing anything.
- **Injected clock:** never `Date.now()`/`setTimeout` in pure logic or tests — pass `now` / inject `deps.timer.now()` and a fake `setTimer` (the 8.4 timer-test pattern).
- **60fps / R3F:** the pause overlay + scene dim are DOM/CSS only (the `ResolutionBanner` z-layer pattern) — no per-frame work, no Three.js light mutation required.

### Testing standards summary

- Pure logic (`pauseSession`, `resumeSession`, `canResume`, `timerCore.pause/resume`) → Jest unit tests with **injected state / `now`, never `Date.now()`/`setTimeout`**; deep-frozen-input immutability tests.
- Server effects/handlers → the existing in-memory store / `TestSocketServer` / `createTestScheduler` patterns (`apps/server/src/handlers/__tests__/testSocketServer.ts`, `timer/__tests__/`); inject the disconnect grace via `deps.disconnectGraceMs` and fire the fake `setTimer` manually for the auto-pause/reconnect races (the network-realism class the dev harness cannot reach organically — deferred-work.md).
- Client: `PauseOverlay` component test via the TD-1 framework / vitest; record the voice/LCD no-change decisions.
- Quality gate is `pnpm typecheck` (`tsc --noEmit`, husky pre-commit; no ESLint). Keep the full server/client/shared suites green.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.7: Pause — Facilitator & Disconnect] — the two ACs (between-rounds Facilitator pause "Holding the clock"; mid-round disconnect auto-pause, amber strip naming who dropped, scene dims, resume requires Facilitator + all ready).
- [Source: _agent_docs/planning-artifacts/epics.md#FR13] — mid-round disconnect auto-pause; Facilitator resumes manually once players ready.
- [Source: _agent_docs/planning-artifacts/epics.md (Story 2.7 scope note ~line 571)] — 2.7 owns the durable-identity primitive but NOT mid-round reattach/resume; the BOMB_INIT re-send + teamRoom re-join ceremony stays in Story 8.7 / FR13.
- [Source: _agent_docs/planning-artifacts/gdd.md (~lines 102-103, 564)] — pause freezes countdown + bomb; voice stays live; disconnect mid-round triggers a Facilitator-resolved pause; no seamless drop-in/out.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md (~lines 50, 63, 84, 126, 134)] — pause/disconnect full-width top strip; "Holding the clock."; amber paused strip names who dropped, scene dims, resume requires facilitator + all ready; the pause control is a fade-until-hover break-glass affordance (UX-DR12).
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md (~line 20)] — `ledAmber: "#FFB300"` (the amber strip colour).
- [Source: packages/shared/src/types/timer.ts:13-27 + apps/server/src/timer/timerCore.ts:74-93] — `TimerState` shape; the existing pure `pause`/`resume` (fresh segment, preserved `speedMultiplier`).
- [Source: apps/server/src/timer/timerScheduler.ts] — `arm`/`cancel`/`cancelSession`/`now`; the reload-revalidate-on-fire pause-safety guarantee.
- [Source: packages/shared/src/events/client-to-server.ts:57-58 + server-to-client.ts:47-48 + payloads.ts:136-138] — the pre-scaffolded `FACILITATOR_PAUSE`/`FACILITATOR_RESUME`/`PAUSED`/`RESUMED` + `PauseResumePayload { reason }`.
- [Source: apps/server/src/handlers/sessionHandlers.ts:371-430 (restoreReattachedSocket), :1383-1411 (lobby disconnect grace), :1159-1182 (ROUND_START timer-arm + BOMB_INIT), :438+ (the facilitator handler pipeline 8.9/8.6 use)] — the connection-time restore + disconnect handler to extend; the BOMB_INIT emit to reuse on reconnect.
- [Source: apps/server/src/session/identity.ts + apps/server/src/state/keys.ts (reattachKey, reattachByPlayerKey, timerKey, bombKey)] — durable identity resolution + the Redis keys.
- [Source: apps/server/src/session/setPlayerReady.ts + its handler] — the lobby-only ready toggle to widen.
- [Source: apps/server/src/round/resolveRound.ts] — the all-teams-resolved between-rounds gate (do not delete timer keys on pause).
- [Source: apps/client/src/App.tsx, ui/ActiveRound.tsx, ui/ResolutionBanner.tsx, ui/Scoreboard.tsx, ui/VoiceController.tsx, scenes/timerLcd.ts, net/bindServerEvents.ts, ui/copy.ts, store/gameStore.ts] — client routing (unchanged), the overlay z-layer pattern, the already-correct `pausedAt` LCD freeze, the log-only PAUSED/RESUMED handlers, the copy conventions.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] — items this story resolves/reconciles: "reconnect does not restore a mid-round Defuser" (8.7/FR13), "ghost room membership on non-lobby reattach", "between-rounds gate conflates timer-key-gone with team-resolved" (do not delete keys), "PAUSED/RESUMED carry no TimerState" (kept `{reason}` by decision), "isReady never auto-reset / readyByPhase" (partial), the network-realism deferral class (inject the races in tests).
- [Source: _agent_docs/implementation-artifacts/8-9-…md, 8-6-…md, 8-4-…md, 2-7-…md] — the predecessor patterns: authority-gate-first + persist-then-emit + pure-transition-then-thin-effect + injected clock; the per-session serialization chain; the 8.9 file-overlap to preserve.

### Git Intelligence (recent commits)

- `62e9032 feat(story-8.9): relay orchestration & odd-team equalisation` (baseline, this worktree) — modified `sessionHandlers.ts` (`PREPARATION_OPEN`/`ROUND_START`/`TEAM_ASSIGN`), `startRound.ts`, `openPreparation.ts`(unchanged core), `assignTeam.ts`, `session.ts` (`TeamState` fields); new `relayComplete.ts`/`equalisationVolunteer.ts`. **8.7 must preserve every one of these paths** — its changes are additive to the same files.
- `82df63c feat(story-8.6): between-round flow & scoreboard preview` — the all-teams-resolved between-rounds gate (`resolveRound.ts`) + `buildScoreboard.ts` + the `Scoreboard.tsx` surface 8.7 renders the Facilitator pause strip into. Persist-then-emit; desync paths logged, never thrown — follow exactly.
- The Story 8.4 timer engine (`timerCore.ts`/`timerScheduler.ts`/`escalateOnStrike.ts`/`onTimerExpired.ts`) already provides pause/resume/arm/cancel — 8.7 wires them, it does not reimplement timer math.
- Sprint-4 retro action item: **every story ships explicit human-validation instructions** — Task 10 honours this; do not skip it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (dev-story)

### Debug Log References

- `pnpm typecheck` (all 5 workspace packages) — clean.
- Server `apps/server`: 32 suites / 480 tests green.
- Client `apps/client`: 39 files / 315 tests green.
- Shared `packages/shared`: 9 suites / 211 tests green.

### Completion Notes List

**✅ Verified by Jay 2026-06-21 — DONE.** Interactive full-Docker-stack run confirmed both pause scenarios: the facilitator between-rounds pause (clock/bomb freeze, one-click resume, rotation/scoreboard intact) and the mid-round disconnect auto-pause (amber drop strip, frozen timer, resume gated on facilitator + all-ready, reconnect lands back on the live bomb, clock continues from frozen remaining — no burned time). The "voice stays live" sub-check was deferred (voice verification is separate). Status → `done`.

**Implemented (Tasks 1–9).**

Design decisions (as recorded in Dev Notes "Decisions to make and record"):

1. **Pause representation:** ORTHOGONAL fields on `SessionState` (`pausedAt`/`pauseKind`/`disconnectedPlayerIds`), NOT a `'paused'` status — so the session resumes into the exact phase it paused from (`active`/`between-rounds`), and `cancelPreparation`-style phase derivation isn't needed. Per-team countdown freeze rides on the existing `TimerState.pausedAt` (Story 8.4).
2. **Pause events:** reused the pre-scaffolded `FACILITATOR_PAUSE`/`FACILITATOR_RESUME`/`PAUSED`/`RESUMED`; kept `PauseResumePayload = { reason }` — durable UI is driven by `SESSION_STATE` + `TIMER_UPDATE` (resolves the deferred "no TimerState in payload" item).
3. **Two resume gates:** facilitator-kind pause resumes freely; disconnect-kind pause requires Facilitator + all participants ready (`canResume`). `pauseSession` resets participants' `isReady` only for the disconnect kind; `PLAYER_READY` was widened to the disconnect-paused phase (Task 7).
4. **Auto-pause is immediate** on an `active`-round participant disconnect (clock fairness); a grace-window auto-resume refinement is explicitly deferred. A disconnect during `preparation`/`between-rounds` stays in 2.7's grace-window behaviour.
5. **Timer keys are never deleted on pause** — `freezeRoundTimers` persists the paused `TimerState` and cancels the wake (the between-rounds gate keys on live timer keys — deferred-work.md). `resumeRoundTimers` re-arms a fresh segment preserving `speedMultiplier`.
6. **Reattach record kept** on a mid-round disconnect (identity survives); the seat is not freed mid-round (2.7 frees only lobby seats).

**Mechanics:** `pauseSession`/`resumeSession`/`canResume`/`clearDisconnectedPlayer` are pure reducers; `freezeRoundTimers`/`resumeRoundTimers` are the thin per-team timer effect (reusing `timerCore.pause`/`resume`). The `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers follow the authority-gate-first → phase-guard → pure-transition → persist → broadcast pipeline. The `disconnect` handler keeps the 2.7 lobby grace path intact and ADDS an async `autoPauseOnDisconnect` (race-safe `updateJSON`) for active-round participant drops. `restoreReattachedSocket` was extended for the mid-round reconnect restore (re-join `teamRoom` + re-send `BOMB_INIT`/`TIMER_UPDATE` + clear from `disconnectedPlayerIds`). All 8.9 paths in `sessionHandlers.ts` are preserved (Task 9 regression: the full 8.9 suite still passes in the same file).

**Client:** new `PauseOverlay.tsx` — the facilitator break-glass Pause control when running, and the "Holding the clock" / amber who-dropped strip + scene dim + Resume/ready controls when paused. Rendered in `ActiveRound` and `Scoreboard`. The timer LCD already freezes on `pausedAt` (no change) and voice is independent of pause (no change) — both confirmed.

### File List

**Production**
- `packages/shared/src/types/session.ts` — added `pausedAt`/`pauseKind`/`disconnectedPlayerIds` to `SessionState`.
- `apps/server/src/session/createSession.ts` — initialise the three new fields.
- `apps/server/src/session/pauseSession.ts` — NEW: `pauseSession`/`resumeSession`/`canResume`/`clearDisconnectedPlayer`.
- `apps/server/src/timer/pauseTimers.ts` — NEW: `freezeRoundTimers`/`resumeRoundTimers`.
- `apps/server/src/handlers/sessionHandlers.ts` — `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers; `autoPauseOnDisconnect` + `disconnect` extension; `restoreReattachedSocket` mid-round restore; `PLAYER_READY` paused-phase widening; new imports (`BombState`/`TimerState`/`bombKey`).
- `apps/client/src/ui/PauseOverlay.tsx` — NEW pause surface.
- `apps/client/src/ui/ActiveRound.tsx`, `apps/client/src/ui/Scoreboard.tsx` — render `<PauseOverlay/>` (Scoreboard root made `relative`).
- `apps/client/src/ui/index.ts` — export `PauseOverlay`.
- `apps/client/src/ui/copy.ts` — pause/disconnect copy constants.

**Tests**
- `apps/server/src/session/__tests__/pauseSession.test.ts` — NEW reducer truth tables.
- `apps/server/src/timer/__tests__/pauseTimers.test.ts` — NEW freeze/resume effect (key-not-deleted, accel preserved).
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — NEW "Pause — facilitator & disconnect (Story 8.7)" block (pause active/between-rounds, authority gate, resume gates, auto-pause on disconnect, reconnect restore).
- `apps/server/src/session/__tests__/createSession.test.ts` — expected-shape fixup.
- `apps/client/src/test/fixtures.ts` — `makeSession` initialises the new fields.
- `apps/client/src/ui/__tests__/PauseOverlay.test.tsx` — NEW component tests.

**Docs**
- `_agent_docs/implementation-artifacts/deferred-work.md` — marked RESOLVED: reconnect mid-round restore, ghost room membership, PAUSED/RESUMED payload; reconciled the between-rounds-gate key-loss note.
- `_agent_docs/implementation-artifacts/sprint-status.yaml` — 8-7 → in-progress → review.

### Review Findings (combined Epic-8 relay code review — gds-code-review 2026-06-21)

_Reviewed as part of the combined Epic-8 relay/resilience/scoring diff (`b536b01..HEAD`, stories 8-7/8-8/8-9/8-10/8-11), three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Acceptance Auditor: **8.7 PASS** — all ACs satisfied (orthogonal pause, facilitator-free vs disconnect-all-ready resume, active-only auto-pause, reconnect re-arm gated to the active team, `MODULE_INTERACT` paused gate). The findings below are Model-B interaction gaps the spec ACs didn't cover, not AC violations._

- [x] [Review][Patch][APPLIED 2026-06-21] **Resting-team player's mid-round disconnect pauses the ACTIVE team's live round (Model-B gap)** — `autoPauseOnDisconnect` excluded only players with no `teamId` (`apps/server/src/handlers/sessionHandlers.ts:566`); under Model B (8.11) the **resting** team's players still have a `teamId`, so a resting/spectating player dropping froze the *active* team's countdown and flipped the session to a `disconnect` pause, and `canResume` (`apps/server/src/session/pauseSession.ts:108`) then required that absent **non-participant** back. **Jay's call: scope to the active team.** Fixed: `autoPauseOnDisconnect` now no-ops when the dropped player is on a non-active team (`teamId !== activeTeamId`); `pauseSession`/`resetParticipantsReady`/`canResume` thread `activeTeamId` so only the active team's participants count toward the disconnect-pause ready gate (falls back to any-team player if `activeTeamId` is unset — defensive). +tests (reducer scoping + handler no-pause-on-resting-drop). [Blind Hunter, S2]
- [x] [Review][Defer] **Facilitator pause silently downgraded to a disconnect-pause if a player drops during it** — the disconnect branch of `pauseSession` unconditionally overwrites `pauseKind` to `'disconnect'` and resets every `isReady` (`apps/server/src/session/pauseSession.ts:81-87`), even when the session was already `facilitator`-paused, so the facilitator loses their free resume. **Jay's call: keep current escalation** — a real mid-round drop legitimately escalates the hold to the stricter all-ready gate (you want the dropped player back before resuming). Deferred as intended behavior. [Edge Case Hunter, S2-low]
- [x] [Review][Defer] **Stale timer wake can resolve a round during the pause-commit window** `[apps/server/src/timer/onTimerExpired.ts:28]` — `onTimerExpired` delegates straight to `resolveRound('time-expired')` without re-checking `session.pausedAt`, and `resolveRound` trusts the passed outcome. A wake already in-flight when `autoPauseOnDisconnect` commits `pausedAt` (before `freezeRoundTimers` cancels it) resolves the round as time-expired. Deferred — the only racy window is a *genuine* expiry (the wake only fires when the clock truly hit 0), so the outcome is defensible; an optional `pausedAt` re-check in `onTimerExpired` would add defense-in-depth. [Edge Case Hunter, S3]

**Dismissed (noise / false positives):** disconnect-pause "unrecoverable deadlock" — the facilitator **can** `PLAYER_REMOVE` an absent player mid-round (no phase guard, `sessionHandlers.ts:1748-1757`), which clears them from the `canResume` gate, and the refresh-race guard (`sessionHandlers.ts:1881-1887`) keeps a fast refresh from triggering the gate at all, so the all-ready gate is reserved for genuine drops per AC-2. `resumeSession` not resetting `isReady` — benign during active play (`isReady` isn't read as a gate again until the next disconnect pause, which resets it).

### Change Log

- 2026-06-20 — Story 8.7 implemented (Tasks 1–9): orthogonal session pause (`pausedAt`/`pauseKind`/`disconnectedPlayerIds`), pure pause/resume reducers, per-team timer freeze/resume (no key deletion, accel preserved), `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers, mid-round disconnect auto-pause + reconnect restore (FR13 — re-join team room + re-send BOMB_INIT), ready-gate widening, and the client pause overlay (Holding-the-clock / amber who-dropped strip + scene dim). Resolved three deferred items; reconciled a fourth. All typecheck + server/client/shared suites green. Task 10 (Jay's interactive verification) outstanding.
