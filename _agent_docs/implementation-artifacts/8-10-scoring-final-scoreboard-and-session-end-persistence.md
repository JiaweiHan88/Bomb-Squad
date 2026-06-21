---
baseline_commit: 3e3f33e
---

# Story 8.10: Scoring, Final Scoreboard & Session-End Persistence

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a team,
I want cumulative defuse times totalled into a final scoreboard and the completed session archived,
so that we learn who won and the session is recorded.

## Acceptance Criteria

1. **Final scoring — lowest cumulative defuse time wins (FR45).** When scores are computed at session end, the winner is the team with the **strictly-lowest cumulative defuse time**; a **failed round contributes a FULL-TIMER PENALTY** — it records the full `config.timerMs` (not the actual failure-moment elapsed), so failing is **never cheaper than defusing** (Jay's decision 2026-06-21, resolving `bugs-epic8-2026-06-21.md:15`); and there are **no per-module points** (scoring is time-only). A tie (equal cumulative times, or a single-team session with no opponent) yields **no declared winner** (a draw / "session complete" headline), never a false winner. _Note: this changes the elapsed `resolveRound` records for FAILED outcomes (detonation/timeout) — see Task 0; a successful defuse still records its actual elapsed._

2. **Final scoreboard surface (UX-DR / "display headline font").** When the session ends, the client renders a **final scoreboard** showing a **round-by-round breakdown per team** — each team's per-turn **time AND outcome (defused ✓ / detonated ✗)** in order (Jay's decision 2026-06-21: outcome icons, not times-only) — **and the winner**, rendered in the **display headline font** (`font-display`). This is a distinct end-state surface from the Story 8.6 *between-rounds preview* — its copy reads "winner"/"final", never "leading"/"provisional". The `'ended'` session status routes to this surface (today `App.tsx` falls `'ended'` back to Lobby — that placeholder is replaced).

3. **Session-end persistence — single Postgres transaction, only at session end (AR / project-context).** When the session ends, **session metadata, per-round per-team times, and the final scoreboard are written to Postgres in a single transaction**. **No Postgres writes occur during play** (the archive is invoked exactly once, at the session-end transition, off the game-tick path). On a Postgres write failure the session does **NOT** flip to `'ended'` — a recoverable error is surfaced and the Facilitator may retry (persist-then-transition; never a half-archived session).

4. **Session-end transition is Facilitator-driven and relay-complete-gated.** The session transitions to `'ended'` only when the relay is complete (`isRelayComplete` — Story 8.9/8.11) AND the Facilitator explicitly ends it. The existing `RELAY_COMPLETE` notice (Story 8.9 — "The relay is complete — end the session.") gains an **"End session" affordance**; activating it runs the archive + transition. A non-Facilitator cannot end the session; ending a not-yet-complete relay is refused; ending an already-`'ended'` session is an idempotent no-op (no second archive write).

5. **No regression to the relay, scoreboard preview, or pure-reducer/handler boundaries.** The Story 8.6 between-rounds `buildScoreboard` preview, the Story 8.9/8.11 relay-complete gate on `PREPARATION_OPEN` (`RELAY_COMPLETE`), per-team time accumulation in `resolveRound`, and the authority-gate-first / persist-then-emit handler discipline all remain correct. `isRelayComplete` stays a clean shared export. The final-scoring projection is a **pure** function (no I/O, no clock); the Postgres write lives **only** in the handler.

## Tasks / Subtasks

- [x] **Task 0 — Full-timer penalty for failed rounds (AC: 1)**
  - [x] In `apps/server/src/round/resolveRound.ts` (~line 126, the single `elapsedMs` definition), make a **FAILED** outcome (3rd-strike `exploded` / `time-expired`) record the **full `session.config.timerMs`** instead of the actual failure-moment elapsed. A successful **`defused`** outcome is UNCHANGED (its real elapsed). A timeout already records ~`timerMs` (remaining clamps to 0), so the visible change is for fast detonations. Keep the `Math.max(0, …)` clamp discipline; keep `cumulativeTimeMs === sum(roundTimesMs)`.
  - [x] Reconcile with the **Story 8.8 retry "better-of-two"**: a retry replaces the last `roundTimesMs` entry with the *lower* time. A failed first attempt now stores `timerMs`; a successful retry stores its real (lower) elapsed → the better wins, correct. Confirm the retry-replace path (`resolveRound.ts:181-185`) still holds with the penalty value.
  - [x] Update `resolveRound`'s elapsed-definition comment (it currently says "one definition for all outcomes" — now it's "defused = real elapsed; failed = full-timer penalty"). Extend `resolveRound.test.ts` for the penalty: a fast detonation records `timerMs`, a defuse records real elapsed, a retry of a failed round lowers the stored time.
  - [x] _This is the only change to live round resolution; everything else in 8.10 is session-end + persistence + client._

- [x] **Task 1 — Pure final-scoring projection (AC: 1)**
  - [x] Add a pure function (co-locate near `buildScoreboard.ts`, e.g. `apps/server/src/round/buildFinalScoreboard.ts`, or extend `buildScoreboard` with an authoritative-winner variant) `buildFinalScoreboard(session: SessionState): FinalScoreboard`. It reuses the per-team `cumulativeTimeMs` + `roundTimesMs` already maintained by `resolveRound` — **do not recompute times**; just total/rank. Winner = the team with the **strictly-lowest** `cumulativeTimeMs` among teams that played ≥1 round; **undefined on a tie** or a single-team session (AC-1's draw case). No I/O, no clock, no randomness.
  - [x] Decide the final-scoreboard shape. **Prefer reusing `ScoreboardPayload`** (`{ teams: { cumulativeTimeMs, rounds }, winnerTeamId? }`) for the wire so the client can share rendering with the preview — the difference is *copy/semantics* (authoritative winner vs provisional leader), not structure. If a richer round-by-round breakdown (per-round **outcome** icons, not just times) is in scope, see Task 2's `roundOutcomes` decision; otherwise the times array IS the breakdown.
  - [x] Unit-test the truth table: clear winner (A faster), tie (no winner), single-team session (no winner), a session where a team's only rounds were failures (its failure-moment times still total and rank). Injected `SessionState` only; pure.

- [x] **Task 2 — Per-round outcome history for the round-by-round breakdown (AC: 2)** _(Jay's decision 2026-06-21: add the outcome icons — this is in scope, not deferred)_
  - [x] Add `roundOutcomes: RoundOutcome[]` to `TeamState` (`packages/shared/src/types/session.ts`) — `RoundOutcome = 'defused' | 'exploded' | 'time-expired'` (already in `packages/shared/src/types/round.ts`). Append/replace it in `resolveRound.ts` **exactly alongside `roundTimesMs`**: append the round's outcome on a first attempt; replace-the-last-entry on a retry (same index discipline as `roundTimesMs`, so `roundOutcomes.length === roundTimesMs.length` always holds). Resolves `deferred-work.md:240`.
  - [x] `roundOutcomes` is **additive and required** on `TeamState` → it surfaces at every construction site (the typecheck enumerates them — the 8.9 precedent was ~8–10 sites: `assignTeam.ts` + every test fixture + `apps/client/src/test/fixtures.ts`). Initialise `[]` at each. It must ALSO be persisted (Task 3/4 — one row per round carries its outcome).
  - [x] Run `pnpm typecheck` — a new required `TeamState` field is a compile error at every literal until initialised. Fix them all.

- [x] **Task 3 — Postgres schema + idempotent DDL bootstrap (AC: 3)**
  - [x] There is **no migration framework** and **no session-history DDL** yet (`postgres.ts` is pool + health-ping only; architecture leaves the schema to this story). Add a minimal, idempotent **boot-time DDL** (`CREATE TABLE IF NOT EXISTS …`) run once during server startup (the game server already **waits on Postgres health before accepting connections** — `index.ts`/architecture:531), OR a tiny migration runner if you prefer — keep it minimal and self-hosted (V1 is a single self-hosted Compose stack).
  - [x] Schema — **NORMALISED, one row per round** (Jay's decision 2026-06-21: a `session_rounds` table, not an `int[]` array column — more queryable for future analytics). Record the final DDL in Dev Notes:
    - `sessions` — `session_id text primary key`, `join_code text`, `config jsonb`, `winner_team_id text null`, `round_count int`, `ended_at timestamptz`. (Note: `SessionState` has **no** `createdAt`/`startedAt` today — persist `ended_at` only, OR add a `createdAt` stamp at `createSession` if session duration is wanted. Prefer `ended_at` only unless Jay asks for duration.)
    - `session_team_results` — `session_id text references sessions`, `team_id text`, `cumulative_time_ms int`, `primary key (session_id, team_id)`. (The per-team total + winner; the per-round detail lives in `session_rounds`.)
    - `session_rounds` — `session_id text references sessions`, `team_id text`, `round_index int` (0-based position in that team's turn order), `elapsed_ms int`, `outcome text` (`'defused'|'exploded'|'time-expired'`), `primary key (session_id, team_id, round_index)`. One row per team per round (`roundTimesMs[i]` + `roundOutcomes[i]`).
  - [x] No persistent leaderboards / no user identity in V1 (GDD) — archive only.

- [x] **Task 4 — Archive writer: single-transaction `archiveSession` (AC: 3)**
  - [x] Extend `PostgresArchive` (`apps/server/src/persistence/postgres.ts`) with `archiveSession(record: SessionArchiveRecord): Promise<void>` that writes session metadata + per-team results + winner **in ONE transaction**. Use a checked-out client: `const client = await pool.connect(); try { BEGIN; INSERT … ; COMMIT } catch { ROLLBACK; throw } finally { client.release() }`. This means **extending `PoolLike`** minimally with `connect()` returning a `{ query, release }` client — keep the interface tight (the FakePool test double mirrors it). A partial write must never commit.
  - [x] `SessionArchiveRecord` is a plain data object the handler builds from `SessionState` + the final scoreboard: `{ sessionId, joinCode, config, endedAt, winnerTeamId?, teams: [{ teamId, cumulativeTimeMs, rounds: [{ roundIndex, elapsedMs, outcome }] }] }`. `archiveSession` writes the `sessions` row, the `session_team_results` rows, AND the `session_rounds` rows (from each team's `roundTimesMs[i]`/`roundOutcomes[i]`) in the one transaction. Keep `archiveSession` the **only** write method — and idempotent-safe (`ON CONFLICT … DO NOTHING`/`DO UPDATE` on every table) so an end-then-retry after a broadcast hiccup cannot double-insert.
  - [x] **Wire `archive` into the handlers.** Today `index.ts` builds `archive` from `connectPostgres` but passes only `{ redis, log, timer }` to `registerSessionHandlers` — the archive is used for the health ping only. Add `archive: PostgresArchive` to `SessionHandlerDeps` and pass it through. Tests inject a fake archive.

- [x] **Task 5 — Session-end transition: pure reducer + `SESSION_END` handler (AC: 3, 4)**
  - [x] Add a pure transition `endSession(session: SessionState): SessionState` (co-locate in `apps/server/src/session/`) — `between-rounds → ended` ONLY when `isRelayComplete(session)`; same-reference no-op otherwise (mirrors `openPreparation`'s guard discipline). It flips `status` to `'ended'` and clears transient per-round intent (`activeTeamId`/`retryingTeamId` → undefined). It does **NOT** do I/O. Persistence is the handler's job.
  - [x] Add a new Facilitator client→server event `SESSION_END: () => void` to `ClientToServerEvents` (no payload — mirrors `PREPARATION_OPEN`; success = `SESSION_STATE` broadcast, failure = typed `ERROR`). This is additive; confirm no existing event already expresses "end the session" (none does — `PREPARATION_OPEN` from a complete relay only *refuses* with `RELAY_COMPLETE`).
  - [x] Implement the `SESSION_END` handler in `sessionHandlers.ts` following the canonical order: **authority-gate FIRST** (non-facilitator → `NOT_FACILITATOR`, learns nothing) → load state → guard (`status === 'ended'` → idempotent no-op; not `between-rounds` OR `!isRelayComplete` → `RELAY_NOT_COMPLETE` recoverable error) → build final scoreboard (Task 1) → **`await deps.archive.archiveSession(record)`** (the single Postgres tx) → on archive failure emit a recoverable `SESSION_END_FAILED` and **return without flipping status** (no half-archived `'ended'`) → on success `endSession(state)` → persist to Redis → broadcast `SESSION_STATE` (status `'ended'`) and emit the final `SCOREBOARD`. **Postgres write happens BEFORE the Redis status flip** (the durable archive is the commit point; Redis/broadcast follow).

- [x] **Task 6 — Client final-scoreboard surface (AC: 2, 4)**
  - [x] Route `session.status === 'ended'` in `App.tsx` to a final-scoreboard surface (replace the `'ended' → Lobby` placeholder comment at `App.tsx:101-102`). Reuse `Scoreboard.tsx` in an "ended/final" mode OR a thin `FinalScoreboard.tsx` — show per-team round-by-round times + cumulative + the **winner headline in `font-display`** (draw copy when no winner). Reuse the shared `ScoreboardPayload`/relay predicates so client and server cannot drift (the `relay.ts`/`rotation.ts` discipline).
  - [x] Add the Facilitator **"End session"** affordance to the between-rounds relay-complete notice (`Scoreboard.tsx` already shows the relay-complete notice + swallowed-error surfacing from Story 8.9): when `isRelayComplete`, render an "End session & view results" button emitting `SESSION_END`; surface `RELAY_NOT_COMPLETE`/`SESSION_END_FAILED` like the other relay error codes (the `ADVANCE_ERROR_CODES` filter Story 8.9 added — extend it, don't bypass it, or the button reads as dead).
  - [x] Copy lives in `apps/client/src/ui/copy.ts` (final/winner/draw/end-session strings), consistent with the existing relay copy.

- [x] **Task 7 — Tests (AC: 1–5)**
  - [x] `apps/server/src/round/__tests__/buildFinalScoreboard.test.ts` (new): winner/tie/single-team/all-failures truth table; pure, injected state.
  - [x] `apps/server/src/session/__tests__/endSession.test.ts` (new): `between-rounds + relay-complete → ended` flips status + clears transient intent; not-complete or wrong-status → same-reference no-op.
  - [x] `apps/server/src/persistence/__tests__/postgres.test.ts` (extend): `archiveSession` issues `BEGIN`/`INSERT`/`COMMIT` on the FakePool client and `ROLLBACK`s on a mid-transaction throw (no partial commit); a second archive of the same session is safe (idempotent). Extend the FakePool double with `connect()`.
  - [x] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` (extend): (a) full relay walk to completion → `SESSION_END` archives once + flips to `'ended'` + broadcasts; (b) non-facilitator `SESSION_END` → `NOT_FACILITATOR` (authority gate unbroken, no archive call); (c) `SESSION_END` on an incomplete relay → `RELAY_NOT_COMPLETE` (no archive); (d) archive throws → recoverable `SESSION_END_FAILED`, status stays `between-rounds`, no broadcast of `'ended'`; (e) `SESSION_END` on an already-`'ended'` session → idempotent, **archive NOT called twice**; (f) assert **no archive call occurs at any point during play** (lobby→preparation→active→between-rounds across rounds). Use `TestSocketServer` + in-memory store + a **fake archive spy**; injected clock only.
  - [x] Client: a component test for the final-scoreboard surface (winner headline, draw case, round-by-round rows) and the "End session" button emitting `SESSION_END` + surfacing its errors (TD-1 framework, per the 8.9 Scoreboard test precedent).
  - [x] Run `pnpm typecheck` (the project quality gate — husky pre-commit `tsc --noEmit`, no ESLint) and the full server/client/shared suites; all green.

- [ ] **Task 8 — Human verification (per project rule [[human-verification-ac-rule]]) — Jay verifies interactively**
  - [ ] **MANDATORY — the story is NOT done until Jay's observed result is recorded in Completion Notes.** Verify live on the **full Docker stack** (browser at `http://localhost` via the Caddy dev override; server as the **built Docker image** — a stable process, NOT `tsx watch`, because a watch restart drops in-memory timer/expiry wakes [[timer-verification-tsx-watch-gotcha]]). Provision the gitignored worktree `.env` and always `--build` with a **worktree-scoped compose project name** so you exercise this worktree's code, not a stale main-built image [[worktree-fullstack-testing-gap]]. **Postgres must be reachable** — confirm the `postgres` service is healthy (this is the first story that writes to it).
  - [ ] Use the TD-5 bot swarm ([[td-5-player-simulator-test-harness]]) to play a full session to relay completion (e.g. 2v2). Verify end-to-end:
    1. Play every round through to relay-complete; the Facilitator sees "relay complete" + an **"End session"** button (not a dead "Start next round").
    2. Click "End session": the **final scoreboard** renders with a round-by-round per-team breakdown and the **winner in the headline font**; the lowest-cumulative-time team wins; a session including a failed round totals the failure-moment time correctly.
    3. **Inspect Postgres** (`psql`/`docker compose exec postgres`) and confirm exactly ONE session row + per-team result rows were written, **only after** ending — `SELECT` the tables mid-play to confirm they are empty during rounds.
    4. (Negative) confirm a non-Facilitator client has no end affordance and that ending is refused before the relay completes.
  - [ ] Record Jay's verbatim observed result + the date in Completion Notes (e.g. "Verified by Jay 2026-mm-dd: …"). Until then, status stays `review`, never `done`.

## Dev Notes

### Cross-Story Seam (READ FIRST)

**8.10 is the TERMINUS of Epic 8's relay** — it consumes the relay-complete predicate the earlier stories built and is the FIRST and ONLY code that writes to Postgres. It depends on, and must not regress:

- **`isRelayComplete(session)`** — pure shared export in `packages/shared/src/session/relay.ts:116` (re-exported via `apps/server/src/session/relayComplete.ts`). Story 8.9 built it + gated `PREPARATION_OPEN` on it; Story 8.11 reworked it for Model B (per-team pointers, `currentDefuserIndex` = count of natural rounds played, advanced at-resolve only). 8.10 imports it UNCHANGED to gate the session-end transition. **Do not modify it.**
- **`buildScoreboard(session)`** — pure `(SessionState) => ScoreboardPayload` at `apps/server/src/round/buildScoreboard.ts`. Its header comment explicitly hands the **authoritative** winner to 8.10: *"The session winner is authoritative only at session end (Story 8.10); the preview copy must read 'leading'/'standings', never 'winner'."* 8.10's `buildFinalScoreboard` is the authoritative twin — same winner math (strictly-lowest cumulative; undefined on tie) with end-state semantics. Consider whether to literally reuse `buildScoreboard` (the winner logic is identical) vs. a separate function for clarity — record the choice.
- **Per-team time accumulation** — `apps/server/src/round/resolveRound.ts:161-196` records each round's `elapsedMs` into `team.roundTimesMs` (append on first attempt; replace-last-entry on retry — Story 8.8) and keeps `cumulativeTimeMs === sum(roundTimesMs)`. **8.10 does NOT recompute times** — it totals/ranks what is already there. The single elapsed definition (`resolveRound.ts:126-129`: `Math.max(0, timerMs - remainingMs(timer, now))`) already gives the failure-moment time for detonations/timeouts (AC-1's "failure-moment time").

### Failed-round scoring = FULL-TIMER PENALTY (AC-1) — RESOLVED by Jay 2026-06-21

The current `resolveRound` records the **actual elapsed at the moment of failure**, so a *fast* 3-strike detonation records *less* time than a slow defuse — a loophole flagged in `bugs-epic8-2026-06-21.md:15`. **Jay's call: a failed round incurs a FULL-TIMER PENALTY — it records the full `config.timerMs`** so failing is never cheaper than defusing. This is **Task 0**, the one change to live round resolution (`resolveRound.ts:126`): `defused` → real elapsed (unchanged); `exploded`/`time-expired` → `timerMs`. It composes with the Story 8.8 retry "better-of-two" (a failed attempt stores `timerMs`; a faster successful retry replaces it with the lower real time). Everything downstream (the preview `buildScoreboard`, the final scoreboard, persistence) just consumes the already-penalised `cumulativeTimeMs`/`roundTimesMs`.

### Session-end mechanism decision (AC-4) — explicit Facilitator event

The relay-complete state already EXISTS (Story 8.9): `PREPARATION_OPEN` from a complete relay refuses with `RELAY_COMPLETE` ("The relay is complete — end the session."), and the client shows a relay-complete notice instead of a "Start next round" button. 8.10 turns that dead-end into an action: a NEW `SESSION_END` Facilitator event drives archive + transition. This is cleaner than auto-ending inside the `RELAY_COMPLETE` refusal (an explicit, durable, outward-facing action — writing the permanent archive — should be a deliberate Facilitator click, not a side effect of a probe). Mirror `PREPARATION_OPEN`: payload-less, no ack, success = `SESSION_STATE` broadcast.

### Persistence discipline (AC-3) — the hard rules

From `_agent_docs/project-context.md` and `game-architecture.md` (quote-level rules — do NOT violate):
- **"NEVER write to PostgreSQL inside a Socket.IO event handler — queue it for session end."** The session-end handler IS that session-end moment — it is the ONE sanctioned Postgres write. No other handler touches Postgres; no write on the game-tick / round path.
- **"Session history written as a single transaction at session end."** One `BEGIN…COMMIT`, all-or-nothing. `game-architecture.md:445`: *"A completed session is written as a single transaction at session end: session metadata, per-round per-team times, final scoreboard. No writes during play. No mid-round queries."*
- **"Use connection pooling (`pg-pool`) — never open a new connection per request."** Reuse the boot `Pool` (`connectPostgres`); `pool.connect()` a client for the transaction and `release()` it.
- **Persist-then-emit / failure handling** (`game-architecture.md:378`): *"a failed Redis write must not leave a half-applied broadcast — persist then emit, and on persist failure emit nothing and surface a recoverable error."* Here the **Postgres archive is the persist step**: archive first; only on success flip Redis `'ended'` + broadcast. On archive failure: recoverable `SESSION_END_FAILED`, session stays `between-rounds`, Facilitator retries.

### Current state of files this story modifies / adds (read each fully before editing)

**NEW**
- `apps/server/src/round/buildFinalScoreboard.ts` (+ `__tests__`) — pure authoritative scoreboard (or extend `buildScoreboard`).
- `apps/server/src/session/endSession.ts` (+ `__tests__`) — pure `between-rounds → ended` transition (relay-complete-gated).
- DDL/bootstrap for the Postgres schema (boot-time `CREATE TABLE IF NOT EXISTS`, or a tiny migration file).
- `apps/client/src/ui/FinalScoreboard.tsx` (or an `ended` mode on `Scoreboard.tsx`) + tests.

**UPDATE**
- `apps/server/src/persistence/postgres.ts` — *current:* `PoolLike { query, end }`, `PostgresArchive { ping, close }`, no write methods (JSDoc: *"Session-archive writes land in Story 8.10 as a single transaction at session end; this story is pool + health only."*). *Change:* add `archiveSession`; extend `PoolLike` with `connect()` for the transaction. *Preserve:* `ping`/`close`; the existing health probe.
- `apps/server/src/persistence/index.ts` — `connectPostgres` returns `{ pool, archive }`. *Change:* none likely (archive already constructed) — just ensure the archive is threaded to handlers.
- `apps/server/src/index.ts:120` — *current:* `registerSessionHandlers(io, { redis: redisStore, log: fastify.log, timer: timerScheduler })` (archive NOT passed). *Change:* add `archive` to the deps object; run the DDL bootstrap during boot (after the Postgres health gate, before accepting connections). *Preserve:* the Postgres-health-before-connections ordering, pool shutdown on close (`index.ts:165`).
- `apps/server/src/handlers/sessionHandlers.ts` — *current:* `SessionHandlerDeps { redis, log, timer, disconnectGraceMs? }`; the canonical authority-gate-first → load → guard → pure transition → persist → broadcast pattern; the `PREPARATION_OPEN` `RELAY_COMPLETE` gate at ~1033; `status === 'ended'` already short-circuits `PREPARATION_OPEN` (1014). *Change:* add `archive` to `SessionHandlerDeps`; add the `SESSION_END` handler. *Preserve:* every existing error code; authority-gate-first; persist-then-emit; durable-`playerId` resolution (never `socket.id`); the non-atomic-multi-key V1 posture.
- `packages/shared/src/events/client-to-server.ts` — *current:* event union incl. `PREPARATION_OPEN: () => void`. *Change:* add `SESSION_END: () => void`. *Preserve:* the typed-events-only contract; existing event signatures (additive).
- `packages/shared/src/types/session.ts` — `TeamState` (add required `roundOutcomes: RoundOutcome[]` — Task 2); `SessionState.status` union already has `'ended'`. No `createdAt` exists — decide per Task 3.
- `apps/server/src/round/resolveRound.ts` — *current:* one elapsed definition for all outcomes (`:126`). *Change:* Task 0 — failed outcomes record full `timerMs`; append `roundOutcomes` alongside `roundTimesMs`. *Preserve:* the `defused` real-elapsed path, the retry replace-last discipline, the `cumulative === sum` invariant, purity.
- `apps/client/src/App.tsx:101-113` — *current:* status router; `'ended'` falls through to `<Lobby/>` (placeholder per the comment). *Change:* route `'ended'` to the final scoreboard.
- `apps/client/src/ui/Scoreboard.tsx` — *current:* between-rounds preview; relay-complete notice + the `ADVANCE_ERROR_CODES` swallowed-error surfacing (Story 8.9). *Change:* add the "End session" button (relay-complete branch) + surface `RELAY_NOT_COMPLETE`/`SESSION_END_FAILED`. *Preserve:* the preview's "leading"/provisional copy.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative / pure-reducer:** game/scoring logic in pure `(state) => …` functions that never import `socket.io`/`ioredis`/`pg`/`fastify`; **handlers own all I/O**. `buildFinalScoreboard`/`endSession` are pure; the handler holds `redis`/`archive`/`io`.
- **State is never mutated in place** — return new objects via spread/map.
- **NEVER emit a socket event from inside a reducer** — emission lives in the handler.
- **NEVER write to PostgreSQL inside a Socket.IO handler — queue it for session end.** The session-end handler is the queue's single drain point — this is the ONE sanctioned write.
- **No Postgres on the tick path / single tx at session end / `pg-pool` connection pooling.**
- **Typed events only:** extend `ClientToServerEvents`/`ServerToClientEvents`; `socket.emit(string, any)` is forbidden.
- **Authority gate first:** resolve the caller by durable `socket.data.playerId` against freshly-loaded state; refuse non-facilitators before doing anything (especially before a permanent archive write).
- **60fps / R3F:** the final scoreboard is DOM/state only — no per-frame work.

### Testing standards summary

- Pure logic (`buildFinalScoreboard`, `endSession`) → Jest unit tests with injected state; never `Date.now()`/`setTimeout`.
- Server effects → existing in-memory store / `TestSocketServer` (`apps/server/src/handlers/__tests__/testSocketServer.ts`); inject a **fake archive** (spy) — the real one is only exercised in Jay's Docker run. The existing `postgres.test.ts` FakePool double is the model for the transaction test (extend it with `connect()`).
- Client: the final-scoreboard surface + "End session" button via the TD-1 component framework (follow the 8.9 `Scoreboard.test.tsx` precedent).
- Quality gate: `pnpm typecheck` (`tsc --noEmit`, husky pre-commit; no ESLint). Keep the full suite green.

### Decisions — Jay's calls (2026-06-21) baked in; a few small ones left to dev

**RESOLVED by Jay (do NOT re-litigate):**
- **Failed-round scoring (AC-1):** FULL-TIMER PENALTY (`timerMs`), not failure-moment elapsed → Task 0.
- **Round-by-round granularity (AC-2):** add `roundOutcomes` + render defused/detonated icons → Task 2.
- **Persistence schema (AC-3):** NORMALISED `session_rounds` table (one row per team per round), not an `int[]` column → Task 3.
- **End trigger (AC-4):** explicit Facilitator `SESSION_END` event + "End session" button, not auto-end → Tasks 5/6.

**Left to dev judgement (record the choice in Completion Notes):**
1. **Reuse `buildScoreboard` vs. a separate `buildFinalScoreboard`** (winner math is identical; semantics/copy differ).
2. **DDL bootstrap mechanism:** boot-time `CREATE TABLE IF NOT EXISTS` vs. a tiny migration runner (no framework exists yet).
3. **`ended_at` only vs. adding a `createdAt` stamp** for session duration (prefer `ended_at` only unless duration is wanted).
4. **Idempotency strategy** for end-then-retry (`ON CONFLICT DO NOTHING/UPDATE` on each table).

### Project Structure Notes

- New server files beside their kin: `round/buildFinalScoreboard.ts` (beside `buildScoreboard.ts`/`resolveRound.ts`), `session/endSession.ts` (beside `openPreparation.ts`/`startRound.ts`), `persistence/postgres.ts` extension.
- Shared changes additive (one new event; optional `TeamState.roundOutcomes`). Keep `packages/shared` pure TS.
- Naming: events `SCREAMING_SNAKE_CASE` (`SESSION_END`); types `PascalCase` (`SessionArchiveRecord`, `FinalScoreboard`); functions `camelCase` (`buildFinalScoreboard`, `endSession`, `archiveSession`).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.10: Scoring, Final Scoreboard & Session-End Persistence (lines 1334–1352)] — the three ACs (lowest-cumulative-time wins / failure-moment time / no per-module points; round-by-round breakdown + winner in display font; single-transaction Postgres write at session end, no writes during play).
- [Source: _agent_docs/planning-artifacts/epics.md (FR45 line 81, FR43–FR46)] — time-based scoring; sequential relay; session-end archive.
- [Source: _agent_docs/game-architecture.md:443-445, :398, :162, :378, :521, :531] — Postgres session-end-only archive (single tx: metadata + per-round per-team times + final scoreboard); no tick-path writes; persist-then-emit failure rule; game server waits on Postgres health before accepting connections.
- [Source: _agent_docs/project-context.md] — "NEVER write to PostgreSQL inside a Socket.IO handler — queue it for session end"; single-tx-at-session-end; `pg-pool` pooling; pure-reducer/handler boundary; typed events; authority-gate-first.
- [Source: packages/shared/src/session/relay.ts:105-118] — `isRelayComplete` (the terminal predicate 8.10 gates on); Model B rotation/completion model.
- [Source: apps/server/src/round/buildScoreboard.ts] — the provisional preview projection + its explicit "winner authoritative only at session end (8.10)" hand-off; the winner math (strictly-lowest cumulative, undefined on tie) 8.10 makes authoritative.
- [Source: apps/server/src/round/resolveRound.ts:126-129, :161-196] — the single elapsed definition (failure-moment time for detonation/timeout) and per-team `roundTimesMs`/`cumulativeTimeMs` accumulation (invariant `cumulative === sum(rounds)`; retry replaces last entry) — 8.10 totals, never recomputes.
- [Source: apps/server/src/persistence/postgres.ts + index.ts] — the pool+ping adapter awaiting its write method; `PoolLike`/`PostgresArchive`; the JSDoc deferral to 8.10; the FakePool test double.
- [Source: apps/server/src/index.ts:69, :120, :165] — `connectPostgres` → `{ pool, archive }`; `archive` currently used only for health ping (NOT passed to handlers — 8.10 wires it in); pool shutdown on close.
- [Source: apps/server/src/handlers/sessionHandlers.ts:86-97 (SessionHandlerDeps), :1001-1040 (authority gate + RELAY_COMPLETE gate), :1014 (status 'ended' short-circuit)] — the deps to extend; the authority-gate-first + relay-complete pattern the SESSION_END handler copies.
- [Source: packages/shared/src/types/session.ts:89-145] — `SessionState` (`status` union has `'ended'`, unused until now; `activeTeamId`/`retryingTeamId` transient intent to clear on end); `TeamState` (add `roundOutcomes` only if Task 2(b)); no `createdAt` field.
- [Source: packages/shared/src/events/client-to-server.ts:34-60 + server-to-client.ts:30,44] — add `SESSION_END`; reuse `SESSION_STATE`/`SCOREBOARD`.
- [Source: apps/client/src/App.tsx:101-113] — the `'ended' → Lobby` placeholder this story replaces with the final scoreboard.
- [Source: apps/client/src/ui/Scoreboard.tsx] — the between-rounds preview + relay-complete notice + `ADVANCE_ERROR_CODES` swallowed-error surfacing (Story 8.9) the "End session" button extends.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:240] — per-round outcome history (`roundOutcomes`) deferred to "when Story 8.10 builds the final round-by-round scoreboard" — now in scope (Task 2, Jay's decision).
- [Source: _agent_docs/implementation-artifacts/bugs-epic8-2026-06-21.md:15] — failed-round scoring penalty — RESOLVED by Jay (full-timer penalty, Task 0).
- [Source: _agent_docs/implementation-artifacts/8-9-relay-orchestration-and-odd-team-equalisation.md, 8-11-sequential-round-orchestration.md] — the relay-complete predicate + Model B round-count model (each team plays `maxLen` rounds; two-team session = `2 × maxLen` turns) 8.10 consumes; the 8.9 post-verification client-error-surfacing pattern the "End session" button follows.

### Git Intelligence (recent commits)

- `3e3f33e Merge master into worktree-s5-epic8-relay (Epic 3 voice + Epic 8 relay)` (baseline) — this worktree now carries Stories 8.9 + 8.11 (relay spine + Model B sequential play) plus merged voice (3.3/3.4/3.6). 8.10 is the next relay story; the relay-complete predicate + per-team time accumulation it consumes are all present and `done`.
- `062abba fix(story-8.7): pause-interaction gate + visible Resume button` — the persist-then-emit + recoverable-error handler discipline 8.10's `SESSION_END` handler copies.
- `2844482 feat(epic-8): story 8.11 — Model B sequential round orchestration` — established per-team pointers + `activeTeamId`; the round-count model 8.10's scoreboard reflects.
- Sprint-4 retro action item: **every story ships explicit human-validation instructions** — Task 8 honours this (and adds Postgres inspection, since this is the first story that writes to it).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story)

### Debug Log References

- `pnpm typecheck` (all 6 workspace packages) — clean.
- Shared suite `packages/shared`: 10 suites / 216 tests green.
- Server suite `apps/server`: 35 suites / 538 tests green.
- Client suite `apps/client`: 45 files / 396 tests green.
- `pnpm --filter sim-clients verify` — 6/6 PASS (bot swarm).

### Completion Notes List

**Implemented (Tasks 0–7). Task 8 (Jay's interactive Docker-stack verification) is OPEN — status stays `review` until his observed result is recorded here.**

**Jay's design decisions (2026-06-21), all implemented:** failed rounds = full-timer penalty (Task 0); round-by-round breakdown shows outcome icons via new `TeamState.roundOutcomes` (Task 2); persistence uses a normalised `session_rounds` table (Task 3); session ends via an explicit Facilitator `SESSION_END` button (Tasks 5/6).

Key implementation decisions (the "left to dev" calls from Dev Notes):

1. **`buildFinalScoreboard` is SHARED, not a server-only twin of `buildScoreboard`** (`packages/shared/src/session/finalScoreboard.ts`). Because `roundOutcomes` now lives on `TeamState`, the client final scoreboard derives the winner + the per-round (time, outcome) breakdown from `session.teams` via the SAME pure function the server uses to build the archive record — client/server winner can never drift (the `relay.ts` discipline). It returns `{ teams (sorted asc), winnerTeamId?, isDraw }`: strict-lowest winner, `isDraw` distinguishes a two-team tie ("It's a draw") from a single-team/no-rounds session ("Session complete").
2. **Failed-round penalty applied at the SOURCE** (`resolveRound`): a new `scoredElapsedMs` (= `timerMs` for a failure, real elapsed for a defuse) feeds `roundTimesMs`/`cumulativeTimeMs`; the BOMB_EXPLODED announcement keeps the HONEST `displayedElapsedMs` (the real strike instant). So scoring is penalised but the explosion cinematic still shows when the bomb actually blew. `roundOutcomes` is appended/replaced in lock-step with `roundTimesMs` (retry keeps the better attempt's time AND its outcome).
3. **DDL bootstrap = boot-time `ensureSchema()`** (idempotent `CREATE TABLE IF NOT EXISTS` ×3) called best-effort in `index.ts` (a Postgres-down-at-boot start does not crash — mirrors the redis-connect catch) AND lazily memoised inside `archiveSession` so the first session end after a late Postgres recovery still creates the schema. No migration framework (V1, single self-hosted stack).
4. **`archiveSession` single transaction** via a checked-out client (`PoolLike.connect()` → `BEGIN … INSERT×N … COMMIT`, `ROLLBACK` + rethrow on any failure, `release()` in `finally`). Every insert is `ON CONFLICT … DO NOTHING` so an end-then-retry after a broadcast hiccup cannot double-insert. `ended_at` stored as `to_timestamp(endedAt/1000)`; no `createdAt` added (session duration not requested).
5. **`SESSION_END` handler order** (the ONE sanctioned Postgres write): authority-gate-first → `status==='ended'` idempotent no-op (no 2nd archive) → `between-rounds && isRelayComplete` gate (else `RELAY_NOT_COMPLETE`) → build record → `archiveSession` (on throw: `SESSION_END_FAILED`, session stays `between-rounds`, NO flip/broadcast) → `endSession` reducer → persist Redis → broadcast SESSION_STATE (`'ended'`) + final SCOREBOARD (authoritative winner). The archive is wired into `SessionHandlerDeps` (and `registerModuleHandlers`, which reuses that deps type); `index.ts` previously passed `archive` only to the health ping.
6. **Client:** `'ended'` routes to a new `FinalScoreboard.tsx` (replaces the `App.tsx` `'ended' → Lobby` placeholder); the relay-complete notice gains a confirm-gated "End session & view results" button (facilitator-only) emitting `SESSION_END`; `RELAY_NOT_COMPLETE`/`SESSION_END_FAILED` join the Scoreboard's `ADVANCE_ERROR_CODES` so neither fails silently.

**No regression (AC-5):** the Story 8.6 between-rounds preview, the 8.9/8.11 relay-complete `RELAY_COMPLETE` gate, retry better-of-two, and the authority-gate-first/persist-then-emit discipline are all unchanged. The one behaviour change to live play is the failed-round penalty (Task 0) — its existing 3rd-strike test was updated to assert the penalty + that the announcement keeps the real elapsed.

### File List

**Production — shared**
- `packages/shared/src/types/session.ts` — added required `roundOutcomes: RoundOutcome[]` to `TeamState` (+ `RoundOutcome` import).
- `packages/shared/src/session/finalScoreboard.ts` — NEW: `buildFinalScoreboard` + `FinalScoreboard`/`FinalTeamResult` types (shared authoritative scoring).
- `packages/shared/src/session/index.ts` — re-export `finalScoreboard`.
- `packages/shared/src/events/client-to-server.ts` — new `SESSION_END: () => void` facilitator event.

**Production — server**
- `apps/server/src/round/resolveRound.ts` — `scoredElapsedMs` full-timer penalty for failures; `roundOutcomes` lock-step append/replace; announcement keeps `displayedElapsedMs`.
- `apps/server/src/session/assignTeam.ts` — init `roundOutcomes: []`.
- `apps/server/src/session/endSession.ts` — NEW: pure `between-rounds → ended` (relay-complete-gated) reducer.
- `apps/server/src/persistence/postgres.ts` — `PoolLike.connect()`/`PoolClientLike`; `SessionArchiveRecord`; `ensureSchema` (idempotent DDL ×3) + `archiveSession` (single transaction).
- `apps/server/src/persistence/index.ts` — re-export `PoolClientLike`/`SessionArchiveRecord`.
- `apps/server/src/handlers/sessionHandlers.ts` — `archive` added to `SessionHandlerDeps`; `SESSION_END` handler.
- `apps/server/src/index.ts` — boot-time `archive.ensureSchema()`; pass `archive` to `registerSessionHandlers` + `registerModuleHandlers`.

**Production — client**
- `apps/client/src/ui/FinalScoreboard.tsx` — NEW: final scoreboard surface (winner headline in `font-display`, per-round ✓/✗ outcome icons).
- `apps/client/src/ui/index.ts` — export `FinalScoreboard`.
- `apps/client/src/App.tsx` — route `status === 'ended'` → `FinalScoreboard`.
- `apps/client/src/ui/Scoreboard.tsx` — "End session" confirm button on the relay-complete branch; `RELAY_NOT_COMPLETE`/`SESSION_END_FAILED` in `ADVANCE_ERROR_CODES`.
- `apps/client/src/ui/copy.ts` — session-end / final-scoreboard copy.

**Tests**
- `packages/shared/src/session/__tests__/finalScoreboard.test.ts` — NEW: winner/tie/single-team/all-failures/no-rounds truth table.
- `apps/server/src/session/__tests__/endSession.test.ts` — NEW: complete→ended + clears transient intent; incomplete/wrong-status/already-ended no-ops.
- `apps/server/src/persistence/__tests__/postgres.test.ts` — REWRITTEN: BEGIN/INSERT×6/COMMIT, schema-ensured-once, ROLLBACK-on-failure, idempotent re-archive (FakePool + FakeClient with `connect()`/`release()`).
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — NEW `SESSION_END` describe: archive-once + flip + final SCOREBOARD; non-facilitator → NOT_FACILITATOR (no write); incomplete → RELAY_NOT_COMPLETE; archive-throw → SESSION_END_FAILED (stays between-rounds); already-ended idempotent (no 2nd archive); asserts nothing archived during play.
- `apps/server/src/round/__tests__/resolveRound.test.ts` — penalty + `roundOutcomes` lock-step assertions (3rd-strike now scores `timerMs`; defuse/retry outcomes).
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — `createSpyArchive`/`SpyArchive` (observe + `failNext`) + `fakeArchive`.
- Construction-site fixups (added `roundOutcomes`): `apps/client/src/test/fixtures.ts`, `apps/client/src/ui/__tests__/rotation.test.ts`, `apps/server/src/session/__tests__/{assignTeam,cancelPreparation,openPreparation,relayComplete,removePlayerFromSession,retryRound}.test.ts`, `apps/server/src/round/__tests__/{buildScoreboard,resolveRound}.test.ts`, `apps/server/src/timer/__tests__/timerScheduler.test.ts`, `apps/server/src/handlers/__tests__/sessionHandlers.test.ts`; archive dep added to handler-test harnesses (`manual/module/voice/sessionHandlers.test.ts`).
- `apps/client/src/ui/__tests__/FinalScoreboard.test.tsx` — NEW: winner headline/badge, ✓/✗ breakdown, draw, single-team-complete.
- `apps/client/src/ui/__tests__/Scoreboard.test.tsx` — End-session button emits SESSION_END; facilitator-only; SESSION_END_FAILED alert.
- `tools/sim-clients/src/verify.ts` — no-op archive in the sim handler wiring.

**Docs**
- `_agent_docs/implementation-artifacts/sprint-status.yaml` — 8-10 → in-progress → review.
- `_agent_docs/implementation-artifacts/deferred-work.md` — `roundOutcomes` item (line 240) resolved by this story.

### Change Log

- 2026-06-21 — Story 8.10 implemented (Tasks 0–7): full-timer failure penalty + `roundOutcomes` history in `resolveRound`; shared pure `buildFinalScoreboard` (strict-lowest winner, draw/single-team distinction); normalised Postgres schema (`sessions`/`session_team_results`/`session_rounds`) + idempotent `ensureSchema` + single-transaction `archiveSession`; pure `endSession` reducer + Facilitator `SESSION_END` event/handler (archive-then-flip, persist-then-emit, recoverable on archive failure); client `FinalScoreboard` surface + "End session" button. typecheck clean; shared 216 / server 538 / client 396 + sim-verify 6/6 green. Task 8 (Jay's interactive Docker-stack verification) outstanding — status `review`.
