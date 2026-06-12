---
baseline_commit: 1591434 (+ uncommitted Story 2.3 working-tree changes in this worktree)
---

# Story 2.4: Team & Per-Player Role Assignment

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to assign players to two teams and set each player's role,
so that the relay has balanced teams with clear roles before a round starts.

## Acceptance Criteria

1. **Facilitator assignment updates everyone's roster.** Given players in the lobby, when I assign a player to Team A or Team B and set their role (Defuser/Expert/Spectator), then a `TEAM_ASSIGN` is accepted only from a Facilitator and the roster updates for all participants.

2. **Non-facilitators are rejected with no state change.** Given a non-Facilitator socket, when it attempts `TEAM_ASSIGN`, then the server rejects it with an authority error and no state changes.

## Tasks / Subtasks

- [x] **Task 1 — Server: socket→session bookkeeping via `socket.data.sessionId` (AC: 1, 2)**
  - [x] `TEAM_ASSIGN` is the first event whose payload carries no session identifier — the server must know which session the *calling socket* belongs to. Resolve it via `socket.data.sessionId`, set server-side at session entry. This is transient socket bookkeeping, explicitly sanctioned by architecture Pattern 1 ("no authoritative in-memory game state — only transient socket bookkeeping"); authority itself is still checked against the Redis-loaded state on every action. Do NOT trust any session/player identifier from the client payload for authority, and do NOT parse `socket.rooms` strings.
  - [x] In `apps/server/src/handlers/sessionHandlers.ts`: export `interface SessionSocketData { sessionId?: string }` and retype `SessionIOServer` as `SocketIOServer<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SessionSocketData>`. `DefaultEventsMap` is exported from the `socket.io` package root in the installed 4.8.3 — `import type { DefaultEventsMap } from 'socket.io'`. Apply the same 4-generic shape to `AppIOServer` in `apps/server/src/index.ts` and `TestIOServer` in `handlers/__tests__/testSocketServer.ts` (a genuinely-missing harness capability — the sanctioned kind of harness edit). The client socket type is untouched (`SocketData` is server-only).
  - [x] Set `socket.data.sessionId = sessionId` in all three session-entry paths: `SESSION_CREATE` success (before the ack), `SESSION_JOIN` success (before the broadcast), and the `SESSION_JOIN` idempotent-rejoin convergence branch (a re-join must re-point a fresh socket... it can't today, but the branch must stay consistent). Do not clear it anywhere — there is no leave/disconnect flow yet (known socket.id deferral, deferred-work.md).

- [x] **Task 2 — Server: pure assignment function in `apps/server/src/session/` (AC: 1)**
  - [x] Create `apps/server/src/session/assignTeam.ts` exporting a pure function `assignPlayerToTeam(state: SessionState, args: { playerId: string; teamId: TeamId; role: PlayerRole }): SessionState`. Same purity discipline as `createSession.ts`/`joinSession.ts` (copy their doc-comment voice): no I/O, no clock, no randomness, imports only from `@bomb-squad/shared`. Spread, never mutate.
  - [x] **Player update:** `players[playerId] = { ...player, teamId, role }` — preserve `displayName` and `isReady` untouched.
  - [x] **Teams maintenance (this story owns the `SessionState.teams` record):** keep `teams[teamId].relayOrder` in sync with assignments, because the GDD fixes the default defuse rotation as *team join order* — and assignment order IS that order. Rules:
    - Lazily create the target `TeamState` on first assignment: `{ teamId, relayOrder: [], currentDefuserIndex: 0, cumulativeTimeMs: 0 }`.
    - Append `playerId` to the target team's `relayOrder` **iff not already present** (append order = assignment order = GDD default rotation; Epic 8 stories own reordering and rotation mechanics).
    - When moving a player between teams, remove them from the previous team's `relayOrder`; if that leaves the previous team's `relayOrder` empty, **delete** the team entry (keeps `teams` matching its `Partial` semantics: a team exists iff someone is on it).
    - A **role-only change** (same `teamId`) must NOT move the player's `relayOrder` position.
    - `currentDefuserIndex` stays `0` — the handler's lobby-phase guard (Task 4) means rounds have never run when this executes; no clamping logic. Leave a one-line comment so Epic 8 knows this assumption.
  - [x] **Guard clauses (defensive — handler errors first, but pure fns never trust):** unknown `playerId` → return `state` unchanged (same reference); target player's current `role === 'facilitator'` → return `state` unchanged. **Idempotency:** if the player already has exactly this `teamId` and `role` → return `state` unchanged (same reference).
  - [x] Unit tests `apps/server/src/session/__tests__/assignTeam.test.ts` (match `joinSession.test.ts` style): assigns teamId+role and preserves name/isReady; lazily creates TeamState with the empty-team shape; two assignments to the same team produce `relayOrder` in assignment order; moving A→B removes from A's relayOrder and deletes the emptied team A entry; moving when others remain keeps the others' order intact; role-only change keeps relayOrder position; idempotent same-assignment → same reference; unknown playerId → same reference; facilitator target → same reference; immutability (deep-frozen input must not throw; input unchanged, result is a new object); `config`/`status`/`joinCode`/`roundNumber` untouched.

- [x] **Task 3 — Server: `TEAM_ASSIGN` payload validation (AC: 1, 2)**
  - [x] In `sessionHandlers.ts`, add `parseTeamAssignPayload(payload: unknown)` alongside the existing validators, same `ParseResult`-style discriminated shape, exported for direct unit testing. Rebuild a sanitized object; never forward the raw client object. Rules:
    - `payload` must be a non-null, non-array object — else fail.
    - `playerId`: must be a string, length 1–128 (socket.ids are ~20 chars; the bound is a sanity fence, not a format check — ids are opaque) — else fail.
    - `teamId`: must be exactly `'A'` or `'B'` — else fail with `'teamId must be A or B'`.
    - `role`: must be one of `'defuser' | 'expert' | 'spectator'` — reuse the existing `JOINABLE_ROLES` const. **`'facilitator'` is rejected** for the same reason `SESSION_JOIN` rejects it: the facilitator seat is minted by `SESSION_CREATE` only, and a facilitator must not be able to mint a *second* facilitator (or demote themselves into an authority-less session). Security boundary, not style.
    - Unknown extra keys: ignore (rebuild from the three known fields; extras are inert).
  - [x] Validator unit tests (same `describe` style as the `parseSessionJoinPayload` suite): happy path; `teamId: 'C'`/lowercase `'a'` rejected; `role: 'facilitator'` rejected; empty `playerId` rejected; 129-char playerId rejected; non-object payload rejected; missing fields rejected; extra keys ignored.

- [x] **Task 4 — Server: `TEAM_ASSIGN` handler — third verse of the canonical pipeline (AC: 1, 2)**
  - [x] Add `socket.on('TEAM_ASSIGN', async (payload) => { … })` inside the existing `io.on('connection')` block. **The contract has no ack** (`TEAM_ASSIGN: (payload: TeamAssignPayload) => void` in `client-to-server.ts` — frozen, do not add one): success is conveyed by the `SESSION_STATE` broadcast, failure by a typed `ERROR` to the calling socket. Same no-ack settle model as `SESSION_JOIN`.
  - [x] Pipeline — **validate → resolve socket's session → load → authority → target guards → phase guard → pure assign → persist → broadcast**:
    1. `parseTeamAssignPayload` fails → `ERROR { code: 'INVALID_PAYLOAD', message, recoverable: true }`, return.
    2. `socket.data.sessionId` undefined → `ERROR { code: 'NOT_IN_SESSION', message: "You're not in a session.", recoverable: true }`, return.
    3. `await redis.getJSON<SessionState>(sessionKey(sessionId))` → `null` (stale pointer; session evicted) → same `NOT_IN_SESSION` error, return.
    4. **Authority (AC 2 — the heart of this story):** `state.players[socket.id]?.role !== 'facilitator'` → `ERROR { code: 'NOT_FACILITATOR', message: 'Only the facilitator assigns teams.', recoverable: true }`, return — **before** any other guard so a non-facilitator learns nothing about session contents (e.g. whether a playerId exists). Authority is checked against the *Redis-loaded state*, never against anything client-supplied and never cached in memory.
    5. **Target exists:** `state.players[parsed.playerId]` undefined → `ERROR { code: 'PLAYER_NOT_FOUND', message: "That player isn't in this session.", recoverable: true }`, return.
    6. **Target is not the facilitator:** target's `role === 'facilitator'` → `ERROR { code: 'INVALID_ASSIGNMENT', message: "The facilitator doesn't sit on a team.", recoverable: true }`, return. (GDD persona: the facilitator runs the session, they don't play in the relay.)
    7. **Lobby-phase guard (defensive):** `state.status !== 'lobby'` → `ERROR { code: 'NOT_IN_LOBBY', message: 'Teams are locked once the round starts.', recoverable: true }`, return. Epic 8 (between-rounds flow, 8.6) will widen this deliberately; the guard exists so it can't be widened by omission.
    8. `const next = assignPlayerToTeam(state, parsed)`. **If `next === state` (idempotent no-op): return silently** — no persist, no broadcast, no error. The roster already shows the truth.
    9. **Persist then emit:** `await redis.setJSON(sessionKey(sessionId), next)`; then `io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next)`. Single-key write — no rollback needed. Same accepted load-modify-store race as `SESSION_JOIN` (single-process, human-speed lobby; comment it, don't solve it).
    10. All awaits inside try/catch → `log.error({ err, socketId: socket.id }, 'TEAM_ASSIGN failed')` + `ERROR { code: 'TEAM_ASSIGN_FAILED', message: 'Could not assign. Try again.', recoverable: true }`.
  - [x] **Logging:** `log.info({ sessionId, playerId: parsed.playerId, teamId: parsed.teamId, role: parsed.role, by: socket.id }, 'player assigned')`. Never log the join code (AR15) — it isn't in this payload, keep it that way.

- [x] **Task 5 — Server: handler integration tests (AC: 1, 2)**
  - [x] Extend `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` with a `TEAM_ASSIGN` describe block on the existing `testSocketServer.ts` harness (multi-client + failure injection — reuse, don't fork). Server tests are **Jest** (established 2.2 deviation), keep the `afterEach` teardown pattern (hung workers were the documented failure mode). Typical setup helper: socket A `SESSION_CREATE` → ack, socket B `SESSION_JOIN` with the acked code.
  - [x] Cover: **(a)** happy path — A (facilitator) emits `TEAM_ASSIGN { playerId: B.id, teamId: 'A', role: 'defuser' }`; **both** sockets receive `SESSION_STATE` where B carries `teamId: 'A'`, `role: 'defuser'` and `teams.A.relayOrder === [B.id]`; **(b)** the fake store's session value contains the assignment (persisted, not just broadcast); **(c)** **AC 2:** B (non-facilitator) emits a valid `TEAM_ASSIGN` targeting itself → `NOT_FACILITATOR` to B only, A receives no broadcast, store byte-identical; **(d)** a connected socket that never joined any session → `NOT_IN_SESSION`; **(e)** unknown target playerId → `PLAYER_NOT_FOUND`, no state change; **(f)** targeting the facilitator's own playerId → `INVALID_ASSIGNMENT`, no state change; **(g)** seeded `status: 'active'` session → `NOT_IN_LOBBY`; **(h)** invalid payloads (`teamId: 'C'`, `role: 'facilitator'`, non-object) → `INVALID_PAYLOAD` via `it.each`; **(i)** reassign A→B — second broadcast shows `teams.B.relayOrder === [B.id]` and `teams.A` deleted; **(j)** idempotent repeat of the same assignment → no additional broadcast to A (listener-count pattern from the 2.3 rejoin test); **(k)** injected `setJSON` failure → `TEAM_ASSIGN_FAILED` to the facilitator, no broadcast; **(l)** two joiners assigned to the same team in sequence → `relayOrder` in assignment order.

- [x] **Task 6 — Client: facilitator assignment controls + team badges in `Lobby.tsx` (AC: 1, 2)**
  - [x] Extend `apps/client/src/ui/Lobby.tsx` — you are extending the 2.3 roster panel, not rewriting it. Keep the share panel, the "You" tag, and the facilitator-first sort intact.
  - [x] **Team badge on every roster row (all participants see it):** next to the existing role badge, render a team badge — `Team A` / `Team B` when `player.teamId` is set, `Unassigned` otherwise. Style on the mockup's badge grammar (`2. Lobby.html` `.badge.unassigned`: muted ink, subtle border, pill radius; assigned badges use neutral ink — **never** LED green/red/amber, which are reserved semantics, and never `speaker-self` blue, which is identity-only). The facilitator's own row gets **no** team badge (they don't sit on a team).
  - [x] **Facilitator-only controls** — rendered only when `session.players[getSocket().id]?.role === 'facilitator'`, and only on **non-facilitator** rows:
    - **Team toggle:** two small chips `A` / `B` (plain styled `<button type="button">`, the 2.3 role-chip pattern — selection state, NOT the `Button` primitive; `aria-pressed` on each). Click emits `getSocket().emit('TEAM_ASSIGN', { playerId: player.playerId, teamId: clicked, role: player.role })` — team changes carry the player's *current* role.
    - **Role select:** a native `<select>` (mockup 6's `role-select` pattern — body font, surface background, thin border) with options Defuser/Expert/Spectator (reuse `ROLE_*` copy), `value={player.role}`, **disabled until the player has a `teamId`** (mirrors mockup 6: the unassigned pool has no role selects; also `TeamAssignPayload.teamId` is required, so a role-only change on an unassigned player cannot be expressed on the wire — don't fake it). `onChange` emits `TEAM_ASSIGN { playerId, teamId: player.teamId, role: selected }`.
    - **Controls are server-truth-driven, never locally stateful:** `aria-pressed`/`value` derive from the last `SESSION_STATE` snapshot; the emit's effect arrives via the room broadcast → `gameStore` → re-render. No optimistic flip, no `useState` mirror of server fields (render-only client rule). The sub-second LAN round-trip is acceptable; do not add per-row busy spinners.
    - When the facilitator's controls are present, replace the static role badge with the select on those rows (one source of truth per row — badge for everyone else's view, select for the facilitator's view). The "You" tag and team badge render for both views.
  - [x] **No drag-and-drop.** The drag-into-teams interaction belongs to the Facilitator Dashboard screen (mockup 6, built with round configuration in Epic 8). EXPERIENCE.md IA §2 puts "role pickers" in the Lobby — chips + select satisfy it at this story's scope.
  - [x] **Error surface:** Lobby currently has no `ERROR` listener (Landing's is unmounted once Lobby shows). Add one: `useEffect` that subscribes `getSocket().on('ERROR', …)` on mount and unsubscribes on unmount, writing `payload.message` to a local `useState` string rendered as a small `role="alert"` line in the roster panel (deadpan, render the server message directly — they're already human-readable). Clear it whenever a new `SESSION_STATE` lands (the `session` object identity changing means an action succeeded) — a `useEffect` keyed on `session` works. This is presentation state — local `useState`, never Zustand.
  - [x] New strings in `apps/client/src/ui/copy.ts` (one voice source): `TEAM_A = 'Team A'`, `TEAM_B = 'Team B'`, `UNASSIGNED = 'Unassigned'`. Keep dry/deadpan.
  - [x] **Scope fence:** no ready state/button (2.5), no mic indicators (2.5), no empty-state message (2.5), no capacity UI (2.6), no unassign affordance (the wire contract has no unassign — a player moves between teams only; if product wants unassign later, that is a shared-contract change owned by that story), no Facilitator Dashboard screen (Epic 8).

- [x] **Task 7 — Gates: tests, typecheck, build, smoke (AC: 1, 2)**
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore` (the 4-generic Server retype in Task 1 must compile cleanly everywhere, including the test harness). `pnpm -r test` → all green: server 115 existing + new assignTeam/validator/handler suites; client 24 existing (no new client unit tests — the controls are render+emit only, no pure logic extracted); shared 24 untouched. `pnpm --filter @bomb-squad/client build` → succeeds.
  - [x] **Manual smoke (document results in Completion Notes):** stack or `redis`+`postgres` containers + dev server. Three sockets: facilitator hosts; two joiners join. Facilitator assigns joiner 1 → Team A/Defuser, joiner 2 → Team B/Expert → all three receive rosters with badges/teams. Move joiner 2 to Team A → `teams.B` gone, relayOrder order = [j1, j2]. Joiner attempts `TEAM_ASSIGN` → `NOT_FACILITATOR`, state unchanged. Verify the join code still never appears in server stdout (AR15). If no browser available, replicate via three headless socket.io-clients (the 2.2/2.3 pattern) and say exactly what was and wasn't visually verified.

## Dev Notes

### What this story is — and is not

Third verse of the handler pipeline: `TEAM_ASSIGN` is **validate → resolve socket's session → load → authority gate → target guards → pure assign → persist → broadcast**. The two genuinely new things are (1) the **first authority check in the codebase** — facilitator-only, checked against Redis-loaded state, the pattern every Epic-8 facilitator action will copy — and (2) the **first event that must resolve the caller's session without a payload identifier**, solved with `socket.data.sessionId` bookkeeping. It also makes this story the owner of `SessionState.teams` population (relayOrder = assignment order = GDD default rotation).

**Out of scope:** ready state/mic check/empty-state (2.5), capacity & join-window (2.6), drag-and-drop + Facilitator Dashboard screen + relay reordering/rotation (Epic 8), unassigning a player from all teams (no wire contract for it), session reattach / durable player ids (deferred), voice (Epic 3).

### Baseline warning — this worktree carries uncommitted 2.3 work

Last commit is `1591434` (story 2.2 done), but **Story 2.3's full implementation exists as uncommitted working-tree changes** in this worktree (see `git status`: modified `sessionHandlers.ts`, `Landing.tsx`, `Lobby.tsx`, `copy.ts`, + new `joinSession.ts`, `joinCode.ts`, tests). Story 2.3 is `done` in sprint-status — build on the working tree as it stands; do not "restore" files to their committed state and do not re-implement anything 2.3 already landed.

### The wire contract is frozen — zero `packages/shared` changes

- `TEAM_ASSIGN: (payload: TeamAssignPayload) => void` — **no ack**. Same settle model as `SESSION_JOIN`: success = the `SESSION_STATE` broadcast, failure = typed `ERROR` to the caller. Do not add an ack "for symmetry."
- `TeamAssignPayload = { playerId: string; teamId: TeamId; role: PlayerRole }` (`packages/shared/src/events/payloads.ts:31`). `TeamId = 'A' | 'B'` — exactly two teams, the type enforces it. `PlayerRole` admits `'facilitator'` — the **validator must reject it** (mint-only seat; see Task 3).
- `teamId` is **required** in the payload → there is no "unassign" and no "role-only change while unassigned" on the wire. The client UI must respect this (role select disabled until a team is set), not work around it.
- New `ERROR` codes minted here (server-side string literals, no shared enum — established 2.3 decision): `NOT_IN_SESSION`, `NOT_FACILITATOR`, `PLAYER_NOT_FOUND`, `INVALID_ASSIGNMENT`, `NOT_IN_LOBBY`, `TEAM_ASSIGN_FAILED` (plus reusing `INVALID_PAYLOAD`).

### `socket.data` — the one structural addition, and its boundaries

- Socket.IO's `SocketData` generic (4th type param) types `socket.data`. Installed `socket.io@4.8.3` exports `DefaultEventsMap` from the package root.
- `socket.data.sessionId` is a **pointer, not authority**: it tells the handler *which* session to load; the facilitator check reads `state.players[socket.id].role` from the freshly loaded Redis state. A client cannot set `socket.data` remotely — it is server-assigned only.
- It is in-memory and dies with the socket — consistent with Pattern 1's "transient socket bookkeeping" carve-out and with the existing socket.id-identity deferral (a reconnect loses it, exactly as it loses the roster entry; the session-reattach story owns both).
- Three aliases to retype: `SessionIOServer` (sessionHandlers.ts), `AppIOServer` (index.ts:13), `TestIOServer` (testSocketServer.ts:14). Client types untouched.

### Existing code you build on (read before editing)

- `apps/server/src/handlers/sessionHandlers.ts` — your handler lands beside `SESSION_CREATE`/`SESSION_JOIN` in the same `connection` block. Reuse `sessionRoom()`, `JOINABLE_ROLES`, the `ParseResult` validator idiom (rebuild, never pass through), the try/catch-everything + typed-failure-code shape, and the no-ack settle model from `SESSION_JOIN`.
- `apps/server/src/session/createSession.ts` + `joinSession.ts` — the pure-function style to copy (doc-comment voice, guard-clause-returns-same-reference idempotency, spread-only). Note `createSessionState` seeds `teams: {}` — your lazy `TeamState` creation is the first writer.
- `apps/server/src/state/redis.ts` — `getJSON` **throws** on malformed JSON (returns `null` only for absent keys); keep every await inside the try/catch. `apps/server/src/state/keys.ts` — `sessionKey` only; this event never touches `joinCodeKey`.
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — multi-client harness + `createMemoryRedisStore(overrides)` failure injection. Extend the test file; the only harness edit is the `TestIOServer` generic retype (Task 1).
- `apps/client/src/ui/Lobby.tsx` — 2.3's roster panel (facilitator-first sort, role badges via `ROLE_LABELS`, "You" tag on `getSocket().id`) and the 2.2 share panel. Your badges/controls slot into the existing row markup.
- `apps/client/src/ui/copy.ts` — single voice source; `ROLE_DEFUSER/EXPERT/SPECTATOR` already exist for the select options.
- `apps/client/src/net/socket.ts` — `getSocket()` inside event handlers/effects only (never module top level). `bindServerEvents.ts` already routes `SESSION_STATE` → store: **zero net-layer changes**. **Do not touch App.tsx, gameStore.ts, bindServerEvents.ts, or anything in `packages/shared`.**
- Mockup `6. Facilitator Dashboard.html` lines 188–258 — the *visual grammar* for team assignment (role `<select>` styling, team columns, unassigned pool). Borrow the select styling; the columns/drag belong to Epic 8's dashboard.

### Previous-story intelligence (2.3, done — uncommitted on this baseline)

- **Jest on the server, Vitest on the client** — settled deviation; don't re-litigate. `jest.config.cjs` `testMatch` already excludes the harness file.
- The no-ack settle pattern (pending ref + `ERROR` listener + local timer) lives in Landing for join. **Lobby's error surface is simpler on purpose**: assignment failures are low-stakes (the facilitator just sees the roster not change + the message), so a listener + inline alert line suffices — no pending gate, no timeout machinery.
- 2.3's review deferred (do NOT fix here): socket.id identity breaks on reconnect (ghost rosters, lost "You" tag); the load-modify-store race (accepted V1, comment it); UTF-16 name-length nits. Your `TEAM_ASSIGN` inherits the same accepted race — same comment, same posture.
- Idempotent no-op convergence (2.3's rejoin branch) is the established answer to duplicate emits — Task 4 step 8 applies it to repeated identical assignments.
- Test patterns that worked: `it.each` for invalid payloads; asserting the fake store's raw map for persistence; counting broadcasts on the *other* socket to prove no-op; seeding the store directly for non-lobby/full states; strict `afterEach` teardown.

### Architecture compliance checklist (the rules this story is judged against)

- **Handler = I/O; logic = pure.** `assignTeam.ts` imports only shared types. The handler adds no logic beyond pipeline + guards.
- **Authority check order:** facilitator gate fires before target-existence checks — a non-facilitator probe must not leak whether a playerId is in the session (architecture Security: "Is this a Facilitator-only action from a Facilitator?").
- **Authority source:** the Redis-loaded `SessionState`, never `socket.data`, never the payload. `socket.data.sessionId` only selects which key to load.
- **Persist then emit; on persist failure emit nothing** but the typed `ERROR`. Single-key write, no rollback.
- **AC 2 is literal:** rejection path performs zero writes — assert store byte-equality in the test.
- **State residence:** load → modify → store through Redis only. Accepted V1 race, commented.
- **Typed events only** — structural via the existing generics; the `SocketData` retype keeps it that way.
- **Client is render-only:** controls reflect the last snapshot; no optimistic team flips; the broadcast is the only state writer.
- **AR15:** join code in no log line. This payload doesn't carry it — don't add it to any log for "context."

### UX compliance (DESIGN.md / EXPERIENCE.md / mockups 2 & 6)

- EXPERIENCE.md IA §2: "Lobby — show team roster, role pickers, join-code share, Ready state, voice mic-check" — this story delivers the role pickers + team assignment; Ready/mic are 2.5.
- Badge grammar from mockup 2 (`.badge`, `.badge.unassigned`): pill radius, uppercase, body font, muted-on-dark. Team badges are **neutral ink** — LED green/red/amber are reserved (solved/strike/caution), `speaker-self` blue is identity-only. No color-coding teams with reserved semantics; if you want team distinction beyond text, use the mockup-6 swatch neutrals (`#E8DCC2` cream / `#9A8E78` taupe), not LEDs.
- Role select styling from mockup 6 `.role-select` (body font, `--surface` background, thin border, small radius). Native `<select>` — no custom dropdown component (2.1 decision: no new primitives until needed thrice).
- Selection chips (A/B toggle) follow the 2.3 role-chip grammar: `border-brass` + primary ink when selected, muted border/ink otherwise, `aria-pressed`.
- Microcopy dry/deadpan; all new strings in `copy.ts`. Server error messages are already in voice — render them verbatim.

### Project Structure Notes

- New server files: `session/assignTeam.ts`, `session/__tests__/assignTeam.test.ts`. Updated: `handlers/sessionHandlers.ts` (+ `SessionSocketData`, `parseTeamAssignPayload`, `TEAM_ASSIGN` handler, `socket.data.sessionId` writes), `handlers/__tests__/sessionHandlers.test.ts` (+ suites), `handlers/__tests__/testSocketServer.ts` (generic retype only), `index.ts` (`AppIOServer` retype only).
- Updated client files: `ui/Lobby.tsx` (badges, facilitator controls, error line), `ui/copy.ts` (3 strings). No new client files, no new client tests (no pure logic extracted — if you find yourself wanting one, the logic has probably leaked from the server's responsibility).
- **No changes:** `packages/shared` (contract frozen), `App.tsx`, `net/*`, `store/*`, configs, deps. No new dependencies anywhere.
- Naming: `TEAM_ASSIGN` SCREAMING_SNAKE (exists), `assignTeam.ts`/`assignPlayerToTeam` camelCase, per project-context conventions.

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors; no `// @ts-ignore`.
- All game actions validated server-side — client input untrusted; never trust `playerId`/`teamId`/`role` without whitelisting (this story's server half *is* that rule).
- Socket event types live in `packages/shared/src/events/` only — reuse, never redeclare; untyped `emit(string, any)` forbidden.
- Redis = all in-flight session state, O(1) per action (one `getJSON` + one `setJSON` here); Postgres untouched.
- Handlers await all async I/O cleanly inside try/catch; pure fns throw nothing, mutate nothing, import no infra.
- State never mutated in place — spread/map only; unknown/invalid input falls through returning state unchanged.
- React: no game logic in components; presentation state in `useState`, server snapshots in Zustand; controls derive from the snapshot.
- Never `Math.random()` outside seeded generation — nothing here needs randomness.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.4: Team & Per-Player Role Assignment] (ACs verbatim; 2.5/2.6 fences)
- [Source: _agent_docs/game-architecture.md#Pattern 1 — Multi-Session, Single-Process Model] (transient socket bookkeeping carve-out; room naming; Redis residence)
- [Source: _agent_docs/game-architecture.md#Pattern 2 / API Contracts / Server-Side Validation Boundaries] (pipeline; `TEAM_ASSIGN { playerId, teamId, role }` "Facilitator only"; identity & role checks; typed ERROR, no state change)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md §Rotation] ("Defuse order is Facilitator-chosen; default is team join order" → relayOrder = assignment order; Epic 8 owns reordering)
- [Source: packages/shared/src/events/payloads.ts:31-35 + client-to-server.ts:30] (TeamAssignPayload; no-ack signature — frozen)
- [Source: packages/shared/src/types/session.ts] (TeamId 'A'|'B'; PlayerInfo.teamId optional; TeamState shape incl. relayOrder/currentDefuserIndex/cumulativeTimeMs; teams Partial record)
- [Source: apps/server/src/handlers/sessionHandlers.ts] (pipeline + validator idiom + JOINABLE_ROLES + sessionRoom; SESSION_JOIN's no-ack settle model to mirror)
- [Source: apps/server/src/session/createSession.ts, joinSession.ts] (pure-function style; teams seeded `{}`; idempotency-by-same-reference pattern)
- [Source: apps/server/src/handlers/__tests__/testSocketServer.ts] (multi-client harness + failure injection; TestIOServer alias to retype)
- [Source: apps/client/src/ui/Lobby.tsx, copy.ts; net/socket.ts] (roster panel to extend; voice source; getSocket discipline)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Information Architecture §2] (lobby = roster + role pickers + share + ready + mic)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/2. Lobby.html + 6. Facilitator Dashboard.html] (badge grammar; role-select styling; team swatch neutrals; drag = dashboard/Epic 8)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (socket.id identity deferral — socket.data shares its lifetime; PlayerInfo.teamId ↔ relayOrder referential integrity flagged in 1.2 review → this story is the runtime owner; accepted join race)
- [Source: _agent_docs/implementation-artifacts/2-3-player-joins-via-code-and-picks-a-role.md] (previous-story patterns: no-ack settle, idempotent convergence, test idioms, review deferrals)
- [Source: node_modules socket.io@4.8.3 dist/index.d.ts:597] (`DefaultEventsMap` exported from package root — verified locally)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors across all three workspaces (no `@ts-ignore`); the 4-generic `Server` retype compiles cleanly including the test harness.
- `pnpm -r test` → shared 24 ✓ (untouched), client 24 ✓ (untouched — no new client unit tests; controls are render+emit only), server 147 ✓ (11 suites; was 115 — +12 assignTeam pure-fn, +6 parseTeamAssignPayload validator, +14 TEAM_ASSIGN handler integration incl. the `it.each` expansion).
- `pnpm --filter @bomb-squad/client build` → success (`index.css` 16.45 kB gz 4.33, `index.js` 200.34 kB gz 64.16).
- **Live end-to-end smoke (headless):** booted the worktree server via `tsx` on :3199 against throwaway `redis:7-alpine`/`postgres:16-alpine` containers (`/health` → ok on both probes). Three real `socket.io-client`s: facilitator hosted; Maya and Devon joined as experts. Facilitator assigned Maya → Team A/Defuser — **all three** sockets received the updated `SESSION_STATE` with `teams.A.relayOrder = [maya]`. Devon → Team B, then moved B→A: `teams.B` deleted, `relayOrder = [maya, devon]` (assignment order preserved). Non-facilitator `TEAM_ASSIGN` → `NOT_FACILITATOR` with **no broadcast leaked** (300 ms spy window). Targeting the facilitator → `INVALID_ASSIGNMENT`. `grep -c VMM3OI server.log` → **0** (AR15 verified live); the assign log line carries `{sessionId, playerId, teamId, role, by}` only. Containers/process removed after.

### Completion Notes List

- **Task 1 — socket bookkeeping:** `SessionSocketData { sessionId?: string }` exported from `sessionHandlers.ts`; `SessionIOServer`/`AppIOServer`/`TestIOServer` retyped to the 4-generic form (`DefaultEventsMap` confirmed exported from `socket.io@4.8.3` root). `socket.data.sessionId` set in all three session-entry paths (create success, join success, idempotent-rejoin convergence). Pointer-not-authority documented on the interface.
- **Task 2 — pure assignment:** `assignPlayerToTeam` in `session/assignTeam.ts` — spread-only; owns the `teams` record (lazy `TeamState` creation, relayOrder = assignment order per GDD default rotation, emptied teams deleted to keep `Partial` semantics, role-only changes preserve position, `currentDefuserIndex` stays 0 with an Epic-8 note). Guards return the same reference for unknown playerId, facilitator target, and idempotent re-assertion. 12 unit tests incl. two deep-frozen-input immutability cases (fresh assign + cross-team move).
- **Task 3 — validation:** `parseTeamAssignPayload` (exported) — non-object rejected, `playerId` bounded 1–128 (opaque-id sanity fence), `teamId` strictly `'A'|'B'`, role whitelisted via the existing `JOINABLE_ROLES` (facilitator mint-only), rebuilt object, extra keys inert. 6 validator tests.
- **Task 4 — handler:** `TEAM_ASSIGN` beside `SESSION_JOIN`, no ack per the frozen contract. Pipeline: validate → `socket.data.sessionId` resolve (`NOT_IN_SESSION`, also covers the stale-pointer/evicted-session case) → load → **authority gate first** (`NOT_FACILITATOR` before any target checks, so a non-facilitator probe learns nothing about session contents) → `PLAYER_NOT_FOUND` → facilitator target `INVALID_ASSIGNMENT` → `NOT_IN_LOBBY` phase guard → pure assign → idempotent no-op returns silently (no persist/broadcast/error) → persist-then-broadcast. All awaits in try/catch → `TEAM_ASSIGN_FAILED`. Accepted load-modify-store race commented. Assign log carries ids/team/role only — never the join code (AR15).
- **Task 5 — integration tests:** 12 tests in the existing harness: happy path asserting both sockets receive teams+roster; persistence in the fake store; **AC 2** non-facilitator → `NOT_FACILITATOR` + store byte-identical + no broadcast; never-joined socket → `NOT_IN_SESSION`; unknown target → `PLAYER_NOT_FOUND`; facilitator target → `INVALID_ASSIGNMENT`; seeded `active` status → `NOT_IN_LOBBY`; `it.each` invalid payloads; A→B move (team deletion); idempotent repeat with an ERROR-fence proving no persist/broadcast; injected `setJSON` failure → `TEAM_ASSIGN_FAILED`; two-joiner relayOrder ordering.
- **Task 6 — Lobby UI:** team badge (`Team A`/`Team B`/`Unassigned`, neutral-ink pill per mockup-2 badge grammar, omitted on the facilitator's row) for every viewer. Facilitator-only per-row controls: A/B toggle chips (2.3 chip grammar, `aria-pressed`, emits with the player's current role) and a native role `<select>` (mockup-6 styling, disabled until a team is set — the wire contract requires `teamId`). Controls are server-truth-driven — no optimistic flips, no local mirrors. Lobby gained its own `ERROR` listener → inline `role="alert"` line (`text-led-red`, matching Landing's rejection grammar), cleared whenever a new `SESSION_STATE` snapshot lands. New strings (`TEAM_A`, `TEAM_B`, `UNASSIGNED`) in `copy.ts`. Roster panel widened to `max-w-xl` to seat the controls; share panel untouched.
- **Task 7 — gates:** typecheck/tests/build all green (see Debug Log); live three-client headless smoke executed end-to-end incl. AR15 and the no-broadcast-on-rejection check. Browser-visual pass not possible in this environment — recommend two windows (`pnpm dev`): host in one, join in an incognito window, assign teams from the host and watch both rosters update live.
- **Deviation (none material):** the inline error line uses `text-led-red` (Landing's established server-rejection color) rather than amber — rejections are errors, not cautions; one grammar for one meaning.

### File List

- apps/server/src/session/assignTeam.ts (created)
- apps/server/src/session/__tests__/assignTeam.test.ts (created)
- apps/server/src/handlers/sessionHandlers.ts (modified — + `SessionSocketData`, `parseTeamAssignPayload`, `TEAM_ASSIGN` handler, `socket.data.sessionId` writes ×3, `TeamId` import)
- apps/server/src/handlers/__tests__/sessionHandlers.test.ts (modified — + TEAM_ASSIGN + validator suites)
- apps/server/src/handlers/__tests__/testSocketServer.ts (modified — `TestIOServer` 4-generic retype only)
- apps/server/src/index.ts (modified — `AppIOServer` + instantiation 4-generic retype only)
- apps/client/src/ui/Lobby.tsx (modified — team badges, facilitator A/B chips + role select, ERROR listener + inline alert)
- apps/client/src/ui/copy.ts (modified — TEAM_A/TEAM_B/UNASSIGNED)

## Change Log

- 2026-06-12: Story 2.4 implemented — third verse of the handler pipeline and the codebase's first facilitator-authority gate. Server: `socket.data.sessionId` bookkeeping (typed via `SessionSocketData`), pure `assignPlayerToTeam` (owns `teams`/relayOrder = assignment order per GDD default rotation), `parseTeamAssignPayload`, `TEAM_ASSIGN` handler (authority-first guard order, idempotent no-op, persist-then-broadcast). Client: team badges for all viewers + facilitator-only assignment controls (A/B chips, role select gated on team) + lobby error surface. All gates green (tsc 0 errors; 195 tests across workspaces; build); live three-client headless smoke verified end-to-end including AC 2 rejection and AR15.
