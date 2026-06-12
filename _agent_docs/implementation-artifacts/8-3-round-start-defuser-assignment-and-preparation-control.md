---
baseline_commit: ea825dde87bf5f355a051c480bfa7bb1368387bf
---

# Story 8.3: Round Start, Defuser Assignment & Preparation Control

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to control the preparation phase and start the round with the right Defuser,
so that the team orients and the relay rotation is honoured.

## Acceptance Criteria

1. **Given** a configured round, **When** I open the Preparation phase, **Then** its duration is Facilitator-controlled (default 2–5 min) and players see role-gated prep content. (FR8)
2. **Given** rotation order (default team join order), **When** I start the round, **Then** the next player in rotation is assigned Defuser and `ROUND_START` (Facilitator-only) begins the round, routing players to their surfaces and voice channels. (FR11)

## Dependencies & Scope Boundaries (READ FIRST)

This story is being built **ahead of** several stories it touches edges with. The scope fences below are deliberate decisions, not oversights:

- **Story 8.1 (`ROUND_CONFIGURE`) is backlog.** "A configured round" = the session's existing `config` field — populated with `DEFAULT_ROUND_CONFIG` at `SESSION_CREATE` (easy / 3 modules / 5:00 / 25%) and optionally overridden via the create payload. Do **not** implement `ROUND_CONFIGURE`; the prep/start flow must work off `SessionState.config` as-is.
- **Story 8.2 (bomb generation) is backlog.** `ROUND_START` does **not** generate or broadcast a bomb in this story. Leave an explicit seam comment in the handler (`// Story 8.2: bomb generation slots in here, before status flip`) — the handler shape (load → reduce/build → persist → broadcast) must let 8.2 insert generation without restructuring.
- **Story 8.4 (timer) is the next story in this worktree.** `ROUND_START` does **not** start a timer. Leave a seam comment (`// Story 8.4: TimerState minted + broadcast here`). Do not touch `TimerState`.
- **Epic 3 (voice) is backlog.** "Routing players to voice channels" is satisfied **structurally**: at `ROUND_START` the server joins each player's socket to its Socket.IO team room `session:{sessionId}:team:{teamId}` (architecture Pattern 1). LiveKit token minting/room moves land in Epic 3 — note this in code, do not stub LiveKit calls.
- **Story 4.6 (prep placeholder bomb) is backlog.** The Defuser's prep content ships as an honest copy-driven placeholder panel where 4.6 will mount its view. Do not build a placeholder 3D bomb here.
- **Story 5.2 (manual viewer) IS in this worktree** (master merged 2026-06-13). Experts'/Spectators' prep content mounts the real `ManualViewer` (`apps/client/src/manual/ManualViewer.tsx`) fed by `buildChapters(...)` over the registered modules' `getManualPages()` output — this is exactly the seam 5.2 left open ("Wiring all registered modules → chapters lands with the real modules, Story 5.3+"). Today only `dev-demo` is registered (`SANDBOX_MODULES` in `apps/client/src/modules/index.ts`), so the manual shows one demo chapter; 5.3+ chapters appear automatically through the same wiring. Do not modify the manual code itself.
- **Rotation pointer advancement** (`currentDefuserIndex++` between rounds) belongs to Stories 8.6/8.9. This story **reads** the pointer to pick the Defuser; it never advances it.
- **Prep duration is facilitator-controlled, not timer-enforced.** GDD A9: "Prep phase is Facilitator-controlled [ASSUMPTION: 2–5 min default]". There is **no server countdown** for prep — prep lasts until the Facilitator sends `ROUND_START`. The "default 2–5 min" is display guidance on the facilitator's prep surface, nothing more.

## Tasks / Subtasks

- [x] Task 1 — Shared contract: `PREPARATION_OPEN` event + `RoundState` type (AC: 1, 2)
  - [x] Add `PREPARATION_OPEN: () => void` to `ClientToServerEvents` (`packages/shared/src/events/client-to-server.ts`). Facilitator-only, no payload, no ack — success is the `SESSION_STATE` broadcast, failure a typed `ERROR` (the frozen-contract pattern `TEAM_ASSIGN` established).
  - [x] Add `RoundState` to `packages/shared/src/types/` (new file `round.ts`, export via `types/index.ts` + package root): `{ roundNumber: number; status: 'active'; defusers: Partial<Record<TeamId, string>>; retry: boolean }`. Architecture names this shape for `session:{id}:round:{n}` (status, active defuser per team, retry flag). `retry` is always `false` here (Story 8.8 owns it); `status` gains more values in 8.5.
  - [x] No `ServerToClientEvents` change — phase transitions ride the existing `SESSION_STATE` broadcast.
- [x] Task 2 — Pure session transitions in `apps/server/src/session/` (AC: 1, 2)
  - [x] `openPreparation.ts`: pure `(state: SessionState) => SessionState`. Sets `status: 'preparation'` and increments `roundNumber` (0→1 on first open — `roundNumber` is "the round being prepared/played"; 8.2's `templateSeed = hash(sessionId + ":" + roundNumber)` depends on this being settled **before** generation). Guard clauses (same-reference return, no throws): status not in `'lobby' | 'between-rounds'` → unchanged. (`'between-rounds'` is unreachable until 8.5/8.6 but costs nothing and is the documented contract.)
  - [x] `startRound.ts`: pure `(state: SessionState) => SessionState | { state: SessionState; round: RoundState }`-style result (pick one clean shape; the handler needs both the next SessionState and the RoundState to persist). Behaviour:
    - Guard: `status !== 'preparation'` → unchanged/null result (handler emits `ERROR`).
    - Guard: no team with a non-empty `relayOrder` → unchanged/null (handler emits `ERROR` — "Assign at least one player to a team first.").
    - For **each existing team**: defuser = `relayOrder[currentDefuserIndex normalized]`. **Normalize defensively**: `relayOrder.length === 0` → skip team; index out of range → use `currentDefuserIndex % relayOrder.length`. This resolves the read-side of the deferred-work item "`currentDefuserIndex` not re-clamped when a player leaves relayOrder" (2.4 review deferral) — document with a comment citing it.
    - Role flips in `players`: the selected player's `role` becomes `'defuser'`; any **other** player on that same team currently holding `'defuser'` becomes `'expert'` (one defuser per team, invariant). Spectators and the facilitator are never touched.
    - Sets `status: 'active'`. Does NOT touch `cumulativeTimeMs`, `currentDefuserIndex`, `config`, or `roundNumber`.
  - [x] Both functions: spread-only immutability, no I/O / clock / randomness — identical discipline to `assignPlayerToTeam` (read it first: `apps/server/src/session/assignTeam.ts`).
- [x] Task 3 — `PREPARATION_OPEN` handler in `apps/server/src/handlers/sessionHandlers.ts` (AC: 1)
  - [x] Copy the `TEAM_ASSIGN` pipeline verbatim (it is the canonical facilitator-authority gate — its header comment says Epic-8 actions copy it): resolve `socket.data.sessionId` (`NOT_IN_SESSION`) → load from Redis → **authority gate first** (`NOT_FACILITATOR`, before any state inspection leaks) → phase guard (`status !== 'lobby'` → `NOT_IN_LOBBY`-style error; use code `CANNOT_OPEN_PREP`, message in operator voice) → pure `openPreparation` → idempotent same-reference return = silent no-op → persist `sessionKey` then broadcast `SESSION_STATE` to `sessionRoom` → try/catch → `PREPARATION_OPEN_FAILED`.
  - [x] Log `{ sessionId, roundNumber }` at info ("preparation opened"). **Never log the join code** (AR15).
- [x] Task 4 — `ROUND_START` handler (AC: 2)
  - [x] Same pipeline: pointer → load → facilitator gate → `startRound` → on guard failure emit typed `ERROR` (`CANNOT_START_ROUND` with a reason message; e.g. not in preparation, or no populated team).
  - [x] Persist **both** keys before any emit: `sessionKey(sessionId)` (new SessionState) and `roundKey(sessionId, roundNumber)` (new `RoundState`) — `roundKey` already exists in `apps/server/src/state/keys.ts`. Two `setJSON` calls are not atomic; on the second failing, best-effort rollback is NOT required (session re-broadcast self-heals; note the accepted non-atomicity in a comment, same posture as `SESSION_CREATE`'s two-key write).
  - [x] **Team-room routing:** after persist, fetch the session's sockets (`io.in(sessionRoom(sessionId)).fetchSockets()`) and join each socket whose `socket.id` appears in `players` with a `teamId` to `session:{sessionId}:team:{teamId}`. Facilitator/unassigned spectators join no team room. Export a `teamRoom(sessionId, teamId)` helper beside `sessionRoom`. Seam comment: Epic 3 re-mints voice tokens here on role change.
  - [x] Broadcast `SESSION_STATE` to the session room (it carries the role flips + status — clients route surfaces off it). Seam comments for 8.2 (generation + `BOMB_INIT`) and 8.4 (timer) in their flow positions.
  - [x] Log `{ sessionId, roundNumber, defusers }` at info.
- [x] Task 5 — Handler integration tests (`apps/server/src/handlers/__tests__/sessionHandlers.test.ts`, existing `TestSocketServer` harness) (AC: 1, 2)
  - [x] `PREPARATION_OPEN`: happy path (lobby → preparation, roundNumber 1, all sockets receive `SESSION_STATE`); non-facilitator → `NOT_FACILITATOR` + store byte-identical + no broadcast (300ms spy-window pattern from 2.4); already in preparation → silent idempotent no-op (no persist/broadcast/error); never-joined socket → `NOT_IN_SESSION`; injected `setJSON` failure → `PREPARATION_OPEN_FAILED`.
  - [x] `ROUND_START`: happy path (preparation → active; rotation pick = `relayOrder[0]` first round; previous defuser-role holder on the team flipped to expert; `RoundState` persisted at `roundKey`; both team's sockets joined to their team rooms — assert via `socket.rooms` / `fetchSockets`); facilitator-only rejection; `status === 'lobby'` → `CANNOT_START_ROUND`; no populated teams → `CANNOT_START_ROUND`; out-of-range `currentDefuserIndex` seeded → modulo pick, no throw; spectator on team keeps role.
  - [x] Pure-function unit tests (`apps/server/src/session/__tests__/`): both transitions — happy, each guard returns same reference, deep-frozen input does not throw (immutability test is **never** skipped, project rule), idempotency.
- [x] Task 6 — Client surface routing (AC: 1, 2)
  - [x] `App.tsx`: replace the `session === null ? <Landing/> : <Lobby/>` branch with status-routed surfaces from the server snapshot (no router, no URL state — comment already says "Surface derives from the server snapshot"): `lobby` → `Lobby`, `preparation` → new `Preparation`, `active` → new `ActiveRound`, others → fall back to `Lobby` for now (8.5/8.6 own them).
  - [x] `ui/Preparation.tsx` — role-gated single component (role = `session.players[getSocket().id]?.role`):
    - **Facilitator:** prep heading + guidance line ("Walk them through the manual — two to five minutes is the sweet spot." — operator voice, new `copy.ts` strings), the **upcoming Defuser per team** (derive client-side exactly as the server does: `relayOrder[currentDefuserIndex % relayOrder.length]`, display name from `players`), and a "Start the round" `ConfirmButton` (existing component — destructive/major actions use two-step confirm) that emits `ROUND_START`. Listen for `ERROR` → inline `role="alert"` line, `text-led-red`, cleared on the facilitator's own next emit (the 2.4 review patch pattern — do NOT clear on every `SESSION_STATE`).
    - **Defuser-to-be:** role line ("You're defusing this round.") + placeholder panel where 4.6's placeholder bomb will mount — clearly-marked seam, minimal markup.
    - **Experts / Spectators:** role line ("You're on the manual.") + the real `ManualViewer` mounted with `buildChapters(SANDBOX_MODULES.flatMap((m) => m.getManualPages()))` (EXPERIENCE.md: during prep, Experts and Spectators browse the full manual). Build the chapter list once (memo/module-scope) — `getManualPages()` is pure.
  - [x] `ui/Lobby.tsx`: add the Facilitator-only "Open preparation" `ConfirmButton` that emits `PREPARATION_OPEN` (this is the AC-1 entry point). Reuse the existing lobby error-line pattern.
  - [x] `ui/ActiveRound.tsx` — role-routed: **Defuser** mounts the existing `BombScene` (it tolerates `bomb === null` via `DEV_PLACEHOLDER_MODULES` until 8.2 lands — leave a comment); **Expert** mounts `ManualViewer` (same chapters wiring as prep — EXPERIENCE.md IA: active-round Expert surface IS the manual); **Spectator / Facilitator** get minimal labeled placeholder panels (8.5+/Epic 9 surfaces). No HUD work (4.4/4.5 own timer/strike HUD).
  - [x] All new strings in `ui/copy.ts` (dry, deadpan, operator voice — see existing file). No fast-blinking elements, no nested modals (UX-DR on facilitator dashboard under social pressure).
- [x] Task 7 — Gates & verification (AC: all)
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore`. `pnpm -r test` all green. `pnpm --filter @bomb-squad/client build` green.
  - [x] Headless live smoke (pattern from 2.4 Debug Log): boot server via `tsx` against throwaway redis/postgres containers; facilitator + 2 joiners; assign both to Team A; `PREPARATION_OPEN` → all sockets see `status: 'preparation'`; `ROUND_START` → `status: 'active'`, first relayOrder player has `role: 'defuser'`, `RoundState` present in Redis, sockets in team room; non-facilitator `PREPARATION_OPEN` rejected with no broadcast.
  - [ ] **Jay verifies interactively** (two browser windows, `pnpm dev`): host opens prep from the lobby, joiner sees the prep surface for their role, host starts the round, joiner routed to their active surface, defuser sees the bomb scene. Record his observed result in Completion Notes — story is not done without it (project verification rule).

## Dev Notes

### Existing code being modified — current state (READ THESE FILES FIRST)

- **`apps/server/src/handlers/sessionHandlers.ts` (UPDATE)** — owns `SESSION_CREATE`/`SESSION_JOIN`/`TEAM_ASSIGN`. The `TEAM_ASSIGN` handler is explicitly documented as "the pattern every Epic-8 facilitator action copies": validate → `socket.data.sessionId` pointer (never authority) → Redis load → **facilitator gate before anything that could leak session contents** → phase guard → pure function → same-reference = silent no-op → persist-then-broadcast → try/catch typed failure. `SessionSocketData { sessionId?: string }` is already set in all session-entry paths. Preserve: all three existing handlers untouched; the accepted load-modify-store race posture (single-process V1, human-speed actions, commented — do NOT add locks/WATCH).
- **`apps/server/src/session/assignTeam.ts` (READ, not modified)** — the pure-function house style: spread-only, guard clauses return the same reference, doc-comment explains ownership. Its header notes "`currentDefuserIndex` stays 0 … Epic 8 note: revisit" — your `startRound` is that revisit (read-side normalization only).
- **`packages/shared/src/types/session.ts` (likely no change)** — `SessionState.status` already includes `'preparation' | 'active'`; `TeamState` already carries `relayOrder` (= join/assignment order, the GDD default rotation) and `currentDefuserIndex`. The types were built for this story — extend nothing unless `RoundState` placement demands an import.
- **`packages/shared/src/events/client-to-server.ts` (UPDATE)** — `ROUND_START: () => void` **already exists** in the contract (typed, unhandled server-side). You are adding `PREPARATION_OPEN` and writing the first handler for `ROUND_START`. Do not change existing signatures.
- **`apps/client/src/App.tsx` (UPDATE)** — currently: platform gate → loading screen → AppShell with `session === null ? Landing : Lobby`, plus three dev-harness branches (`/dev/bomb`, `/dev/sandbox`, `/dev/manual` — Stories 4.x/5.1/5.2 — **preserve all three**). Surfaces derive from the server snapshot; keep it that way (no router).
- **`apps/client/src/ui/Lobby.tsx` (UPDATE)** — has facilitator A/B chips + role select + the error-surface pattern from the 2.4 review patch (clear on own next emit, not on `SESSION_STATE`). Add the open-prep control; touch nothing else.
- **`apps/client/src/store/gameStore.ts` (no change expected)** — `SESSION_STATE` already lands via `setSession`; status routing is pure render-side. `bomb` stays null until 8.2.

### Architecture compliance (non-negotiable)

- **Pure reducer discipline** (Pattern 2): `openPreparation`/`startRound` import nothing from socket.io/ioredis/pg/fastify; no `Date.now()`/`Math.random()`/`setTimeout`; unknown/invalid input returns state unchanged, never throws. Handlers own ALL I/O: parse → load → pure fn → persist → emit.
- **Server-authoritative**: clients emit intents (`PREPARATION_OPEN`, `ROUND_START`) and render the snapshot. The client never flips its own phase optimistically — surface routing reacts to the broadcast `SESSION_STATE` only.
- **Authority gates**: both new events are Facilitator-only, validated against the **freshly-loaded** Redis state (`state.players[socket.id]?.role === 'facilitator'`), never against `socket.data`.
- **Rooms** (Pattern 1): `session:{id}` exists (`sessionRoom`); this story introduces `session:{id}:team:{teamId}` joins. Epic 8.4+ team-scoped bomb/timer broadcasts depend on this routing being correct.
- **Redis keyspace**: `sessionKey` and `roundKey` only, via `apps/server/src/state/keys.ts`. O(1) reads/writes; no scans.
- **Event naming**: SCREAMING_SNAKE_CASE; payload types (none needed — both events are payload-less) would live in `packages/shared/src/events/payloads.ts`.
- **Persist then emit**; on persist failure emit nothing but a recoverable `ERROR`. Never fire-and-forget an await.
- **Logging**: structured, keyed by `sessionId`/`roundNumber`; never log join codes (AR15) or tokens.

### Design decisions settled for this story (do not re-litigate, do not silently change)

1. **`roundNumber` increments at `PREPARATION_OPEN`** (0→1 first time), not at `ROUND_START`. Rationale: prep belongs to a specific round (8.6: "the next round's Preparation phase begins for the next Defuser"), and 8.2's seed chain needs `roundNumber` fixed before generation, which happens inside `ROUND_START` before the status flip.
2. **The upcoming Defuser is *derivable* during prep** (`relayOrder[currentDefuserIndex % len]`) **and *committed* at `ROUND_START`** (role flip in `players`). AC-2's "assigned" is the commit; the prep surface shows the derivation so the team orients. Both sides use the identical expression — drift between them is a bug.
3. **One defuser per team, enforced at start**: rotation-selected player → `'defuser'`; any other `'defuser'` on that team → `'expert'`. Spectators never auto-flip (a spectator in `relayOrder` who comes up in rotation DOES become defuser — relay order is the authority; GDD: every player defuses).
4. **Prep has no countdown.** Facilitator-controlled means the facilitator ends it by starting the round. Display "2–5 min" as guidance copy only (GDD A9).
5. **Sequential-relay sequencing (which team's bomb is "live") is Story 8.9's problem.** Here, `ROUND_START` assigns defusers for ALL populated teams and activates the round.

### Pitfalls from prior reviews (this codebase's known sharp edges)

- **`socket.id` is player identity** (accepted V1 posture, multiple deferrals): a refresh mid-prep orphans the player. Do NOT fix reattach here — but also do not introduce any new dependence on `socket.data` for authority.
- **Error-surface UX**: clearing client error state on any `SESSION_STATE` was a shipped bug (2.4 review patch). Clear on the user's own next emit.
- **Idempotent no-ops are silent**: same-reference return from the pure fn → no persist, no broadcast, no error. Tests assert the silence (ERROR-fence pattern in 2.4's tests).
- **`fetchSockets()` is async** — await it; it returns `RemoteSocket`s whose `.join()` is synchronous-ish but treat per Socket.IO v4 docs (in-process here, no adapter).
- **Client `ROUND_START` button must tolerate rejection** — the server may say `CANNOT_START_ROUND` (e.g. someone left and a team emptied between render and click). Render the error, never assume success.
- **4.3 flagged protocol note** (for awareness, owned by 8.4): strike broadcasts must pass through a transient `'struck'` module state. Not this story's code, but don't write anything that precludes it.

### Testing standards summary

- Pure fns: Jest, Node, zero infra, in `apps/server/src/session/__tests__/`. Required set: happy, guards (unchanged same-reference), idempotency, deep-frozen-input immutability.
- Handlers: integration via the existing `TestSocketServer` harness in `apps/server/src/handlers/__tests__/` — never mock the pure function, call through it. Use the established fake Redis store + injected-failure pattern.
- No `setTimeout`/`Date.now()` in tests of pure logic (neither function takes time — easy).
- Client: routing/copy are render-only; no logic tests required (logic leaks → move server-side). Existing client suites must stay green.

### Project Structure Notes

- New server files: `apps/server/src/session/openPreparation.ts`, `apps/server/src/session/startRound.ts` (+ `__tests__`). Matches the established one-pure-function-per-file pattern (`createSession.ts`, `joinSession.ts`, `assignTeam.ts`).
- New shared file: `packages/shared/src/types/round.ts`, exported through `types/index.ts` and the package root. `.js` extensions on relative imports (NodeNext convention already in force).
- New client files: `apps/client/src/ui/Preparation.tsx`, `apps/client/src/ui/ActiveRound.tsx`, exported via `ui/index.ts`; strings in `ui/copy.ts`.
- No new dependencies. No build/config changes. `packages/shared` stays framework-free.

### Project Context Rules (from `_agent_docs/project-context.md` — authoritative)

- TypeScript throughout; `tsc --noEmit` zero errors before commit; no `@ts-ignore`.
- Reducers/pure fns: zero infra imports, no in-place mutation, unknown actions fall through unchanged, no throws.
- Socket events typed in `packages/shared/src/events/` and imported both sides — untyped `emit(string, any)` forbidden.
- Redis = in-flight state; **never** write Postgres in a socket handler (session-end only — not this story).
- Never run the bomb timer on the client; never emit a socket event from a pure function.
- Lobby/join codes are secrets — never logged.
- Naming: SCREAMING_SNAKE_CASE events, PascalCase components, camelCase hooks/`use` prefix.
- UI: operator-world styling, no fast-blinking elements, no nested modals; microcopy dry/deadpan ("Bring them in" voice).
- Never trust client payloads — though both new events are payload-less, the authority + phase gates ARE the validation.

### Previous Story Intelligence

- No prior Epic-8 story exists; nearest relevant work: **2.4** (facilitator-authority handler + lobby controls — its Dev Agent Record is the template for this story's handler/test/UI work) and **4.3** (client registry/scene patterns; `BombScene` reads `s.bomb?.modules ?? DEV_PLACEHOLDER_MODULES`, so mounting it bomb-less is safe).
- **Stories 5.1 + 5.2 merged from master into this worktree 2026-06-13** (baseline: tsc 0 errors; tests 53 shared / 143 client / 169 server, all green). 5.1 added the module plugin scaffold (`modules/dev-demo/`, `modules/index.ts` barrel, `/dev/sandbox` route, interaction/dispatch primitives); 5.2 added the manual surface (`manual/` — `ManualViewer`, `buildChapters`, search, `publishPosition` into `uiStore`). Reuse, don't duplicate: chapter grouping, search, and keyboard nav all exist as pure modules under `apps/client/src/manual/`.
- 2.4's live-smoke methodology (tsx server + throwaway containers + real socket.io-clients + broadcast spy windows + AR15 grep) is the expected verification bar — reuse it.
- Worktree note: this is the `story-8-3-8-4` worktree (`worktree-story-8-3-8-4` branch). Worktrees lack gitignored `.env` files and stale main-built images — provision env and use `--build` with a worktree-scoped compose project name if you need the Docker stack (known project gotcha); the headless smoke pattern (tsx + throwaway redis/postgres containers) avoids the stack entirely and is preferred.

### Latest tech information

No new libraries. Socket.IO v4.8.x (already pinned): `io.in(room).fetchSockets()` returns local sockets in-process (no adapter installed) and their `join()` is supported on the returned instances; `socket.data` typing flows through the 4-generic `Server` form already adopted in 2.4.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.3] — story statement + ACs (lines ~1171–1185)
- [Source: _agent_docs/planning-artifacts/epics.md#Epic 8] — FR8/FR11 coverage, UX-DR11/12
- [Source: _agent_docs/game-architecture.md#Pattern 1] — rooms model (`session:{id}:team:{teamId}`)
- [Source: _agent_docs/game-architecture.md#Pattern 2] — pure reducer / handler pipeline
- [Source: _agent_docs/game-architecture.md#Redis Keyspace] — `session:{id}:round:{n}` → RoundState shape
- [Source: _agent_docs/game-architecture.md#API Contracts] — `ROUND_START` Facilitator-only; validation boundaries
- [Source: gdds/gdd-Ktane-2026-06-09/gdd.md#Core Gameplay Loop + A9] — prep facilitator-controlled, 2–5 min assumption, rotation = team join order
- [Source: ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Information Architecture] — prep surface role-gating; role-gating principle; voice/tone
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] — 2.4 deferrals (`currentDefuserIndex` clamp, relayOrder integrity), error-surface patch
- [Source: _agent_docs/implementation-artifacts/2-4-team-and-per-player-role-assignment.md#Dev Agent Record] — canonical handler/test/smoke patterns

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors across all three workspaces, no `@ts-ignore`.
- `pnpm -r test` → shared 53 ✓ (untouched), client **147 ✓** (was 143 — +4 `rotation.test.ts`), server **203 ✓** (was 169 — +7 openPreparation, +14 startRound pure-fn, +13 handler integration: 6 PREPARATION_OPEN + 7 ROUND_START).
- `pnpm --filter @bomb-squad/client build` → success (chunk-size warning pre-existing from 4.x three.js).
- **Live end-to-end smoke (headless, 2026-06-13):** booted the worktree server via `tsx` on :3299 against throwaway `redis:7-alpine`/`postgres:16-alpine` containers (`/health` → ok both probes). Three real `socket.io-client`s: facilitator hosted; Maya + Devon joined as experts, both assigned Team A. Non-facilitator `PREPARATION_OPEN` → `NOT_FACILITATOR` with **no broadcast leaked** (300 ms spy window). Facilitator `PREPARATION_OPEN` → all 3 sockets received `status:'preparation'`, `roundNumber:1`. `ROUND_START` → all 3 received `status:'active'` with Maya (relayOrder[0]) flipped to `defuser`, Devon untouched as `expert`. Duplicate `ROUND_START` → `CANNOT_START_ROUND`. Redis `session:{id}:round:1` = `{"roundNumber":1,"status":"active","defusers":{"A":"<mayaSocketId>"},"retry":false}` ✓. `grep -c <joinCode> server.log` → **0** (AR15 verified live); info lines carry `{sessionId, roundNumber, defusers}` only. Server process + containers removed after. (Port note: :3199 was occupied by a stale prior-session smoke process — used :3299 rather than killing it.)

### Completion Notes List

- **Task 1 — shared contract:** `PREPARATION_OPEN: () => void` added to `ClientToServerEvents` (doc comment states facilitator-only + no-ack contract). New `packages/shared/src/types/round.ts` with `RoundState { roundNumber, status:'active', defusers: Partial<Record<TeamId,string>>, retry }`, exported via `types/index.ts` → package root. No `ServerToClientEvents` change — phase flips ride `SESSION_STATE`.
- **Task 2 — pure transitions:** `openPreparation.ts` (lobby|between-rounds → preparation, `roundNumber+1`; any other status → same reference) and `startRound.ts` (`StartRoundResult` discriminated union; preparation → active; per-team rotation pick with **non-negative modulo** normalization — the documented read-side resolution of the 2.4 `currentDefuserIndex` deferral; role commits: pick → `'defuser'`, displaced same-team `'defuser'` → `'expert'`, facilitator/off-team never touched; relayOrder entries missing from `players` skip the team, all-skipped → `NO_POPULATED_TEAM`). Both spread-only, zero infra imports, no clock/randomness. 21 unit tests incl. deep-frozen-input immutability for both.
- **Task 3 — PREPARATION_OPEN handler:** TEAM_ASSIGN pipeline copied: pointer → load → **authority gate first** → phase guard (`active`/`ended` → `CANNOT_OPEN_PREP`; duplicate-open falls through to the pure fn's same-reference return = silent no-op) → persist-then-broadcast → `PREPARATION_OPEN_FAILED` catch. Info log `{sessionId, roundNumber}`, never the join code.
- **Task 4 — ROUND_START handler:** same pipeline; `startRound` refusals map to `CANNOT_START_ROUND` with reason-specific operator-voice messages. Persists **both** `sessionKey` and `roundKey` before any emit (non-atomic two-key write commented, same posture as SESSION_CREATE). Team-room routing via `io.in(sessionRoom).fetchSockets()` → `member.join(teamRoom(sessionId, teamId))` for every rostered socket with a team; new exported `teamRoom()` helper beside `sessionRoom()`. Seam comments in flow position for 8.2 (generation + BOMB_INIT) and 8.4 (TimerState); Epic 3 voice-token note on the routing loop.
- **Task 5 — tests:** 13 handler integration tests in the existing `TestSocketServer` harness (happy paths incl. team-room membership asserted via `io.in(...).fetchSockets()`, NOT_FACILITATOR with broadcast-spy + store-byte-identical, silent idempotent duplicate-open with ERROR-fence, CANNOT_OPEN_PREP, CANNOT_START_ROUND ×2, out-of-range index modulo pick, NOT_IN_SESSION ×2, injected `setJSON` failures → `*_FAILED` with no broadcast). One test-only flake fixed during red→green: `setupPrepared` now awaits each broadcast on **all** sockets so stale snapshots can't race later listeners.
- **Task 6 — client surfaces:** `App.tsx` routes by `session.status` (`preparation` → `Preparation`, `active` → `ActiveRound`, else `Lobby`; all three dev routes preserved). `ui/Preparation.tsx`: facilitator panel (guidance copy, per-team "On the bomb next" derived via shared expression, two-step `ConfirmButton` "Start the round", code-filtered ERROR banner cleared on own next emit per the 2.4 review patch); upcoming-defuser panel (4.6 seam comment + placeholder copy); Experts/Spectators get the **real `ManualViewer`** fed by `buildChapters(SANDBOX_MODULES.flatMap(getManualPages))` — the 5.2 wiring seam, built once via `useMemo`. `ui/ActiveRound.tsx`: defuser → `BombStage`+`BombScene` (tolerates `bomb===null` until 8.2), expert → `ManualViewer`, spectator/facilitator → labeled placeholders. `ui/rotation.ts` `upcomingDefuserId()` mirrors `startRound`'s pick expression (4 unit tests, incl. modulo + negative-index). Lobby: facilitator-only "Open preparation" `ConfirmButton`; `CANNOT_OPEN_PREP`/`PREPARATION_OPEN_FAILED` added to the lobby's owned error codes; clear-on-own-emit preserved. New strings in `copy.ts` (operator voice; no blinking, no modals).
- **Task 7 — gates:** typecheck/tests/build all green (Debug Log); live three-client headless smoke executed end-to-end incl. AR15 and the no-broadcast-on-rejection check.
- **⚠️ OUTSTANDING — Jay's interactive verification (Task 7 final subtask, unchecked):** two browser windows (`pnpm dev` + server): host opens prep from the lobby → joiner sees role-gated prep surface → host starts round → joiner routes to their active surface; defuser sees the bomb scene. Per the project verification rule, the observed result goes here before the story can be marked done.
- **Deviation (none material):** prep-phase role gating for the manual uses the *derived* upcoming defuser (not committed roles) so the player about to defuse sees their orientation panel during prep — committed roles don't exist until ROUND_START by design (story decision 2).

### File List

- packages/shared/src/types/round.ts (created — RoundState)
- packages/shared/src/types/index.ts (modified — RoundState export)
- packages/shared/src/events/client-to-server.ts (modified — PREPARATION_OPEN)
- apps/server/src/session/openPreparation.ts (created — pure transition)
- apps/server/src/session/startRound.ts (created — pure transition + StartRoundResult)
- apps/server/src/session/__tests__/openPreparation.test.ts (created — 7 tests)
- apps/server/src/session/__tests__/startRound.test.ts (created — 14 tests)
- apps/server/src/handlers/sessionHandlers.ts (modified — roundKey/openPreparation/startRound imports, `teamRoom` export, PREPARATION_OPEN + ROUND_START handlers)
- apps/server/src/handlers/__tests__/sessionHandlers.test.ts (modified — +13 integration tests, imports)
- apps/client/src/ui/rotation.ts (created — upcomingDefuserId, mirrors server pick)
- apps/client/src/ui/__tests__/rotation.test.ts (created — 4 tests)
- apps/client/src/ui/Preparation.tsx (created — role-gated prep surface)
- apps/client/src/ui/ActiveRound.tsx (created — role-routed active surface)
- apps/client/src/ui/Lobby.tsx (modified — Open preparation ConfirmButton, error codes)
- apps/client/src/ui/copy.ts (modified — prep/active strings)
- apps/client/src/ui/index.ts (modified — Preparation/ActiveRound exports)
- apps/client/src/App.tsx (modified — status-routed surfaces)
- _agent_docs/implementation-artifacts/sprint-status.yaml (modified — story status tracking)

## Change Log

- 2026-06-13: Story 8.3 implemented — the game loop's first phase transitions. Shared: `PREPARATION_OPEN` event + `RoundState` type. Server: pure `openPreparation` (roundNumber increments at prep-open, fixing the seed-chain ordering for 8.2) and `startRound` (rotation pick with modulo normalization resolving the 2.4 index deferral, one-defuser-per-team role commits), both handlers on the TEAM_ASSIGN authority-gate pipeline, `RoundState` persisted at `roundKey`, sockets routed into `session:{id}:team:{teamId}` rooms for 8.4+ broadcasts. Client: status-routed surfaces (Lobby → Preparation → ActiveRound), facilitator prep controls with two-step confirm, real ManualViewer for Experts/Spectators in prep and active, BombScene for the active defuser. All gates green (tsc 0; 403 tests incl. 38 new; build); live three-client headless smoke verified end-to-end incl. AR15. Awaiting Jay's interactive two-browser verification before done.
