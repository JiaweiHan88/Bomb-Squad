---
baseline_commit: 1591434
---

# Story 2.3: Player Joins via Code and Picks a Role

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to enter a join code, pick a display name and role, and land in the lobby,
so that I can take part as Defuser, Expert, or Spectator.

## Acceptance Criteria

1. **The 6-cell code input behaves per the UX contract.** Given the join-code input, when I type or paste a code, then it shows 6 mono character cells, auto-uppercases, splits a paste per cell, and submits on the 6th character without a separate button.

2. **A valid join lands me in the roster.** Given a valid code and an available session, when I submit with a display name and chosen role, then `SESSION_JOIN` succeeds and I appear in the lobby roster with that role.

3. **Failures are typed and survivable.** Given an invalid or full session code, when I submit, then I receive a typed, human-readable error and remain on the join screen.

## Tasks / Subtasks

- [x] **Task 1 — Server: pure join function in `apps/server/src/session/` (AC: 2)**
  - [x] Create `apps/server/src/session/joinSession.ts` exporting a pure function `addPlayerToSession(state: SessionState, player: { playerId: string; displayName: string; role: PlayerRole }): SessionState`. Returns a **new** state with `players[playerId] = { playerId, displayName, role, isReady: false }` (no `teamId` — team assignment is Story 2.4). Spread, never mutate: `{ ...state, players: { ...state.players, [playerId]: … } }`.
  - [x] **Idempotency guard inside the pure function:** if `state.players[playerId]` already exists, return `state` **unchanged** (same reference). This protects the facilitator's own entry (a facilitator re-emitting `SESSION_JOIN` into their own session must not demote their `role: 'facilitator'`) and makes a double-emit from a flaky client a no-op. The handler still re-sends `SESSION_STATE` to that socket (Task 3) so the client converges.
  - [x] Pure means pure: no I/O, no `Date.now()`, no randomness, zero imports from socket.io/ioredis/fastify — same discipline as `createSession.ts` (the file to copy style from, including its doc-comment voice).
  - [x] Unit tests `apps/server/src/session/__tests__/joinSession.test.ts` (match `createSession.test.ts` style): adds a player with the given role and `isReady: false`; does not touch `teams`/`config`/`status`/`joinCode`; immutability (input object frozen with deep `Object.freeze` must not throw; result is a new object, input unchanged); idempotent (existing playerId → identical reference returned); facilitator entry survives a duplicate join attempt.

- [x] **Task 2 — Server: `SESSION_JOIN` payload validation (AC: 2, 3)**
  - [x] In `apps/server/src/handlers/sessionHandlers.ts`, add `parseSessionJoinPayload(payload: unknown)` alongside `parseSessionCreatePayload`, same `ParseResult`-style shape, exported for direct unit testing. Rebuild a sanitized object; never pass the raw client object onward. Rules:
    - `payload` must be a non-null, non-array object — else fail.
    - `joinCode`: must be a string; **normalize** `trim().toUpperCase()`; after normalization must match `/^[A-Z0-9]{6}$/` (the mint charset and length from `joinCode.ts`) — else fail with `'joinCode must be 6 characters (letters and digits)'`. Normalizing server-side means a hand-built client sending lowercase still resolves.
    - `displayName`: must be a string; `trim()`; length 1–24 after trim — else fail. 24 keeps roster rows one-line at the mockup's type scale.
    - `role`: must be exactly one of `'defuser' | 'expert' | 'spectator'`. **`'facilitator'` is rejected** even though `PlayerRole` admits it — the facilitator seat is minted by `SESSION_CREATE` only; accepting it here would let any joiner claim facilitator authority (Story 2.4's `TEAM_ASSIGN` will gate on that role). This is a security boundary, not a style choice.
    - Unknown extra keys: ignore them (JSON transport junk), do not fail — unlike `SESSION_CREATE`'s config (which whitelists because it persists the object), here you rebuild from the three known fields, so extras are inert.
  - [x] Validator unit tests (same `describe` style as the existing `parseSessionCreatePayload` tests): happy path; lowercase/padded code normalized; 5-char and 7-char codes rejected; code with `-`/`:` rejected; empty/whitespace-only name rejected; 25-char name rejected; 24-char name accepted; `role: 'facilitator'` rejected; non-object payload rejected; missing fields rejected.

- [x] **Task 3 — Server: `SESSION_JOIN` handler — the canonical pipeline, second verse (AC: 2, 3)**
  - [x] Add a `socket.on('SESSION_JOIN', async (payload) => { … })` inside the existing `io.on('connection')` block of `registerSessionHandlers`. **The contract has no ack** (`SESSION_JOIN: (payload: SessionJoinPayload) => void` in `client-to-server.ts` — frozen, do not add one): success is conveyed by the `SESSION_STATE` broadcast, failure by a typed `ERROR` to the joining socket. Do not redesign the contract.
  - [x] Pipeline (architecture Pattern 2, same shape as `SESSION_CREATE`): **validate → resolve code → load state → guard → pure add → persist → join room → broadcast**:
    1. `parseSessionJoinPayload` fails → `socket.emit('ERROR', { code: 'INVALID_PAYLOAD', message, recoverable: true })`, return.
    2. `await redis.getJSON<string>(joinCodeKey(code))` → `null` → `ERROR { code: 'SESSION_NOT_FOUND', message: "That code doesn't match an open session.", recoverable: true }`, return.
    3. `await redis.getJSON<SessionState>(sessionKey(sessionId))` → `null` (dangling joincode key — e.g. partial cleanup) → same `SESSION_NOT_FOUND` error. Never leak internals in the message.
    4. **Already joined?** `state.players[socket.id]` exists → `await socket.join(sessionRoom(sessionId))` (re-assert room membership) then `socket.emit('SESSION_STATE', state)` and return — idempotent convergence, no persist, no broadcast, no error.
    5. **Capacity guard (AC 3 "full"):** `Object.keys(state.players).length >= MAX_PLAYERS` (declare `const MAX_PLAYERS = 16` in the handler file — GDD/FR cap, facilitator counts as a player) → `ERROR { code: 'SESSION_FULL', message: 'That session is full — 16 is the limit.', recoverable: true }`, return. (Story 2.6 re-tests this formally and adds the join-window/between-rounds rules; the cap itself belongs here because this AC names it.)
    6. **Lobby-phase guard (defensive):** `state.status !== 'lobby'` → `ERROR { code: 'SESSION_NOT_JOINABLE', message: 'That session has already started.', recoverable: true }`, return. Today status is always `'lobby'` (no `ROUND_START` exists yet); the guard exists so Epic-8 stories can't create a mid-round-join hole by omission. Story 2.6 will refine it (between-rounds admits).
    7. `const next = addPlayerToSession(state, { playerId: socket.id, displayName, role })`.
    8. **Persist then emit:** `await redis.setJSON(sessionKey(sessionId), next)` inside the try; on any throw (including the `getJSON`s above — `getJSON` **throws** on malformed JSON, it does not return null) → catch → `log.error({ err, socketId: socket.id }, 'SESSION_JOIN failed')` + `ERROR { code: 'SESSION_JOIN_FAILED', message: 'Could not join the session. Try again.', recoverable: true }`. No rollback needed — a single `setJSON`, nothing partial to orphan (unlike `SESSION_CREATE`'s two-key write).
    9. `await socket.join(sessionRoom(sessionId))` **before** broadcasting, then `io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next)` — one broadcast serves the joiner *and* every existing lobby member (this is exactly why 2.2 broadcast to the room instead of acking state).
  - [x] `playerId` **is** `socket.id` — consistent with the facilitator in `createSession.ts`. Known V1 limitation (deferred-work.md: ephemeral id breaks on reconnect; the reattach story owns the fix). Do not invent a UUID player id here — it would diverge from the facilitator entry and from how 2.4's `TEAM_ASSIGN` will address players.
  - [x] **Logging (AR15 — hard rule):** never log the join code, valid or invalid. `log.info({ sessionId, playerId: socket.id, role }, 'player joined')`. The failure log above carries `socketId` only.
  - [x] **Known accepted race:** two concurrent joins interleaving load→modify→store can drop one player (last write wins). Single-process V1 with human-speed lobby joins — accepted, same as 2.2's get-then-set code reservation. Do not build locks/WATCH/Lua for this; note it in a comment.

- [x] **Task 4 — Server: handler integration tests (AC: 2, 3)**
  - [x] Extend `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` with a `SESSION_JOIN` describe block using the existing `testSocketServer.ts` harness (it already supports multiple typed clients and failure-injection on the fake store — reuse, don't fork). Remember server tests are **Jest** (`import { jest } from '@jest/globals'` for fns), not Vitest — established 2.2 deviation.
  - [x] Cover: **(a)** two-socket happy path — socket A `SESSION_CREATE`, socket B `SESSION_JOIN` with the acked code + `{ displayName: 'Maya', role: 'expert' }`; **both** sockets receive a `SESSION_STATE` containing 2 players, with B's entry carrying `role: 'expert'`, `isReady: false`, no `teamId`; **(b)** the fake store's `session:{id}` value contains the new player (persisted, not just broadcast); **(c)** unknown code → `SESSION_NOT_FOUND` to B only, A receives nothing, store unchanged; **(d)** lowercase code accepted (normalization); **(e)** invalid payloads (`role: 'facilitator'`, empty name, 5-char code) → `INVALID_PAYLOAD`, nothing persisted; **(f)** full session — seed the fake store directly with a 16-player `SessionState` + its joincode key, join → `SESSION_FULL`; **(g)** non-lobby status — seed `status: 'active'` → `SESSION_NOT_JOINABLE`; **(h)** idempotent re-join — B joins twice; second attempt yields a `SESSION_STATE` to B, player count stays 2, no third broadcast to A; **(i)** persist failure (`setJSON` rejects on the session key) → `SESSION_JOIN_FAILED` to B, no broadcast to A; **(j)** dangling joincode (joincode key present, session key absent) → `SESSION_NOT_FOUND`.
  - [x] Keep the `afterEach` socket/server teardown pattern — hung Jest workers were the documented failure mode.

- [x] **Task 5 — Client: pure join-form logic in `apps/client/src/ui/joinCode.ts` (AC: 1)**
  - [x] All cell/form logic lives in a pure module so the component stays a dumb renderer (2.1 testing posture: components are visual-regression-only; if a component needs a logic test, the logic has leaked). Export:
    - `sanitizeCode(raw: string): string` — uppercase, strip to `[A-Z0-9]`, used for typed chars, paste text, and the `?join=` prefill.
    - `applyCharAt(cells: string[], index: number, raw: string): { cells: string[]; focusIndex: number }` — set one sanitized char, advance focus (clamped to 5).
    - `applyPasteAt(cells: string[], index: number, raw: string): { cells: string[]; focusIndex: number }` — mockup behavior verbatim: sanitize, spread one char per cell from `index`, focus `min(index + pasted.length, 5)`.
    - `applyBackspaceAt(cells: string[], index: number): { cells: string[]; focusIndex: number }` — clear current if filled; if already empty, move focus back one and clear that cell.
    - `isCodeComplete(cells: string[]): boolean` — all 6 non-empty.
    - `isJoinReady(cells: string[], name: string, role: PlayerRole | null): boolean` — code complete ∧ trimmed name 1–24 ∧ role chosen. Mirror of the server validator so a payload that passes locally never bounces off `INVALID_PAYLOAD`.
  - [x] Cells are always `string[]` of length 6 (`''` = empty) — pure data, never DOM reads. Functions return new arrays (no mutation).
  - [x] Unit tests `apps/client/src/ui/__tests__/joinCode.test.ts` (Vitest, Node env — client tests are Vitest, unlike the server): sanitize (lowercase→upper, strips `-`, spaces, emoji); paste mid-cells overflow-truncates; paste of `'ktane5'` at index 0 fills all six; backspace on empty cell retreats; readiness matrix (missing name / missing role / 5 cells / whitespace name / 25-char name → false).

- [x] **Task 6 — Client: join panel UI in `Landing.tsx` (AC: 1, 2, 3)**
  - [x] Extend `apps/client/src/ui/Landing.tsx` to the full mockup card (`mockups/1. Landing.html`): join section **above**, `or` divider, host section **below**. Switch the "Host a session" button to `variant="secondary"` — the mockup renders it `btn-secondary` once the join path is the primary affordance. Keep the entire 2.2 host flow (pending ref, `settleFailure`, ack timeout, `ERROR` listener) — you are extending this file, not rewriting it.
  - [x] **Form fields, top to bottom:** display-name `<input>` (`maxLength={24}`, label "Your name"), role picker, then the 6-cell code input under the mockup's label "Enter a join code" with help line "Six characters, from your facilitator. **Submits on the sixth.**"
  - [x] **Role picker:** three toggle chips — Defuser / Expert / Spectator — **no preselection** (AC says *chosen* role; a silent default would ship players into the wrong seat). Build with plain styled `<button type="button">` elements, NOT the `Button` primitive (that's an action button with the tactile press reserved for primary actions; these are selection state). Selected chip: `border-brass` + `text-ink-primary`; unselected: `border-ink-muted text-ink-muted` — same filled-vs-empty grammar as the code cells. Add `aria-pressed`.
  - [x] **6-cell code input:** six `<input>`s, `maxLength={1}`, `font-mono`, centered, uppercase rendering, one `aria-label` each ("Join code character N"), `autoComplete="off"`. State is a single `useState<string[]>` driven exclusively through the Task-5 pure functions; handlers do `setCells` + imperative `.focus()` on a `useRef` array of the six elements. Filled cells get `border-brass`; focus ring comes free from the global focus token. All of this is presentation state — local `useState`, never Zustand (2.1 rule).
  - [x] **Submit triggers (AC 1 — "submits on the 6th character without a separate button"):** there is **no Join button**. Emit happens when:
    - (a) a typed char or paste makes the code complete (`isCodeComplete` flips true in that handler) **and** `isJoinReady` — emit immediately; or
    - (b) `Enter` is pressed in the name field (or a cell) while `isJoinReady` — covers the `?join=` prefill flow where the code was complete before the name existed.
    - If the 6th char lands but name/role are missing: do **not** emit; show a deadpan inline hint ("Add a name and pick a role — then it sends itself.") and focus the name field. Re-trigger via (b) once complete. No reactive `useEffect`-watching-form-state submits — emits fire only inside user-event handlers, so the form can never surprise-submit on a role click.
  - [x] **Emit + settle (no ack exists on this event):** on submit set local `joining` state + a `pending` ref (mirror the host flow exactly), `getSocket().emit('SESSION_JOIN', { joinCode: cells.join(''), displayName: name.trim(), role })`. Resolution paths: **success** — `SESSION_STATE` lands in `gameStore`, App swaps `Landing → Lobby`, this component unmounts (nothing to do); **server rejection** — the existing `ERROR` listener in Landing fires `settleFailure(payload.message)` (gate it on the shared pending ref exactly as the host path does — the server messages from Task 3 are already human-readable and deadpan, render `payload.message` directly; this is AC 3's "typed, human-readable error … remain on the join screen"); **timeout** — start a 5 s `setTimeout` on emit (this event has no ack so `socket.timeout()` doesn't apply); on fire, `settleFailure(JOIN_TIMEOUT)` copy. Clear the timer on settle and on unmount. While `joining`: disable all join inputs; small inline busy line ("Checking the code…"), not a `LoadingScreen` (reserved for socket connection).
  - [x] **`?join=` prefill (closes the 2.2 share-link loop):** on mount, `const prefill = sanitizeCode(new URLSearchParams(window.location.search).get('join') ?? '').slice(0, 6)`; if non-empty, seed the cells and focus the **name** field (the code is done; the name is what's missing). Do not auto-submit a prefilled code — name/role gate it naturally. Leave the URL untouched (no router, no `replaceState` — harmless and re-shareable).
  - [x] New strings in `apps/client/src/ui/copy.ts` (one voice source): `ENTER_A_JOIN_CODE = 'Enter a join code'`, `JOIN_HELP` (the "Submits on the sixth." line), `YOUR_NAME = 'Your name'`, role labels `ROLE_DEFUSER/ROLE_EXPERT/ROLE_SPECTATOR`, `JOIN_INCOMPLETE` hint, `JOIN_BUSY = 'Checking the code…'`, `JOIN_TIMEOUT = 'No answer from the server. Try again.'`. Keep dry/deadpan/period-appropriate.

- [x] **Task 7 — Client: minimal lobby roster (AC: 2)**
  - [x] Extend `apps/client/src/ui/Lobby.tsx` with a "Team roster" panel (mockup `2. Lobby.html` left column) rendering `Object.values(session.players)`: each row = `displayName`, a role badge (mono, small caps style per mockup badges; facilitator's badge reads "Facilitator"), and a cool-blue **"You" tag** when `player.playerId === getSocket().id` (`text-speaker-self` — the DESIGN.md-reserved self color; this is identity, exactly its sanctioned use). Sort: facilitator first, then by `displayName` for a stable order across broadcasts.
  - [x] Scope fence: **no** team badges (2.4), **no** ready button/state display (2.5), **no** empty-state message (2.5), **no** mic indicators (2.5), **no** role re-pickers in the lobby (2.4 facilitator assignment). Render name + role + You only. The roster updates in real time for free — every join re-broadcasts `SESSION_STATE` and `Lobby` already subscribes via `useGameStore((s) => s.session)`.
  - [x] Keep the 2.2 share panel as-is next to the roster (mockup shows both; spectators/experts seeing the code is fine — they're in the session). Layout: side-by-side panels within the existing centered container; plain Tailwind on tokens, no new component primitives (2.1 decision: no Panel/Toast components yet).
  - [x] Roster row strings (the "You" tag text) go in `copy.ts`.

- [x] **Task 8 — Gates: tests, typecheck, build, smoke (AC: 1, 2, 3)**
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `// @ts-ignore`. `pnpm -r test` → all green: server 90 existing + new join suites; client 9 existing + new `joinCode` suite; shared 24 untouched. `pnpm --filter @bomb-squad/client build` → succeeds.
  - [x] **Manual smoke (document results in Completion Notes):** full stack or `redis`+`postgres` containers + dev servers. Window 1: host a session, copy the link. Window 2 (incognito): open the copied `/?join=CODE` link → cells prefilled, focus on name → type a name, pick Expert, press Enter → lobby shows both players, "You" on the joiner, Expert badge. Window 1's roster updated live without refresh. Then: bogus code `ZZZZZZ` → inline "That code doesn't match an open session." and still on landing. Verify the join code never appears in server stdout (AR15). If a browser is unavailable in the dev environment, replicate via two headless socket.io-clients (the 2.2 pattern) and say exactly what was and wasn't visually verified.

## Dev Notes

### What this story is — and is not

Second verse of the handler pipeline 2.2 established: `SESSION_JOIN` is **validate → resolve `joincode:` key → load → guard → pure add → persist → room → broadcast**, plus the client's join form and the first visible roster. The interesting differences from 2.2: **this event has no ack** (success = the `SESSION_STATE` broadcast that mounts Lobby; failure = typed `ERROR`), and it's the first handler that *loads and mutates existing* session state rather than creating it.

**Out of scope:** team assignment + facilitator role authority (`TEAM_ASSIGN`, 2.4), ready state / mic check / roster empty-state (2.5), formal capacity + join-window rules and between-rounds admits (2.6 — but the 16-cap itself is in this story's AC and lands here), session reattach on refresh (deferred; socket.id identity is the documented V1 limitation), any voice/LiveKit, any router.

### The wire contract is frozen — the no-ack shape is deliberate

`packages/shared` needs **zero changes**:

- `SESSION_JOIN: (payload: SessionJoinPayload) => void` — no ack callback. Do not add one "for symmetry" with `SESSION_CREATE`: create needed an ack because the creator must learn identifiers that exist nowhere else; a joiner learns everything from the `SESSION_STATE` broadcast it receives the moment it enters the room. Client settle logic = pending ref + `ERROR` listener + 5 s local timer.
- `SessionJoinPayload = { joinCode: string; displayName: string; role: PlayerRole }`. `PlayerRole` includes `'facilitator'` — the **server validator must reject it** (see Task 2; authority boundary for 2.4).
- `PlayerInfo.teamId` is optional — joiners simply omit it (Story 2.4 sets it). The lobby mockup's "Role TBD"/unassigned badge maps to *team* unassignment, not role: per the epic AC the player's chosen role is real from the moment of join, and the facilitator re-assigns in 2.4.
- `ERROR: { code, message, recoverable }` — already bound in Landing with the pending-gate pattern. New codes this story mints: `SESSION_NOT_FOUND`, `SESSION_FULL`, `SESSION_NOT_JOINABLE`, `SESSION_JOIN_FAILED` (plus reusing `INVALID_PAYLOAD`). Codes are server-side string literals — no shared-package enum exists and none should be added (codes are advisory; `message` is the rendered surface).

### Existing code you build on (read before editing)

- `apps/server/src/handlers/sessionHandlers.ts` — your handler lands inside the existing `io.on('connection')` callback next to `SESSION_CREATE`. Reuse `sessionRoom()`, the `SessionLog`/`SessionHandlerDeps` types, and the validator style (`ParseResult`, rebuild-don't-pass-through). Post-review version includes best-effort rollback on create — join needs no equivalent (single-key write).
- `apps/server/src/state/redis.ts` — `getJSON` **throws** on malformed JSON (returns `null` only for absent keys). Both the joincode resolve and the session load sit inside your try/catch → `SESSION_JOIN_FAILED`.
- `apps/server/src/state/keys.ts` — `joinCodeKey` (built by 2.2 explicitly for this story) and `sessionKey`. Key builders don't validate inputs; your `[A-Z0-9]{6}` normalization is the guard (deferred-work.md item).
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — harness with Map-backed `RedisStore` fake + failure injection. Supports multiple clients; extend the test file, not the harness, unless something is genuinely missing.
- `apps/client/src/ui/Landing.tsx` — already has the pending-ref/`settleFailure`/`ERROR`-listener machinery and an inline `role="alert"` error line. The join flow **shares** that error line and pending ref (a user can't host and join simultaneously; one in-flight attempt at a time keeps the gate sound).
- `apps/client/src/ui/Lobby.tsx` — share panel renders from `useGameStore((s) => s.session)`; add the roster panel beside it. `buildShareLink` produces `/?join=CODE` — Task 6's prefill is the consumer half of that contract.
- `apps/client/src/net/socket.ts` — `getSocket()` for event-handler emits (never module top level) and `getSocket().id` for the You tag. `bindServerEvents.ts` already routes `SESSION_STATE` → store: **zero net-layer changes**.
- `apps/client/src/App.tsx` — `session === null ? <Landing/> : <Lobby/>` already swaps surfaces when the join broadcast lands. **Do not touch App.tsx, gameStore.ts, or bindServerEvents.ts.**
- `apps/client/src/ui/Button.tsx` — `variant="secondary"` exists (transparent, ink-muted border) — use it for the demoted host button; role chips are bespoke toggles, not Buttons.

### Previous-story intelligence (2.2, done — patches on your baseline `1591434`)

- **Jest on the server, Vitest on the client** — 2.2's documented deviation; `jest.config.cjs` `testMatch` already narrowed so the harness file isn't collected as a suite. Don't re-litigate.
- The review added: best-effort rollback on create's two-key write, the pending-gate for `ERROR` cross-talk in Landing (your join flow must use the same gate, not a second listener), `Number.isInteger` strictness in validators (mirror it), and a throwing-`getJSON` test (replicate for join's resolve path).
- The facilitator-identity-is-socket.id deferral is recorded in deferred-work.md — `SESSION_JOIN` keying players by `socket.id` is *consistent with* that decision, not a new instance of it. Flag nothing; change nothing.
- Smoke posture: live headless socket smoke against throwaway containers worked well in 2.2 and is the fallback if no browser is available; AR15 was verified by grepping server logs for the minted code — do the same.

### Architecture compliance checklist (the rules this story is judged against)

- **Handler = I/O; logic = pure.** `joinSession.ts` imports only shared types. The handler adds no logic beyond the pipeline + guards.
- **Persist then emit; on persist failure emit nothing** but a typed `ERROR`.
- **Never fire-and-forget** — every `await` inside try/catch; join the room *before* the broadcast or the joiner misses their own join.
- **Server-side validation of untrusted input** (architecture Security): role whitelist (facilitator excluded), code normalization, name bounds, capacity, phase. Anything failing → typed `ERROR`, **no state change**.
- **State residence:** load → modify → store through Redis only; no in-memory session cache. The load-modify-store race is the accepted V1 concurrency model (Pattern 1 note) — comment it, don't solve it.
- **AR15:** the join code never appears in any log line — including validation-failure logs (log `socketId`, not the attempted code).
- **Client is render-only:** the roster renders `SESSION_STATE.players` verbatim; the client never fabricates roster entries optimistically (no "ghost self" row while joining — the broadcast is sub-second on LAN and the busy line covers it).
- **Typed events only** — existing `AppClientSocket`/server generics make this structural.

### UX compliance (DESIGN.md / EXPERIENCE.md / mockup 1 & 2)

- Join-code input contract (EXPERIENCE.md Component Patterns, verbatim): "6 character cells, mono type. Auto-uppercases. Pastes split per-cell. Submits on 6th char without explicit button press." The mockup's JS block is the reference implementation for typing/advance/backspace/paste — port its behavior through the Task-5 pure functions.
- Operator-world surface: dark shell, cream ink, `surface-raised` panels; filled-cell state = `border-brass`; focus = LED-green ring (already the global focus token).
- Color reservations: **`speaker-self` cool blue for the You tag only**; never decorative. Role badges are neutral (mono, muted ink) — do not color-code roles with LED semantics (green/red/amber are solved/strike/caution, reserved).
- Microcopy is dry/deadpan ("Bring them in" precedent). All new strings in `copy.ts`.
- The mockup's mic-preflight note ("We'll ask for your microphone next…") is **Epic 3** — do not render it yet; it would promise a permission prompt this build never makes.

### Project Structure Notes

- New server files: `session/joinSession.ts`, `session/__tests__/joinSession.test.ts`. Updated: `handlers/sessionHandlers.ts` (+ `SESSION_JOIN` handler + `parseSessionJoinPayload` + `MAX_PLAYERS`), `handlers/__tests__/sessionHandlers.test.ts`.
- New client files: `ui/joinCode.ts`, `ui/__tests__/joinCode.test.ts`. Updated: `ui/Landing.tsx`, `ui/Lobby.tsx`, `ui/copy.ts`. Barrel `ui/index.ts` only if a new component file is split out (acceptable: a `JoinCodeCells.tsx` child of Landing if the file gets unwieldy — keep it rendering-only).
- **No changes:** `packages/shared` (contract frozen), `App.tsx`, `net/*`, `store/*`, any config/tsconfig/deps. No new dependencies anywhere — `URLSearchParams`, `socket.emit` (no ack), and `setTimeout` are the only "APIs" this story adds.
- Naming: `SESSION_JOIN` SCREAMING_SNAKE (exists), `joinSession.ts`/`addPlayerToSession` camelCase, components PascalCase — all per project-context conventions.

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors; no `// @ts-ignore`.
- All game actions validated server-side — client input untrusted; never trust payload values without bounds-checking (this story's whole server half).
- Join codes: min 6 chars cryptographic random (minting was 2.2; this story must not weaken it — e.g. never reveal whether a code is "close" or log attempted codes).
- Socket event types live in `packages/shared/src/events/` only — reuse, never redeclare; untyped `emit(string, any)` forbidden.
- Redis = all in-flight session state, O(1) per action (two `getJSON` + one `setJSON` here); Postgres untouched.
- Handlers await all async I/O cleanly; reducers/pure fns throw nothing, mutate nothing.
- React: no game logic in components — cell/form logic extracted pure (Task 5); presentation state in `useState`, server snapshots in Zustand.
- Never `Math.random()` outside seeded generation — nothing in this story needs randomness at all.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.3: Player Joins via Code and Picks a Role] (ACs verbatim; FR2–FR3 scope; 2.4/2.5/2.6 fences)
- [Source: _agent_docs/game-architecture.md#Pattern 1 — Multi-Session, Single-Process Model] (room naming; Redis residence; serialized-mutation note → accepted race)
- [Source: _agent_docs/game-architecture.md#Pattern 2 / Implementation Patterns / Error Handling] (pipeline; persist-then-emit; validate at boundary; typed ERROR, no state change)
- [Source: _agent_docs/game-architecture.md#API Contracts] (`SESSION_JOIN { joinCode, displayName, role }` with "Valid code; capacity" authority checks)
- [Source: _agent_docs/game-architecture.md#Security Architecture / Logging Strategy] (untrusted input; AR15 never log codes)
- [Source: packages/shared/src/events/client-to-server.ts] (SESSION_JOIN signature — no ack; frozen)
- [Source: packages/shared/src/events/payloads.ts] (SessionJoinPayload; ErrorPayload)
- [Source: packages/shared/src/types/session.ts] (PlayerRole incl. facilitator → must reject; PlayerInfo.teamId optional; SessionState.players Record)
- [Source: apps/server/src/handlers/sessionHandlers.ts] (pipeline + validator style to extend; sessionRoom; post-review patterns)
- [Source: apps/server/src/session/createSession.ts, state/keys.ts, state/redis.ts] (pure-factory style; joinCodeKey; getJSON throw semantics)
- [Source: apps/server/src/handlers/__tests__/testSocketServer.ts] (multi-client harness + failure injection)
- [Source: apps/client/src/ui/Landing.tsx, Lobby.tsx, Button.tsx, copy.ts, shareLink.ts] (pending-gate error machinery; share panel; secondary variant; voice source; `?join=` producer)
- [Source: apps/client/src/net/socket.ts, store/gameStore.ts, App.tsx] (getSocket()/socket.id; SESSION_STATE → session → Lobby swap — untouched)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Component Patterns / IA] (join-code input contract verbatim; lobby = roster + share; role-gated surfaces)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md + apps/client/src/index.css] (speaker-self reserved for self; LED semantic reservations; brass/filled grammar)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/1. Landing.html, 2. Lobby.html] (cell behavior reference JS; roster row anatomy; "You" tag; secondary host button)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (socket.id identity deferral; key-builder validation deferral)
- [Source: _agent_docs/implementation-artifacts/2-2-facilitator-hosts-a-session.md] (handler pipeline precedent; Jest deviation; review patches; smoke posture)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors across all three workspaces (no `@ts-ignore`).
- `pnpm -r test` → shared 24 ✓ (untouched), client 24 ✓ (3 files; was 9 — +15 joinCode pure-logic tests), server 115 ✓ (10 suites; was 90 — +5 joinSession, +13 SESSION_JOIN handler integration, +7 parseSessionJoinPayload validator).
- `pnpm --filter @bomb-squad/client build` → success (`index.css` 15.95 kB gz 4.25, `index.js` 198.67 kB gz 63.76).
- **Live end-to-end smoke (headless):** booted the worktree server via `tsx` on :3199 against throwaway `redis:7-alpine`/`postgres:16-alpine` containers (`/health` → 200, both probes ok). Two real `socket.io-client`s drove the flow: A `SESSION_CREATE` → ack; B `SESSION_JOIN` with a **lowercase, whitespace-padded** code and `'  Maya  '` → **both** sockets received the 2-player `SESSION_STATE` with Maya as `expert`, `isReady: false`, no `teamId` (normalization + trim verified live). Bogus code `ZZZZZZ` → `SESSION_NOT_FOUND` ("That code doesn't match an open session."). `role: 'facilitator'` claim → `INVALID_PAYLOAD`. Duplicate join → idempotent (roster stayed 2, original entry untouched). Redis held `joincode:8BOEIH` → sessionId. `grep -c 8BOEIH server.log` → **0** (AR15 verified live); the join log line is `{"sessionId":…,"playerId":…,"role":"expert","msg":"player joined"}`. Containers/process removed after.

### Completion Notes List

- **Task 1 — pure join:** `addPlayerToSession` in `session/joinSession.ts` — spread-only, adds `{ playerId, displayName, role, isReady: false }` (no `teamId`; 2.4's concern). Idempotency guard returns the same reference when the playerId already exists, which structurally protects the facilitator from demotion by a duplicate join. 5 unit tests incl. deep-frozen-input immutability.
- **Task 2 — validation:** `parseSessionJoinPayload` (exported) normalizes the code (`trim().toUpperCase()`, must match `[A-Z0-9]{6}`), trims/bounds the name (1–24), and whitelists `defuser|expert|spectator` — `'facilitator'` rejected as a mint-only seat (security boundary for 2.4's authority checks). Rebuilds a fresh object; unknown extra keys inert. 7 validator tests.
- **Task 3 — handler:** `SESSION_JOIN` added beside `SESSION_CREATE` in the same `connection` block, no ack per the frozen contract. Pipeline: validate → `joincode:` resolve → load → idempotent-rejoin convergence (re-join room + re-send snapshot, no persist/broadcast) → `SESSION_FULL` at `MAX_PLAYERS = 16` → `SESSION_NOT_JOINABLE` for non-lobby status (defensive; 2.6 refines) → pure add → persist → `socket.join` **before** room broadcast. All awaits inside try/catch → `SESSION_JOIN_FAILED` (covers `getJSON` throws). Single-key write — no rollback needed. AR15: code never logged; success log carries `sessionId`/`playerId`/`role` only. The load-modify-store race is commented as the accepted V1 model.
- **Task 4 — integration tests:** 13 tests in the existing harness (multi-client): happy path asserting **both** sockets receive the 2-player roster; persistence check against the fake store; unknown code (joiner-only error, store untouched); lowercase normalization; `it.each` invalid payloads; seeded 16-player session → `SESSION_FULL`; seeded `active` status → `SESSION_NOT_JOINABLE`; idempotent re-join (no growth, no extra broadcast to others); injected `setJSON` failure → `SESSION_JOIN_FAILED` + no broadcast; dangling joincode → `SESSION_NOT_FOUND`.
- **Task 5 — pure client logic:** `ui/joinCode.ts` — `sanitizeCode`, `applyCharAt`, `applyPasteAt` (mockup paste-split verbatim), `applyBackspaceAt` (clear-or-retreat), `isCodeComplete`, `isJoinReady` (local mirror of the server validator so a locally-passing payload never bounces off `INVALID_PAYLOAD`). 15 Vitest tests incl. paste overflow/junk and the readiness matrix.
- **Task 6 — Landing join panel:** full mockup card — name field (maxLength 24), three role chips (`aria-pressed`, no preselection — AC says *chosen* role), 6 mono cells (controlled inputs driven exclusively through the Task-5 pure functions; `border-brass` filled-state; focus-select so typing over a filled cell replaces). Submit fires only from user-event handlers: 6th char/paste completing the code, or Enter with a complete code; incomplete name/role → deadpan hint + name focus, never a surprise submit. `?join=` prefill seeds the cells and focuses the name (never auto-submits). No ack on the event → 5 s local timer; the shared `pending` ref gates host+join failures to settle exactly once; busy state disables all inputs with "Checking the code…". Host button demoted to `variant="secondary"` per mockup; entire 2.2 host flow preserved. New strings centralized in `copy.ts`.
- **Task 7 — Lobby roster:** "Team roster" panel beside the 2.2 share panel — facilitator-first stable sort, name + mono role badge, cool-blue `text-speaker-self` "You" tag on `getSocket().id` match (the DESIGN.md-sanctioned identity use). No team badges/ready/mic/empty-state (2.4/2.5 fences). Roster updates in real time for free via the join re-broadcast → existing `useGameStore` subscription.
- **Task 8 — gates:** typecheck/tests/build all green (see Debug Log); live headless two-client smoke executed end-to-end incl. AR15. Browser-visual pass not possible in this environment — recommend a quick look via two windows (`pnpm dev` ×2): host in one, open the copied `/?join=` link in an incognito window, join as Expert, watch both rosters update live.
- **Deviation (none material):** no barrel change was needed (`Landing`/`Lobby` already exported; no new component file split out). `EMPTY_CELLS` is exported frozen from `joinCode.ts` as the canonical empty-cells value — a convenience the story's API list implied but didn't name.

### File List

- apps/server/src/session/joinSession.ts (created)
- apps/server/src/session/__tests__/joinSession.test.ts (created)
- apps/server/src/handlers/sessionHandlers.ts (modified — + `parseSessionJoinPayload`, `MAX_PLAYERS`, `SESSION_JOIN` handler)
- apps/server/src/handlers/__tests__/sessionHandlers.test.ts (modified — + SESSION_JOIN + validator suites)
- apps/client/src/ui/joinCode.ts (created)
- apps/client/src/ui/__tests__/joinCode.test.ts (created)
- apps/client/src/ui/Landing.tsx (modified — join panel: name, role chips, 6-cell code input, ?join= prefill; host demoted to secondary)
- apps/client/src/ui/Lobby.tsx (modified — roster panel with role badges + "You" tag)
- apps/client/src/ui/copy.ts (modified — join/roster strings)

## Change Log

- 2026-06-12: Story 2.3 implemented — second verse of the handler pipeline. Server: pure `addPlayerToSession` (idempotent, facilitator-demotion-proof), `parseSessionJoinPayload` (code normalization, name bounds, facilitator-role rejection), `SESSION_JOIN` handler (resolve → guards: not-found/full-at-16/non-lobby → persist-then-broadcast, room join before emit, AR15). Client: pure 6-cell input logic + Landing join panel (auto-submit on 6th char, role chips, `?join=` prefill, 5 s no-ack timeout, shared pending gate), Lobby roster with "You" tag. All gates green (tsc 0 errors; 163 tests; build); live two-client headless smoke verified end-to-end including AR15 (join code never logged).

## Review Findings

_Code review 2026-06-12 (gds-code-review, 3 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor returned fully clean — all 3 ACs and every prescriptive Task sub-bullet verified PASS. 0 decision-needed, 0 patch, 3 deferred, 14 dismissed as noise/known-accepted._

- [x] [Review][Defer] Reconnect breaks socket.id identity — orphaned roster rows, broken "You" tag, ghost capacity [apps/server/src/handlers/sessionHandlers.ts; apps/client/src/ui/Lobby.tsx] — deferred, pre-existing (extends the 2.2 socket.id deferral). On any Socket.IO reconnect the client gets a new `socket.id`, so the idempotent-rejoin guard misses, a second roster entry is added, the old one never leaves (no `disconnect` handler), the "You" tag (`playerId === getSocket().id`) silently drops, and ghost entries count toward `MAX_PLAYERS`. The session-reattach story owns the durable-id fix.
- [x] [Review][Defer] Concurrent `SESSION_JOIN` load-modify-store race can drop a player or exceed the 16-cap [apps/server/src/handlers/sessionHandlers.ts] — deferred, accepted-by-design. Two interleaving joins (last-write-wins) can lose a player, and two racers at 15 occupancy can both pass the `>= MAX_PLAYERS` check and reach 17. Explicitly accepted in Task 3 ("Known accepted race") and commented in code; single-process human-speed V1. Story 2.6 may revisit alongside the formal join-window rules.
- [x] [Review][Defer] Display-name bounds use UTF-16 `.length`, not grapheme/codepoint count; no NFC normalization [apps/server/src/handlers/sessionHandlers.ts; apps/client/src/ui/joinCode.ts] — deferred, minor i18n robustness (mirrors existing `createSession` pattern). Astral/emoji names hit the 1–24 limit at the wrong visible length, `maxLength={24}` can truncate mid-surrogate, and a lone zero-width/combining char passes the 1-char floor as an invisible roster row. Acceptable for V1; revisit with an i18n/input-hardening pass.
