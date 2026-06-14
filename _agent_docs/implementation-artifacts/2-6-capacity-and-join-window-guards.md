---
baseline_commit: d17df0c (master; clean worktree at story-creation time)
---

# Story 2.6: Capacity & Join-Window Guards

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want session capacity and join-window rules enforced,
so that sessions stay within the 2–16 cap and no one joins mid-round.

## Acceptance Criteria

1. **Capacity is hard-capped at 16 — race-safe.** Given a session at 16 players, when another player attempts to join, then the join is rejected with a `SESSION_FULL` error. The cap holds even when two joins arrive concurrently at 15 occupancy: at most one is admitted, the roster never exceeds 16, and the loser receives `SESSION_FULL`.

2. **No mid-round joins.** Given a round is active (`preparation`, `active`, or `ended`), when a new player attempts to join, then the join is refused with a `SESSION_NOT_JOINABLE` error and no roster change.

3. **Between-rounds joins are admitted; defuse eligibility is emergent.** Given the session is between rounds (`between-rounds`), when a player joins via the code, then the player is admitted to the roster. They are *not* placed in any team's `relayOrder`, so they are inherently ineligible to defuse the established rotation — the actual relay slotting/equalisation is enforced by Epic 8 (8.6/8.9), which owns between-rounds flow. No `packages/shared` contract change in this story.

## Tasks / Subtasks

- [x] **Task 1 — Server: optimistic compare-and-set primitive on the Redis adapter (AC: 1)**
  - [x] **Why this exists:** the join path is `load → modify → store`. The capacity guard (`Object.keys(players).length >= MAX_PLAYERS`) reads, then a *later* `setJSON` writes; two joins interleaving at 15 occupancy can both pass the read-check and push the roster to 17. This is the accepted-but-now-load-bearing race named in `deferred-work.md:65`, with Story 2.6 as its designated home. The fix is server-side serialization on the single session key.
  - [x] **Keep the reducer pure (architecture rule):** do **not** push player-add logic into a Lua script — `addPlayerToSession` stays pure TS. Use the WATCH/MULTI **optimistic-transaction** pattern so the guard + add run in TS and only the commit is atomic.
  - [x] Widen `RedisLike` in `apps/server/src/state/redis.ts` with the ioredis primitives needed for the transaction. The real client is a full `ioredis@^5.11.1` `Redis` instance (`state/index.ts` narrows it to `RedisLike` only for the wrapper), so these already exist on the concrete client — this is interface-widening, not new client capability:
    - `watch(key: string): Promise<unknown>`
    - `unwatch(): Promise<unknown>`
    - `multi(): RedisMultiLike` where `RedisMultiLike = { set(key, value): RedisMultiLike; exec(): Promise<[Error | null, unknown][] | null> }` — `exec()` returns `null` when a WATCHed key changed (transaction aborted), which is the conflict signal.
    - `duplicate(): RedisLike` — for the dedicated transaction connection (next bullet).
  - [x] **⚠️ CRITICAL — `WATCH` is connection-scoped, and the store holds one shared client.** `connectRedis` builds a single `ioredis` connection and the whole server multiplexes commands over it. If two `updateJSON` calls run WATCH/MULTI concurrently on that one connection, their awaits interleave (A.watch → B.watch → A.exec → B.exec) and the transaction guarantees **silently break** — the in-memory fake will pass but the real race (the entire point of AC 1) will not. **This is the single most important implementation detail in the story.** Resolve it one of two ways (pick one, justify in Completion Notes):
    1. **Dedicated transaction connection (recommended):** lazily `client.duplicate()` once, cache it in the `createRedisStore` closure, and run every `updateJSON` WATCH/MULTI on that connection — **serialized through an in-process promise-chain queue** (a `Map<string, Promise<unknown>>` keyed by the Redis key, chaining each call after the prior one for the same key) so no two transactions interleave on it. In-process the queue removes intra-connection interleave; across processes (future) each process's own dedicated connection makes WATCH/MULTI catch the cross-process conflict and retry. A single global queue is acceptable at human-speed join rates if per-key bookkeeping feels heavy — note the choice.
    2. **Connection per transaction:** `client.duplicate()` per call, WATCH/MULTI/EXEC, then `quit()`. Simpler, correct, but churns a connection per join — acceptable at human speed, wasteful at scale. Document the tradeoff.
  - [x] Add one **generic** method to `RedisStore` (reusable — the `TEAM_ASSIGN` race in `deferred-work.md:70` and Epic-8 facilitator writes will copy it). Signature:
    ```ts
    updateJSON<T, R>(
      key: string,
      mutate: (current: T | null) => { commit: boolean; value?: T; result: R },
      opts?: { maxRetries?: number }, // default 5
    ): Promise<{ committed: boolean; result: R }>;
    ```
    - The store loop: `watch(key)` → `getJSON<T>(key)` → call `mutate(current)`. If `commit === false`: `unwatch()`, return `{ committed: false, result }` (no write). If `commit === true`: `multi().set(key, JSON.stringify(value)).exec()`; on a non-null reply return `{ committed: true, result }`; on a **null** reply (WATCHed key changed mid-transaction) loop and retry from `watch`. After `maxRetries` exhausted, throw `new Error('RedisStore.updateJSON: contention retry limit exceeded for key "<key>"')` — the caller's try/catch turns it into a typed `*_FAILED`.
    - `mutate` is **pure** (no I/O, no clock) — it may be invoked more than once (once per retry). Carry per-attempt decisions only through the returned `result`.
    - Always `unwatch()` on the non-commit and on the throw path so a WATCH never leaks onto the connection (a leaked WATCH silently breaks the *next* unrelated transaction on that connection).
  - [x] Unit tests in `apps/server/src/state/__tests__/redis.test.ts` against a small scripted `RedisLike` fake (this file already tests the adapter directly — match its style; the scripted fake must now also implement `watch`/`unwatch`/`multi().set().exec()`/`duplicate` so the transaction path runs): commit path writes the serialized value and returns `{ committed: true }`; `commit:false` writes nothing and never calls `multi`; a one-time null `exec()` reply triggers exactly one retry (assert `watch`/`mutate` called twice, second commit succeeds); `maxRetries` exhaustion throws the contention error; `unwatch` is called on the no-commit and throw paths; malformed JSON from the inner `getJSON` surfaces (reuse the existing malformed-JSON assertion).

- [x] **Task 2 — Server: teach the in-memory test fake the same primitive + a race hook (AC: 1)**
  - [x] Extend `createMemoryRedisStore` in `apps/server/src/handlers/__tests__/testSocketServer.ts` with a matching `updateJSON<T, R>` over its backing `Map`. A single-threaded fake is trivially atomic, so the default implementation is: read from `data`, call `mutate`, write on `commit`, return.
  - [x] **Race injection (this is what makes the AC-1 concurrency test real):** add an optional, *self-clearing* interleave hook to the fake — e.g. `createMemoryRedisStore({ onBeforeCommit })` where `onBeforeCommit?: (key: string) => void | Promise<void>` fires **once** between the fake's read and its write, then disarms. A test arms it to mutate `data` (simulate a second client's join landing mid-transaction); the fake detects the value changed since its read and re-runs `mutate` with the new value (modelling WATCH/EXEC-null → retry). Keep the hook one-shot so it doesn't loop forever. Preserve the existing `overrides?: Partial<RedisStore>` failure-injection seam — `updateJSON` must be overridable too (for the `*_FAILED` test in Task 4).
  - [x] No new exported test file; this is harness capability that several Task-4 tests consume (the sanctioned kind of harness edit, same posture as 2.4's `TestIOServer` retype).

- [x] **Task 3 — Server: refactor the `SESSION_JOIN` handler onto `updateJSON` + refine the join-window (AC: 1, 2, 3)**
  - [x] File: `apps/server/src/handlers/sessionHandlers.ts`, the existing `socket.on('SESSION_JOIN', …)` block (currently ~lines 314–396). The contract is **frozen** (no ack; success = `SESSION_STATE` broadcast, failure = typed `ERROR`) — do not change the wire shape. `MAX_PLAYERS = 16` stays where it is (sessionHandlers.ts:155); no `packages/shared` change.
  - [x] **Keep unchanged, before the transaction (read-only fast paths):**
    1. `parseSessionJoinPayload` → `INVALID_PAYLOAD` on failure.
    2. `joinCodeKey(code)` lookup → `SESSION_NOT_FOUND` (`notFound()`) when the sessionId is `null`. The joincode→sessionId mapping is immutable for a live session, so this read stays **outside** the transaction — the transaction only WATCHes the *session* key it mutates.
    3. `sessionKey(sessionId)` load returning `null` → `notFound()` (dangling joincode key, indistinguishable to the joiner).
    4. **Idempotent rejoin:** `state.players[socket.id] !== undefined` → `await socket.join(...)`, set `socket.data.sessionId`, re-`emit('SESSION_STATE', state)`, return. Read-only convergence, no write — stays a pre-transaction fast path (a stale snapshot re-sent to a rejoiner is harmless).
  - [x] **Replace** the standalone capacity check, the join-window check, the `addPlayerToSession` call, and the bare `setJSON` with a single `deps.redis.updateJSON(sessionKey(sessionId), mutate)` call whose **pure** `mutate(current)` encodes all of it (re-evaluated against the freshly-WATCHed state on every attempt — this is what closes the race):
    - `current === null` → `{ commit: false, result: 'vanished' }` (session evicted between the pre-read and the transaction; treat as `notFound()`).
    - `current.players[socket.id] !== undefined` → `{ commit: false, result: 'rejoin' }` (defensive: a join that became a rejoin between the fast-path read and the transaction; handler converges as in the fast path).
    - **Join-window (AC 2 + AC 3):** admit only `current.status === 'lobby' || current.status === 'between-rounds'`. Any other status (`preparation`, `active`, `ended`) → `{ commit: false, result: 'not-joinable' }`. This is the deliberate refinement of 2.3's defensive blanket `status !== 'lobby'` refusal — `between-rounds` now admits.
    - **Capacity (AC 1):** `Object.keys(current.players).length >= MAX_PLAYERS` → `{ commit: false, result: 'full' }`. Evaluated **inside** the transaction against the WATCHed state → race-safe.
    - Otherwise: `{ commit: true, value: addPlayerToSession(current, { playerId: socket.id, displayName: parsed.displayName, role: parsed.role }), result: 'added' }`.
  - [x] **After the call, branch on `{ committed, result }`:**
    - `result === 'vanished'` → `notFound()`, return.
    - `result === 'rejoin'` → `await socket.join(sessionRoom(sessionId))`, `socket.data.sessionId = sessionId`, `socket.emit('SESSION_STATE', <reload or the value>)`, return. (Re-load via `getJSON` for the freshest snapshot, or thread the read value out through `result`; a re-load is simplest and off the hot path.)
    - `result === 'not-joinable'` → `ERROR { code: 'SESSION_NOT_JOINABLE', message: 'That session has already started.', recoverable: true }`, return.
    - `result === 'full'` → `ERROR { code: 'SESSION_FULL', message: 'That session is full — 16 is the limit.', recoverable: true }`, return. (Keep both existing messages verbatim — Landing renders them; no copy churn.)
    - `result === 'added'` (and `committed === true`): `await socket.join(sessionRoom(sessionId))`, `socket.data.sessionId = sessionId`, `io.to(sessionRoom(sessionId)).emit('SESSION_STATE', committedValue)`, `deps.log.info({ sessionId, playerId: socket.id, role: parsed.role }, 'player joined')`. **Broadcast the committed value** the store returns (the post-commit snapshot), not a re-read — so the broadcast can't reflect a later interleaving write. (Thread the committed `value` out of `updateJSON`, or re-`getJSON`; prefer threading it through.)
  - [x] Wrap the transaction + post-branch awaits in the existing try/catch → on throw (incl. `updateJSON` retry-limit) `deps.log.error({ err, socketId: socket.id }, 'SESSION_JOIN failed')` + `ERROR { code: 'SESSION_JOIN_FAILED', message: 'Could not join the session. Try again.', recoverable: true }`. **AR15:** never log the join code — it isn't in this branch's log lines today; keep it that way.
  - [x] Replace the old `// Known accepted race …` and `// Defensive join-window guard; Story 2.6 refines it …` comments with: a one-line note that capacity+window are now evaluated atomically inside `updateJSON`, and a pointer that `between-rounds` admits while Epic 8 (8.6/8.9) owns relay eligibility for late joiners.

- [x] **Task 4 — Server: handler integration tests (AC: 1, 2, 3)**
  - [x] Extend the `SESSION_JOIN` describe block in `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` (Jest; keep the strict `afterEach` teardown — hung workers were the documented failure mode). Reuse the existing create→join helper and direct fake-store seeding.
  - [x] **AC 1 capacity (non-raced):** seed a session with 16 players directly in the fake store; a 17th `SESSION_JOIN` → `SESSION_FULL` to that socket only; fake store roster still 16 (byte-identical).
  - [x] **AC 1 race (the headline test):** seed a session at 15 players. Arm `createMemoryRedisStore`'s one-shot `onBeforeCommit` so that, during the first join's transaction, a second player is written straight into `data` (occupancy → 16). Then drive the first `SESSION_JOIN`. Assert: the fake re-ran the mutate against the now-16 state and the first join resolves as `SESSION_FULL` (roster capped at 16, never 17). Mirror-assert the inverse ordering if cheap. The point is to prove the guard re-evaluates post-interleave — a plain read-check fails this test, `updateJSON` passes it.
  - [x] **AC 2 mid-round refusal:** seed `status: 'preparation'`, `'active'`, and `'ended'` sessions (`it.each`) → each join → `SESSION_NOT_JOINABLE`, no roster change, no broadcast to others.
  - [x] **AC 3 between-rounds admit:** seed `status: 'between-rounds'` with a facilitator + one team that already has a populated `relayOrder`; a fresh `SESSION_JOIN` → the joiner appears in `players`, **and** assert the joiner is in **no** team's `relayOrder` (emergent ineligibility) and `teams` is unchanged. Both sockets receive the `SESSION_STATE`.
  - [x] **Idempotent rejoin unchanged:** an already-present socket re-joining → re-emits `SESSION_STATE` to itself, no second broadcast to the room (listener-count pattern), no write.
  - [x] **`*_FAILED` path:** override `updateJSON` to reject (or to throw the retry-limit error) → `SESSION_JOIN_FAILED` to the joiner, no broadcast, store unchanged.
  - [x] **AR15:** assert the join code never appears in captured log lines for the full-/refused-/admitted paths.

- [x] **Task 5 — Client: confirm no change needed; fence the scope (AC: 1, 2, 3)**
  - [x] **No client code changes.** `SESSION_FULL` and `SESSION_NOT_JOINABLE` already surface to the **joiner** via Landing's `ERROR` listener, which renders the server's human-readable message verbatim (`apps/client/src/ui/Landing.tsx:83-91`). A between-rounds joiner routes to `<Lobby/>` because `App.tsx` already falls non-`active`/non-`preparation` statuses back to the lobby surface (`App.tsx:94,102`). Read both to confirm, then assert "no change" in Completion Notes — do not add a capacity counter, a "session full" lobby banner, or any facilitator-facing capacity UI.
  - [x] **Scope fence:** the "As a Facilitator" framing is about the *rules being enforced server-side*, not a new facilitator screen. No min-player (2) round-start gate here — that is an Epic-8 round-start concern (you can never drop below the current count by joining). No `eligibleToDefuse`/`joinedMidSession` field on `PlayerInfo` — eligibility is emergent (Decision: join-side only). No cosmetic between-rounds lobby polish — 8.6 owns the between-rounds surface (`deferred-work.md:144`).

- [x] **Task 6 — Gates: tests, typecheck, build, smoke (AC: 1, 2, 3)**
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore` (the widened `RedisLike` and the generic `updateJSON` must type cleanly across the real wiring in `state/index.ts` and the test fake).
  - [x] `pnpm -r test` → all green: shared untouched; client untouched (no client changes — confirm count unchanged); server existing + new `redis.test.ts` `updateJSON` cases + the SESSION_JOIN capacity/race/window/between-rounds/failure suites.
  - [x] `pnpm --filter @bomb-squad/client build` → succeeds (sanity; no client change expected to move it).
  - [x] **Live smoke against real Redis (document results in Completion Notes):** boot the worktree server (`tsx`, no `watch` — see the worktree gotcha note) against a throwaway `redis:7-alpine` + `postgres:16-alpine` so the WATCH/MULTI path runs against **real** ioredis, not just the fake. (1) Fill a session to 16 via headless `socket.io-client`s, then attempt a 17th → `SESSION_FULL`; `grep` server stdout for the join code → 0 (AR15). (2) Concurrency: at 15 occupancy fire two joins in the same tick (`Promise.all`) → assert the final `GET session:<id>` roster length is exactly 16 and exactly one socket got `SESSION_FULL`. (3) Seed/flip a session to `between-rounds`, join → admitted, joiner in no `relayOrder`; flip to `active`, join → `SESSION_NOT_JOINABLE`. Tear down containers after. If a browser pass isn't possible, say exactly what was verified headlessly.

## Review Findings

_Code review 2026-06-14 (gds-code-review: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 3 ACs verified fully satisfied; the WATCH/MULTI race-safety, queue-choice reasoning, and WATCH hygiene are correct. Findings are operational hardening of the new `updateJSON` primitive. 3 patch (all fixed) · 4 deferred · 3 dismissed._

- [x] [Review][Patch] Dedicated `txConn` (`client.duplicate()`) had no `'error'` listener — an emitted connection error on this separate EventEmitter crashes the Node process [apps/server/src/state/redis.ts] — **FIXED 2026-06-14:** `transactionConnection` now attaches an `'error'` listener (prevents the process crash; ioredis auto-reconnects, per-command failures still surface as `*_FAILED`) and a `'close'` listener that drops the cache so the next call re-duplicates a fresh connection.
- [x] [Review][Patch] A throwing `mutate(current)` leaked a WATCH onto the shared dedicated connection [apps/server/src/state/redis.ts] — **FIXED 2026-06-14:** `mutate` is now wrapped in try/unwatch/throw (mirrors the malformed-JSON read path). New regression test "thrown by mutate" — verified red without the guard (only `watch`,`get` logged), green with it.
- [x] [Review][Patch] `updateJSON` decision type allowed `commit: true` with `value` undefined → `JSON.stringify(undefined)` corrupts the key [apps/server/src/state/redis.ts] — **FIXED 2026-06-14:** introduced an exported `UpdateDecision<T,R>` discriminated union (`commit: true` structurally requires `value`); applied across the interface, `runTransaction`, the method, and both fakes. tsc confirms all call sites already supply `value`.

- [x] [Review][Defer] Global serialization queue is a liveness coupling — one slow/hung transaction blocks every session's join/cleanup (now 4+ call sites share the one queue + one connection). Bounded in practice by the main client's `commandTimeout: 2000` (inherited by `duplicate()`), so a hung command rejects in ~2 s and the queue advances [apps/server/src/state/redis.ts:146-156] — deferred (V1 human-speed rates; spec explicitly accepted the global queue)
- [x] [Review][Defer] `txConn` is never `quit()`/torn down and has no explicit reconnect/health handling; relies on ioredis auto-reconnect [apps/server/src/state/redis.ts:82-85] — deferred (auto-reconnect + the P1 listener cover the common case; full reset-on-close is extra hardening)
- [x] [Review][Defer] `rejoin` reload via `getJSON` can return `null` (session evicted between commit-read and reload) → joins room + sets `socket.data` for a vanished session with no snapshot [apps/server/src/handlers/sessionHandlers.ts rejoin branch] — deferred (narrow window, benign convergence)
- [x] [Review][Defer] The headline AC1 race test exercises the in-memory fake's `updateJSON`, a different code path from the real WATCH/MULTI adapter; only the (now-deleted) live-smoke harness exercised real ioredis concurrency — no standing CI integration test for the real race [apps/server/src/handlers/__tests__/sessionHandlers.test.ts] — deferred (add a real-Redis integration test when CI Redis infra lands)

## Dev Notes

### What this story is — and is not

The capacity (`SESSION_FULL`) and a blanket join-window (`SESSION_NOT_JOINABLE`) guards already exist in the `SESSION_JOIN` handler — added **defensively** in Story 2.3 with the explicit comment "Story 2.6 refines it (between-rounds admits)" (`sessionHandlers.ts:361`). So 2.6 is **not** greenfield. It does exactly two things:

1. **Makes the capacity cap race-safe.** Today the guard is a plain read-check ahead of a separate write — two joins at 15 occupancy can both pass and reach 17 (`deferred-work.md:65`, which names this story as the home). The fix is the codebase's **first Redis serialization**: an optimistic WATCH/MULTI compare-and-set, encapsulated in a new generic `RedisStore.updateJSON` so the pure reducer stays pure and the primitive is reusable (the `TEAM_ASSIGN` race, `deferred-work.md:70`, and Epic-8 writes are the next customers).
2. **Refines the join-window** from "lobby only" to "lobby **or** between-rounds," refusing `preparation`/`active`/`ended`.

**Decisions made at story creation (Jay, via create-story):**
- **Capacity race → fix now with Redis atomicity** (not accept-again). This is the one story where the race has a *correctness* consequence (AC1 is literally violable), so it earns the first WATCH/MULTI.
- **AC3 → join-side only, emergent eligibility.** Admit the between-rounds join; the "ineligible to defuse" requirement is satisfied *emergently* — a fresh joiner is in no team's `relayOrder` (join never touches `teams`), and `relayOrder` **is** the defuse rotation. The real rotation/equalisation enforcement for late joiners is Epic 8's (8.6 between-rounds flow, 8.9 relay orchestration). **No `PlayerInfo` flag, no `packages/shared` change.**

**Out of scope:** any new shared contract field (emergent eligibility — see above); min-player (2) round-start gating (Epic 8); a facilitator-facing capacity UI / "session full" lobby banner (the joiner already sees the rejection on Landing); cosmetic between-rounds lobby polish (8.6 owns that surface, `deferred-work.md:144`); the `TEAM_ASSIGN` lost-update race (`deferred-work.md:70` — the new `updateJSON` primitive makes it a trivial follow-up, but applying it there is not this story); session reattach / durable player ids (the socket.id-identity deferral, `deferred-work.md:64`).

### The wire contract is frozen — zero `packages/shared` changes

- `SESSION_JOIN` keeps its **no-ack** signature: success = the `SESSION_STATE` broadcast the joiner receives in-room, failure = typed `ERROR` to the caller. Do not add an ack.
- `SESSION_FULL` and `SESSION_NOT_JOINABLE` are existing server-side `ERROR` code strings (no shared enum — established 2.3 decision). Reuse them with the exact existing messages so Landing renders unchanged copy. No new `ERROR` code is required by this story.
- `PlayerInfo` is untouched — emergent eligibility means no `eligibleToDefuse`/`joinedMidSession` field. `SessionState.status` already includes `'between-rounds'` (`packages/shared/src/types/session.ts`); the refinement just reads it.

### The atomicity primitive — design and boundaries

- **Why not Lua:** a Lua `eval` would run the player-add inside Redis, duplicating `addPlayerToSession` in a second language and violating "all game logic lives in pure TS reducers." The WATCH/MULTI optimistic loop keeps the guard + add in TS and makes *only the commit* atomic — the architecture-compliant choice.
- **Why a generic `updateJSON(key, mutate, opts)`** rather than a bespoke `atomicJoin`: the same load-modify-store race exists on `TEAM_ASSIGN` (`deferred-work.md:70`) and every Epic-8 facilitator write. One reusable, well-tested primitive beats N hand-rolled WATCH loops. The `mutate` returns `{ commit, value?, result }` so the **handler** owns the accept/reject/no-op *meaning* (`'added' | 'rejoin' | 'full' | 'not-joinable' | 'vanished'`) while the store owns the *transaction mechanics*.
- **`mutate` must be pure and idempotent across retries** — it can be called once per attempt. No I/O, no clock, no socket. The only side-channel is the returned `result`.
- **WATCH hygiene:** always `unwatch()` on the non-commit and throw paths. A leaked WATCH poisons the *next* unrelated transaction on the same ioredis connection — a silent, hard-to-trace bug. Cover it in the Task-1 unit tests.
- **The fake must model conflict, not just success.** A single-threaded `Map` fake is atomic by construction, so without the one-shot `onBeforeCommit` interleave hook the race is *untestable*. The hook simulates "another client wrote between my read and my commit," forcing the retry path — that is the test that proves AC1's race clause. Keep the hook self-clearing or the retry loops forever.
- **`WATCH` is connection-scoped — the one real hazard** (see Task 1's ⚠️ bullet). The store holds one shared ioredis connection; concurrent WATCH/MULTI on it interleave and break. The fake *cannot* surface this (it has no connection), so **only the real-Redis concurrency smoke (Task 6) catches a shared-connection bug** — that smoke is non-optional. Run the optimistic transaction on a dedicated connection serialized by an in-process queue (recommended) or a connection per call.

### The join-window refinement — exact semantics

- 2.3's guard: `if (state.status !== 'lobby') → SESSION_NOT_JOINABLE`. 2.6's: admit `status ∈ { 'lobby', 'between-rounds' }`, refuse the rest. `'between-rounds'` is **reachable today** — Story 8.5 (`resolveRound.ts`) flips status to `'between-rounds'` (done). So this is a live code path, not a future hypothetical.
- A `'between-rounds'` joiner routes to `<Lobby/>` on the client (`App.tsx:94` falls non-`active`/non-`preparation` back to Lobby), so the join mechanic works end-to-end with no client change. The lobby is cosmetically imperfect during between-rounds — that's `deferred-work.md:144`/8.6's problem, not this story's.
- **Emergent ineligibility is correct, not a shortcut:** `relayOrder` is populated only by `TEAM_ASSIGN` (Story 2.4), whose handler refuses any non-`lobby` status (`NOT_IN_LOBBY`). So a between-rounds joiner *cannot* be assigned to a team (hence to a `relayOrder`) until Epic 8 deliberately widens `TEAM_ASSIGN`. Until then they sit in the unassigned pool — exactly "admitted but not in the defuse rotation." Epic 8 reads `relayOrder` membership for eligibility; this story guarantees the late joiner isn't in it.

### Existing code you build on (read before editing)

- `apps/server/src/handlers/sessionHandlers.ts` — the `SESSION_JOIN` block (~314–396); `MAX_PLAYERS = 16` (line 155). Reuse `parseSessionJoinPayload`, `joinCodeKey`/`sessionKey`, `sessionRoom()`, the `notFound()` helper, `socket.data.sessionId` writes (Story 2.4 bookkeeping), and the no-ack settle model. The TEAM_ASSIGN handler right below is the reference for "load → guard → persist → broadcast" discipline.
- `apps/server/src/state/redis.ts` — `RedisLike` (the narrow client interface to widen) and `createRedisStore` (where `updateJSON` lands). `getJSON` **throws** on malformed JSON (returns `null` only for absent keys) — preserve that inside the transaction read.
- `apps/server/src/state/index.ts` — `connectRedis` constructs a full `ioredis@^5.11.1` `Redis` and casts to `RedisLike`. `watch`/`multi`/`unwatch`/`exec` already exist on that concrete client; widening `RedisLike` is sufficient — no change to how the client is built.
- `apps/server/src/session/joinSession.ts` — `addPlayerToSession` (pure, idempotent-by-same-reference). It becomes the body of the `commit:true` branch of `mutate`; do not change it.
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — `createMemoryRedisStore(overrides)` (the fake to extend with `updateJSON` + `onBeforeCommit`), `MemoryRedisStore` (`data` map for assertions), `noopLog`, the multi-client harness. The `overrides` failure-injection seam must keep working for `updateJSON`.
- `apps/server/src/state/__tests__/redis.test.ts` — the adapter's direct unit-test home; add `updateJSON` cases here with a scripted `RedisLike`.
- `apps/client/src/ui/Landing.tsx:83-91` — the `ERROR` listener already renders `SESSION_FULL`/`SESSION_NOT_JOINABLE` messages verbatim (read to confirm no change). `apps/client/src/App.tsx:94,102` — between-rounds → `<Lobby/>` routing (read to confirm no change).

### Previous-story intelligence (2.4, done)

- **Jest on server, Vitest on client** — settled; don't re-litigate. Strict `afterEach` teardown is mandatory (hung-worker failure mode).
- Test idioms that work and apply directly here: `it.each` for the status-refusal matrix; asserting the fake store's raw `data` map for persistence/no-write; counting broadcasts on the *other* socket to prove a no-op (idempotent rejoin); seeding the store directly for full/non-lobby states; injecting store failures via `overrides` for the `*_FAILED` path.
- The accepted load-modify-store race that 2.4 inherited and commented is the **same** race class this story now *fixes* at the source for joins — 2.4's `TEAM_ASSIGN` race (`deferred-work.md:70`) becomes a one-line follow-up once `updateJSON` exists (not in this story; note it in Completion Notes as newly cheap).
- socket.id-as-identity is still the open deferral (`deferred-work.md:64`); it interacts with capacity (a flapping client's ghost counts toward the cap) but the **disconnect cleanup** that fixes that is **Story 2.7**, not here. Do not attempt roster cleanup in 2.6.

### Architecture compliance checklist (what this story is judged against)

- **Handler = I/O; logic = pure.** The capacity + window decisions and the player-add live in the pure `mutate` closure (TS); `updateJSON` owns only the WATCH/MULTI mechanics. No logic leaks into Lua.
- **State residence:** load → modify → store through Redis only; now *atomically* on the session key. Single-key transaction, no cross-key scan.
- **AC 2 / refusal paths perform zero writes** — `commit:false` never calls `multi`; assert store byte-equality.
- **Typed events only;** no wire/contract change; `RedisLike`/`RedisStore`/the fake stay structurally typed (no `any`, no `@ts-ignore`).
- **AR15:** the join code appears in no log line on any path (full, refused, admitted, failed).
- **Client is render-only:** no client change; rejections surface through the existing Landing `ERROR` render.
- **O(1) per action:** one `watch` + one `get` + one `multi/exec` per attempt; bounded retries. No `KEYS`/`SCAN`.

### Project Structure Notes

- **Modified (server only):** `state/redis.ts` (`RedisLike` widened + `updateJSON`), `state/__tests__/redis.test.ts` (+ `updateJSON` cases), `handlers/sessionHandlers.ts` (`SESSION_JOIN` refactored onto `updateJSON` + window refinement), `handlers/__tests__/sessionHandlers.test.ts` (+ capacity/race/window/between-rounds/failure suites), `handlers/__tests__/testSocketServer.ts` (fake `updateJSON` + `onBeforeCommit` hook).
- **No changes:** `packages/shared` (contract frozen — including `PlayerInfo` and `status`), `session/joinSession.ts` (reused as-is), any client file (confirmed no-op), `state/index.ts` real wiring (the concrete ioredis client already has the primitives), configs, dependencies.
- Naming: `updateJSON` camelCase on the store; `SESSION_FULL`/`SESSION_NOT_JOINABLE` SCREAMING_SNAKE (existing). Per project-context conventions.

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors; no `// @ts-ignore` (the widened `RedisLike` + generic `updateJSON` must type cleanly).
- All game actions validated server-side — capacity/window are server-authoritative; never trust client-supplied counts or status.
- Redis = all in-flight session state; **O(1) per action** — WATCH/GET/MULTI on one key, bounded retries, no wildcard ops. Postgres untouched (no tick-path writes).
- Pure functions throw nothing, mutate nothing, import no infra — `mutate`/`addPlayerToSession` obey this; spread/map only, unknown input falls through.
- Handlers await all async I/O inside try/catch; never fire-and-forget — the `updateJSON` await and the post-branch awaits are all guarded.
- React render-only; presentation state in `useState` (Landing's error line already does this) — no client change here.
- No `Math.random()` anywhere in this story.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.6: Capacity & Join-Window Guards] (ACs verbatim; 2–16 cap; no mid-round joins; between-rounds admit + ineligible-to-defuse)
- [Source: _agent_docs/planning-artifacts/sprint-change-proposal-2026-06-12-epic-2-lobby-followup.md] ("the accepted SESSION_JOIN load-modify-store race stays with Story 2.6"; 2.7 owns disconnect cleanup, not 2.6)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:65] (the capacity race; "two racers at 15 can both pass `>= MAX_PLAYERS` and push the roster to 17"; Story 2.6 named the home — revisit with WATCH/Lua)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:70] (the TEAM_ASSIGN sibling race — next customer of `updateJSON`, not this story)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:64] (socket.id-identity / ghost-entries-count-toward-MAX_PLAYERS — fixed by Story 2.7's disconnect cleanup, out of scope here)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:144] (between-rounds has no real surface yet — falls back to Lobby; 8.6 owns it)
- [Source: apps/server/src/handlers/sessionHandlers.ts:154-155,314-396] (MAX_PLAYERS; the SESSION_JOIN block to refactor; the "Story 2.6 refines it" comment at :361)
- [Source: apps/server/src/state/redis.ts] (RedisLike to widen; createRedisStore where updateJSON lands; getJSON throws on malformed JSON)
- [Source: apps/server/src/state/index.ts] (connectRedis builds a full ioredis@^5.11.1 Redis cast to RedisLike — watch/multi/exec already present on the concrete client)
- [Source: apps/server/src/session/joinSession.ts] (addPlayerToSession — pure, idempotent; reused as the commit-branch body)
- [Source: apps/server/src/handlers/__tests__/testSocketServer.ts] (createMemoryRedisStore + overrides seam to extend with updateJSON + onBeforeCommit; MemoryRedisStore.data for assertions)
- [Source: apps/server/src/state/__tests__/redis.test.ts] (adapter unit-test home for the updateJSON cases)
- [Source: packages/shared/src/types/session.ts] (SessionState.status includes 'between-rounds'; PlayerInfo/relayOrder shapes — no change)
- [Source: apps/client/src/ui/Landing.tsx:83-91; apps/client/src/App.tsx:94,102] (existing ERROR render for SESSION_FULL/SESSION_NOT_JOINABLE; between-rounds → Lobby routing — confirm no client change)
- [Source: _agent_docs/implementation-artifacts/2-4-team-and-per-player-role-assignment.md] (previous-story patterns: authority/guard ordering, idempotent convergence, test idioms, accepted-race posture)
- [Source: _agent_docs/project-context.md] (pure-reducer/handler-I/O split; O(1) Redis; server-side validation; TS-throughout; AR15)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- Worktree had no `node_modules` (known worktree gap) — ran `pnpm install` + `pnpm --filter @bomb-squad/shared build` before tests would resolve.
- Live-Redis smoke ran via a self-contained harness (`run-smoke-2-6.sh` + `apps/server/smoke-2-6.mjs`) once the Docker daemon was started (`sudo service docker start`): throwaway `redis:7-alpine` + `postgres:16-alpine` on worktree-scoped ports (6399/5499/3099), server booted with `tsx` (no watch), three scenarios driven headlessly against **real** ioredis, server stdout greped for the join code, containers torn down. The transient harness files were removed after the run (not production code).

### Completion Notes List

**What changed (server-only; contract frozen, zero `packages/shared` / client edits):**

1. **`state/redis.ts` — new generic `updateJSON` optimistic CAS + widened `RedisLike`.** Added `watch`/`unwatch`/`multi()`/`duplicate()` to `RedisLike` and a `RedisMultiLike` type (interface-widening only — the concrete ioredis client already has these; `state/index.ts` wiring is unchanged). `updateJSON<T,R>(key, mutate, opts?)` runs `watch → get → mutate → (commit ? multi.set.exec : unwatch)` with bounded retries (default 5) on a null EXEC (WATCHed-key change), throwing `RedisStore.updateJSON: contention retry limit exceeded for key "<key>"` on exhaustion. `mutate` is pure/idempotent; per-attempt meaning rides out on `result`. `getJSON`'s malformed-JSON throw is preserved (factored into a shared `parseJSON`, reused inside the transaction read).

2. **Shared-connection hazard — resolved via a dedicated connection + single global queue.** WATCH is connection-scoped and the server multiplexes over one client, so `updateJSON` lazily `client.duplicate()`s a **dedicated** tx connection (cached in the closure) and serializes **every** call through **one** in-process promise chain. **Chose a single global queue over the per-key `Map` the story floated**, and the story explicitly blesses this ("a single global queue is acceptable at human-speed join rates"): because the dedicated connection is *shared across keys*, a per-key queue would let two different-key transactions interleave MULTI/EXEC on that one connection and silently break the guarantee — exactly the bug the queue exists to prevent. A global queue is free at human-speed lobby join rates; cross-process safety (future) still comes from each process's own connection + WATCH/EXEC-null retry. WATCH is always released (`unwatch`) on the no-commit and throw paths so a leaked WATCH can't poison the next transaction.

3. **`handlers/sessionHandlers.ts` — `SESSION_JOIN` refactored onto `updateJSON`.** The read-only fast paths (payload parse, joincode→sessionId lookup, session load, idempotent-rejoin convergence) stay **outside** the transaction. The capacity guard, join-window guard, and `addPlayerToSession` now live in a single pure `mutate` that the transaction WATCHes — so both are re-evaluated against the committed-at-write state, closing `deferred-work.md:65`. A `JoinOutcome` discriminated union carries `vanished | rejoin | not-joinable | full | added` back out, with the committed snapshot threaded on `added` so the broadcast uses the post-commit state (never a racy re-read). **Join-window refined:** admit `lobby` **or** `between-rounds`; refuse `preparation`/`active`/`ended`. Both existing error messages kept verbatim. The old "Known accepted race" / "Defensive join-window guard" comments were replaced with the atomic-evaluation + Epic-8-owns-relay-eligibility note. AR15 preserved (no join code in any log line — verified by a dedicated test).

4. **Test harness (`testSocketServer.ts`).** `createMemoryRedisStore` gained a matching `updateJSON` over its `Map` plus an optional **one-shot, self-clearing** `onBeforeCommit` interleave hook (second arg) that fires once between the fake's read and write; the fake notices the bytes changed and re-runs `mutate` against the new value — modelling WATCH/EXEC-null → retry, which is the only way a single-threaded fake can surface AC1's race. The `overrides` failure-injection seam still covers `updateJSON`.

**Tests added/updated:** `redis.test.ts` — 6 `updateJSON` cases (commit, no-commit/no-multi/unwatch, one-shot null-EXEC → one retry, retry-limit throw, malformed-JSON unwatch+throw, global-serialization). `sessionHandlers.test.ts` — AC2 mid-round `it.each` (preparation/active/ended, zero-write byte-equality), AC3 between-rounds admit (joiner in players, in NO relayOrder, rotation untouched, both sockets get state), AC1 headline race via `onBeforeCommit` (loser → SESSION_FULL, roster capped at 16), `*_FAILED` retargeted to override `updateJSON` (incl. retry-limit throw), AR15 capturing-log test across admitted/full/refused. Existing 16-player non-raced SESSION_FULL test retained.

**Gates:** `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore`. `pnpm -r test` → all green (server **312**, client **204** unchanged, shared untouched). `pnpm --filter @bomb-squad/client build` → succeeds. **Live-Redis smoke → `SMOKE_RESULT: PASS`** against real ioredis:
- **Scenario 1 (capacity, non-raced):** session filled to exactly 16; 17th join → `SESSION_FULL`; roster never exceeded 16.
- **Scenario 2 (the headline concurrency race):** at 15 occupancy, two joins fired in the same tick (`Promise.all`) → exactly one admitted, exactly one `SESSION_FULL`, final `GET session:<id>` roster exactly **16, never 17**. This is the path the in-memory fake cannot surface (one shared ioredis connection) — proving the dedicated-connection + global-queue resolution of the WATCH hazard holds against real Redis.
- **Scenario 3 (join-window):** `between-rounds` join → admitted, joiner in **no** team's `relayOrder`, rotation untouched; after flipping to `active`, next join → `SESSION_NOT_JOINABLE`.
- **AR15:** `grep` of server stdout for the 6-char join code → **0 hits** ("AR15 OK: no join code in server logs").

**Task 5 — confirmed no client change:** `Landing.tsx:83-91` renders `SESSION_FULL`/`SESSION_NOT_JOINABLE` verbatim via the existing `ERROR` listener; `App.tsx:94-103` routes `between-rounds` to `<Lobby/>` via the non-`active`/non-`preparation` catch-all. No capacity UI / banner / `PlayerInfo` flag added.

**Newly cheap follow-ups (out of scope here):** the `TEAM_ASSIGN` lost-update race (`deferred-work.md:70`) is now a one-line adoption of `updateJSON`; Epic-8 facilitator writes are its next customers.

### File List

- `apps/server/src/state/redis.ts` — widened `RedisLike` (+`RedisMultiLike`), added `updateJSON` optimistic CAS (dedicated connection + global queue), factored `parseJSON`.
- `apps/server/src/state/__tests__/redis.test.ts` — `FakeRedis` gained watch/unwatch/multi/duplicate + `failNextExec`; added `updateJSON` describe block (6 cases).
- `apps/server/src/handlers/sessionHandlers.ts` — `SESSION_JOIN` refactored onto `updateJSON`; `JoinOutcome` union; join-window refined to admit `between-rounds`.
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — `createMemoryRedisStore` gained `updateJSON` + one-shot `onBeforeCommit` race hook (`MemoryRedisStoreOptions`).
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — AC1 race, AC2 matrix, AC3 between-rounds, `*_FAILED` retarget, AR15 tests.

*(A transient live-smoke harness — `run-smoke-2-6.sh` + `apps/server/smoke-2-6.mjs` — was created to run Task 6's real-Redis smoke, then removed after the run; not part of the committed change set.)*

### Change Log

- 2026-06-14 — Implemented Story 2.6: race-safe capacity cap via new `RedisStore.updateJSON` (WATCH/MULTI optimistic CAS on a dedicated connection, single global serialization queue) + `SESSION_JOIN` join-window refinement (`between-rounds` now admits). Server-only; wire contract frozen. All gates green: `tsc --noEmit` clean, `pnpm -r test` (server 312 / client 204 / shared), client build, and live-Redis smoke `SMOKE_RESULT: PASS` (capacity, concurrency race capped at 16, between-rounds admit / active refuse, AR15 no-leak).
