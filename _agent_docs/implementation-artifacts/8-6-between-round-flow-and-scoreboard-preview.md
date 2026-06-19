---
baseline_commit: e639270
---

# Story 8.6: Between-Round Flow & Scoreboard Preview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator and players,
I want a scoreboard preview between rounds with a manual advance,
so that everyone sees the standing before the next round and I control pacing.

## Acceptance Criteria

1. **Between-rounds entry on round resolution.** When a round has resolved for **all participating teams** (every team in `RoundState.defusers` has reached a terminal outcome — defuse / explode / time-expire), the session enters `'between-rounds'`: the server flips `SessionState.status` to `'between-rounds'`, broadcasts `SESSION_STATE` to the session room, and emits `SCOREBOARD` to the session room. A scoreboard preview is then shown to **all** players (every role), and the next round does **not** begin automatically. The status flip + broadcast happen only once, on the **last** team's resolution — never while another team's bomb is still live (no client is routed to the scoreboard mid-round; AC-3 of Story 8.5 is preserved end-to-end).

2. **Scoreboard preview content.** The preview shows, per team, the cumulative defuse time and per-round times, plus the provisional leader (lowest cumulative time). It is reconnect-safe: a client that (re)joins while `status === 'between-rounds'` renders the same standings from the authoritative `SESSION_STATE` snapshot, without depending on having received the one-shot `SCOREBOARD` event. The preview is **not** the final scoreboard (Story 8.10) — it reads "standings"/"leading", never declares a session winner.

3. **Manual advance → next round preparation for the next Defuser.** While `status === 'between-rounds'`, only the Facilitator can advance. When the Facilitator advances (`PREPARATION_OPEN`), the session transitions `'between-rounds' → 'preparation'`, `roundNumber` increments, and **each team's `currentDefuserIndex` advances by one** so the next round's Defuser is the next player in `relayOrder`. The Preparation surface then shows the correct upcoming Defuser per team (the same rotation expression the server commits at the subsequent `ROUND_START`). Non-facilitators cannot trigger the advance (a non-facilitator emit is refused with a typed `ERROR`, learning nothing about session contents).

4. **Cancel restores the originating phase.** `PREPARATION_CANCEL` from a Preparation that was opened **from between-rounds** returns the session to `'between-rounds'` (not `'lobby'`), reverses the `roundNumber` increment, and reverses the per-team `currentDefuserIndex` advance — so a cancel + re-advance lands on the identical next round. A Preparation opened from the lobby (round 1) still cancels back to `'lobby'` exactly as before (no regression to Story 8.3 behaviour).

5. **No mid-round / no premature scoreboard.** The scoreboard surface and the `SCOREBOARD` event appear only in `'between-rounds'`. While any team's round is still `'active'`, neither is shown nor emitted (this story tightens Story 8.5's first-team-flip so the shared session status is not advanced until every team has resolved).

## Tasks / Subtasks

- [x] **Task 1 — Shared contracts: per-round time log on `TeamState` (AC: 1, 2)**
  - [x] Add `roundTimesMs: number[]` to `TeamState` in `packages/shared/src/types/session.ts` — the per-round elapsed-time history (`roundTimesMs[i]` = team's recorded elapsed for round `i+1`). Document that `cumulativeTimeMs === sum(roundTimesMs)` is the maintained invariant; both are kept because the `ScoreboardPayload` carries both and Story 8.5 already consumes `cumulativeTimeMs`.
  - [x] Do **NOT** add new socket events: `SCOREBOARD` already exists in `ServerToClientEvents` with `ScoreboardPayload { teams: Partial<Record<TeamId, { cumulativeTimeMs; rounds: number[] }>>, winnerTeamId? }`. Reuse it. `PREPARATION_OPEN` / `PREPARATION_CANCEL` already exist (Story 8.3) and are the advance / back-out actions — do not add an `ADVANCE`/`NEXT_ROUND` event.
  - [x] Run `pnpm typecheck` — adding a required field to `TeamState` surfaces every construction site (see Task 2 / Task 3). Fix them all; a missing initializer must be a compile error you resolve, not a runtime `undefined`.

- [x] **Task 2 — Initialize `roundTimesMs` at every `TeamState` construction site (AC: 1, 2)**
  - [x] `apps/server/src/session/assignTeam.ts` (the **only** production `TeamState` constructor, ~line 60): add `roundTimesMs: []` beside `cumulativeTimeMs: 0` / `currentDefuserIndex: 0`.
  - [x] Grep the whole workspace for other `TeamState` literals (tests/fixtures, `apps/server/src/**/__tests__`, `apps/client/src/**`): every literal must add `roundTimesMs`. The typecheck from Task 1 is the authority — do not hand-wave this.

- [x] **Task 3 — Record per-round time + gate the between-rounds entry inside `resolveRound` (AC: 1, 5)**
  - [x] In `apps/server/src/round/resolveRound.ts` (`resolveRoundCeremony`), append the resolving team's `elapsedMs` to `roundTimesMs` in the same immutable update that adds it to `cumulativeTimeMs`: `roundTimesMs: [...team.roundTimesMs, elapsedMs]`.
  - [x] **Change the status flip (this is the core fix).** Today the ceremony unconditionally sets `status: session.status === 'active' ? 'between-rounds' : session.status` on the *first* team to resolve. Replace with an **all-teams-resolved gate**: after deleting THIS team's live timer key (step a, already present), check every OTHER team in `round.defusers` for a live timer key (`redis.getJSON(timerKey(sessionId, otherTeamId))`). The session enters between-rounds **only when no other participating team still has a live timer key** (i.e. this is the last team to resolve). Until then, persist `cumulativeTimeMs`/`roundTimesMs` but keep `status: 'active'`.
  - [x] This runs inside the existing per-session serialization (`sessionChains`), so the "any other team still live?" read-check is race-safe against a concurrent two-team resolution — the two ceremonies cannot both observe the other as still-live.
  - [x] When the gate fires (last team), set `status: 'between-rounds'` on the persisted `updatedSession`, then **broadcast `SESSION_STATE` to `sessionRoom(sessionId)`** and **emit `SCOREBOARD` (built via Task 4) to `sessionRoom(sessionId)`**. Order: persist session → broadcast SESSION_STATE → emit SCOREBOARD (persist-then-emit, matching the file's existing discipline). The per-team `BOMB_DEFUSED`/`BOMB_EXPLODED` emit (step d) still fires for every team as today.
  - [x] Single-team session: `round.defusers` has one entry, so the first resolution is also the last → between-rounds entry fires immediately. Verify this path.
  - [x] Update the in-file header/comment block: the "Story 8.6 CAVEAT … first team flips the shared status" note is now **resolved** — document the all-resolved gate as the implemented behaviour.

- [x] **Task 4 — Pure `buildScoreboard(session)` helper (AC: 2)**
  - [x] Add a pure function (e.g. `apps/server/src/round/buildScoreboard.ts`, or co-locate in `resolveRound.ts`) `buildScoreboard(session: SessionState): ScoreboardPayload`. For each team present in `session.teams`, emit `{ cumulativeTimeMs, rounds: [...roundTimesMs] }`. Set `winnerTeamId` to the **provisional leader** = the team with the strictly-lowest `cumulativeTimeMs` (GDD scoring: lowest cumulative time leads); leave `winnerTeamId` undefined on a tie or when fewer than one team has played. Document it is provisional (final winner is Story 8.10).
  - [x] No I/O, no clock — pure projection of `SessionState`. Unit-test it directly.

- [x] **Task 5 — Rotation advance on between-rounds → preparation (AC: 3)**
  - [x] In `apps/server/src/session/openPreparation.ts`: when the source status is `'between-rounds'` (not `'lobby'`), advance each team's `currentDefuserIndex` by +1 (raw integer; the non-negative-modulo read normalization already lives in `startRound` and `upcomingDefuserId`). The `'lobby' → 'preparation'` path (round 1) leaves indices untouched (round 1 uses index 0). Keep the existing `roundNumber + 1` for both paths.
  - [x] Keep it pure (return a new `SessionState`, immutable team map spread). Update the doc comment: the "Pointer ADVANCEMENT belongs to 8.6/8.9" seam from `startRound.ts` is now partly owned here (simple +1). Story 8.9 layers odd-team equalisation / every-player-defuses-once on top — do **not** implement that here.
  - [x] No handler change needed for the advance itself: `PREPARATION_OPEN`'s handler already admits `'between-rounds'` (Story 8.3 phase guard `status === 'active' || 'ended'` refuses; `'between-rounds'` falls through) and already calls `openPreparation` + `hasPopulatedTeam`. Confirm the `hasPopulatedTeam` guard still holds between rounds (it reads `relayOrder` ↔ `players`, unaffected by the index).

- [x] **Task 6 — `cancelPreparation` restores the originating phase (AC: 4)**
  - [x] In `apps/server/src/session/cancelPreparation.ts`: derive the return phase from `roundNumber`. Invariant (verified): lobby starts at `roundNumber: 0` and `openPreparation` increments, so in `'preparation'` `roundNumber === 1` ⟺ opened from lobby (round 1) and `roundNumber >= 2` ⟺ opened from between-rounds. Restore `'lobby'` for the former, `'between-rounds'` for the latter. Always decrement `roundNumber` (existing behaviour). When restoring `'between-rounds'`, also **reverse** the per-team `currentDefuserIndex` advance (−1 per team) so cancel is the exact inverse of Task 5's open.
  - [x] Update the handler `PREPARATION_CANCEL` (`sessionHandlers.ts`): the existing phase guard (`status !== 'preparation'` refuses) is unchanged. After `cancelPreparation`, if the session returned to `'between-rounds'`, the facilitator should land back on the scoreboard — the `SESSION_STATE` broadcast already does this (the client routes by status, Task 7). Consider re-emitting `SCOREBOARD` on the cancel-to-between-rounds path so a facilitator who never reloaded still has the payload; **not required** since the client derives the preview from `session.teams` (Task 7) — note the decision either way.
  - [x] Update the doc comment (the "always returns to 'lobby' … Stories 8.5/8.6 must restore the originating phase" scope note is now resolved). Reconcile with the `deferred-work.md` 8.3 item.
  - [x] **Story 8.8 interaction (note, do not implement):** retry reuses `roundNumber`; the `roundNumber`-based derivation here assumes the monotonic open/cancel pairing. Leave a comment flagging that 8.8 (retry) must reconcile its `roundNumber` handling with this derivation.

- [x] **Task 7 — Client between-rounds surface + scoreboard binding (AC: 1, 2, 3)**
  - [x] `apps/client/src/store/gameStore.ts`: add `scoreboard: ScoreboardPayload | null` + `setScoreboard`. Clear it on a new round (`setBomb` / on `BOMB_INIT`) and in `clearSession`. (Mirror how `resolution` is handled.)
  - [x] `apps/client/src/net/bindServerEvents.ts`: replace the `onScoreboard` stub (currently `console.info`) with `setScoreboard(payload)`. Preserve the exact `socket.on`/`socket.off` symmetry already in place for `SCOREBOARD`.
  - [x] New surface `apps/client/src/ui/Scoreboard.tsx` (DOM, not R3F — the scoreboard is HUD/overlay, no Three.js objects): renders the standings table per team (cumulative + per-round times, provisional leader). **Primary data source is `session.teams`** (authoritative, reconnect-safe — `cumulativeTimeMs` + `roundTimesMs` now live in `SessionState`); the `scoreboard` store field is the explicit trigger/corroboration but the surface must render correctly even if it is `null` (reconnect case, AC-2). Use `copy.ts` constants for all strings; follow the operator-world / no-LED-decoration treatment from the scoreboard mockup (green/red only as per-round defused/failed result iconography).
  - [x] Facilitator gets a "Start next round" control (two-step `ConfirmButton`, matching the Preparation "Start the round" pattern) that emits `PREPARATION_OPEN`; reuse the same `START_ERROR_CODES`-style error filtering for `CANNOT_OPEN_PREP` / `PREPARATION_OPEN_FAILED` / `NOT_FACILITATOR`. Non-facilitators see a "waiting for the facilitator" standby line — no advance control.
  - [x] `apps/client/src/ui/index.ts`: export `Scoreboard`. `apps/client/src/App.tsx`: route `session.status === 'between-rounds'` → `<Scoreboard />` (replace the current `else → <Lobby/>` fallthrough for this status; update the "between-rounds / ended fall back to Lobby until 8.5/8.6" comment). `'ended'` still falls back to Lobby (Story 8.10 owns it).
  - [x] `apps/client/src/ui/copy.ts`: add between-rounds/scoreboard copy (eyebrow, "STANDINGS", per-team labels, leader/"LEADING" label, facilitator advance CTA, player standby line). Retire/repurpose `BETWEEN_ROUNDS_PLACEHOLDER` (the 8.5 interim post-round line) — the real surface replaces the `ResolutionBanner` interim surface. Confirm `ResolutionBanner`'s interim "round over" overlay no longer strands: once the server broadcasts `'between-rounds'`, `ActiveRound` (mounted only while `status === 'active'`) unmounts and `Scoreboard` mounts (resolves the 8.5-deferred "interim surface is terminal" + "banner stranded on re-sync" items).

- [x] **Task 8 — Ratify the lobby role-pick semantics (AC: 3; deferred 8.3 decision)**
  - [x] Decision (carry into Dev Notes + code comments, **no behavioural change required**): the relay rotation (`relayOrder` + `currentDefuserIndex`) is the sole authority for who defuses each round; the lobby `defuser`/`expert` pick distinguishes **participant vs spectator** only (option (c) from the `deferred-work.md` 8.3 manual-verification item). Verify no lobby/prep copy implies the lobby pick binds a specific player as the round Defuser; adjust copy if it does. This closes the deferred item — update `deferred-work.md`.

- [x] **Task 9 — Tests (AC: 1–5)**
  - [x] Server `apps/server/src/round/__tests__/resolveRound.test.ts` (extend): two-team round where team A resolves first → session stays `'active'`, no `SCOREBOARD`/`SESSION_STATE` broadcast yet, A's `roundTimesMs`/`cumulativeTimeMs` recorded; then team B resolves → `status` flips `'between-rounds'`, `SESSION_STATE` + `SCOREBOARD` emitted to the session room once. Single-team session → between-rounds on first resolution. Concurrent two-team resolution (the serialized path) → both times land AND the gate fires exactly once (extends the existing concurrent regression test). Injected `now`/clock only — never `Date.now()`/`setTimeout`.
  - [x] `apps/server/src/round/__tests__/buildScoreboard.test.ts` (new): per-team projection; provisional leader = lowest cumulative; tie → undefined; absent team B omitted (Partial map).
  - [x] `apps/server/src/session/__tests__/openPreparation.test.ts` + `cancelPreparation.test.ts` (extend/new): between-rounds → preparation advances every team's `currentDefuserIndex` by 1 and increments `roundNumber`; lobby → preparation leaves indices at 0; cancel from a round-≥2 preparation restores `'between-rounds'`, decrements `roundNumber`, and reverses the index advance (open∘cancel == identity); cancel from a round-1 preparation restores `'lobby'` (no regression).
  - [x] Server handler integration (`sessionHandlers.test.ts`): a non-facilitator `PREPARATION_OPEN` in `'between-rounds'` is refused `NOT_FACILITATOR`; a facilitator advance transitions to `'preparation'` and a subsequent `ROUND_START` assigns the **next** rotation Defuser (rotation actually advanced end-to-end).
  - [x] Client: extend `apps/client/src/net/__tests__/resolutionBinding.test.ts` (or a new `scoreboardBinding.test.ts`) — `SCOREBOARD` sets `scoreboard`; `BOMB_INIT`/new round clears it; off()-symmetry. Component test (TD-1 framework) for `Scoreboard.tsx`: renders standings from `session.teams` with `scoreboard === null` (reconnect path); facilitator sees the advance control, a player does not.

- [x] **Task 10 — Human verification (per project rule [[human-verification-ac-rule]]) — DONE 2026-06-19** (deferred 2026-06-17, completed 2026-06-19)
  - [x] **Verified by Jay 2026-06-19** on the full Docker stack (browser at `http://localhost` via Caddy dev override; server running as the built Docker image — a stable process, so the `tsx watch` expiry-wake caveat did not apply), with the two teams' players supplied by the TD-5 bot swarm (`[[td-5-player-simulator-test-harness]]`, hybrid `--code` mode, rotating defusers). **Observed (Jay): "everything works as expected"** — running rounds to resolution with two teams: all players land on the scoreboard preview only after BOTH teams finish (never mid-round); standings show cumulative + per-round times and the leader; the next round does not auto-start; "Start next round" advances to Preparation showing the NEXT Defuser per team; cancel returns to the scoreboard with the same standings; a refresh during between-rounds re-renders the scoreboard (reconnect-safe). Note confirmed during the session: there is **no automatic final scoreboard / session end** — the between-round loop is facilitator-driven and the Defuser rotation wraps indefinitely (final scoreboard + session-end persistence is Story 8.10, backlog; "every player defuses once" round-count is Story 8.9, backlog).

## Dev Notes

### Cross-Story Seam (READ FIRST — this is the integration hazard)

Story 8.5 left **two deliberate seams that 8.6 owns and must close** (both in `deferred-work.md` and in `resolveRound.ts` comments):

1. **The shared-session status flip is premature.** `resolveRound` currently flips `SessionState.status` to `'between-rounds'` on the **first** team to resolve, and emits **no** `SESSION_STATE`. Two teams play in parallel in the current V1 (`ROUND_START` arms a timer + emits `BOMB_INIT` for *every* team in `round.defusers` simultaneously — see `sessionHandlers.ts:1064-1087`). So the moment 8.6 starts broadcasting `'between-rounds'`, flipping on the first team would route the still-playing team's client off the bomb mid-round. **8.6 must gate the flip on ALL participating teams having resolved** (Task 3). This is *the* correctness centerpiece of the story.

2. **The 8.5 client banner / interim surface strands on re-sync** (`ResolutionBanner.tsx` interim "round over" overlay; `App.tsx` routes `'between-rounds' → Lobby`). 8.6's real `Scoreboard` surface + the `'between-rounds'` route replace it (Task 7).

The per-team idempotency fence is the **live timer key** (`timerKey(sessionId, teamId)`), deleted on first resolution. 8.6 reuses exactly this signal — "all teams resolved" == "no team in `round.defusers` still has a live timer key" — read inside the existing `sessionChains` serialization so it is race-safe.

### Current-state of files this story modifies (UPDATE files)

- **`apps/server/src/round/resolveRound.ts`** — *current:* serialized per-session ceremony; records `cumulativeTimeMs`, deletes the team timer key, flips status to `'between-rounds'` on first team (no broadcast), emits `BOMB_DEFUSED`/`BOMB_EXPLODED` per team. *Change:* append to `roundTimesMs`; replace the unconditional flip with the all-resolved gate; on last team, broadcast `SESSION_STATE` + emit `SCOREBOARD` to the session room. *Preserve:* the `sessionChains` serialization, the timer-key fence, persist-then-emit ordering, the `del`-before-emit desync posture, the per-team event emit, injected `now`.
- **`apps/server/src/session/openPreparation.ts`** — *current:* `lobby | between-rounds → preparation`, `roundNumber + 1`, no index change. *Change:* advance each team's `currentDefuserIndex` by +1 **only** on the `'between-rounds'` source path. *Preserve:* purity, the `roundNumber + 1` for both paths, the lobby path leaving indices at 0, the same-reference no-op guard.
- **`apps/server/src/session/cancelPreparation.ts`** — *current:* always `→ 'lobby'`, `roundNumber - 1`. *Change:* restore originating phase via the `roundNumber`-derivation; reverse the index advance when returning to `'between-rounds'`. *Preserve:* purity, the same-reference no-op guard, the `roundNumber - 1`.
- **`packages/shared/src/types/session.ts`** — *current:* `TeamState` has `relayOrder`, `currentDefuserIndex`, `cumulativeTimeMs`. *Change:* add `roundTimesMs: number[]` (additive). *Preserve:* `packages/shared` stays pure TS (no runtime deps on react/socket.io/server frameworks).
- **`apps/server/src/session/assignTeam.ts`** — *current:* the only `TeamState` constructor. *Change:* initialize `roundTimesMs: []`. *Preserve:* the immutable-update / accepted-lobby-race posture.
- **`apps/server/src/handlers/sessionHandlers.ts`** — *current:* `PREPARATION_OPEN`/`PREPARATION_CANCEL`/`ROUND_START` facilitator-gated handlers. *Change:* none required for the advance (the handlers already admit `'between-rounds'` via `openPreparation`); optionally re-emit `SCOREBOARD` on cancel-to-between-rounds. *Preserve:* the authority-gate-first ordering (a non-facilitator probe learns nothing), persist-then-emit, the existing error codes.
- **`apps/client/src/App.tsx`** — *current:* `'between-rounds'` falls through to `<Lobby/>`. *Change:* route it to `<Scoreboard/>`. *Preserve:* the no-router status-derived surface selection; precedence (platform gate → loading → shell); `'ended' → Lobby` stays (8.10).
- **`apps/client/src/store/gameStore.ts`**, **`net/bindServerEvents.ts`**, **`ui/index.ts`**, **`ui/copy.ts`** — add `scoreboard` state + setter, wire the `onScoreboard` binding, export the surface, add copy. Preserve store non-authority, off()-symmetry, copy-module conventions.

### Deferred-work items this story OWNS (from `deferred-work.md`)

1. *code review of story-8.5:* "**`between-rounds` status flip strands the resolution banner on re-sync**" → Task 3 (gate + broadcast) + Task 7 (real surface, derives from `session.teams`). RESOLVED.
2. *code review of story-8.5:* "**ResolutionBanner interim surface is terminal** … Story 8.6 owns the between-rounds transition" → Task 7. RESOLVED.
3. *manual verification of story 8-3:* "**`cancelPreparation` always returns to `'lobby'`** … when `'between-rounds' → preparation` becomes reachable (8.5/8.6), cancel must restore the originating phase … and the `roundNumber` decrement must be reconciled" → Task 6. RESOLVED.
4. *manual verification of story 8-3:* "**Lobby role pick … overridden by rotation** … Decision: defer the role-pick semantics to Story 8.6" → Task 8 (ratify option (c)). RESOLVED (decision recorded; no logic change).
5. Update `deferred-work.md` marking items 1–4 resolved by this story.

### Rotation model (the heart of AC-3)

- `relayOrder` = player IDs in join/assignment order (the GDD default rotation). `currentDefuserIndex` indexes into it. The pick is `relayOrder[((idx % len) + len) % len]` — computed identically on the **server** (`startRound.ts:54`) and **client** (`ui/rotation.ts upcomingDefuserId`). These two MUST stay in lock-step; the prep surface shows the client derivation, `ROUND_START` commits the server one (Story 8.3 decision 2).
- `startRound` only **reads** the index; `openPreparation` (this story) **advances** it. So the lifecycle is: prep(round N) opens with the index already pointing at round N's Defuser → `ROUND_START` commits it → round resolves → between-rounds → facilitator advances → `openPreparation` increments the index → prep(round N+1) shows the next Defuser. Round 1 is the base case (index 0, opened from lobby, no advance).
- **Scope fence:** 8.6 does the simple `+1`. Story 8.9 (Relay Orchestration & Odd-Team Equalisation) owns "every player defuses once before session end" and the odd-team extra round — do not implement those here; leave the `+1` as the primitive 8.9 builds on.

### Scoreboard data & reconnect-safety (AC-2)

- `ScoreboardPayload.teams[t].rounds` is per-round elapsed times. There is **no** per-round history in `TeamState` today (only `cumulativeTimeMs`). Task 1 adds `roundTimesMs: number[]`, appended in `resolveRound`. This is also the foundation Story 8.10 (final round-by-round scoreboard) needs — build it now, correctly.
- Because `roundTimesMs` + `cumulativeTimeMs` live in `SessionState.teams` and `SESSION_STATE` is (re)sent on (re)join, the client `Scoreboard` surface **derives its render from `session.teams`** and is reconnect-safe by construction. The `SCOREBOARD` event is the explicit "scoreboard now" signal (and a future animation hook), but the surface must not require it (a reconnecting client never gets a fresh one). This is the clean resolution of the 8.5 "carry resolution across re-sync" deferral.
- `winnerTeamId` in the preview is **provisional** (current leader = lowest cumulative). The session winner is Story 8.10. Copy must read "LEADING"/"STANDINGS", never "WINNER".

### Two-team gate: concurrency reasoning

`resolveRound` already serializes all resolutions for a session through `sessionChains` (a promise chain) to avoid `cumulativeTimeMs` lost-updates. The all-resolved gate (Task 3) runs **inside** that serialized ceremony, so the "is any other team's timer key still live?" read cannot interleave with a sibling team's `del`. Sequenced outcome for two teams A,B: A resolves (deletes A's key, sees B's key live → stays `'active'`), then B resolves (deletes B's key, sees A's key gone → fires the gate once). The existing concurrent two-team regression test extends to assert the gate fires exactly once.

### Project Structure Notes

- New server files: `apps/server/src/round/buildScoreboard.ts` (+ `__tests__/buildScoreboard.test.ts`), beside `resolveRound.ts` / `initializeRoundBombs.ts`.
- New client file: `apps/client/src/ui/Scoreboard.tsx` (+ co-located `__tests__/Scoreboard.test.tsx` per the TD-1 component-test framework).
- Shared change is additive (one field on `TeamState`). Keep `packages/shared` pure TS.
- Naming: socket events `SCREAMING_SNAKE_CASE` (reuse `SCOREBOARD`/`PREPARATION_OPEN`/`PREPARATION_CANCEL`); types `PascalCase`; functions `camelCase` (`buildScoreboard`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Server-authoritative / pure-reducer pattern:** game logic in pure functions `(state) => newState` that never import `socket.io`/`ioredis`/`pg`/`fastify`; **handlers own all I/O** (parse → load → reduce → persist → emit). `openPreparation`/`cancelPreparation`/`buildScoreboard` are pure; `resolveRound` is an effect — keep its decision logic pure where practical.
- **State is never mutated in place** — return new objects via spread/map for `SessionState`/`TeamState` (incl. the new `roundTimesMs`).
- **NEVER emit a socket event from inside a reducer** — emission lives in the effect/handler (`resolveRound` holds the `io` ref; the pure transitions do not).
- **NEVER run the bomb timer on the client** — server owns the clock; the scoreboard is presentation only.
- **NEVER write to PostgreSQL inside a Socket.IO handler** — session history is written at session end (Story 8.10). `cumulativeTimeMs`/`roundTimesMs` live in Redis session state during play. **Do not add Postgres writes here.**
- **Typed events only:** reuse `ServerToClientEvents`/`ClientToServerEvents`; `socket.emit(string, any)` is forbidden.
- **Authority gate first:** every facilitator action resolves the caller by the durable `socket.data.playerId` against freshly-loaded state, refusing non-facilitators before revealing anything (the `PREPARATION_OPEN` handler already does this — do not weaken it for the advance).
- **60fps / R3F:** the scoreboard is a DOM overlay, not a Three.js scene — no objects to dispose; no per-frame work.

### Testing standards summary

- Pure logic (`openPreparation`, `cancelPreparation`, `buildScoreboard`, the resolution decision) → Jest unit tests with **injected `now`/clock, never `Date.now()`/`setTimeout`**.
- Server effects → existing in-memory store / `TestSocketServer` patterns (`apps/server/src/handlers/__tests__/testSocketServer.ts`, `round/__tests__/`).
- Client: binding tests under `apps/client/src/net/__tests__/`; component tests via the TD-1 framework (co-located `__tests__`). R3F components are render-only — but `Scoreboard.tsx` is plain DOM, so it can carry a real component test; any logic that "needs" a test belongs in the store/pure helper, not the component.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.6: Between-Round Flow & Scoreboard Preview] — the two ACs.
- [Source: _agent_docs/planning-artifacts/epics.md#Epic 8] — FR12 (between-round pause), FR15 (manual advance + scoreboard preview), FR45/FR46 (cumulative scoring + between/final scoreboard), FR11 (Defuser rotation).
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#IA] — IA step 5 "Between-round — scoreboard preview + ready gate for next round"; "Scoreboard never appears mid-round"; round-result transitions to between-round.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/8. Scoreboard.html] — visual language: display headline, Bakelite/cream/dark surface, per-round defused(green)/failed(red) result icons ONLY (no decorative LED colour), winner/leader badge, per-round + total times, gap tag. (This mockup is the end-of-session takeover; the between-round preview reuses the language with a "Start next round" advance instead of rematch/end.)
- [Source: apps/server/src/round/resolveRound.ts] — the ceremony 8.6 modifies; the first-team-flip + "Story 8.6" caveat comments (lines ~142-153); `sessionChains` serialization; timer-key fence.
- [Source: apps/server/src/session/openPreparation.ts + cancelPreparation.ts] — the prep transitions; the "8.5/8.6 must restore originating phase" + "between-rounds unreachable until 8.5/8.6" scope notes.
- [Source: apps/server/src/session/startRound.ts] — rotation read (`relayOrder[currentDefuserIndex]`); "Pointer ADVANCEMENT belongs to 8.6/8.9".
- [Source: apps/client/src/ui/rotation.ts] — `upcomingDefuserId`; must mirror the server pick.
- [Source: apps/server/src/handlers/sessionHandlers.ts:836-1110] — `PREPARATION_OPEN`/`PREPARATION_CANCEL`/`ROUND_START` handlers; authority-gate-first + persist-then-emit pattern every facilitator action copies.
- [Source: packages/shared/src/types/session.ts] — `TeamState` (add `roundTimesMs`); `SessionState.status` union (already includes `'between-rounds'`); `roundNumber`.
- [Source: packages/shared/src/events/payloads.ts:120] — `ScoreboardPayload` contract.
- [Source: packages/shared/src/events/server-to-client.ts:44 + client-to-server.ts] — `SCOREBOARD`; `PREPARATION_OPEN`/`PREPARATION_CANCEL`.
- [Source: apps/client/src/App.tsx:100-110] — status-routed surface selection (between-rounds → Lobby fallthrough to replace).
- [Source: apps/client/src/net/bindServerEvents.ts:42] — `onScoreboard` stub to replace; off()-symmetry contract.
- [Source: apps/client/src/store/gameStore.ts] — `resolution` field pattern to mirror for `scoreboard`.
- [Source: apps/client/src/ui/copy.ts:88-93] — `BETWEEN_ROUNDS_PLACEHOLDER` to retire/repurpose; result-copy conventions.
- [Source: apps/server/src/session/createSession.ts:60] — `roundNumber: 0` (validates the cancel-derivation invariant).
- [Source: apps/server/src/session/assignTeam.ts:60] — the sole `TeamState` constructor (add `roundTimesMs: []`).
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] — the four 8.6-owned items (8.5 banner-strand + interim-terminal; 8.3 cancelPreparation-phase; 8.3 lobby-role-pick).
- [Source: _agent_docs/project-context.md] — critical implementation rules.

### Git Intelligence (recent commits)

- `e639270 feat(story-4.6): preparation placeholder bomb view` — the most recent prep-surface work; `PrepBombView`/`Preparation.tsx` patterns and the retired `PREP_DEFUSER_PLACEHOLDER` copy are the convention for the between-rounds surface copy/structure.
- Story 8.5 (`resolveRound` ceremony) and Story 8.3 (`openPreparation`/`cancelPreparation`/`startRound`, `ROUND_START` handler) are the direct dependencies — the pattern to follow throughout: pure transition + thin effect, injected clock in tests, persist-then-emit, desync paths are logged no-ops (never throw), explicit scope-fence comments for the next story (8.8/8.9/8.10).
- TD-1 landed the client component-test framework — use it for `Scoreboard.tsx`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- Two pre-existing 8.5-era tests asserted the OLD first-team-flip behaviour and were updated to the corrected all-resolved gate (no production regression — they were forward-references this story owns):
  - `sessionHandlers.test.ts` "authoritative expiry … status flipped (8.5 ceremony)": with two populated teams (A=maya, B=devon), only A's timer fired, so the session now correctly stays `'active'` (B still playing). Updated to assert that, then fire B's timer too and assert the between-rounds entry + SCOREBOARD broadcast.
  - `timerScheduler.test.ts` "still-expired on fire → delegates to resolveRound": a single-team session is the last team, so the between-rounds entry now also emits SESSION_STATE + SCOREBOARD. Updated the exact-emit assertion accordingly.

### Completion Notes List

- **The core correctness change (AC-1/AC-5):** Story 8.5 flipped `SessionState.status` to `'between-rounds'` on the FIRST team to resolve (and emitted no `SESSION_STATE`). Since both teams play in parallel in the current V1, broadcasting that flip would route a still-playing team off its bomb mid-round. 8.6 gates the flip on ALL participating teams (those in `round.defusers`) having resolved, detected via the existing per-team live-timer-key fence read INSIDE the existing `sessionChains` per-session serialization (race-safe). Only the last team's resolution flips the status and broadcasts `SESSION_STATE` + `SCOREBOARD` to the session room. Proven by a new concurrent two-team test (gate fires exactly once) + a first-team-stays-active test.
- **Per-round history added to the contract:** `TeamState` gained `roundTimesMs: number[]` (invariant `cumulativeTimeMs === sum(roundTimesMs)`), appended in `resolveRound`. This makes the `ScoreboardPayload.rounds` breakdown real and is the foundation Story 8.10's final round-by-round scoreboard needs. Only one production constructor (`assignTeam.ts`); the rest were test/fixture literals (typecheck enumerated all of them).
- **Reconnect-safe scoreboard:** the client `Scoreboard` surface derives its render from `session.teams` (authoritative `SESSION_STATE`), so a reconnect/late-join during between-rounds re-renders the standings without depending on the one-shot `SCOREBOARD` event. The `scoreboard` store field (set by the binding) is the explicit signal/corroboration but is not required by the surface.
- **Rotation advance / cancel restore:** `openPreparation` advances every team's `currentDefuserIndex` by +1 ONLY on the between-rounds→preparation path (round 1 from lobby stays at index 0); `cancelPreparation` derives the originating phase from `roundNumber` (≥2 ⟺ between-rounds) and reverses both the roundNumber increment and the index advance, so open∘cancel is the identity (tested). The roundNumber-derivation invariant (lobby starts at 0) is documented; flagged for Story 8.8 (retry) reconciliation.
- **Lobby role-pick decision (deferred 8.3 item):** ratified option (c) — rotation is the sole defuser authority; the lobby `defuser`/`expert` pick is participant-vs-spectator only. No behavioural change (current behaviour already IS (c)); copy reviewed, no change needed.
- **Two NEW V1 deferrals recorded in `deferred-work.md`:** (1) the LAST team's 2–3s resolution-banner hold is cut short by the immediate scoreboard route (server must not block on client cinematics); (2) per-round defused/failed iconography is not in the preview (no per-round outcome history stored — 8.10 should add it).
- **Validation:** `pnpm typecheck` clean (the project quality gate — husky pre-commit runs `tsc --noEmit`, no ESLint configured). Full suite green: shared 136, client 289 (incl. new `Scoreboard.test.tsx` + extended scoreboard-binding tests), server 386 (incl. new `buildScoreboard.test.ts` + extended `resolveRound`/`openPreparation`/`cancelPreparation`/handler/scheduler tests) = **811 tests**.
- **Human verification: DONE 2026-06-19** (Task 10). Verified live on the Docker stack with the TD-5 bot swarm supplying two teams of rotating defusers; Jay observed "everything works as expected" across the full between-round / scoreboard / rotation / reconnect flow. The deferral (2026-06-17) is now resolved.

### File List

**Shared**
- `packages/shared/src/types/session.ts` — added `roundTimesMs: number[]` to `TeamState` (per-round breakdown; documented `cumulativeTimeMs === sum(roundTimesMs)` invariant).

**Server**
- `apps/server/src/round/buildScoreboard.ts` — NEW: pure `buildScoreboard(session)` → `ScoreboardPayload` projection (provisional leader = lowest cumulative).
- `apps/server/src/round/__tests__/buildScoreboard.test.ts` — NEW: projection / leader / tie / unplayed / absent-team coverage.
- `apps/server/src/round/resolveRound.ts` — all-teams-resolved gate replacing the first-team flip; appends `roundTimesMs`; on last team broadcasts `SESSION_STATE` + emits `SCOREBOARD` to the session room.
- `apps/server/src/round/__tests__/resolveRound.test.ts` — extended: roundTimesMs assertions; between-rounds emissions; concurrent two-team gate-fires-once + first-team-stays-active tests; literal `roundTimesMs` initializers.
- `apps/server/src/session/openPreparation.ts` — advance each team's `currentDefuserIndex` by +1 on the between-rounds path only.
- `apps/server/src/session/__tests__/openPreparation.test.ts` — extended: rotation-advance (between-rounds) + no-advance (lobby) tests.
- `apps/server/src/session/cancelPreparation.ts` — restore originating phase via roundNumber derivation; reverse the rotation advance on the between-rounds path.
- `apps/server/src/session/__tests__/cancelPreparation.test.ts` — extended: between-rounds restore + open∘cancel identity tests.
- `apps/server/src/session/assignTeam.ts` — initialize `roundTimesMs: []` in the `TeamState` constructor.
- `apps/server/src/session/__tests__/assignTeam.test.ts`, `removePlayerFromSession.test.ts` — `roundTimesMs` in TeamState literals/expectations.
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — `roundTimesMs` in literals; updated the expiry integration test for the all-resolved gate (A stays active, B completes → between-rounds + SCOREBOARD).
- `apps/server/src/timer/__tests__/timerScheduler.test.ts` — `roundTimesMs` literal; updated the single-team expiry emit assertion for the between-rounds entry.

**Client**
- `apps/client/src/store/gameStore.ts` — `scoreboard: ScoreboardPayload | null` + `setScoreboard`; cleared on `setBomb` (new round) and `clearSession`.
- `apps/client/src/net/bindServerEvents.ts` — `onScoreboard` now drives `setScoreboard` (was a stub); off()-symmetry preserved.
- `apps/client/src/ui/Scoreboard.tsx` — NEW: between-rounds scoreboard preview surface (DOM); derives standings from `session.teams`; facilitator "Start next round" (ConfirmButton → `PREPARATION_OPEN`) + advance-error banner; non-facilitator standby line.
- `apps/client/src/ui/index.ts` — export `Scoreboard`.
- `apps/client/src/App.tsx` — route `session.status === 'between-rounds'` → `<Scoreboard/>` (was a Lobby fallthrough).
- `apps/client/src/ui/copy.ts` — between-rounds/scoreboard copy; re-scoped the `BETWEEN_ROUNDS_PLACEHOLDER` comment (no longer terminal).
- `apps/client/src/ui/__tests__/Scoreboard.test.tsx` — NEW: standings render (reconnect-safe), provisional leader, facilitator advance emits PREPARATION_OPEN, non-facilitator standby, advance-error alert.
- `apps/client/src/net/__tests__/resolutionBinding.test.ts` — extended: SCOREBOARD sets `scoreboard`; new-round clears it.
- `apps/client/src/test/fixtures.ts`, `apps/client/src/ui/__tests__/rotation.test.ts` — `roundTimesMs` in TeamState fixtures/literals.

**Docs**
- `_agent_docs/implementation-artifacts/deferred-work.md` — marked 4 items RESOLVED by 8.6 (8.5 banner-strand/interim-terminal/test-gap; 8.3 cancelPreparation-phase; 8.3 lobby-role-pick); added 2 new 8.6 deferrals (last-team hold cut short; per-round outcome iconography).

## Change Log

| Date       | Change                                                                 |
| ---------- | --------------------------------------------------------------------- |
| 2026-06-16 | Story drafted (gds-create-story). Status → ready-for-dev.             |
| 2026-06-16 | Story 8.6 implemented (gds-dev-story): all-teams-resolved between-rounds gate in `resolveRound` (replaces 8.5's first-team flip; broadcasts SESSION_STATE + SCOREBOARD on the last team), `TeamState.roundTimesMs` per-round history, pure `buildScoreboard`, rotation advance in `openPreparation` + inverse restore in `cancelPreparation`, reconnect-safe client `<Scoreboard/>` surface + binding. Resolved 4 deferred items, recorded 2 new. 811 tests green; `tsc --noEmit` clean. Status → review (human verification pending, Task 10). |
| 2026-06-16 | Code review (gds-code-review): 3 adversarial layers. 1 patch (missing Task-9 handler-integration tests), 3 deferred, 3 dismissed. No Critical/High production defects; the between-rounds gate, rotation inverse, and reconnect-safe surface verified against spec. |

## Review Findings

_Code review 2026-06-16 (gds-code-review: Blind Hunter + Edge Case Hunter + Acceptance Auditor). The all-teams-resolved gate (AC-1/5), rotation advance/inverse (AC-3/4), and reconnect-safe scoreboard (AC-2) were verified correct against the spec. No Critical/High/Medium production defects in the change set._

### Patch

- [x] [Review][Patch] **RESOLVED.** Task 9 handler-integration scenarios for AC-3 were ticked `[x]` but not actually exercised — added (a) `non-facilitator advance IN between-rounds → NOT_FACILITATOR, no broadcast, store byte-identical` (authority gate fires before the phase transition) and (b) `between-rounds advance → ROUND_START commits the NEXT rotation Defuser (AC-3 end-to-end)` (two-player relay on Team A; advance bumps `currentDefuserIndex` 0→1; `ROUND_START` commits `relayOrder[1]`). Both green; `tsc --noEmit` clean. [apps/server/src/handlers/__tests__/sessionHandlers.test.ts]

### Deferred

- [x] [Review][Defer] Between-rounds gate conflates "timer key gone" with "team resolved" [apps/server/src/round/resolveRound.ts:150-159] — deferred, latent. The "last team to resolve" check treats any participating team whose live-timer key is absent as resolved. If a key is lost for any reason *other* than resolution (the documented crash window between `del` and persist at `resolveRound.ts:96-119`, or a future Story 8.7 pause/disconnect that deletes a key), the current team's resolution flips to `'between-rounds'` with that team's round permanently unrecorded — no error. Sound in single-process V1; revisit when 8.7 lands.
- [x] [Review][Defer] `cancelPreparation` phase/index inverse is derived, not recorded [apps/server/src/session/cancelPreparation.ts] — deferred, acknowledged in-code. Originating phase is inferred from `roundNumber >= 2` and the index reversal is a blind `−1` on whatever teams exist at cancel time, rather than a stored "opened-from" marker. Fragile vs Story 8.8 retry (reused `roundNumber`) and any future path that changes the team set between open and cancel (could drive a fresh index negative — tolerated by `startRound`'s modulo, but the open∘cancel identity silently breaks). Already flagged for 8.8 reconciliation.
- [x] [Review][Defer] `Scoreboard` degenerate-team-state UX [apps/client/src/ui/Scoreboard.tsx] — deferred, cosmetic. An unplayed team (`roundTimesMs: []`) renders a "Total 0:00" card that reads as fastest; a single-team session shows a "LEADING" badge with no opponent; an empty `session.teams` at `'between-rounds'` shows a blank board with no fallback copy. None reachable in the normal two-team flow; add empty/zero-round-state copy when these states become reachable.
