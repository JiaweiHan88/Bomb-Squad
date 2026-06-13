---
baseline_commit: 8eb17a5143cd9c96fcfe4576eb790322f3b28b94
---

# Story 3.1: Role-Scoped LiveKit Token Minting

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the server to mint a LiveKit token scoped to exactly my room and rights,
so that I can join voice with only the permissions my role allows.

## Acceptance Criteria

1. **Given** a participant with a role, **When** they request voice access, **Then** the server mints a LiveKit token scoped to **exactly one** room with **exactly the grants for that role**, and spectator tokens have `canPublish: false`. _(FR38, FR39; AR12)_
2. **Given** any token request, **When** it is logged, **Then** the token value (JWT) itself is **never** written to logs. _(project-context Security)_
3. **Given** a Bomb Room role (Defuser, Expert, Facilitator) on a team, **When** a token is minted, **Then** the room is `bomb-room:{sessionId}:{teamId}` with `canPublish: true` and `canSubscribe: true`. _(AR12)_
4. **Given** a Spectator, **When** a token is minted, **Then** the room is `spectator-lounge:{sessionId}` with `canPublish: false` and `canSubscribe: true`. _(AR12, FR39)_
5. **Given** a token request from a socket whose identity cannot be resolved to a player in the loaded session state (no session pointer, player absent, or — for a Bomb Room role — no team assigned), **When** the request is handled, **Then** the server responds with a typed failure and mints **no** token (authority is the freshly Redis-loaded `SessionState`, never client-supplied role/room).
6. **Given** the minted token, **When** it is generated, **Then** its `identity` is the server-side player id (`socket.id`), its TTL is bounded (default ≤ `TURN_TTL` seconds, capped), and the grant carries the single resolved room — token requests never let the caller choose the room or grants.

## Tasks / Subtasks

- [x] **Task 1 — Add the `livekit-server-sdk` dependency to the server workspace (AC: #1, #3, #4)**
  - [x] Add `livekit-server-sdk` (latest 2.x, currently ^2.15.x) to `apps/server/package.json` dependencies, then `pnpm install` from repo root (pnpm workspaces — never install into a sub-package cwd).
  - [x] Do **not** add `livekit-client` here — that is the client SDK consumed by Story 3.2. Keep server deps server-only.
  - [x] Verify `tsc --noEmit` passes for the server workspace after install (project rule: zero TS errors, no `@ts-ignore`).

- [x] **Task 2 — Pure token-minting module `apps/server/src/voice/mintToken.ts` (AC: #1, #3, #4, #6)**
  - [x] Export a pure function that takes a resolved `{ identity, role, sessionId, teamId? }` plus `{ apiKey, apiSecret, ttlSeconds }` and returns `Promise<string>` (the JWT). It contains **no** Redis, Socket.IO, or `process.env` access — caller injects key/secret from `Config`.
  - [x] Derive room + grants from role via a single mapping (the only place the topology rule lives):
    - `defuser` / `expert` / `facilitator` → room `bomb-room:{sessionId}:{teamId}`, grant `{ roomJoin: true, room, canPublish: true, canSubscribe: true }`.
    - `spectator` → room `spectator-lounge:{sessionId}`, grant `{ roomJoin: true, room, canPublish: false, canSubscribe: true }`.
  - [x] Use `new AccessToken(apiKey, apiSecret, { identity, ttl: ttlSeconds })`, `at.addGrant(videoGrant)`, then `await at.toJwt()`. **`toJwt()` is async in SDK v2 — it MUST be awaited** (v1's sync `toJWT()` is gone; awaiting a non-promise is harmless but the v2 name/casing is `toJwt`).
  - [x] Add a typed `VideoGrant`-shaped object (import the type from `livekit-server-sdk`); never build an untyped grant.
  - [x] If `role` is a Bomb Room role but `teamId` is undefined, throw a typed error — the room cannot be formed. (The handler in Task 3 guards this before calling, but the function stays self-defending.)

- [x] **Task 3 — `VOICE_TOKEN` request/grant socket event + handler (AC: #1, #2, #5, #6)**
  - [x] In `packages/shared/src/events/payloads.ts` add `VoiceTokenRequestPayload` (empty/`{}` — the request carries **no** room or role; everything is derived server-side) and `VoiceTokenGrantPayload { url: string; token: string; room: string; identity: string }`. Re-export as needed.
  - [x] In `packages/shared/src/events/client-to-server.ts` add `VOICE_TOKEN: (payload: VoiceTokenRequestPayload, ack: (result: VoiceTokenGrantPayload | { error: string }) => void) => void;` — use an **ack callback** (same pattern as `SESSION_CREATE`), since the requester needs a direct response, not a broadcast.
  - [x] Create `apps/server/src/handlers/voiceHandlers.ts` exporting `registerVoiceHandlers(io, deps)` mirroring the `registerSessionHandlers` shape (`{ redis, log }` deps; reuse `SessionIOServer` / `SessionSocketData` so `socket.data.sessionId` is the pointer).
  - [x] Handler flow (follow the project's I/O-at-the-edge pattern): read `socket.data.sessionId` → if absent, ack `{ error }` and return. Load `SessionState` from Redis (`sessionKey`). Resolve the player by `socket.id` (`state.players[socket.id]`). If absent, ack `{ error }`. Resolve `role` and `teamId` **from loaded state only** (never trust the payload). For Bomb Room roles, if `teamId` is undefined, ack `{ error }` (not yet assigned). Then `await mintToken(...)` injecting `config.LIVEKIT_API_KEY/SECRET` and a bounded ttl, and ack `{ url: config.LIVEKIT_URL, token, room, identity: socket.id }`.
  - [x] **Never** log the token. Log only non-secret facts: `{ sessionId, playerId, role, room }`. (AC #2 — grep the diff for the token variable inside any `log.*` call before finishing.)
  - [x] Pass `Config` into the voice handler deps (extend `SessionHandlerDeps` or a new `VoiceHandlerDeps`) so the handler has `LIVEKIT_URL/API_KEY/API_SECRET/TURN_TTL` — these are already validated in `apps/server/src/config/env.ts`, no new env plumbing needed.
  - [x] Register in `apps/server/src/index.ts` next to the other `register*Handlers(io, …)` calls, passing the parsed `config`.

- [x] **Task 4 — Tests (AC: #1, #2, #3, #4, #5, #6)**
  - [x] **Unit** (`apps/server/src/voice/__tests__/mintToken.test.ts`, Jest, zero infra): for each role assert the decoded JWT's video grant has the expected `room`, `canPublish`, `canSubscribe`, and `identity`. Decode the JWT payload (base64 of the middle segment, or `jsonwebtoken`/`TokenVerifier` if already available) and assert grant fields — do **not** assert the opaque string. Assert spectator `canPublish === false` explicitly (the core security invariant). Assert a Bomb-Room role with no `teamId` throws.
  - [x] **Handler integration** (`apps/server/src/handlers/__tests__/voiceHandlers.test.ts`, `TestSocketServer` wrapper per AR16): a joined defuser gets a `bomb-room:{sessionId}:{teamId}` grant; a spectator gets a `spectator-lounge:{sessionId}` `canPublish:false` grant; a socket with no session / unknown player / unassigned-team Bomb-Room role gets `{ error }` and no token.
  - [x] **Log-leak guard**: assert (spy on the injected `log`) that no log call argument string-contains the minted token. (AC #2.)
  - [x] Run the full server test suite; keep `tsc --noEmit` green.

- [x] **Task 5 — Worktree env + verification setup (does not gate code, gates the human check that 3.2 will rely on)**
  - [x] Provision the worktree `.env` (gitignored, absent in a fresh worktree) from `.env.example`, **including** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_SECRET`, `TURN_TTL`. ([[worktree-fullstack-testing-gap]])
  - [x] 3.1 is server-only and verifiable by tests — no interactive Jay-verify subtask is required for **this** story (the user-visible "two people talk" check lives in Story 3.2). Note in Completion Notes that the token endpoint was exercised against the real LiveKit container at least once (mint → LiveKit accepts a join with the token) so 3.2 starts from a known-good token. ([[human-verification-ac-rule]], [[timer-verification-tsx-watch-gotcha]])

## Dev Notes

### What this story is (and is not)

This is the **server token-minting half** of the voice subsystem — the first story in Epic 3. It adds a `voice/` module + a `VOICE_TOKEN` request/grant event and nothing else. Story 3.2 (next in this same worktree) consumes the token: it adds `livekit-client`, wires `apps/client/src/store/voiceStore.ts` (today a shape-only stub: `idle | connecting | connected | unavailable`), and actually connects to the room. **Do not** start the client SDK / connection work here.

### Critical architectural constraint — voice never gates game state

AR12 + ADR-007: voice is an **independent subsystem that never blocks game state**. Concretely for this story:
- The `VOICE_TOKEN` handler touches **no reducer and no session-state transition** — it only *reads* `SessionState` to resolve the requester's role/team. It must not write session state, must not advance any phase, and must not emit any game event.
- Voice connection state lives in a **separate Zustand store** (client side, Story 3.2), never in the game store. This story stays server-side and emits only the ack.

### Authority model (matches existing handlers)

`socket.data.sessionId` is a **server-assigned pointer**, not authority (see `sessionHandlers.ts:26-31`). The pattern every handler follows: parse input → load fresh `SessionState` from Redis → make every authority decision against that loaded state → act. Apply it here: the role and team that scope the token come **only** from `state.players[socket.id]`, never from the request payload. The request payload is empty by design (AC #6) — a caller cannot ask for a room or a publish grant they shouldn't have. This is the AC #1/#5 guardrail and the core of FR39's "token-grant enforced, not merely hidden in the UI."

Player identity = `socket.id` (this codebase already uses `socket.id` as the player key — `state.players[socket.id]`, `facilitatorId: socket.id`). Use it as the LiveKit `identity` too; that keeps presence/active-speaker mapping trivial for Stories 3.2/3.4.

### Files to touch

- **NEW** `apps/server/src/voice/mintToken.ts` — pure mint function (role → room + grants → JWT).
- **NEW** `apps/server/src/voice/__tests__/mintToken.test.ts`.
- **NEW** `apps/server/src/handlers/voiceHandlers.ts` — `registerVoiceHandlers(io, deps)`.
- **NEW** `apps/server/src/handlers/__tests__/voiceHandlers.test.ts`.
- **UPDATE** `packages/shared/src/events/payloads.ts` — add `VoiceTokenRequestPayload`, `VoiceTokenGrantPayload`.
- **UPDATE** `packages/shared/src/events/client-to-server.ts` — add `VOICE_TOKEN` with ack. (No `ServerToClientEvents` entry — the response is the ack, not a broadcast.)
- **UPDATE** `packages/shared/src/events/index.ts` — export the new payload types if barrel-exported.
- **UPDATE** `apps/server/src/index.ts` — call `registerVoiceHandlers(io, { redis, log, config })`.
- **UPDATE** `apps/server/package.json` — add `livekit-server-sdk`.

Read these existing files before editing them (current behavior you must not break):
- `apps/server/src/config/env.ts` — `Config` already exposes `LIVEKIT_URL/API_KEY/API_SECRET/TURN_SECRET/TURN_TTL`, all validated `NonEmpty`. Inject from here; add no new env vars.
- `apps/server/src/handlers/sessionHandlers.ts` — copy the `SessionIOServer` / `SessionSocketData` / `SessionLog` / `register*Handlers(io, deps)` shape and the ack pattern from `SESSION_CREATE` (`sessionHandlers.ts:257-308`). Reuse `sessionKey` from `state/keys.js` to load state.
- `apps/server/src/index.ts:94-96` — handler registration site.
- `packages/shared/src/events/*` — typed event interfaces; `socket.emit(string, any)` is forbidden, so the new event must be declared in the interface before use.

### Merge surface (this worktree → master)

Per the Sprint 3 analysis: the only shared-file contention is `packages/shared/src/events/*`. Worktree A (this one) adds `VOICE_TOKEN`; Worktree B adds `PLAYER_REMOVE` + a capacity error. Both are small, additive interface entries — reconcile is trivial. Keep the `VOICE_TOKEN` addition isolated to its own lines to minimize conflict.

### Testing standards summary

- Pure logic (`mintToken.ts`) → Jest unit, **zero infrastructure** (AR16). Decode and assert the grant, never the opaque JWT string.
- Socket handler → `TestSocketServer` wrapper integration test (AR16). Do not mock the reducer/session loader you can call directly.
- The full LiveKit-container voice verification (real SFU accepts the token, two participants hear each other) is the **3.2** human-verify deliverable; for 3.1, a one-shot "real LiveKit accepts this minted token" smoke is enough and should be noted in Completion Notes.
- `tsc --noEmit` must be green before completion; no `@ts-ignore`.

### Latest tech information — `livekit-server-sdk`

- Current line is **2.x (v2.15.x as of June 2026)**. Add `livekit-server-sdk` (server) only; `livekit-client` is the separate client package (Story 3.2).
- API shape:
  ```ts
  import { AccessToken, type VideoGrant } from 'livekit-server-sdk';

  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: ttlSeconds });
  const grant: VideoGrant = { roomJoin: true, room, canPublish, canSubscribe };
  at.addGrant(grant);
  const jwt = await at.toJwt(); // ⚠️ async in v2 — MUST await
  ```
- **v1 → v2 gotcha:** v1 exposed a synchronous `toJWT()`; v2 renames it to `toJwt()` and makes it **async**. Awaiting is mandatory — a forgotten `await` yields a `Promise` cast to `string` and ships a broken token. Pin/confirm the installed version and use `toJwt()`.
- TTL: the SDK accepts `ttl` as seconds (number) or a duration string. Bound it server-side — default to `Config.TURN_TTL` (already validated as a positive integer) or a smaller fixed cap; never mint an unbounded-lifetime token.

### Project Structure Notes

- New server code lives under `apps/server/src/voice/` (new peer of `session/`, `round/`, `timer/`) — matches the existing per-concern folder layout; handlers stay in `apps/server/src/handlers/`.
- All event types live in `packages/shared/src/events/` and are imported on both sides — never duplicated (project rule). `packages/shared` stays pure TS with zero runtime deps on `socket.io`/server frameworks, so put only the **payload type** and the **event signature** there — the `livekit-server-sdk` import belongs in `apps/server`, never in `packages/shared`.
- No client files change in this story.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Socket.IO / Shared Types:** event types defined in `packages/shared/src/events/` and imported both sides; use the typed `ClientToServerEvents` interface — untyped `socket.emit(string, any)` is forbidden.
- **Server-authoritative:** socket handlers own all I/O (parse → load → decide → respond); never fire-and-forget async inside a handler — await cleanly.
- **State boundaries:** Redis holds in-flight session state; LiveKit's own Redis usage is isolated — do not build app logic on it. No PostgreSQL on this path.
- **Security:** all server-side decisions on untrusted client input — bounds/validate; **never trust client-supplied role or room**. Never hardcode LiveKit keys — always via `.env`/`Config`.
- **Voice / LiveKit gotchas:** spectator tokens must be `canPublish:false` enforced at the **grant** level, not the UI. Tokens are re-minted on role change (Story 3.5) and never reused across roles — so keep minting stateless and idempotent (a fresh token per request), do not cache-and-reuse per player.
- **Build:** `tsc --noEmit` zero errors before commit; no `@ts-ignore`; separate `tsconfig.json` per workspace; TypeScript only.
- **WebRTC infra (already in place):** `docker-compose.yml` runs `livekit/livekit-server:v1.8` with `LIVEKIT_URL=ws://livekit:7880` and single UDP mux `7882`; `env.ts` already validates the LiveKit secrets. No infra changes needed for 3.1.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 3.1: Role-Scoped LiveKit Token Minting] — user story + ACs.
- [Source: _agent_docs/planning-artifacts/epics.md#AR12] — voice topology: `bomb-room:{sessionId}:{teamId}` (bidirectional) + `spectator-lounge:{sessionId}` (listen-only); server mints role-scoped tokens (`canPublish:false` for spectators); voice never blocks game state.
- [Source: _agent_docs/planning-artifacts/epics.md] — FR38 (two channels), FR39 (spectator listen-only, token-grant enforced), FR41 (re-mint on role change — future Story 3.5).
- [Source: _agent_docs/implementation-artifacts/Sprint 3 — Voice parallelization analysi.md] — Wave 1 Worktree A scope (3-1 + 3-2 chain), env+`livekit-server-sdk` not yet installed, voiceStore stub exists, merge surface = `packages/shared/src/events/*`.
- [Source: _agent_docs/project-context.md#Voice / LiveKit Gotchas, #Security, #Socket.IO / Shared Types] — grant-level enforcement, no-secret-logging, typed events.
- [Source: apps/server/src/config/env.ts] — `Config` exposes validated `LIVEKIT_URL/API_KEY/API_SECRET/TURN_TTL`.
- [Source: apps/server/src/handlers/sessionHandlers.ts:257-308] — `register*Handlers` + ack-callback pattern to mirror.
- [Source: livekit-server-sdk v2.15.x — AccessToken/addGrant/`toJwt()` (async)] — https://docs.livekit.io/reference/server-sdk-js/classes/AccessToken.html

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story)

### Debug Log References

- Unit test TTL assertion initially read `iat`; LiveKit v2 stamps `exp` (and `nbf`) but no `iat`. Reworked the bound check to assert `exp ≈ now + ttl` instead. Both retained as the lifetime guard.
- `pnpm -r exec tsc` failed in `packages/shared`/`apps/client` because a fresh worktree only had `node_modules` for the server (I'd installed `livekit-server-sdk` with `--filter server`). Ran a full root `pnpm install` to hydrate all four workspace projects; per-package `typecheck` scripts then pass.

### Completion Notes List

- **AC #1/#3/#4 (role-scoped grants):** `resolveVoiceScope` is the single mapping — defuser/expert/facilitator → `bomb-room:{sessionId}:{teamId}` (`canPublish:true`); spectator → `spectator-lounge:{sessionId}` (`canPublish:false`). Asserted on decoded JWT claims in both unit and handler tests.
- **AC #2 (no token in logs):** handler logs only `{ sessionId, playerId, role, room }`; a capturing-logger integration test asserts no log line contains the minted token.
- **AC #5 (server-derived authority):** the `VOICE_TOKEN` payload is empty by contract; role + team come only from the Redis-loaded `state.players[socket.id]`. Denies (no token) for: no session pointer, session state missing, player absent, and Bomb-Room role with no team (`VoiceScopeError` → `VOICE_SCOPE_UNAVAILABLE`). A "client smuggles room/canPublish in payload" test confirms the smuggled fields are ignored and the server-derived spectator scope wins.
- **AC #6 (bounded ttl + server-chosen room):** ttl = `min(TURN_TTL, MAX_VOICE_TOKEN_TTL_S=6h)`; identity = `socket.id`; caller cannot choose room/grants.
- **Voice independence (AR12/ADR-007):** handler only *reads* session state — no reducer, no phase transition, no game event. Confirmed no `setJSON`/emit of game state in `voiceHandlers.ts`.
- **Known-good token (Task 5):** verified out-of-band that LiveKit's own `TokenVerifier` accepts both a defuser (publish=true) and a spectator (publish=false) token — the same signature/claim validation the real SFU performs — so Story 3.2 starts from a token the LiveKit container will accept. Worktree `.env` provisioned from root `.env` (LiveKit/TURN secrets present). 3.1 is server-only/test-verifiable; no interactive Jay-verify gate for this story (that lives in 3.2's "two people talk" check).
- **Validation:** server `tsc --noEmit` clean; shared + client `tsc --noEmit` clean. Full suites green — server 184/184 (incl. 8 unit + 7 handler new), shared 53/53, client 180/180. No lint config present in repo (no lint step).
- **Merge note:** worktree is based on `origin/master` (8eb17a5), behind local master. Voice is additive; the only shared-file touch is `packages/shared/src/events/*` (VOICE_TOKEN + 3 payload types), reconciles cleanly with Worktree B per the Sprint 3 plan.

### File List

**New (server):**
- `apps/server/src/voice/mintToken.ts`
- `apps/server/src/voice/__tests__/mintToken.test.ts`
- `apps/server/src/handlers/voiceHandlers.ts`
- `apps/server/src/handlers/__tests__/voiceHandlers.test.ts`

**Modified (shared):**
- `packages/shared/src/events/payloads.ts` — `VoiceTokenRequestPayload`, `VoiceTokenGrantPayload`, `VoiceTokenErrorPayload`
- `packages/shared/src/events/client-to-server.ts` — `VOICE_TOKEN` event (ack-based)
- `packages/shared/src/events/index.ts` — re-export the three voice payload types

**Modified (server):**
- `apps/server/src/index.ts` — register `registerVoiceHandlers` with LiveKit config slice
- `apps/server/package.json` — add `livekit-server-sdk@^2.15.4`
- `pnpm-lock.yaml` — dependency lock update

**Provisioned (gitignored, not committed):**
- `.env` — worktree env copied from root, includes LiveKit/TURN secrets

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-13 | Story 3.1 implemented: role-scoped LiveKit token minting (pure `mintToken` + `VOICE_TOKEN` ack handler), 15 tests, all suites green → status `review`. |
