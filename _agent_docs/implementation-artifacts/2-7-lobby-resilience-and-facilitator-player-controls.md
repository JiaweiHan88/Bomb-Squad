---
baseline_commit: 782d82e (worktree branch; story 2.6 committed, clean tree at story-creation time)
---

# Story 2.7: Lobby Resilience & Facilitator Player Controls

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator and players,
I want misjoined players removable, refreshed players cleanly handled, and share links that actually let you join,
so that the lobby stays accurate and nobody gets stranded by a refresh or a prefilled link.

## Acceptance Criteria

1. **Facilitator removes a player.** Given the lobby roster, when the Facilitator chooses Remove on a player row and passes a secondary confirm, then a `PLAYER_REMOVE` is accepted **only** from the Facilitator, the target disappears from the roster for all participants, capacity is freed, and the removed client is returned to the landing screen with a human-readable notice.

2. **Removal authority + self-target guard.** Given a non-Facilitator socket, or the Facilitator targeting themselves, when it attempts `PLAYER_REMOVE`, then the server rejects it with a typed authority/validation error (`NOT_FACILITATOR` / `INVALID_REMOVAL`) and **no** state changes.

3. **Lobby disconnect cleanup.** Given a joined player in the **lobby** phase, when their socket disconnects (refresh, tab close, network drop), then their roster entry is removed and the new roster is broadcast, so ghost entries never persist nor count toward capacity. *(Lobby phase only — `preparation`/`active`/`between-rounds`/`ended` disconnects are untouched here; mid-round disconnect/pause is Epic 8 / FR13.)*

4. **Refresh re-attaches cleanly.** Given a player (or the Facilitator) who refreshed during the lobby, when their client reconnects, then it re-attaches to the **same** durable player record — same `playerId`, same role/seat — with **no** duplicate roster entry and **no** capacity error caused by their own stale entry.

5. **Share-link Join button.** Given a join link with `?join=` prefilling a complete 6-character code, when the cells are full but no submitting keystroke occurred, then a visible **Join** button is shown that submits once display name and role are set. Typing the 6th character continues to auto-submit as before (Story 2.3's AC is preserved — the button is a complementary affordance, not a replacement).

6. **Durable identity primitive (the load-bearing one).** Given any of the paths above, when a participant's identity is resolved anywhere in the system, then it resolves against a **durable player id minted at first join/create and decoupled from the ephemeral `socket.id`** — not the rotating socket id. A reconnecting client proves ownership of that id with a **secret reattach token** (never broadcast), presented via the Socket.IO handshake `auth` and resolved server-side into `socket.data.playerId`. This durable id is the **system-wide identity primitive** every authority gate resolves against (facilitator / defuser / expert), and the same id Story 4.7's `MODULE_INTERACT` gate and Story 8.7's mid-round restore will resolve against. The deferred `socket.id`-as-identity items from the 2.2 / 2.3 / 2.4 / 5.2 / 8.3 / 4.7 reviews are marked **resolved** by this story.

## Tasks / Subtasks

- [x] **Task 1 — Shared contract: durable-identity transport + removal events (AC: 1, 2, 6)**
  - [x] **Decision locked (Jay, via create-story): secret reattach token, presented via Socket.IO handshake `auth`; client persistence in `sessionStorage` keyed by `sessionId`.** Carry this verbatim — do not re-litigate or substitute a client-minted id.
  - [x] In `packages/shared/src/events/payloads.ts` add:
    - `SessionIdentityPayload { sessionId: string; playerId: string; reattachToken: string }` — the private identity packet the server sends to exactly one socket (the owner) on create/join. **Never** part of `SessionState` (which is broadcast to the whole room) — the token is a secret.
    - `PlayerRemovePayload { playerId: string }` — the durable id of the player to remove (Facilitator-authored).
    - `SessionRemovedPayload { message: string }` — the human-readable notice sent to a removed client.
  - [x] In `packages/shared/src/events/server-to-client.ts` add `SESSION_IDENTITY: (payload: SessionIdentityPayload) => void` and `SESSION_REMOVED: (payload: SessionRemovedPayload) => void`.
  - [x] In `packages/shared/src/events/client-to-server.ts` add `PLAYER_REMOVE: (payload: PlayerRemovePayload) => void` — **no ack** (success = `SESSION_STATE` broadcast + `SESSION_REMOVED` to the target; failure = typed `ERROR` to the caller), matching the established no-ack mutation convention (`SESSION_JOIN`, `TEAM_ASSIGN`).
  - [x] **`PlayerInfo` is unchanged in shape** — `playerId` already exists; this story only changes its *provenance* (a minted UUID, not `socket.id`). Do **not** add a `reattachToken`/`token` field to `PlayerInfo` — that would leak the secret into the broadcast roster (the entire reason AC 6 needs a separate packet).
  - [x] Export the new payload types from `packages/shared/src/events/index.ts` (and the barrel) so client + server import them typed. No reducer/logic here — types only.

- [x] **Task 2 — Server: mint the durable identity + reattach record (AC: 4, 6)**
  - [x] **The identity model:** at first **create** (facilitator) and first **join**, the server mints a durable `playerId = randomUUID()` and a secret `reattachToken = randomUUID()`. The `playerId` is the public roster/authority key (goes into `players`); the `reattachToken` is private (returned only to the owning socket via `SESSION_IDENTITY`, and stored server-side as the reattach credential).
  - [x] Add a key builder to `apps/server/src/state/keys.ts`: `reattachKey = (sessionId, token) => \`reattach:${sessionId}:${token}\``. The stored value is a small JSON **reattach record** `{ playerId, displayName, role }` — the durable identity plus the last-known profile needed to re-materialise the roster entry on reconnect. (Keep it token-gated and out of any broadcast.) O(1), single-key; no scans.
  - [x] **`SESSION_CREATE` (`sessionHandlers.ts` ~258–310):** replace `facilitatorId: socket.id` (line 292) with a minted `playerId`. `createSessionState` already takes `facilitatorId` as the `playerId` — pass the minted UUID instead of `socket.id` (no change to `createSession.ts` itself; it stays pure and id-agnostic — see Task 3 for the one-line doc-comment touch). After persisting the session, also `setJSON(reattachKey(sessionId, token), { playerId, displayName: 'Facilitator', role: 'facilitator' })`, stamp `socket.data.playerId = playerId`, and emit `socket.emit('SESSION_IDENTITY', { sessionId, playerId, reattachToken })` to the creator only (before/with the existing `SESSION_STATE` broadcast). Keep the CREATE ack `{ sessionId, joinCode }` unchanged.
  - [x] **`SESSION_JOIN` (the 2.6 `updateJSON` block, ~314–436):** the joiner's durable id is `socket.data.playerId` if already resolved by the reconnect middleware (Task 6), otherwise a freshly minted `playerId`. Pass **that** id (not `socket.id`) to `addPlayerToSession` and as the `players` key. On a successful first add: `setJSON(reattachKey(...), { playerId, displayName, role })`, stamp `socket.data.playerId`, and `socket.emit('SESSION_IDENTITY', …)` to the joiner only. The idempotent-rejoin guards (`current.players[<id>]`) must key on the **durable id**, not `socket.id` — this is what makes a reconnecting joiner converge instead of duplicating (AC 4). Keep AR15 (never log the join code or the token).
  - [x] **AR15 extension:** the `reattachToken` is a secret like the join code — it must appear in **no** log line on any path. Do not log the `SESSION_IDENTITY` payload.
  - [x] Unit-test the reattach record + identity mint in `sessionHandlers.test.ts` (see Task 8): create → asserts a `reattach:*` record exists and a `SESSION_IDENTITY` reached only the creator; join → same for the joiner; the token never appears in the broadcast `SessionState`.

- [x] **Task 3 — Server: switch every authority gate from `socket.id` to `socket.data.playerId` (AC: 6)**
  - [x] **This is the codebase-wide sweep the widened scope owns.** Stamping `socket.data.playerId` (Task 2/6) is inert unless every gate that currently keys on `socket.id` switches to it — and leaving any one on `socket.id` *breaks* it (once `players` is keyed by durable id, `players[socket.id]` is always `undefined`). Switch all of them in this story:
    - `sessionHandlers.ts`: the SESSION_JOIN rejoin guards (≈358, 378) and the facilitator-authority checks for `TEAM_ASSIGN` (≈480), `PREPARATION_OPEN` (≈573), `PREPARATION_CANCEL` (≈649), `ROUND_START` (≈711) — every `state.players[socket.id]` → `state.players[socket.data.playerId ?? '']`. The `playerId: socket.id` log fields (≈434) → `socket.data.playerId`.
    - `manualHandlers.ts:90` (Expert gate `state.players[socket.id]?.role !== 'expert'`) and `:94` (`playerId: socket.id`) → `socket.data.playerId`. Resolves `deferred-work.md:92`.
    - `moduleHandlers.ts:115` (`session.players[socket.id]`, the Defuser gate) → `session.players[socket.data.playerId ?? '']`. This is the 4.7 authority dependency the retro named — it now resolves against the durable id.
  - [x] **Guard for the unresolved case:** a socket that never created/joined (or whose token didn't resolve) has `socket.data.playerId === undefined`. `players[undefined as any]` must not throw or accidentally match — use `socket.data.playerId !== undefined && players[socket.data.playerId]?.…`. The existing `NOT_IN_SESSION` / authority refusals must still fire for such sockets (preserve current behaviour for never-joined sockets — there are existing tests for this).
  - [x] `createSession.ts`: no logic change (it already treats `facilitatorId` as an opaque id). Update only its doc comment (lines ~16–21, 30) — `facilitatorId` is now "the durable minted player id" rather than "socket id of the creating client". Keep `addPlayerToSession`/`assignPlayerToTeam` untouched (they're already id-agnostic; `relayOrder` now holds durable ids, which only *improves* the `relayOrder`↔`players` integrity tracked in `deferred-work.md:72`).
  - [x] **Extend `SessionSocketData`** (`sessionHandlers.ts:32`) with `playerId?: string` (a server-assigned pointer, never authority by itself — the same posture as `sessionId`). Document it the same way.
  - [x] Update the existing handler tests that seed `facilitatorId: 'sock-fac'` and drive authority via `socket.id`: they must now stamp/seed the durable id and exercise the gate through `socket.data.playerId`. See Task 8 — this is the largest test-migration surface; budget for it.

- [x] **Task 4 — Server: lobby-phase disconnect cleanup (AC: 3)**
  - [x] There is **no** `disconnect` handler anywhere today (`grep` confirms). Add one inside `registerSessionHandlers`' `io.on('connection', …)` block: `socket.on('disconnect', async () => { … })`.
  - [x] Resolve the session from `socket.data.sessionId` and the player from `socket.data.playerId`; if either is unset, no-op (a socket that never joined). Load the session; **only if `status === 'lobby'`** remove the player. Any other status → no-op (Epic 8 owns mid-round disconnect — explicitly out of scope; leave a one-line pointer comment).
  - [x] Write a **pure reducer** `removePlayerFromSession(state, playerId): SessionState` in `apps/server/src/session/` (mirrors `addPlayerToSession`: no I/O, no clock; returns same reference if the id is absent). It must remove the player from `players` **and** prune the id from any team's `relayOrder` (and drop a team that becomes empty, matching `assignTeam.ts`'s emptied-team deletion) so no ghost `relayOrder` entry survives. Pure + idempotent.
  - [x] Perform the removal **race-safely** with the Story 2.6 `updateJSON` primitive (this is exactly the "next customer" 2.6 named): `updateJSON(sessionKey(sessionId), current => current && current.status === 'lobby' && current.players[playerId] ? { commit: true, value: removePlayerFromSession(current, playerId), result: 'removed' } : { commit: false, result: 'noop' })`. On `'removed'`, broadcast the new `SESSION_STATE` to the room. **Keep the reattach record** (`reattach:*`) so a refresh re-attaches (Task 6) — disconnect frees the *roster slot*, not the identity.
  - [x] Wrap in try/catch; a cleanup failure must log (`deps.log.error`) and never throw out of the `disconnect` handler. AR15: never log the join code or token.

- [x] **Task 5 — Server: `PLAYER_REMOVE` handler (AC: 1, 2)**
  - [x] New `socket.on('PLAYER_REMOVE', async (payload) => { … })` in `registerSessionHandlers`, modelled on the `TEAM_ASSIGN` authority pattern (the reference for "load → facilitator-gate → mutate → persist → broadcast").
  - [x] Parse payload (`parsePlayerRemovePayload` — bound the `playerId` string 1–128 like `parseTeamAssignPayload`), `INVALID_PAYLOAD` on failure.
  - [x] Authority: resolve session from `socket.data.sessionId`; `NOT_IN_SESSION` if unset; load state; the caller is the Facilitator iff `state.players[socket.data.playerId]?.role === 'facilitator'` → else `NOT_FACILITATOR`, no writes (assert byte-identical store in tests).
  - [x] **Self-target guard (AC 2):** `payload.playerId === socket.data.playerId` → `INVALID_REMOVAL` ("You can't remove yourself."), no writes. Also `INVALID_REMOVAL` if the target isn't in `players`.
  - [x] Remove the target race-safely via `updateJSON` + `removePlayerFromSession` (reuse Task 4's reducer). On commit: **delete the target's reattach record** so a kicked player **cannot** reattach (unlike a disconnect — a kick is permanent for this session; the kicked client may start over as a brand-new join). Then broadcast `SESSION_STATE` to the room, and emit `SESSION_REMOVED { message: "The facilitator removed you from the session." }` to the **removed** player's live socket(s) — resolve them via the server room or a socketsByPlayer lookup; if the removed player is currently disconnected, the roster removal + reattach-record deletion is sufficient.
  - [x] `PLAYER_REMOVE_FAILED` on a thrown/`updateJSON` retry-limit error (typed `ERROR` to the facilitator, no broadcast). AR15 holds.

- [x] **Task 6 — Server + client: reconnect/reattach via handshake auth (AC: 4, 6)**
  - [x] **Server middleware** (`io.use`, in `index.ts` after the existing readiness gate): read `socket.handshake.auth` as `{ sessionId?: string; reattachToken?: string }`. If both present, `getJSON(reattachKey(sessionId, reattachToken))`; on a hit, stamp `socket.data.sessionId = sessionId` and `socket.data.playerId = record.playerId`. On a miss or absent auth, leave them unset (a fresh client) — **never reject** the handshake for a bad/missing token (it's optional identity, not access control; the readiness gate already owns access). Order matters: readiness gate first (so a Redis-down server rejects before we read Redis), identity second.
  - [x] **Server connection-time restore:** in `io.on('connection')`, if `socket.data.playerId` and `socket.data.sessionId` are set (i.e. a resolved reattach), restore the player: load the session; (a) if the player is **still** in `players` → re-`join(sessionRoom)` and re-emit `SESSION_STATE` to this socket (converge, like idempotent rejoin — no roster write); (b) if **absent and `status === 'lobby'`** → re-add via `updateJSON` from the reattach record `{ playerId, displayName, role }` (same durable id, so no duplicate; frees-then-refills the slot, so no false capacity error — AC 4), then broadcast; (c) if absent and non-lobby → emit the current `SESSION_STATE` if the session exists, else nothing (Epic 8 territory). Re-emit `SESSION_IDENTITY` (token unchanged) so the client refreshes its store. This server-driven restore handles **both** the Facilitator (who has no `?join=` path) and joiners uniformly — the client does **not** re-emit `SESSION_JOIN`.
  - [x] **Client identity store** (`apps/client/src/net/`): a small module (e.g. `identity.ts`) that reads/writes `sessionStorage['bombsquad:identity']` (or per-`sessionId` key) holding `{ sessionId, playerId, reattachToken }`. On `SESSION_IDENTITY`, persist it. Expose `getIdentity()` for the "You" tag and `setSocketAuth()` to push `{ sessionId, reattachToken }` onto `socket.auth` **before connect** so Socket.IO replays it on the initial connect and every reconnect.
  - [x] **Client wiring** (`net/socket.ts` + the App bootstrap / `bindServerEvents.ts`): before `socket.connect()`, if a stored identity exists, set `socket.auth = { sessionId, reattachToken }`. Bind `SESSION_IDENTITY` → persist. On `SESSION_REMOVED` → clear the stored identity, clear the session store (drop to Landing), and surface the notice. Socket.IO auto-reconnect already replays `socket.auth`, so a refresh (full reload) re-reads `sessionStorage`, sets auth, connects, and the server restore re-mounts Lobby.
  - [x] **"You" tag fix** (`Lobby.tsx:113-114,171`): `selfId` must come from `getIdentity()?.playerId`, **not** `getSocket().id` (which is now the rotating socket id and no longer a roster key). Same for the `isFacilitator` derivation (`Lobby.tsx:114`).

- [x] **Task 7 — Client: Remove control + share-link Join button (AC: 1, 5)**
  - [x] **Remove control (`Lobby.tsx`):** on each non-facilitator player row, when the viewer `isFacilitator`, render a **Remove** button. Clicking it requires a **secondary confirm** (an inline two-step "Remove? / Confirm" affordance or a small confirm dialog — presentation state in `useState`, no new lib) before emitting `getSocket().emit('PLAYER_REMOVE', { playerId: player.playerId })`. Never show Remove on the facilitator's own row (self-removal is server-guarded too). Accessible labels (`aria-label={\`Remove ${player.displayName}\`}`), matching the existing row a11y.
  - [x] **Removed notice:** when this client receives `SESSION_REMOVED`, route to Landing and render the message in the existing error/notice line (reuse Landing's `settleFailure`-style surface; the message is server-authored and human-readable — render verbatim).
  - [x] **Share-link Join button (`Landing.tsx`):** AC 5 is the gap where `?join=` prefilled a complete code but no keystroke submitted (`applyPasteAt` fills cells without firing `tryJoin`). Render a visible **Join** button **when `isCodeComplete(cells)` is true** (covers the prefill case and a paste); clicking calls the existing `tryJoin(cells, name, role)` (which already gates on name+role and shows `JOIN_INCOMPLETE`). Typing the 6th char still auto-submits via `applyUpdate(update, /*submit*/ true)` — **do not remove or alter that path** (Story 2.3's AC). The button is additive. Keep it disabled while `busy`.
  - [x] No change to the join-code auto-submit semantics, the `?join=` prefill effect, or the create/host path beyond what AC 5 adds.

- [x] **Task 8 — Tests (AC: 1–6)**
  - [x] **Server (`sessionHandlers.test.ts`, Jest, strict `afterEach` teardown):**
    - Migrate the existing SESSION_JOIN / TEAM_ASSIGN / PREP / ROUND_START suites to the durable-id model: stamp `socket.data.playerId` (or seed the reattach record + connect with `auth`) and assert authority via the durable id. Keep all existing assertions green (no regressions).
    - **Identity mint:** create → a `reattach:*` record exists, `SESSION_IDENTITY` reached only the creator, the token is absent from the broadcast `SessionState`. Join → same for the joiner.
    - **AC 3 disconnect cleanup:** join a player in lobby, force `socket.disconnect()`, assert the roster entry is gone, the room got a fresh `SESSION_STATE`, capacity is freed, and the `reattach:*` record **survives**. A `status: 'active'` (or preparation/between-rounds) disconnect → roster **unchanged** (out of scope).
    - **AC 1/2 PLAYER_REMOVE:** facilitator removes a joiner → target gone from roster, `SESSION_REMOVED` to the target only, reattach record deleted; non-facilitator → `NOT_FACILITATOR`, store byte-identical; self-target → `INVALID_REMOVAL`, no writes; unknown target → `INVALID_REMOVAL`; `updateJSON` throw → `PLAYER_REMOVE_FAILED`.
    - **AC 4 reattach (headline):** seed a session + reattach record; connect a socket with `handshake.auth = { sessionId, reattachToken }`; assert `socket.data.playerId` resolved, the player converges with **no** duplicate (`Object.keys(players)` unchanged), and the "still-present" vs "cleaned-then-restored" branches both end at one entry with the original `playerId`/role. A bad/absent token → handshake still succeeds, `socket.data.playerId` unset.
    - **`removePlayerFromSession` pure reducer** unit tests (own file under `session/__tests__/`): removes from `players`, prunes `relayOrder`, deletes an emptied team, returns same ref when absent.
    - **AR15:** the join code **and** the reattach token appear in no captured log line across create/join/remove/disconnect/reattach.
  - [x] **Client (Vitest):**
    - `Landing` Join button: a complete prefilled code with no keystroke shows a Join button; clicking with name+role set emits `SESSION_JOIN`; clicking without → `JOIN_INCOMPLETE`, no emit; typing the 6th char still auto-submits (2.3 path intact).
    - `Lobby` Remove: facilitator sees Remove on other rows (not own); the secondary confirm gates the emit; a non-facilitator viewer sees no Remove control. `SESSION_REMOVED` routes to Landing with the notice.
    - identity store: `SESSION_IDENTITY` persists to `sessionStorage`; "You" tag reads `getIdentity().playerId`; `SESSION_REMOVED` clears it.

- [x] **Task 9 — Gates: tests, typecheck, build, live smoke (AC: 1–6)**
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore` (new shared types must flow through client + server).
  - [x] `pnpm -r test` → all green: shared (new payload types compile), server (migrated + new suites), client (new Landing/Lobby/identity tests). Confirm no regression count drop.
  - [x] `pnpm --filter @bomb-squad/client build` → succeeds.
  - [x] **Live smoke against real Redis (document in Completion Notes; reuse the 2.6 throwaway-container + headless `socket.io-client` pattern — `tsx`, no watch):**
    1. **Reattach:** create a session, capture the `SESSION_IDENTITY`, drop the socket, reconnect a new socket with `auth: { sessionId, reattachToken }` → same `playerId` resolved, roster has **one** entry (no dup), facilitator seat retained.
    2. **Disconnect cleanup:** join a 2nd player in lobby, hard-disconnect → `GET session:<id>` roster shrinks by one, capacity freed; the reattach record key still present.
    3. **PLAYER_REMOVE:** facilitator removes the 2nd player → roster shrinks, the removed socket receives `SESSION_REMOVED`, the reattach key is **gone** (kick is permanent); a non-facilitator `PLAYER_REMOVE` → `NOT_FACILITATOR`, roster unchanged.
    4. **AR15:** `grep` server stdout for the join code **and** the reattach token → 0 hits.
  - [x] If a browser pass isn't possible, state exactly what was verified headlessly (the share-link Join button + Remove-confirm UI are the browser-only bits).
  - [x] **Jay verifies interactively (not done until his observed result is in Completion Notes):** in two browsers against the real stack — (a) open a `?join=` share link with a complete code, set name+role, click **Join** → lands in Lobby; (b) as Facilitator, **Remove** a player past the secondary confirm → that player drops to Landing with the notice and the facilitator's roster updates; (c) **refresh** a joined player's tab → they re-appear in the same seat with no duplicate row and the "You" tag intact; (d) refresh the **Facilitator's** tab → they retain the facilitator seat. Record Jay's observed outcome for each.

## Review Findings

_Code review 2026-06-14 (gds-code-review: Blind Hunter + Edge Case Hunter + Acceptance Auditor). 0 decision · 3 patch · 8 deferred · 5 dismissed (D1 resolved → deferred for V1)._

- [x] [Review][Defer] Reattach record can't restore team/seat once the grace window elapses (AC 4 is timing-bounded, not durable) — the `reattach:*` record stores `{ playerId, displayName, role }` only (`session/identity.ts`), never `teamId`/team placement. A disconnect that outlasts `DEFAULT_DISCONNECT_GRACE_MS` (8 s) frees the seat; a later reconnect re-adds via `addPlayerToSession` as an *unassigned* player with the join-time role. **Deferred (Jay, 2026-06-14): V1 lobby scope — the common refresh case is covered within the 8 s grace; durable team-seat reconstruction (persist teamId in the record, refresh on TEAM_ASSIGN) is follow-up work.** [blind+auditor]

- [x] [Review][Patch] Disconnect handler reschedules a grace removal without checking for a live socket on the same `playerId` → an actively reconnected player's seat is freed after the grace (intermittent AC 4 violation) [apps/server/src/handlers/sessionHandlers.ts] — **FIXED 2026-06-14:** disconnect handler now skips scheduling if any other connected socket maps to the same `(sessionId, playerId)`. Regression test added (`sessionHandlers.test.ts` "refresh race…") — verified red without the guard, green with it; full server suite 332 green.
- [x] [Review][Patch] Identity `io.use` is registered before the readiness gate, inverting the spec-mandated order ("readiness first, identity second") [apps/server/src/index.ts] — **FIXED 2026-06-14:** readiness `io.use` now registers before `registerSessionHandlers` so a Redis-down server rejects the handshake before the identity middleware touches Redis.
- [x] [Review][Patch] `RemoveOutcome` reused with `kind: 'removed'` to carry an *added* state in the reattach re-add branch [apps/server/src/handlers/sessionHandlers.ts] — **FIXED 2026-06-14:** added a dedicated `RestoreOutcome` (`restored`/`skipped`); the discriminant now tells the truth.

- [x] [Review][Defer] Reconnecting socket joins the session room before confirming roster membership → a resolved-but-absent non-lobby socket becomes a ghost room member receiving broadcasts [apps/server/src/handlers/sessionHandlers.ts:386] — deferred (Epic 8 owns non-lobby reattach)
- [x] [Review][Defer] `storeReattachRecord` writes the `reattach:*` + `reattachByPlayer:*` pair non-atomically → a lost companion write means PLAYER_REMOVE can't invalidate the token, so a kicked player could reattach [apps/server/src/session/identity.ts storeReattachRecord] — deferred (low-probability hardening)
- [x] [Review][Defer] In-memory `pendingRemovals` Map → a server restart inside the grace window strands the ghost roster entry forever (counts toward capacity) [apps/server/src/handlers/sessionHandlers.ts:444] — deferred (V1, consistent with no-persistence posture)
- [x] [Review][Defer] AC 4 capacity boundary: if the room fills with other joiners during the grace, the refresh re-add no-ops and the reconnecting player gets a snapshot but is never re-added to the roster [apps/server/src/handlers/sessionHandlers.ts:399] — deferred (edge; lobby rarely at cap)
- [x] [Review][Defer] Join-path `storeReattachRecord` failure (after the SESSION_STATE broadcast) routes to the catch → player is rostered + broadcast but identity-less and told the join failed [apps/server/src/handlers/sessionHandlers.ts:~1865] — deferred (low-probability Redis write fail)
- [x] [Review][Defer] `SESSION_REMOVED` notice shares the `setError` surface on Landing → a later connect hint/error can clobber the kick notice before the user reads it [apps/client/src/ui/Landing.tsx] — deferred (Low UX)
- [x] [Review][Defer] Reattach records (`reattach:*`/`reattachByPlayer:*`) have no TTL → tab-close-in-lobby orphans both keys indefinitely [apps/server/src/session/identity.ts] — deferred (consistent with session key's own no-TTL V1 posture)

## Dev Notes

### What this story is — and is not

2.7 closes Epic 2's lobby resilience and, per the Sprint-2 retro (Action Item 2), **owns the durable-identity primitive** the rest of the system depends on. It does **four** user-visible things — Facilitator *Remove*, lobby *disconnect cleanup*, *refresh re-attach*, and a share-link *Join button* — on top of **one** load-bearing infrastructural change: a **durable `playerId` decoupled from `socket.id`**, proven on reconnect by a **secret reattach token**.

It does **not** implement mid-round reattach/resume. A `disconnect` during `preparation`/`active`/`between-rounds`/`ended` is deliberately a no-op here; the pause/resume ceremony (re-send each team's `BOMB_INIT`, re-establish `teamRoom` membership) is **Story 8.7 / FR13**, which builds on the identity 2.7 introduces. [Source: epics.md#Story 2.7 scope note; deferred-work.md:150]

### Decisions locked at story creation (Jay, via create-story)

- **Identity model = secret reattach token.** Server mints a public `playerId` (roster + authority key) and a private `reattachToken` (never broadcast). The client presents the token via Socket.IO handshake `auth` on (re)connect; a server middleware resolves token → `playerId` into `socket.data.playerId`; authority gates read `socket.data.playerId`. Chosen over an id-as-credential / client-minted scheme **because the `playerId` is visible to every participant in the broadcast roster** — if the id were also the credential, any participant could present the Facilitator's id and hijack authority. The token is the secret; the public id is safe to expose.
- **Client persistence = `sessionStorage`, keyed by `sessionId`.** Survives refresh, per-tab, cleared on tab close → matches the lobby-only reconnect AC and gives two tabs distinct identities (no collision). [Decision rationale carried into Task 1/6.]

### The durable-identity design (canonical — implement exactly this)

```
MINT (SESSION_CREATE / first SESSION_JOIN):
  playerId      = randomUUID()        // public; the players[] key + authority key
  reattachToken = randomUUID()        // secret; the reconnect credential
  redis: reattach:{sessionId}:{token} -> { playerId, displayName, role }   // server-side record
  socket.data.playerId = playerId
  socket.emit('SESSION_IDENTITY', { sessionId, playerId, reattachToken })  // to owner ONLY

RECONNECT (handshake):
  client: socket.auth = { sessionId, reattachToken }      // from sessionStorage, before connect
  server io.use (after readiness gate):
     record = GET reattach:{sessionId}:{token}
     if hit -> socket.data.sessionId = sessionId; socket.data.playerId = record.playerId
  server on 'connection' (if resolved):
     still in roster -> join room + re-emit SESSION_STATE (converge, no write)
     absent & lobby   -> updateJSON re-add from record (same id) + broadcast
     re-emit SESSION_IDENTITY (token unchanged)

AUTHORITY (everywhere): state.players[socket.data.playerId]   // never socket.id

DISCONNECT (lobby only): updateJSON remove player + broadcast; KEEP reattach record
PLAYER_REMOVE (kick):    updateJSON remove player + DELETE reattach record + SESSION_REMOVED
```

- **Why the reattach record carries `{ playerId, displayName, role }`** (not just `playerId`): the server-driven restore must re-materialise a roster entry that lobby-disconnect cleanup removed — uniformly for the Facilitator (who has no `?join=` re-entry path) and joiners — without the client re-emitting `SESSION_JOIN`. The record is token-gated and never broadcast.
- **Disconnect keeps the record; kick deletes it.** A refresh must re-attach (record survives); a kicked player must not (record deleted → their next connect is a fresh join, which the Facilitator may remove again).
- **No grace window in V1.** Lobby disconnect removes immediately (the AC says "removed", no grace). A debounced grace window is a deferred enhancement (note it; don't build it). Mid-round pause/grace is 8.7.

### Reuse the Story 2.6 `updateJSON` primitive — do not hand-roll

Both roster mutations 2.7 introduces (disconnect cleanup, `PLAYER_REMOVE`) are **load-modify-store** on the session key — exactly the race class 2.6 fixed. Use `deps.redis.updateJSON(sessionKey(sessionId), mutate)` with a pure `mutate` returning `{ commit, value?, result }`; let the handler branch on `result`. 2.6's Completion Notes explicitly named these as the primitive's "next customers." `removePlayerFromSession` is the pure reducer inside `mutate` (mirror `addPlayerToSession`). [Source: 2-6-capacity-and-join-window-guards.md Completion Notes; redis.ts `updateJSON`]

### The authority-gate sweep (the part most likely to break the system if half-done)

Once `players` is keyed by the durable id, **every** `players[socket.id]` lookup returns `undefined`. The sweep is mechanical but must be complete in one story or gates silently fail:

| File:line | Gate | Change |
|---|---|---|
| `sessionHandlers.ts:292` | `facilitatorId: socket.id` (create) | minted `playerId` |
| `sessionHandlers.ts:358,378` | SESSION_JOIN rejoin guard | `players[socket.data.playerId]` |
| `sessionHandlers.ts:388,434` | join player id + log | `socket.data.playerId` |
| `sessionHandlers.ts:480,573,649,711` | facilitator checks (TEAM_ASSIGN / PREP_OPEN / PREP_CANCEL / ROUND_START) | `players[socket.data.playerId]?.role !== 'facilitator'` |
| `manualHandlers.ts:90,94` | Expert gate + log | `socket.data.playerId` (resolves `deferred-work.md:92`) |
| `moduleHandlers.ts:115` | Defuser gate | `players[socket.data.playerId]` (the 4.7 dependency) |
| `createSession.ts:16-40` | doc comment only | "durable minted id", not "socket id" |

Guard every lookup against `socket.data.playerId === undefined` (a never-joined socket) so `NOT_IN_SESSION` / authority refusals still fire and existing tests stay green. [Source: deferred-work.md:60,64,92,150,164]

### Existing code you build on (read before editing)

- `apps/server/src/handlers/sessionHandlers.ts` — `registerSessionHandlers` (the `io.on('connection')` block is where `disconnect` + `PLAYER_REMOVE` land), `SessionSocketData` (32, extend with `playerId`), the SESSION_JOIN `updateJSON` block (314–436, from 2.6), the facilitator-authority pattern (TEAM_ASSIGN ≈455–540 is the model for PLAYER_REMOVE), `notFound()`/`parse*` helpers, `MAX_PLAYERS`.
- `apps/server/src/state/redis.ts` — `updateJSON` (the 2.6 primitive; reuse for both removals), `getJSON`/`setJSON`. `apps/server/src/state/keys.ts` — add `reattachKey`.
- `apps/server/src/session/joinSession.ts` — `addPlayerToSession` (pure; the template for `removePlayerFromSession`). `assignTeam.ts` — emptied-team deletion pattern to mirror when pruning `relayOrder`.
- `apps/server/src/session/createSession.ts` — `facilitatorId` already opaque; doc-comment touch only.
- `apps/server/src/index.ts:46-55` — the `io` construction + the existing readiness `io.use` gate (add the identity middleware *after* it); the `io.on('connection')` breadcrumb (the connection-restore lands in `registerSessionHandlers`, not here).
- `apps/server/src/handlers/manualHandlers.ts:68-100`, `moduleHandlers.ts:79-116` — the two non-session authority gates to switch.
- `apps/client/src/net/socket.ts` — `createSocket`/`getSocket` (`autoConnect:false`; set `socket.auth` before connect). `apps/client/src/net/bindServerEvents.ts` — where `SESSION_IDENTITY`/`SESSION_REMOVED` bind. `apps/client/src/ui/Lobby.tsx:113-114,171,187-220` — "You" tag + the per-row controls (add Remove). `apps/client/src/ui/Landing.tsx:97-205` — `?join=` prefill (97–108), `tryJoin` (115–145), the render (add the Join button); `joinCode.ts` `isCodeComplete`/`isJoinReady`.
- `packages/shared/src/events/*` — `client-to-server.ts`, `server-to-client.ts`, `payloads.ts`, `index.ts` (new events/payloads).

### Previous-story intelligence (2.6, just shipped — same worktree)

- **`updateJSON` exists and is battle-tested** (WATCH/MULTI optimistic CAS on a dedicated connection + global serialization queue; live-Redis smoke green). 2.7's two roster removals are its first real reuse — do not reintroduce a bare `setJSON` load-modify-store.
- **The fake store** (`testSocketServer.ts` `createMemoryRedisStore`) already implements `updateJSON` + the one-shot `onBeforeCommit` race hook and an `overrides` failure-injection seam — reuse them for the `*_FAILED` and any race tests.
- **Jest on server, Vitest on client; strict `afterEach` teardown** (hung-worker failure mode). `it.each` for matrices; assert the fake store's raw `data` map for persistence/no-write; count broadcasts on the *other* socket to prove a no-op. Seed the store directly to set up states.
- **AR15 discipline** is enforced by a dedicated capturing-log test — extend it to also assert the **reattach token** never leaks.
- **The `relayOrder`↔`players` divergence** (`deferred-work.md:72`) is *reduced* by keying both on the durable id; `removePlayerFromSession` pruning `relayOrder` further tightens it.

### Architecture compliance checklist (what this story is judged against)

- **Handler = I/O; logic = pure.** `removePlayerFromSession` is a pure reducer (no I/O, no clock, no socket); handlers own the WATCH/MULTI, room joins, and emits. Identity mint uses `randomUUID()` (crypto) — **no `Math.random()`** anywhere.
- **State residence:** session + reattach record live in Redis; O(1) per action (single-key `updateJSON`, single `getJSON` for token resolve — no `KEYS`/`SCAN`).
- **Server-authoritative:** removal authority and self-target guard are server-side; the durable id is resolved server-side from the token (the client's presented token is a credential, not a claim of identity).
- **Typed events only:** the three new events/payloads are added to the shared contract; no stringly-typed emits; no `any`/`@ts-ignore`.
- **Secrets:** the join code **and** the reattach token are never logged and never placed in any broadcast payload (`SESSION_IDENTITY` is unicast to the owner; the token is never in `SessionState`).
- **Client render-only:** Lobby/Landing hold presentation state in `useState`; identity persistence is a thin `net/` module, not game logic.

### Project Structure Notes

- **Modified — server:** `handlers/sessionHandlers.ts` (mint + identity emit + disconnect + PLAYER_REMOVE + gate sweep + `SessionSocketData`), `handlers/manualHandlers.ts` + `handlers/moduleHandlers.ts` (gate switch), `index.ts` (identity middleware), `state/keys.ts` (`reattachKey`), `session/createSession.ts` (doc only), **new** `session/removePlayerFromSession.ts`.
- **Modified — shared:** `events/payloads.ts`, `events/client-to-server.ts`, `events/server-to-client.ts`, `events/index.ts` (3 new events + payloads). `PlayerInfo`/`SessionState` shapes **unchanged**.
- **Modified — client:** `ui/Landing.tsx` (Join button), `ui/Lobby.tsx` (Remove control + "You" tag fix), `net/socket.ts` + `net/bindServerEvents.ts` (auth wiring + new event binds), **new** `net/identity.ts` (sessionStorage identity store).
- **New tests:** `session/__tests__/removePlayerFromSession.test.ts`; extended `handlers/__tests__/sessionHandlers.test.ts`; client `Landing`/`Lobby`/identity specs.
- Naming: SCREAMING_SNAKE events (`SESSION_IDENTITY`, `PLAYER_REMOVE`, `SESSION_REMOVED`); camelCase helpers (`reattachKey`, `removePlayerFromSession`, `getIdentity`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors; no `@ts-ignore`.
- All game logic in pure reducers `(state, event) => newState`; reducers import nothing from `socket.io`/`ioredis`/`pg`/`fastify`. Handlers own all I/O: parse → load → reduce → persist → emit.
- Redis holds all in-flight session state; O(1) per action; no wildcard ops. Postgres untouched here.
- React/R3F render-only; presentation state in `useState`; Zustand for snapshot state (`getState()` on render loops, not `useState`).
- Server-authoritative validation; never trust client-supplied identity/role/counts — the token is resolved server-side, not trusted as a claim.
- No `Math.random()` — identifiers via `randomUUID()`.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.7: Lobby Resilience & Facilitator Player Controls] (all 6 ACs verbatim; the widened-scope note making durable identity a gameplay-authority dependency owned here, consumed by 4.7/8.7)
- [Source: _agent_docs/planning-artifacts/sprint-change-proposal-2026-06-12-epic-2-lobby-followup.md] (origin of Story 2.7: ghost-on-refresh, no disconnect handler, PLAYER_REMOVE + stable id + disconnect cleanup; 2.7 scopes cleanup to lobby phase; mid-round is FR13/Epic 8)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:60,64] (facilitator + joiner `socket.id`-as-identity deferrals — resolved by this story's durable id)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:92] (`MANUAL_NAVIGATE` Expert gate on `socket.id` — switch to durable id here)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:150,164] (mid-round Defuser restore owned by 8.7, *depends on* 2.7's durable id; the reconnect-cluster index naming 2.7 as the durable-id home)
- [Source: _agent_docs/implementation-artifacts/2-6-capacity-and-join-window-guards.md] (the `updateJSON` primitive 2.7 reuses; the fake-store `updateJSON`/`onBeforeCommit`/`overrides` seams; AR15 capturing-log test pattern; strict-teardown Jest idioms)
- [Source: apps/server/src/handlers/sessionHandlers.ts] (registerSessionHandlers; SESSION_JOIN updateJSON block; facilitator-authority pattern; `SessionSocketData`; `MAX_PLAYERS`)
- [Source: apps/server/src/handlers/manualHandlers.ts:90; moduleHandlers.ts:115] (the two non-session authority gates to switch)
- [Source: apps/server/src/state/redis.ts (updateJSON); state/keys.ts] (reuse primitive; add reattachKey)
- [Source: apps/server/src/session/joinSession.ts; createSession.ts; assignTeam.ts] (pure-reducer template; opaque facilitatorId; emptied-team deletion to mirror)
- [Source: apps/server/src/index.ts:46-55] (io construction; readiness io.use gate to order the identity middleware after)
- [Source: apps/client/src/net/socket.ts; ui/Lobby.tsx:113-114,171; ui/Landing.tsx:97-205; ui/joinCode.ts] (auth wiring; "You" tag fix; Join button; submit helpers)
- [Source: packages/shared/src/events/client-to-server.ts; server-to-client.ts; payloads.ts; types/session.ts] (where the 3 new events/payloads go; PlayerInfo/SessionState shapes stay frozen)
- [Source: _agent_docs/project-context.md] (pure-reducer/handler-I/O split; O(1) Redis; server-authoritative; TS-throughout; no Math.random; AR15)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- Worktree node_modules already provisioned from the 2.6 session; `pnpm --filter @bomb-squad/shared build` after the contract change so server/client resolve the new payload types.
- **Gate-sweep miss caught by tests:** `ROUND_START` routed sockets to team rooms via `players[member.id]` (socket.id) in a `fetchSockets()` loop — not one of the `players[socket.id]` lines the story enumerated. Switched to `member.data.playerId`; this was the single non-obvious sweep site (the moduleHandlers round-flow tests timed out on it because the defuser never joined its team room → no `TIMER_UPDATE`).
- **Join-broadcast timing:** the reattach-record `setJSON` between the `updateJSON` commit and the `SESSION_STATE` broadcast widened the window in which other room members' broadcast copies were in-flight, exposing a latent test fragility (helpers awaited only the joiner's copy). Fixed in production by broadcasting **immediately** after `socket.join` (before the record write/identity emit), and hardened the test join helpers to also drain the facilitator's copy. SESSION_IDENTITY now arrives after SESSION_STATE, so order-independent capture in the test helpers.
- **Reattach test race:** the server-driven restore emits `SESSION_STATE` concurrently with the client handshake completing; the real client binds handlers *before* connect, so added a `connectClientCapturingState` harness method that attaches the listener before the handshake resolves (models production).
- Live smoke ran via a self-contained harness (removed after) against throwaway `redis:7-alpine` + `postgres:16-alpine`, server booted with `tsx` (no watch).

### Completion Notes List

**Durable-identity primitive (AC 6) — secret reattach token, as decided.** The server mints a public `playerId` (roster + authority key) and a secret `reattachToken` per first create/join. The token → `{ playerId, displayName, role }` record lives in Redis (`reattach:{sessionId}:{token}`), with a `reattachByPlayer:{sessionId}:{playerId}` companion so `PLAYER_REMOVE` can invalidate it without a reverse scan. The token is unicast via a new `SESSION_IDENTITY` event (never in `SessionState`, never logged). A connection-time `io.use` middleware resolves a presented token into `socket.data.playerId`; a server-driven connection restore re-attaches the socket (converge if still rostered, or re-add from the record if lobby-cleaned) — uniformly for the Facilitator and joiners, no client re-emit.

**Authority-gate sweep (AC 6).** Every `players[socket.id]` authority/identity lookup switched to `players[socket.data.playerId]`: SESSION_JOIN rejoin guards, the four facilitator checks (TEAM_ASSIGN / PREP_OPEN / PREP_CANCEL / ROUND_START), the ROUND_START team-room `fetchSockets` loop, `manualHandlers` Expert gate, `moduleHandlers` Defuser gate. `SessionSocketData` gained `playerId`. `createSession` doc-comment only. Resolves the `socket.id`-as-identity deferrals (`deferred-work.md:60,64,92,150,164`).

**PLAYER_REMOVE (AC 1/2).** Facilitator-gated, modelled on TEAM_ASSIGN: `parsePlayerRemovePayload` → `NOT_IN_SESSION` → `NOT_FACILITATOR` → self-target/unknown → `INVALID_REMOVAL` → race-safe removal via the 2.6 `updateJSON` + the new pure `removePlayerFromSession` reducer (prunes `relayOrder`, deletes emptied teams). On commit: delete the reattach record (kick is permanent), `SESSION_REMOVED` to the target's live socket(s), broadcast the new roster. `PLAYER_REMOVE_FAILED` on throw.

**Lobby disconnect cleanup (AC 3).** New `socket.on('disconnect')`: lobby-phase only, race-safe `updateJSON` removal + broadcast, **keeps** the reattach record so a refresh re-attaches. Non-lobby disconnects are a no-op (Epic 8 owns mid-round). Both removals reuse the 2.6 primitive — its first real reuse, as 2.6's notes predicted.

**Client (AC 1/4/5).** New `net/identity.ts` (sessionStorage `{ sessionId, playerId, reattachToken }`); `applyAuthFromIdentity` pushes the token onto `socket.auth` before connect (App bootstrap) so Socket.IO replays it on every reconnect. `bindServerEvents` binds `SESSION_IDENTITY` (persist + refresh auth) and `SESSION_REMOVED` (clear identity, drop to Landing with the notice). gameStore gained `clearSession`/`removalNotice`. Lobby: "You" tag now reads the durable id from `getIdentity()`; a per-row **Remove** uses the canonical `ConfirmButton` two-step confirm → `PLAYER_REMOVE`. Landing: a **Join** button renders when `isCodeComplete(cells)` (the `?join=`-prefilled-no-keystroke gap), calling the existing `tryJoin`; the 6th-char auto-submit (Story 2.3) is untouched.

**Gates.** `tsc --noEmit` 0 errors, no `@ts-ignore`. `pnpm -r test` all green: **shared 136, client 210 (+6 identity), server 330 (+18: identity/disconnect/PLAYER_REMOVE/reattach/AR15 + removePlayerFromSession reducer)**. Client build OK. **Migration:** 22 pre-existing authority tests updated to resolve players by the durable id (from `SESSION_IDENTITY`/roster) instead of the client `socket.id` — no behavioural regressions, the production code was correct.

**Live-Redis smoke → `SMOKE_RESULT: PASS`** (real ioredis, the handshake-auth reconnect path the fake can't surface):
- Reattach: join → roster 2; disconnect → roster 1, reattach record survives; reconnect with the token → same durable `playerId`, roster back to 2 with **no duplicate**.
- PLAYER_REMOVE: facilitator removes → target gets `SESSION_REMOVED`, roster shrinks, reattach record **deleted** (kick permanent); a non-facilitator `PLAYER_REMOVE` → `NOT_FACILITATOR`.
- **AR15:** grep of server stdout for the join code AND the reattach token → 0 hits.

**No component-test harness in the project** (no jsdom/RTL; the codebase tests pure logic/helpers only). The Landing Join button and Lobby Remove UI are therefore covered by the **Jay-interactive verification** subtask (Task 9), consistent with the established posture for browser-only surfaces. Adding a React-testing dependency was out of scope (would need approval).

**Newly resolved deferrals:** `deferred-work.md:60,64` (facilitator + joiner socket.id identity), `:92` (MANUAL_NAVIGATE Expert gate). Story 8.7's mid-round restore now has the durable id it depends on (`:150,164`).

**Interactive-verification findings (fixed mid-pass).** Jay's browser passes surfaced three client-side defects, all fixed:

1. **Both Facilitator + Defuser got the Expert manual after ROUND_START** (and the Defuser's cuts would have been dropped). The **client** self-identification sweep was incomplete — `ActiveRound`, `Preparation`, `productionDispatch` still resolved "which player am I" via `getSocket().id`, no longer a roster key (same class as the server gate sweep). All now resolve by the durable id; a full re-grep confirms no `socket.id` self-lookup remains in client source.

2. **The "You" tag didn't appear until a refresh.** The tag read `getIdentity()` (sessionStorage) once at render, but on first join `SESSION_STATE` renders the Lobby before `SESSION_IDENTITY` is persisted, and a storage write isn't reactive. Fixed by holding the durable self-id in a **reactive store field** (`gameStore.myPlayerId`), set on `SESSION_IDENTITY` and seeded from storage at App bootstrap; `Lobby`/`ActiveRound`/`Preparation` read it reactively.

3. **A lobby refresh reset the player's team/role (violated AC 4 "same seat").** A refresh is a disconnect→reconnect; the immediate disconnect removal dropped the player (and their team/relayOrder), then restore re-added them from the join-time reattach record. Fixed with a **disconnect grace window** (`DEFAULT_DISCONNECT_GRACE_MS`, overridable via `deps.disconnectGraceMs`): a disconnect schedules the seat removal; a reconnect (or PLAYER_REMOVE) within the grace cancels it, so a refresh never tears the seat down (AC 4) while a genuine departure still frees it after the grace (AC 3). This **supersedes the story's original "no grace window in V1" note**, which was incompatible with AC 4's same-seat guarantee. New server test covers it (refresh-within-grace preserves team/role/relayOrder).

These client surfaces have no component-test harness, so role routing / the "You" tag remain part of the interactive pass.

**Separately surfaced (NOT a 2.7 AC — needs a product decision):** 2.7's reattach intentionally keeps a participant in the session across a refresh, which removed the previous de-facto "leave" (a refresh used to drop you to Landing). There is no self-leave affordance, so a participant in an active round is stuck (closing the tab clears the per-tab sessionStorage identity and is the current escape). A "Leave session" control is a reasonable companion but is out of this story's stated scope — flagged for Jay to decide (add to 2.7 vs. a follow-up).

**✅ Jay interactive verification (2026-06-14, two browsers via Docker stack at `https://localhost`):** share-link **Join** button → Lobby ✓; **Remove** + secondary confirm → removed player dropped to Landing with the notice, facilitator roster updated ✓; **refresh a joined player** → same seat/team/role, no duplicate, "You" tag intact ✓; **refresh the Facilitator** → kept the seat ✓; post-fix **role routing** → Defuser on the bomb, Facilitator on the panel (no longer both on the manual) ✓. Jay's words: "so far so good… everything else as expected." One cosmetic nit logged to `deferred-work.md` (brief Lobby flicker on refresh during the reconnect→restore window — not a correctness issue).

### File List

- `packages/shared/src/events/payloads.ts` — `PlayerRemovePayload`, `SessionIdentityPayload`, `SessionRemovedPayload`.
- `packages/shared/src/events/client-to-server.ts` — `PLAYER_REMOVE`.
- `packages/shared/src/events/server-to-client.ts` — `SESSION_IDENTITY`, `SESSION_REMOVED`.
- `packages/shared/src/events/index.ts` — export the new payloads.
- `apps/server/src/state/keys.ts` — `reattachKey`, `reattachByPlayerKey`.
- `apps/server/src/session/identity.ts` *(new)* — mint / store / resolve / delete reattach record.
- `apps/server/src/session/removePlayerFromSession.ts` *(new)* — pure removal reducer (prunes relayOrder).
- `apps/server/src/handlers/sessionHandlers.ts` — identity mint on create/join, `SessionSocketData.playerId`, identity middleware + connection restore, authority-gate sweep, `disconnect` + `PLAYER_REMOVE` handlers, `parsePlayerRemovePayload`, `RemoveOutcome`, `SessionServerSocket`.
- `apps/server/src/handlers/manualHandlers.ts` — Expert gate → durable id.
- `apps/server/src/handlers/moduleHandlers.ts` — Defuser gate → durable id.
- `apps/server/src/session/createSession.ts` — doc comment (durable id).
- `apps/client/src/net/identity.ts` *(new)* — sessionStorage identity store + `applyAuthFromIdentity`.
- `apps/client/src/net/bindServerEvents.ts` — bind `SESSION_IDENTITY` / `SESSION_REMOVED`.
- `apps/client/src/App.tsx` — `applyAuthFromIdentity` before connect.
- `apps/client/src/store/gameStore.ts` — `clearSession`, `removalNotice`, `clearRemovalNotice`, reactive `myPlayerId` + `setMyPlayerId`.
- `apps/client/src/App.tsx` — seed `myPlayerId` from storage at bootstrap (reactive "You" tag on first render).
- `apps/client/src/ui/Lobby.tsx` — durable-id "You" tag + per-row Remove control.
- `apps/client/src/ui/ActiveRound.tsx` — role-based surface routing resolves self by the durable id (was socket.id).
- `apps/client/src/ui/Preparation.tsx` — facilitator / upcoming-defuser detection by the durable id (was socket.id).
- `apps/client/src/net/productionDispatch.ts` — MODULE_INTERACT team resolution by the durable id (was socket.id).
- `apps/client/src/net/__tests__/productionDispatch.test.ts` — mock `getIdentity` (durable-id self resolution).
- `apps/client/src/ui/Landing.tsx` — share-link Join button + removal-notice display.
- `apps/client/src/ui/copy.ts` — `REMOVE_PLAYER`, `REMOVE_CONFIRM`, `JOIN_NOW`.
- `apps/server/src/session/__tests__/removePlayerFromSession.test.ts` *(new)* — reducer unit tests.
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — durable-id migration + new 2.7 suite (identity/disconnect/PLAYER_REMOVE/reattach/AR15).
- `apps/server/src/handlers/__tests__/manualHandlers.test.ts` — capture + assert durable id.
- `apps/server/src/handlers/__tests__/moduleHandlers.test.ts` — durable-id team-room assertions.
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — `connectClient(auth)` + `connectClientCapturingState`.
- `apps/client/src/net/__tests__/identity.test.ts` *(new)* — identity store unit tests.

### Change Log

- 2026-06-14 — Implemented Story 2.7: durable player-id primitive (secret reattach token via handshake auth, resolved server-side into `socket.data.playerId`) + system-wide authority-gate sweep off `socket.id`; `PLAYER_REMOVE` (facilitator-gated, permanent kick); lobby-phase disconnect cleanup; refresh re-attach (server-driven restore); share-link Join button. Reuses the 2.6 `updateJSON` primitive for both race-safe roster removals. All gates green (shared 136 / client 210 / server 330, tsc clean, client build) + live-Redis smoke PASS (reattach no-dup, kick invalidation, AR15). Jay-interactive verification pending.
