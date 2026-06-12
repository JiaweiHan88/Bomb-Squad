---
baseline_commit: 8355fda
---

# Story 2.2: Facilitator Hosts a Session

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to create a private session and get a shareable link + join code,
so that I can bring my team in within minutes without any accounts.

## Acceptance Criteria

1. **Hosting creates a session.** Given the landing screen, when I choose "Host a session", then a `SESSION_CREATE` is sent and the server returns a `sessionId` and a `joinCode` of ≥6 characters derived from `crypto.randomBytes` (never sequential).

2. **Lobby shows the code and link.** Given a created session, when I view the lobby, then the join code and a shareable link are displayed with a "Bring them in" share affordance, and no account creation was required.

## Tasks / Subtasks

- [x] **Task 1 — Server: join-code mint + session factory in `apps/server/src/session/` (AC: 1)**
  - [x] Create `apps/server/src/session/joinCode.ts` exporting `generateJoinCode(length = 6, randomBytes = crypto.randomBytes): string`. Charset: uppercase `A–Z0–9` (mockups show codes like `KTANE5`; the 2.3 input auto-uppercases and strips to `[A-Z0-9]`). Derive each character from `crypto.randomBytes` (`node:crypto`) — use rejection sampling (discard bytes ≥ `Math.floor(256 / charset.length) * charset.length`) so no modulo bias. Never `Math.random()`, never a counter/sequence. The injectable `randomBytes` parameter exists only so unit tests can feed fixed bytes — production callers pass nothing.
  - [x] The charset must NOT include `:` (Redis key segments join on `:` — `state/keys.ts` interpolates raw IDs; a colon would corrupt the keyspace; this is the documented deferral from story 1.5 review). Alphanumeric-only satisfies it structurally.
  - [x] Create `apps/server/src/session/createSession.ts` exporting a pure factory `createSessionState(args: { sessionId: string; joinCode: string; facilitatorId: string; config?: Partial<RoundConfig> }): SessionState`. Defaults (GDD Flow 3 first-round kindness): `difficulty: 'easy'`, `moduleCount: 3`, `timerMs: 300_000`, `strikeSpeedUpPct: 25`, `modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false }`. Spread the caller's partial over the defaults (shallow merge; merge `modifiers` explicitly so a partial config can't drop a field). Result: `status: 'lobby'`, `players: { [facilitatorId]: { playerId: facilitatorId, displayName: 'Facilitator', role: 'facilitator', isReady: false } }`, `teams: {}`, `roundNumber: 0`. Pure function — no I/O, no `Date.now()`, no randomness (the seed-chain rules apply to all server logic, not just modules).
  - [x] `sessionId` is generated at the handler (Task 3) via `crypto.randomUUID()` — keep it out of the pure factory.

- [x] **Task 2 — Server: join-code → session lookup key in the keyspace (AC: 1; enables 2.3)**
  - [x] Add `joinCodeKey = (joinCode: string): string => \`joincode:${joinCode}\`` to `apps/server/src/state/keys.ts` (single source of truth for the keyspace — never inline key strings in handlers). Value stored: the `sessionId` string (store via `setJSON` for consistency with the adapter). Story 2.3's `SESSION_JOIN` resolves code → session through this key; without it the code is undiscoverable.
  - [x] Extend `apps/server/src/state/__tests__/keys.test.ts` with the new builder (match the existing test style).

- [x] **Task 3 — Server: first real Socket.IO handler — `SESSION_CREATE` (AC: 1)**
  - [x] Create `apps/server/src/handlers/sessionHandlers.ts` exporting `registerSessionHandlers(io: AppIOServer, deps: { redis: RedisStore; log: FastifyBaseLogger })`. Inside, `io.on('connection', (socket) => { socket.on('SESSION_CREATE', async (payload, ack) => { … }) })`. This is the canonical handler flow from the architecture — **parse/validate → (no prior state to load) → build state (pure factory) → persist to Redis → join room → ack + broadcast**. No game logic in the handler beyond that pipeline.
  - [x] **Validate the untrusted payload at the boundary.** `SessionCreatePayload` is `{ config?: Partial<RoundConfig> }`. Defensive checks before use: payload must be an object (or `undefined` — tolerate a missing payload from a misbehaving client); if `config` present, accept only known keys with correct types/ranges (`moduleCount` integer 3–11, `timerMs` positive integer, `strikeSpeedUpPct` 0–50, `difficulty` one of the three tiers, `modifiers` booleans). On invalid input: emit typed `ERROR` (`{ code: 'INVALID_PAYLOAD', message, recoverable: true }`) to that socket, do **not** ack with fabricated data, do not throw — never crash the session. Also guard `typeof ack === 'function'` (a hand-rolled client can omit the ack; without the guard the handler throws).
  - [x] **Mint identifiers:** `sessionId = crypto.randomUUID()`; `joinCode = generateJoinCode()`. **Collision check:** loop (max ~5 attempts) — `await redis.getJSON(joinCodeKey(code))`; if occupied, regenerate. 36⁶ ≈ 2.2B codes vs a handful of concurrent sessions — collisions are theoretical, but the loop is cheap and the lookup key must be reserved anyway. (A get-then-set race is acceptable in V1's single process; do not build SETNX into the adapter for this.)
  - [x] **Persist before emitting** (architecture error-handling rule: persist *then* emit; on persist failure emit nothing but an `ERROR`): `await redis.setJSON(sessionKey(sessionId), state)` and `await redis.setJSON(joinCodeKey(joinCode), sessionId)`. Wrap in try/catch → on failure log + emit `ERROR` (`{ code: 'SESSION_CREATE_FAILED', recoverable: true }`) and return. Never fire-and-forget the awaits.
  - [x] **Room + delivery:** `await socket.join(\`session:${sessionId}\`)` (architecture Pattern 1 room naming), then `ack({ sessionId, joinCode })`, then `io.to(\`session:${sessionId}\`).emit('SESSION_STATE', state)` so the lobby renders from the same broadcast path every other roster change will use. Ack answers "did my create succeed"; `SESSION_STATE` carries the truth the UI renders.
  - [x] **Logging (AR15 — hard rule):** structured log keyed by `sessionId` only. **NEVER log the `joinCode`** — codes are the session's only secret. `log.info({ sessionId }, 'session created')`.
  - [x] **Wire-up in `apps/server/src/index.ts` (UPDATE):** keep `buildServer()` pure (it's driven by `fastify.inject()` in tests with no stores). In `start()`, after `connectRedis(...)`, call `registerSessionHandlers(io, { redis: redisStore, log: fastify.log })`. Leave the existing `io.on('connection')` debug breadcrumb in `buildServer` — `io.on('connection')` supports multiple listeners, no conflict. Do not touch the readiness gate `io.use(...)`, the shutdown path, or the health registry.

- [x] **Task 4 — Server: handler integration tests via a `TestSocketServer` wrapper (AC: 1)**
  - [x] This story opens `apps/server/src/handlers/` — build the test harness now (project rule: "budget this before writing game logic, not after"). Create `apps/server/src/handlers/__tests__/testSocketServer.ts`: boots a bare `node:http` server + typed `SocketIOServer<ClientToServerEvents, ServerToClientEvents>` on an ephemeral port (`listen(0)`), registers the handlers under test with an **in-memory `RedisStore` fake** (a `Map`-backed object implementing `getJSON/setJSON/del/ping/isReady` — mirror the fake style in `state/__tests__/redis.test.ts`), and returns `{ url, io, store, close() }`. Add `socket.io-client` as a server **devDependency** for the test client (`pnpm --filter @bomb-squad/server add -D socket.io-client`). Use a no-op pino-compatible logger stub for `log`.
  - [x] `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — connect a typed client socket, then cover: **(a)** `SESSION_CREATE` ack returns `sessionId` (UUID format) + `joinCode` (≥6 chars, all `[A-Z0-9]`); **(b)** a `SESSION_STATE` broadcast arrives with `status: 'lobby'`, the facilitator in `players` with `role: 'facilitator'`, `roundNumber: 0`, and default config; **(c)** the fake store holds `session:{sessionId}` and `joincode:{code}` → sessionId; **(d)** a partial config (e.g. `{ config: { timerMs: 600000 } }`) merges over defaults without dropping `modifiers`; **(e)** an invalid config (e.g. `moduleCount: 99` or `difficulty: 'nightmare'`) → `ERROR` event, no ack invocation, nothing persisted; **(f)** two creates yield different join codes (and different sessionIds); **(g)** persist failure (fake store whose `setJSON` rejects) → `ERROR`, no `SESSION_STATE` emitted. Close sockets + server in `afterEach` to avoid hung Vitest workers.
  - [x] Unit tests `apps/server/src/session/__tests__/joinCode.test.ts` + `createSession.test.ts`: code length/charset; injected fixed bytes → deterministic expected output (proves rejection sampling); 200 generated codes are not sequential (no two consecutive codes differ by an alphabet increment — cheap sanity, not a randomness proof); factory defaults, partial-merge (including nested `modifiers`), facilitator player shape, purity (same args → deep-equal result; frozen input config not mutated).

- [x] **Task 5 — Client: Landing screen with "Host a session" (AC: 1)**
  - [x] Create `apps/client/src/ui/Landing.tsx` — operator-world surface inside `AppShell` (dark shell, cream ink, deadpan — reuse Story 2.1 primitives; **no new colors, no bomb-world tokens**). Reference layout: `mockups/1. Landing.html` (two panels: join-by-code + host). **This story wires the host panel only** — Story 2.3 ships the 6-cell join-code input and its behavior contract; render the host path without a dead join form (a non-functional input is worse than its absence; 2.3 lands immediately after).
  - [x] "Host a session" is a **primary** `Button` (safe/forward action — primary is correct per the 2.1 rule; nothing destructive here, so no `ConfirmButton`). On click, emit `SESSION_CREATE` with an ack and a timeout:
    ```ts
    socket.timeout(5000).emit('SESSION_CREATE', {}, (err, result) => { … });
    ```
    Note the signature shift: with `.timeout()`, the callback becomes error-first (`err` set on timeout, `result` is the `SessionCreatedPayload`). Send `{}` (no config overrides — round configuration is Story 8.1's `ROUND_CONFIGURE`; do not build a config form here).
  - [x] While awaiting the ack, disable the button and show an inline busy hint (e.g. label flips to the deadpan "Opening a line…" or simply disable — keep it small; this is a sub-second local call, not a full-bleed `LoadingScreen`, which is reserved for socket connection per 2.1). On `err` (timeout) or an `ERROR` event: re-enable and show an inline error line — never a silent failure (AC3 of 2.1 generalizes: no silent network waits).
  - [x] **Do not store the ack result as state.** The lobby renders from `gameStore.session`, set by the `SESSION_STATE` broadcast through the existing `bindServerEvents` → `setSession` path. The ack is only the success/failure signal (and is already documented as such in `payloads.ts`). No new Zustand state for sessionId/joinCode — that would duplicate the server snapshot.
  - [x] The in-flight `creating` boolean is presentation state → local `useState`, **not** Zustand (Story 2.1 rule: UI-ephemeral state stays out of stores).

- [x] **Task 6 — Client: Lobby share panel — code, link, "Bring them in" (AC: 2)**
  - [x] Create `apps/client/src/ui/Lobby.tsx`. Render from `useGameStore((s) => s.session)` (reactive selector is fine — this is not a per-frame loop). Show: the join code in `font-mono` at display scale (mono is the DESIGN.md-assigned face for join codes — "anywhere alphanumeric identity matters more than reading flow"); the shareable link; a copy affordance under the heading **"Bring them in"** (EXPERIENCE.md microcopy — *not* "Invite Players"). Layout reference: `mockups/2. Lobby.html` share panel (panel, lead/sub text hierarchy, copy button). Roster, ready state, role/team assignment are Stories 2.3–2.5 — render a minimal placeholder region for them at most; do **not** build roster UI here.
  - [x] **Shareable link format: `${window.location.origin}/?join=${joinCode}`** — query param on the root path, NOT a path route (`/join/CODE`). Load-bearing constraint: the deployed client is `vite preview` behind Caddy with **no SPA fallback** — deep-link paths 404 (deferred-work.md, story 1.8 review). There is no router in the app; do not add one. Story 2.3 reads the `?join=` param to prefill the code input.
  - [x] Copy button: primary `Button`; `navigator.clipboard.writeText(link)` wrapped in try/catch (clipboard API needs a secure context — localhost and the Caddy HTTPS deployment both qualify; the catch keeps a file:// or odd context from throwing). On success flip the label to "Copied" for ~1.6 s then back (mockup behavior). Keep the flip in local `useState`; clear the timeout on unmount (`useEffect` cleanup) so an unmounted lobby doesn't setState.
  - [x] "No account creation was required" (AC2) is satisfied structurally — there is no auth anywhere; do not add any name/email prompt to the host path.
  - [x] Add the new strings to `apps/client/src/ui/copy.ts` (`BRING_THEM_IN = 'Bring them in'`, plus the share-panel sub-line, e.g. mockup's "Share the join code or link. Players land here as they enter — assign roles once everyone's in."). One voice source — Stories 2.3–2.6 reuse it.
  - [x] Export `Landing` and `Lobby` from the `ui/index.ts` barrel.

- [x] **Task 7 — Client: route the connected shell — Landing ⇄ Lobby (AC: 1, 2)**
  - [x] UPDATE `apps/client/src/App.tsx`: replace only the connected-branch placeholder (`<p>Connected. Lobby lands in Story 2.2.</p>`). New rendering: `session === null ? <Landing/> : <Lobby/>` inside the existing `AppShell`, selected via `useGameStore((s) => s.session)`. **Preserve verbatim** the socket `useEffect([])` (StrictMode-safe connect/cleanup from 1.7), the `PlatformGate → LoadingScreen → AppShell` precedence from 2.1, and the `SERVER_URL` derivation. No router, no URL state — surface choice derives from the store snapshot (IA: same session, different surfaces).
  - [x] `Landing` needs the socket to emit. The socket is currently a local variable inside the effect. Smallest sound change: export a module-level accessor from `apps/client/src/net/socket.ts` — e.g. keep `createSocket` but have it store the instance (`let socket: AppClientSocket | null`) and add `getSocket(): AppClientSocket` (throws if not created). `App.tsx` already calls `createSocket` in the effect; `Landing` calls `getSocket()` inside its click handler (never at module top level — the click can only happen while connected, after creation). Do not create a second socket; do not put the socket in Zustand (it's not snapshot state).

- [x] **Task 8 — Tests, typecheck, build (AC: 1, 2)**
  - [x] Client unit tests (Vitest, Node env, pure logic only — 2.1 testing rule: components are visual-regression-only): extract the share-link builder into a pure helper (e.g. `apps/client/src/ui/shareLink.ts`, `buildShareLink(origin: string, joinCode: string): string`) and test it (`apps/client/src/ui/__tests__/shareLink.test.ts`): plain origin, origin with port, code is URL-encoded (defensive; charset makes it a no-op).
  - [x] **Gate:** `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore`. `pnpm -r test` → all green, including the new handler integration suite (server: 64 existing tests must stay green; client: 6 + new; shared: 24). `pnpm --filter @bomb-squad/client build` → succeeds.
  - [x] **Manual smoke (document in Completion Notes):** `docker compose up -d redis postgres` (or full stack), `pnpm --filter @bomb-squad/server dev`, `pnpm --filter @bomb-squad/client dev`. Click "Host a session" → lobby appears showing a 6-char code + link; "Bring them in" copy works; the code is absent from server stdout (AR15 check); refresh → back to landing (session re-attach is a later-story concern — losing the lobby on refresh is expected and acceptable now; note it, don't fix it).

## Dev Notes

### What this story is — and is not

First **vertical slice through the realtime stack**: landing UI → typed `SESSION_CREATE` with ack → handler (validate → factory → Redis persist → room join → `SESSION_STATE` broadcast) → lobby UI. It establishes the **handler pipeline pattern and its test harness** that every subsequent Epic-2/8 socket story copies. Get the shape right; 2.3–2.6 are mostly repetitions of it.

**Out of scope:** join flow + 6-cell code input (2.3), roster/teams/ready/mic (2.4/2.5), capacity & join-window guards (2.6), round config UI (8.1), session re-attach on refresh, any LiveKit/voice, any router. `SESSION_JOIN` handling is **not** built here — only the `joincode:` lookup key that 2.3 needs.

### The wire contract is already frozen — do not redesign it

`packages/shared` (story 1.2) already defines everything this story sends/receives — **no shared-package changes are needed or wanted**:

- `SESSION_CREATE: (payload: SessionCreatePayload, ack: (result: SessionCreatedPayload) => void) => void` — ack carries `{ sessionId, joinCode }` "so the creating client learns the new identifiers without racing a subsequent broadcast" (payloads.ts doc).
- `SessionCreatePayload = { config?: Partial<RoundConfig> }` — note: **no facilitator display name in the contract.** Default the facilitator's `PlayerInfo.displayName` to `'Facilitator'` server-side. If a real name matters later, that's a 2.4/2.5 roster concern, not a contract change here.
- `SESSION_STATE: (state: SessionState) => void` — client already binds it (`bindServerEvents` → `gameStore.setSession`). Emitting this from the handler makes the lobby render with **zero client net-layer changes**.
- `ERROR: (payload: { code, message, recoverable }) => void` — already bound client-side (console.error today; an inline error line in Landing is this story's UI for it).
- `SessionState` shape (types/session.ts): `players: Record<string, PlayerInfo>`, `teams: Partial<Record<TeamId, TeamState>>` — empty `{}` teams at creation is valid by construction.

Server runtime still only needs `import type` from `@bomb-squad/shared` (joinCode/factory are server-local code) — the known deferred-work landmine "shared exports point at `.ts` source, breaks on first server *runtime* import" is **not** triggered by this story. Keep it that way: do not move `generateJoinCode` into `packages/shared`.

### Existing code you build on (read before editing)

- `apps/server/src/index.ts` — `buildServer()` is pure construction (tests drive it with `inject()`, no stores); stores connect in `start()`. **Register handlers in `start()` after `connectRedis`**, keeping `buildServer` dependency-free. The readiness gate (`io.use`) already rejects handshakes while Redis is down — your handler can assume a connected store at handshake time but must still try/catch the awaits (Redis can drop mid-session).
- `apps/server/src/state/redis.ts` — `RedisStore` adapter: `getJSON/setJSON/del/ping/isReady`, O(1) only; `KEYS`/`SCAN` forbidden. `getJSON` **throws** on malformed JSON (doesn't return null) — relevant to the collision-check `getJSON`: a throw there should fall into your handler's catch → `ERROR`.
- `apps/server/src/state/keys.ts` — keyspace single source; `sessionKey(sessionId)` exists; you add `joinCodeKey`. Key builders do not validate inputs (documented deferral) — your alphanumeric charset is the guard.
- `apps/client/src/App.tsx` — the connected branch placeholder literally says "Lobby lands in Story 2.2". The socket `useEffect` and gate/loading precedence are load-bearing (1.7 + 2.1) — replace only the placeholder JSX.
- `apps/client/src/net/socket.ts` — 9 lines: `createSocket(url)` with `autoConnect: false`, `transports: ['websocket']`. Extend (module-level instance + `getSocket()`), don't rewrite.
- `apps/client/src/net/bindServerEvents.ts` — already routes `SESSION_STATE` → store. Untouched unless you improve the `ERROR` path; if you surface `ERROR` in Landing, prefer listening on the socket within Landing's effect or reading a small `lastError` you add — simplest: handle create-failure via the ack timeout + a socket-level `ERROR` listener registered in Landing with cleanup. Keep `bindServerEvents`'s existing registrations intact.
- `apps/client/src/ui/` — Story 2.1 primitives to reuse as-is: `AppShell` (header slot), `Button` (primary = safe/forward only), `LoadingScreen` (socket-connection only), `copy.ts` (extend), barrel `index.ts` (extend). Tailwind v4 tokens are live (`font-mono`, `text-xl`, `bg-surface-raised`, `text-ink-muted`, etc. — all generated from the `@theme` block).
- `apps/server` test style: Vitest (`vitest run`), fakes over mocks (see `state/__tests__/redis.test.ts`), no real infra in unit tests.

### Previous-story intelligence (2.1, in review — its code is on `master` at your baseline)

- The `ui/` component-per-file + barrel pattern, `copy.ts` voice source, and "presentation state in `useState`, server snapshots in Zustand" split are established — extend, don't fork.
- 2.1 deliberately did not build `Toast`/`Panel` components — don't introduce them here either; the share panel is plain Tailwind on `AppShell`, matching the mockup's panel styling via tokens.
- 2.1's review note: manual browser smoke wasn't executable in that environment — same may apply; if so, document exactly what was and wasn't manually verified.
- Stories 1.7 and 2.1 are in `review`, not `done` — their code is committed (your baseline `8355fda`) and is the foundation here; if review patches land mid-implementation, rebase before finishing.

### Architecture compliance checklist (the rules this story is judged against)

- **Handler = I/O; logic = pure functions.** `joinCode.ts`/`createSession.ts` import nothing from socket.io/ioredis/fastify. The handler does parse→build→persist→emit and nothing else.
- **Persist then emit; on persist failure emit nothing** but a typed `ERROR` (architecture Error Handling).
- **Never fire-and-forget** async I/O in a handler — await everything.
- **Room naming:** `session:{sessionId}` (Pattern 1). Broadcast `SESSION_STATE` to the room, not the socket, so the same code path serves 2.3 joins.
- **State residence:** the server process keeps **no authoritative in-memory session state** — Redis only. Don't cache the SessionState in a module map.
- **Security (NFR9/AR15):** join code ≥6 chars crypto-random; **never logged**; never sequential. `randomUUID`/`randomBytes` from `node:crypto` only.
- **Client is render-only:** lobby renders the last `SESSION_STATE` snapshot; nothing client-side fabricates session truth (the ack result is a receipt, not state).
- **Typed events only:** the existing `AppIOServer` / `AppClientSocket` types make untyped emits a compile error — keep every new emit on those types.

### Project Structure Notes

- New server files: `session/joinCode.ts`, `session/createSession.ts`, `session/__tests__/{joinCode,createSession}.test.ts`, `handlers/sessionHandlers.ts`, `handlers/__tests__/testSocketServer.ts`, `handlers/__tests__/sessionHandlers.test.ts` — exactly the architecture's `session/` ("session lifecycle, lobby") and `handlers/` ("own ALL I/O", integration-tested via TestSocketServer) homes. Updated: `state/keys.ts` (+test), `index.ts` (handler registration), `package.json` (+`socket.io-client` devDep).
- New client files: `ui/Landing.tsx`, `ui/Lobby.tsx`, `ui/shareLink.ts`, `ui/__tests__/shareLink.test.ts`. Updated: `App.tsx`, `net/socket.ts`, `ui/copy.ts`, `ui/index.ts`.
- No new tsconfig, no new workspace deps beyond the server-side `socket.io-client` devDep. Socket.IO v4 APIs in play: server `socket.join`/`io.to(room).emit`, client `socket.timeout(ms).emit(event, payload, errFirstCb)` — both stable in the already-installed v4 line; match existing installed versions, add nothing new.

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors pre-commit; no `// @ts-ignore`.
- Lobby join codes: min 6 chars, cryptographic random — sequential IDs unacceptable (verbatim security rule).
- Socket event names `SCREAMING_SNAKE_CASE`; all event types live in `packages/shared/src/events/` and are imported on both sides (already true — reuse, never redeclare).
- Redis = all in-flight session state, O(1) per action; Postgres untouched (session-end only — nothing to persist in this story).
- Handlers synchronous where possible, async awaited cleanly — never fire-and-forget.
- React components `PascalCase`; hooks `use`-prefixed; no game logic in components (the only "logic" here — link building — is extracted pure and unit-tested).
- Never hardcode server URLs/secrets — `SERVER_URL` derivation in App.tsx already handles this; the share link derives from `window.location.origin` at runtime.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.2: Facilitator Hosts a Session] (ACs verbatim; FR1)
- [Source: _agent_docs/game-architecture.md#Pattern 1 — Multi-Session, Single-Process Model] (sessionId UUID, joinCode rules, room naming, Redis residence)
- [Source: _agent_docs/game-architecture.md#Pattern 2 / Implementation Patterns / Error Handling] (handler pipeline; persist-then-emit; validate at boundary; never throw reducers/handlers)
- [Source: _agent_docs/game-architecture.md#Redis Keyspace / API Contracts] (`session:{id}` key; SESSION_CREATE/SESSION_STATE/ERROR surface)
- [Source: _agent_docs/game-architecture.md#Logging Strategy] (never log join codes — AR15)
- [Source: _agent_docs/game-architecture.md#Testing Architecture] (TestSocketServer boundary for handlers)
- [Source: packages/shared/src/events/payloads.ts] (SessionCreatePayload/SessionCreatedPayload ack semantics)
- [Source: packages/shared/src/types/session.ts] (SessionState/PlayerInfo/RoundConfig shapes + ranges)
- [Source: apps/server/src/index.ts] (buildServer purity; start()-time store wiring; readiness gate)
- [Source: apps/server/src/state/redis.ts, keys.ts] (RedisStore contract; keyspace single source; getJSON throw behavior)
- [Source: apps/client/src/App.tsx, net/socket.ts, net/bindServerEvents.ts, store/gameStore.ts] (socket lifecycle; SESSION_STATE → setSession; render-only store)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Voice and Tone / Information Architecture] ("Bring them in"; Landing→Lobby IA; role-gated surfaces)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#Typography] (mono face for join codes)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/1. Landing.html, 2. Lobby.html] (layout reference; copy-button "Copied" flip; code format `KTANE5`)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (no SPA fallback → query-param share link; `:`-free IDs; shared `.ts`-source export constraint)
- [Source: _agent_docs/implementation-artifacts/2-1-design-tokens-ui-shell-and-state-patterns.md] (ui/ primitives, state-pattern rules, copy.ts, test posture)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors across all three workspaces (no `@ts-ignore`).
- `pnpm -r test` → shared 24 ✓, client 9 ✓ (2 files), server 90 ✓ (9 suites; was 64 — +6 joinCode, +5 createSession, +1 keys, +14 handler integration/validation).
- `pnpm --filter @bomb-squad/client build` → success (`index.css` 14.27 kB gz 3.83, `index.js` 193.39 kB gz 61.94).
- **Live end-to-end smoke (headless):** booted the worktree server via `tsx` on :3199 against throwaway `redis:7-alpine`/`postgres:16-alpine` containers (`/health` → 200, both probes ok). A real `socket.io-client` drove `SESSION_CREATE {}`: ack returned UUID `sessionId` + 6-char code (`XI5MDI`); `SESSION_STATE` broadcast arrived with `status: 'lobby'`, one `facilitator` player, `roundNumber: 0`, `difficulty: 'easy'`. Redis held exactly `session:{uuid}` and `joincode:XI5MDI` → sessionId. `grep -c XI5MDI server.log` → **0** (AR15 verified live); the only log line is `{"sessionId":…,"msg":"session created"}`. Containers/process removed after.

### Completion Notes List

- **Task 1 — joinCode + session factory:** `generateJoinCode` draws from `crypto.randomBytes` over an `A–Z0–9` charset (no `:` — keyspace safety) with rejection sampling at byte ≥ 252 to kill modulo bias; `randomBytes` injectable for deterministic tests only. `createSessionState` is a pure factory (no I/O/clock/randomness) producing a lobby `SessionState` with GDD first-round defaults and a nested-`modifiers`-safe merge; facilitator `displayName` defaults to `'Facilitator'` (contract carries no name).
- **Task 2 — keyspace:** `joinCodeKey` added to `state/keys.ts` (`joincode:{code}` → sessionId, stored via `setJSON`); keys test extended. This is the lookup Story 2.3's `SESSION_JOIN` will resolve against.
- **Task 3 — handler:** `registerSessionHandlers(io, { redis, log })` implements parse→factory→persist→room→ack+broadcast. Boundary validation (`parseSessionCreatePayload`, exported for direct testing) accepts only known config keys in range and **rebuilds** a sanitized object; invalid input → `ERROR INVALID_PAYLOAD`, nothing persisted, ack untouched. Missing-ack guard included. Collision loop (≤5 attempts) reserves the code via `getJSON`. Persist-then-emit enforced: persist failure → `ERROR SESSION_CREATE_FAILED`, no ack, no `SESSION_STATE`. Logs `sessionId` only — never the code. Registered in `start()` after `connectRedis`, keeping `buildServer()` pure; readiness gate/shutdown untouched. Typed server alias declared locally (avoids an import cycle with index.ts; story's `AppIOServer` import would have been circular).
- **Task 4 — tests:** `testSocketServer.ts` harness (ephemeral-port HTTP + typed Socket.IO server, Map-backed `RedisStore` fake with failure-injection overrides, no-op logger) + 8 integration tests covering ack shape, broadcast content, persistence, partial-config merge, invalid-config rejection, distinct codes across creates, and persist-failure semantics; 6 direct validator tests. `socket.io-client` added as server devDep per spec. **Deviation (documented):** server tests are **Jest**, not Vitest as one story line assumed — followed the repo. Jest's default `testMatch` would have collected the harness as an empty suite, so `jest.config.cjs` gained `testMatch: ['**/__tests__/**/*.test.ts']` (all existing suites already match). ESM Jest needs `import { jest } from '@jest/globals'` for `jest.fn`, so `@jest/globals@^29.7.0` (same family as installed jest 29) was added as a devDep — test-infra only, no runtime surface.
- **Task 5 — Landing:** host panel only (join panel deliberately absent — Story 2.3, no dead form). Primary `Button` emits `SESSION_CREATE {}` via `socket.timeout(5000)` (error-first ack); busy state disables the button with deadpan "Opening a line…"; timeout or server `ERROR` event re-enables with an inline `role="alert"` line — no silent failure. Ack result is never stored; the Lobby renders from the `SESSION_STATE` → `gameStore.session` path. `creating`/`error` are local `useState`.
- **Task 6 — Lobby:** "Bring them in" share panel — join code in `font-mono` at display scale, share link, copy button flipping to "Copied" for 1.6 s (timer cleared on unmount). Link is `${origin}/?join=CODE` via pure `buildShareLink` (query param — no SPA fallback in `vite preview`, no router). Clipboard call try/caught for non-secure contexts. New strings centralized in `copy.ts`. No roster UI (2.3–2.5). No auth anywhere (AC2).
- **Task 7 — shell routing:** `App.tsx` connected branch now renders `session === null ? <Landing/> : <Lobby/>`; socket effect, `PlatformGate → LoadingScreen → AppShell` precedence, and `SERVER_URL` derivation preserved verbatim. `net/socket.ts` extended with a module-level instance + `getSocket()` accessor (throws if called pre-bootstrap); no second socket, socket kept out of Zustand.
- **Task 8 — gates:** typecheck/tests/build all green (see Debug Log); live headless smoke executed and verified including the AR15 no-code-in-logs check. Browser-visual pass not possible in this environment — recommend a quick look via `pnpm --filter @bomb-squad/client dev` (host → lobby shows code/link/copy). Refresh returns to Landing (session re-attach is a later-story concern, as specified).

### File List

- apps/server/src/session/joinCode.ts (created)
- apps/server/src/session/createSession.ts (created)
- apps/server/src/session/__tests__/joinCode.test.ts (created)
- apps/server/src/session/__tests__/createSession.test.ts (created)
- apps/server/src/handlers/sessionHandlers.ts (created)
- apps/server/src/handlers/__tests__/testSocketServer.ts (created — shared harness, not a suite)
- apps/server/src/handlers/__tests__/sessionHandlers.test.ts (created)
- apps/server/src/state/keys.ts (modified — + `joinCodeKey`)
- apps/server/src/state/__tests__/keys.test.ts (modified — + joinCodeKey case)
- apps/server/src/index.ts (modified — register session handlers in `start()`)
- apps/server/jest.config.cjs (modified — `testMatch` narrowed to `*.test.ts`)
- apps/server/package.json (modified — devDeps: socket.io-client, @jest/globals)
- apps/client/src/ui/Landing.tsx (created)
- apps/client/src/ui/Lobby.tsx (created)
- apps/client/src/ui/shareLink.ts (created)
- apps/client/src/ui/__tests__/shareLink.test.ts (created)
- apps/client/src/ui/copy.ts (modified — host/share strings)
- apps/client/src/ui/index.ts (modified — barrel: Landing, Lobby)
- apps/client/src/net/socket.ts (modified — module-level instance + `getSocket()`)
- apps/client/src/App.tsx (modified — Landing/Lobby branch in connected shell)
- pnpm-lock.yaml (modified)

## Change Log

- 2026-06-12: Story 2.2 implemented — first vertical slice through the realtime stack. Server: crypto-random join codes (rejection-sampled A–Z0–9), pure session factory, `SESSION_CREATE` handler (validate → factory → persist-then-emit → room → ack + `SESSION_STATE`), `joincode:` lookup key, TestSocketServer harness + 14 handler/validator tests. Client: Landing ("Host a session" with ack timeout + inline error), Lobby ("Bring them in" share panel with code, `?join=` link, clipboard copy), Landing⇄Lobby branch driven by the store snapshot. All gates green (tsc 0 errors; 123 tests; build); live headless socket smoke verified end-to-end including AR15 (join code never logged).
