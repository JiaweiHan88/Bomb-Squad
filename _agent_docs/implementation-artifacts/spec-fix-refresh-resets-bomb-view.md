---
title: 'Fix: refresh during active defusal resets bomb view to 6 empty placeholders'
type: 'bugfix'
created: '2026-06-20'
status: 'done'
baseline_commit: 'b536b0148a179fdc0749212811b2b3d67c1e52d6'
context: ['{project-root}/_agent_docs/project-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a defuser refreshes the browser during an *active* round, the bomb view rehydrates to the 6 dev placeholder modules instead of the live bomb. The reattaching socket is restored to the session room and re-sent `SESSION_STATE`, but it is never re-joined to its team room and never re-sent `BOMB_INIT`/`TIMER_UPDATE` — so the client's `bomb` stays `null` and `BombScene` falls back to `DEV_PLACEHOLDER_MODULES`.

**Approach:** Extend the server's reattach restore so that, when the session is mid-round (`status === 'active'`) and the reconnecting player has a team, the socket is re-joined to its team room and unicast the current bomb snapshot (`BOMB_INIT`) plus the current timer (`TIMER_UPDATE`) from Redis. No client changes — the existing `BOMB_INIT`/`TIMER_UPDATE` handlers already rehydrate the store.

## Boundaries & Constraints

**Always:** Replay is read-only — read `bombKey`/`timerKey` from Redis and unicast to the reconnecting socket only (`socket.emit`, never broadcast); no state writes, no reducer calls. Reuse existing `BOMB_INIT`/`TIMER_UPDATE` events and `teamRoom()` helper. Self-guarded: a missing bomb/timer key must not throw into the connection callback. Resolve team via the durable `playerId` (`snapshot.players[playerId].teamId`), never `socket.id`.

**Ask First:** Introducing any NEW socket event (e.g. a dedicated `BOMB_SNAPSHOT`) instead of re-emitting `BOMB_INIT`.

**Never:** Do not run the timer on the client or recompute remaining time client-side. Do not change lobby reattach behavior. Do not implement broader Epic 8 mid-round sync beyond bomb+timer replay. Do not mutate `SessionState`/bomb/timer.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Refresh mid-round, player on a team | `status==='active'`, `players[playerId].teamId` set, bomb+timer keys present | Socket re-joins `teamRoom`; receives unicast `BOMB_INIT` (live bomb) + `TIMER_UPDATE` (live timer) | N/A |
| Refresh mid-round, no team assigned | `status==='active'`, `teamId` undefined | No team join, no bomb replay; `SESSION_STATE` still sent | N/A |
| Refresh in lobby/preparation | `status!=='active'` | Unchanged behavior (existing lobby restore path) | N/A |
| Bomb/timer key missing or evicted | `status==='active'`, `bombKey`/`timerKey` null | Skip that emit; still join room + send `SESSION_STATE`; no throw | Guarded, logged |

</frozen-after-approval>

## Code Map

- `apps/server/src/handlers/sessionHandlers.ts` -- `restoreReattachedSocket()` (~L369-428): the `if (!restored)` tail runs for active reconnects; add team-room join + bomb/timer replay here. Mirror the ROUND_START emit at L1100-1116. `teamRoom()` at L99, `timerKey` already imported (L12); add `bombKey` to that import.
- `apps/server/src/state/keys.ts` -- `bombKey(sessionId, teamId)` (L9), `timerKey` (L12) — Redis snapshot keys.
- `apps/client/src/scenes/BombScene.tsx` (~L140) -- reads `s.bomb?.modules ?? DEV_PLACEHOLDER_MODULES`; the symptom surface, no change needed.
- `apps/client/src/net/bindServerEvents.ts` (~L108) -- `socket.on('BOMB_INIT', setBomb)` + `TIMER_UPDATE` handler already rehydrate the store; no change needed.
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` -- existing reattach coverage to extend.

## Tasks & Acceptance

**Execution:**
- [x] `apps/server/src/handlers/sessionHandlers.ts` -- in `restoreReattachedSocket`, after the snapshot is sent (or within the active branch), when `snapshot.status === 'active'` resolve `teamId = snapshot.players[playerId]?.teamId`; if defined, `await socket.join(teamRoom(sessionId, teamId))`, then read `bombKey`/`timerKey` from Redis and `socket.emit('BOMB_INIT', bomb)` / `socket.emit('TIMER_UPDATE', timer)` when each is non-null. Add `bombKey` to the keys import. Keep all of it inside the existing try/catch.
- [x] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` -- add integration tests covering the I/O matrix: active reattach re-joins team room and receives `BOMB_INIT`+`TIMER_UPDATE`; no-team active reattach gets neither; missing bomb/timer key does not throw and still restores; lobby reattach unchanged.

**Acceptance Criteria:**
- Given an active round and a teamed defuser, when their socket reattaches (refresh), then the server re-joins them to their team room and unicasts the current `BOMB_INIT` and `TIMER_UPDATE`, and the client renders the live bomb (not placeholders).
- Given a mid-round reattach where the bomb or timer Redis key is absent, when restore runs, then the connection callback does not throw and `SESSION_STATE` is still delivered.
- Given a lobby/preparation reattach, when restore runs, then behavior is unchanged (no team join, no bomb replay).
- **Jay verifies interactively:** with a live session mid-round, refresh the defuser browser and confirm the real bomb + running timer reappear (no 6 empty placeholders). Record the observed result in Completion Notes.

## Spec Change Log

- **2026-06-20 — review patch (edge-case hunter, HIGH).** Finding: in a multi-team session a team that defuses/explodes/times-out has its timer key deleted by `resolveRound` but its bomb key kept, while the session stays `active` for the still-playing team. The initial fix replayed `BOMB_INIT` unconditionally, so a resolved-team refresh would replay a stale playable bomb and (via the client's `setBomb`, which clears `resolution`/`scoreboard`) wipe the result banner. Amendment: gate the bomb+timer replay on the timer key still being present (live timer ⟺ team still playing this round). Avoids the known-bad state of a banner-wiped, interactive-looking dead bomb. Replaying the resolution banner itself on reattach is out of scope (Epic 8 / Story 8-7) — deferred. KEEP: the timer-presence gate is the correct liveness signal; AC1 (live team) and the missing-key matrix row are unchanged and still covered. Added a regression test (resolved team: bomb kept, timer gone → replays neither).

## Design Notes

The fix deliberately reuses `BOMB_INIT` rather than minting a new snapshot event — the client handler (`setBomb`) is idempotent and a re-emit cleanly rehydrates the store. The replay must happen *after* `socket.join(teamRoom)` only for ordering clarity; since the emits are unicast to this socket, room membership isn't strictly required for delivery, but the join is needed so subsequent team-scoped `MODULE_UPDATE`/`TIMER_UPDATE` broadcasts reach the reconnected client (otherwise it goes stale on the next interaction). Read the live timer straight from `timerKey` — the scheduler treats Redis as authoritative, so no recomputation is needed. The timer is read *first* and gates the bomb replay: `resolveRound` deletes a resolved team's timer key but leaves the bomb key, so a present timer is the liveness signal that this team is still playing — without the gate a resolved-team refresh would replay a stale playable bomb and wipe the client's result banner.

## Verification

**Commands:**
- `pnpm --filter @bomb-squad/server test sessionHandlers` -- expected: new reattach tests pass.
- `pnpm --filter @bomb-squad/server exec tsc --noEmit` -- expected: zero errors.

**Manual checks:**
- Mid-round, refresh the defuser browser: live modules + running timer render; team-scoped `MODULE_UPDATE` after a subsequent interaction still updates the refreshed client.

## Suggested Review Order

**The fix — mid-round replay on reattach**

- Entry point: the new active-round branch in the reattach restore path.
  [`sessionHandlers.ts:443`](../../apps/server/src/handlers/sessionHandlers.ts#L443)

- The timer-gate ordering (read timer first; it gates the bomb replay) — the review-patch core.
  [`sessionHandlers.ts:450`](../../apps/server/src/handlers/sessionHandlers.ts#L450)

- Supporting imports: `BombState`/`TimerState` + `bombKey`.
  [`sessionHandlers.ts:10`](../../apps/server/src/handlers/sessionHandlers.ts#L10)

**Tests**

- Race-safe multi-event capture helper (listeners bound pre-handshake).
  [`testSocketServer.ts:215`](../../apps/server/src/handlers/__tests__/testSocketServer.ts#L215)

- The four I/O-matrix scenarios + the resolved-team regression test.
  [`sessionHandlers.test.ts:1949`](../../apps/server/src/handlers/__tests__/sessionHandlers.test.ts#L1949)

## Review Findings (code review 2026-06-20)

### Patch (all applied 2026-06-20 — `tsc` clean, full server suite 433/433)
- [x] [Review][Patch] Timer-present / bomb-absent half-replay [`sessionHandlers.ts`] — (blind+edge+auditor; was decision → **both-or-neither**) Both emits now gated on the bomb being present (read timer→bomb; replay both or neither); a live timer with no bomb no longer leaves the client ticking over DEV placeholders. Aligns with AC1. Added `(bomb✗ timer✓)` regression test.
- [x] [Review][Patch] Stale pre-await `snapshot` for the replay decision [`sessionHandlers.ts`] — (blind+edge) Replay now decides on a `latest` state var updated from the restored/`fresh` read, so a team assignment or round resolution landing across the restore awaits is observed.
- [x] [Review][Patch] Replay Redis reads not isolated [`sessionHandlers.ts`] — (edge) Wrapped the bomb/timer reads in their own try/catch; a corrupt key now skips just the replay (logged) without mislabeling the already-emitted SESSION_STATE/identity restore as failed.
- [x] [Review][Patch] Test helper leaves a half-init client on `connect_error` [`testSocketServer.ts`] — (blind) Handshake failure now disconnects the socket before propagating, so it doesn't linger in `clients` with dangling listeners.

### Deferred
- [x] [Review][Defer] Paused-timer replay sends no `PAUSED` signal [`apps/server/src/handlers/sessionHandlers.ts:447-451`] — deferred, depends on unshipped pause/resume (Story 8.7). A refresh during a paused round would replay a frozen `TimerState` with no pause flag; latent until pause/resume is wired.

## Completion Notes

- **Root cause:** `restoreReattachedSocket` only restored lobby-phase reconnects; mid-round reattaches were re-sent `SESSION_STATE` but never re-joined to the team room nor re-sent the bomb, so the client's `bomb` stayed `null` and `BombScene` rendered `DEV_PLACEHOLDER_MODULES` (the 6 empty placeholders).
- **Fix:** active-round replay block in `restoreReattachedSocket` — re-join the team room and unicast `BOMB_INIT` + `TIMER_UPDATE` from Redis, gated on the timer key still being live (resolved-team guard from the review patch).
- **Automated verification — DONE.** `tsc --noEmit` clean; full server suite 432/432 green (5 new tests: live replay, no-team, both-keys-absent, resolved-team, lobby-unchanged).
- **Interactive verification (AC "Jay verifies") — OUTSTANDING.** Per [[human-verification-ac-rule]] this is not fully done until Jay refreshes a live mid-round defuser browser and confirms the real bomb + running timer reappear (no 6 placeholders), with the observed result recorded here. Best exercised on the full Docker stack (the bot-swarm harness `[[td-5-player-simulator-test-harness]]` can supply a live round) — the harness gap from [[identity-key-change-needs-a-client-sweep-too]] / [[worktree-fullstack-testing-gap]] means a client-side reattach miss only surfaces interactively.
