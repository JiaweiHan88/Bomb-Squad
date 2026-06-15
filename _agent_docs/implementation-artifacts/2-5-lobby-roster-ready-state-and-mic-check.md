---
baseline_commit: e9de0d6 (master; + uncommitted TD-1 client component-test harness in the working tree — see "Baseline" note)
---

# Story 2.5: Lobby Roster, Ready State & Mic Check

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator and players,
I want a live roster with ready indicators and a mic check,
so that I can confirm everyone is present and audible before starting the round.

## Acceptance Criteria

1. **Live roster reflects team, role, and ready state in real time.** Given the lobby, when players join or change role/team/ready, then the roster reflects each player's team, role, and ready state in real time for all participants.

2. **Mic check lights a per-player speaker dot.** Given a player who has joined the lobby mic check, when their microphone produces audio, then their roster speaker indicator shows active (green); a silent (or not-yet-speaking) player's indicator stays gray, so the Facilitator can prompt them. The name is always shown alongside the dot (never icon-only — colorblind floor, EXPERIENCE.md).

3. **Single-player empty state.** Given a lobby with a single player (the viewer is alone), when it renders, then an empty-state message ("Waiting for your team.") is shown instead of a lonely one-row roster.

## Tasks / Subtasks

- [x] **Task 1 — Shared contract: `PLAYER_READY` self-toggle event (AC: 1)**
  - [x] `PlayerInfo.isReady: boolean` **already exists** (`packages/shared/src/types/session.ts:31`) and is preserved across join/assign — but **nothing toggles it today** (`grep PLAYER_READY` → zero hits). This story adds the toggle event. **No `SessionState`/`PlayerInfo` shape change** — only a new event.
  - [x] In `packages/shared/src/events/payloads.ts` add `PlayerReadyPayload { isReady: boolean }`. The payload carries **no `playerId`** — a player may only set **their own** ready state; the server resolves the caller from `socket.data.playerId` (the durable-id model, Story 2.7). This is the same "server resolves the caller, never trust a client-supplied identity" rule that `TEAM_ASSIGN` follows for its *target*, applied here to the *self*.
  - [x] In `packages/shared/src/events/client-to-server.ts` add `PLAYER_READY: (payload: PlayerReadyPayload) => void` — **no ack** (success = `SESSION_STATE` broadcast; failure = typed `ERROR` to the caller), matching the established no-ack mutation convention (`SESSION_JOIN`, `TEAM_ASSIGN`, `PLAYER_REMOVE`).
  - [x] Export `PlayerReadyPayload` from `packages/shared/src/events/index.ts` (and the barrel) so client + server import it typed. Types only — no logic. Run `pnpm --filter @bomb-squad/shared build` after so server/client resolve the new type.
  - [x] **No voice contract change.** The mic check rides on the existing `VOICE_TOKEN` event (Story 3.1), whose request payload is intentionally empty (`VoiceTokenRequestPayload`) — the server derives the room from session state. The lobby-room scope (Task 2) is added entirely server-side; the wire stays frozen.

- [x] **Task 2 — Server: fix the voice authority/identity regression + add the lobby-room scope (AC: 2)**
  - [x] **🚨 Pre-existing regression to fix first (blocks the mic check).** `apps/server/src/handlers/voiceHandlers.ts` resolves the requester with `state.players[socket.id]` and mints the token with `identity: socket.id`. Story 2.7 re-keyed `players` by the durable `playerId` and swept every *other* authority gate to `socket.data.playerId` — **but voiceHandlers was not in that sweep** (it lives in a separate file registered separately; the 2.7 sweep enumerated only `sessionHandlers`/`manualHandlers`/`moduleHandlers`). So in production `state.players[socket.id]` is **always `undefined`** → `VOICE_TOKEN` fails `NOT_IN_SESSION` for everyone. (The existing `voiceHandlers.test.ts` masks this by seeding `players` keyed by `socket.id` — line 72/172.) Fix:
    - Resolve the requester: `state.players[socket.id]` → `state.players[socket.data.playerId ?? '']`, with the same `socket.data.playerId === undefined` guard the 2.7 sweep used (a never-joined socket must still get `NOT_IN_SESSION`, not an accidental match).
    - **Identity → durable id:** pass `identity: socket.data.playerId` (not `socket.id`) into `mintVoiceToken`, and set `grant.identity = socket.data.playerId`. This is **load-bearing for AC 2**: the LiveKit participant identity must equal the roster `playerId` so the client can map `ActiveSpeakersChanged` participants back to roster rows. Update the log line's `playerId` field accordingly (it currently logs `socket.id`).
  - [x] **Lobby-room scope (the new bit).** `apps/server/src/voice/mintToken.ts` owns the role→room→grant rule. Add a **lobby phase** branch so that *while the session is in `lobby` status*, **every** participant (defuser/expert/spectator/facilitator) is scoped to a single shared room `lobby:{sessionId}` with `canPublish: true, canSubscribe: true` (bidirectional — a mic check needs everyone audible to everyone, and every player must confirm their own mic). Implementation shape:
    - Add `export const lobbyRoomName = (sessionId: string): string => \`lobby:${sessionId}\`;` beside `bombRoomName`/`spectatorLoungeName`.
    - Thread the phase into the scope decision. Cleanest: add an optional `phase?: SessionState['status']` to `VoiceParticipant` and branch at the **top** of `resolveVoiceScope` — `if (phase === 'lobby') return { room: lobbyRoomName(sessionId), grant: { roomJoin: true, room, canPublish: true, canSubscribe: true } };` — *before* the role checks, so an un-teamed defuser in the lobby no longer throws `VoiceScopeError` (today a Bomb-Room role with no team throws; in the lobby they belong in the lobby room regardless of team). The existing role-scoped behaviour (bomb-room / spectator-lounge) is unchanged for every non-lobby phase.
    - In `voiceHandlers.ts`, pass `phase: state.status` into the `mintVoiceToken` participant. The handler already loads `state` — no extra read.
  - [x] **Deliberate scope note (document in code):** the lobby room grants spectators `canPublish: true`, which is a **lobby-only** exception to FR39's spectator-listen-only rule. FR39 governs the *Spectator Lounge* (the in-game listen-only channel, Story 3.3); a pre-game mic check is not the lounge — every participant must be able to verify their own mic. Leave a one-line comment so a future reader doesn't "fix" it into listen-only.
  - [x] AR15 holds: never log the token. The new lobby `room` string is non-secret and may be logged (it already logs `room`).

- [x] **Task 3 — Server: `PLAYER_READY` pure reducer + handler (AC: 1)**
  - [x] Pure reducer `apps/server/src/session/setPlayerReady.ts` exporting `setPlayerReady(state: SessionState, playerId: string, isReady: boolean): SessionState`. Same purity discipline as `assignTeam.ts`/`removePlayerFromSession.ts` (copy the doc-comment voice): no I/O, no clock, no randomness, imports only `@bomb-squad/shared`, spread-never-mutate. Rules:
    - Unknown `playerId` → return `state` unchanged (same reference).
    - Already exactly `isReady` → return `state` unchanged (same reference — idempotent).
    - Otherwise `players[playerId] = { ...player, isReady }`; preserve every other field (`displayName`, `role`, `teamId`).
  - [x] Unit tests `apps/server/src/session/__tests__/setPlayerReady.test.ts` (mirror `setPlayerReady`'s siblings): toggles true/false and preserves name/role/team; unknown playerId → same reference; idempotent same-value → same reference; immutability (deep-frozen input must not throw, input unchanged, result is a new object); `config`/`status`/`teams`/`joinCode` untouched.
  - [x] Handler `socket.on('PLAYER_READY', …)` in `registerSessionHandlers` (`sessionHandlers.ts`), modelled on the `TEAM_ASSIGN`/`PLAYER_REMOVE` pipeline but **self-targeted** (no facilitator gate — any player sets their own ready):
    - `parsePlayerReadyPayload(payload)` (exported, `ParseResult`-style; `isReady` must be a strict `boolean`, rebuild a sanitized object, extra keys inert) → `INVALID_PAYLOAD` on failure.
    - `socket.data.sessionId` undefined → `NOT_IN_SESSION`. `socket.data.playerId` undefined → `NOT_IN_SESSION` (a resolved player always has both; defend the unresolved socket).
    - **Race-safe mutation via the Story 2.6 `updateJSON` primitive** (do **not** hand-roll load-modify-store — same posture 2.7 took for its removals): `updateJSON(sessionKey(sessionId), current => { if (!current || !current.players[playerId]) return { commit: false, result: 'noop' }; const next = setPlayerReady(current, playerId, parsed.isReady); return next === current ? { commit: false, result: 'noop' } : { commit: true, value: next, result: 'ready' }; })`. On `'ready'` → broadcast `SESSION_STATE` to the room. On `'noop'` → return silently (idempotent; the roster already shows the truth).
    - **Lobby-phase guard:** only meaningful in `lobby` (ready is a pre-round affordance; EXPERIENCE.md "Lobby chrome, role pickers, ready buttons — gone" once the round starts). Add the `state.status !== 'lobby'` short-circuit inside the `updateJSON` mutate (treat non-lobby as `'noop'`), so a stray `PLAYER_READY` after prep opens is inert rather than mutating a started session. (Between-round ready gating is Story 8.6 — out of scope.)
    - All awaits in try/catch → `log.error({ err, socketId: socket.id }, 'PLAYER_READY failed')` + `ERROR { code: 'PLAYER_READY_FAILED', message: 'Could not update ready state. Try again.', recoverable: true }`.
    - **Logging:** `log.info({ sessionId, playerId, isReady: parsed.isReady }, 'player ready set')`. Never the join code (AR15).
  - [x] **No new authority concept** — `PLAYER_READY` is the first *self-service* mutation (every prior mutation was facilitator-gated or join). The "caller resolves to `socket.data.playerId`, mutate only that player" pattern is the template for any future self-service action.

- [x] **Task 4 — Server tests: voice regression + lobby scope + `PLAYER_READY` (AC: 1, 2)**
  - [x] **Voice regression (`voiceHandlers.test.ts`):** migrate the existing suite off the `socket.id`-as-key assumption — seed `players` keyed by a durable id and stamp `socket.data.playerId` (the way the 2.7 migration did for the other handler suites), then assert `VOICE_TOKEN` mints with `identity === <durableId>` (not `socket.id`). **Add a regression test that would fail today:** a socket whose `socket.data.playerId` is a durable UUID present in `players` (but whose `socket.id` is *not* a key) gets a successful grant — this is exactly the production case the old test masked.
  - [x] **Lobby-room scope:** with `state.status === 'lobby'`, a defuser **with no team** mints a grant whose `room === lobby:{sessionId}` and `canPublish === true` (no `VoiceScopeError`); a spectator in lobby likewise gets `lobby:{sessionId}` with `canPublish === true`. With `state.status === 'active'`, the *same* spectator gets `spectator-lounge:{sessionId}` with `canPublish === false` (the non-lobby path is unchanged). Prefer unit-testing `resolveVoiceScope` directly (it's pure) for the matrix, plus one handler-level assertion that `state.status` is threaded through.
  - [x] **`PLAYER_READY` handler (`sessionHandlers.test.ts`, Jest, strict `afterEach`):** happy path — a joined player emits `PLAYER_READY { isReady: true }`; **all** sockets receive `SESSION_STATE` where that player's `isReady === true`; the fake store reflects it (persisted). Toggle back to `false`. Idempotent repeat → no second broadcast (count broadcasts on the *other* socket). `INVALID_PAYLOAD` for `isReady: 'yes'`/missing/non-object via `it.each`. Never-joined socket → `NOT_IN_SESSION`. Seeded `status: 'active'` → no mutation/broadcast (lobby-phase guard). Injected `updateJSON` throw → `PLAYER_READY_FAILED`, no broadcast. AR15: join code in no captured log line.
  - [x] **`setPlayerReady` reducer** unit tests (Task 3).

- [x] **Task 5 — Client: active-speaker tracking in `voiceStore` + `connectVoice` binding (AC: 2)**
  - [x] **This is the speaker-presence primitive Story 3.4 will reuse** — introduce it minimally here; do not build 3.4's in-round pill or mute control.
  - [x] Extend `apps/client/src/store/voiceStore.ts` with `activeSpeakers: string[]` (durable player ids currently transmitting; default `[]`) and a setter `setActiveSpeakers(ids: string[])`. Keep the store's invariant intact: it holds **only** voice presentation state, written **only** by `connectVoice`, read by UI; never anything game-authoritative. Clear `activeSpeakers` to `[]` on `setConnecting`/`setUnavailable`/`reset` (no stale dots after a drop).
  - [x] In `apps/client/src/voice/connectVoice.ts`, bind `RoomEvent.ActiveSpeakersChanged` (alongside the existing `TrackSubscribed`/`Disconnected` listeners; add it to `VoiceRoom`'s structural interface and remember the handle for teardown in `clearRoomBindings`). The event delivers the current `Participant[]`; map to `participant.identity` (which **is** the durable `playerId`, per Task 2) and call `setActiveSpeakers(ids)`.
  - [x] **150ms stop-grace (EXPERIENCE.md "speaker indicator … 150ms grace to suppress flicker on stop"):** when an identity drops out of the active set, don't clear its dot for 150ms — debounce removals in the controller (per-identity clear timer, or a "last-spoke timestamp + scheduled recompute"). Newly-speaking identities light **immediately**; only the *stop* is graced. Cancel/flush all such timers in teardown so nothing fires after disconnect (the controller already has strict teardown discipline — extend it).
  - [x] Unit-test the addition in `connectVoice.test.ts` (the fake `VoiceRoom` already drives `RoomEvent`s): emitting `ActiveSpeakersChanged` with two participants writes their ids to `voiceStore.activeSpeakers`; dropping one keeps it for the grace then clears it (drive timers with `vi.useFakeTimers()`); teardown clears `activeSpeakers` and cancels pending timers.

- [x] **Task 6 — Client: fix `VoiceController` self-resolution + a lobby mic-check affordance (AC: 2)**
  - [x] **🚨 Pre-existing regression to fix.** `apps/client/src/ui/VoiceController.tsx` resolves "am I a bomb-room participant?" via `const selfId = getSocket().id; session?.players[selfId]`. Post-2.7, `players` is keyed by the durable id, so `players[getSocket().id]` is `undefined` → the bomb-room voice CTA **never renders**. (2.7's completion notes swept `ActiveRound`/`Preparation`/`productionDispatch` to the durable id but missed `VoiceController`.) Fix: resolve self via the reactive store id — `const selfId = useGameStore((s) => s.myPlayerId)` — exactly as `Lobby.tsx:89` already does. Keep the rest of the component (bomb-room-participant gate, teardown-on-unmount, microcopy) intact.
  - [x] **Lobby mic-check connect affordance.** The lobby mic check needs each participant to actually join the `lobby:{sessionId}` voice room. `getUserMedia`/autoplay require a **user gesture**, so this is a **button**, not silent auto-connect — reuse the established gesture-driven `connectVoice()` pattern (`VoiceController` Task-2 autoplay note). Add a small lobby-scoped affordance (a new `LobbyMicCheck` presentation component, or a lobby branch — your call, keep it render-only) that:
    - When `voiceStore.status === 'idle'` shows a "Join mic check" button → `void connectVoice()`. `connectVoice` requests a fresh `VOICE_TOKEN`; the server now mints the `lobby:{sessionId}` room (Task 2) because the session is in `lobby` status. No client room knowledge — it trusts the token's room (the client is room-agnostic by design).
    - Mirrors `voiceStore.status` into the same EXPERIENCE microcopy `VoiceController` uses (`connecting` / `connected` / `unavailable` with the dismissible "Voice unavailable — game continues without it"). A voice failure must **never** block the lobby (AR12 / ADR-007 — voice never gates game state).
    - **Teardown on unmount** (`void disconnectVoice()` in a cleanup effect), so when the facilitator opens preparation and `App.tsx` swaps `Lobby` → `Preparation`, the lobby voice room is released before the bomb-room `VoiceController` connects fresh. This hand-off (lobby room → per-team bomb room) is automatic: different surface, different mount, fresh token.
  - [x] **Do not** auto-connect every player on mount, **do not** add push-to-talk, **do not** add a mute control (3.4), and **do not** render the in-round speaker *pill* (3.4) — the lobby's presence UI is the per-row dot (Task 7), not the bomb-view pill.

- [x] **Task 7 — Client: Lobby UI — Ready toggle + ready indicators + speaker dots + empty state (AC: 1, 2, 3)**
  - [x] You are extending the **post-2.7** `apps/client/src/ui/Lobby.tsx` (durable-id "You" tag, team badges, facilitator A/B chips + role select + Remove, error banner, Open Preparation). Keep all of it. Ready/dots/empty-state are the **only** additions; the scope fences in the file's doc comment ("Ready state, mic check, and the empty-state message are Story 2.5 — intentionally absent") are the work you now fill in (update that comment).
  - [x] **Ready self-toggle (AC 1).** On the viewer's **own** row, render a Ready toggle (a styled `<button type="button">` with `aria-pressed={self.isReady}`, the 2.4 chip grammar — **not** the `Button` primitive). Click emits `getSocket().emit('PLAYER_READY', { isReady: !self.isReady })`. Server-truth-driven — `aria-pressed`/label derive from the last `SESSION_STATE` snapshot; no optimistic flip, no `useState` mirror of `isReady` (render-only client rule). The facilitator may toggle their own ready too (harmless; it's informational). **No all-ready gate on Open Preparation** (decided: Ready is informational — the existing `canOpenPrep` rule stands; do not add a ready gate).
  - [x] **Ready indicator on every row (AC 1).** Next to each player's role/team, show a small ready indicator visible to all participants — `Ready` vs nothing (or a muted "Not ready"), driven by `player.isReady`. Use **neutral ink**, not LED green/red (those are reserved for solved/strike; the *speaker* dot is the only green here, and that's a deliberate, sanctioned use for "audible"). The facilitator reads these to see who's confirmed.
  - [x] **Speaker dot on every row (AC 2).** Render a dot per row: **green** when `voiceStore.activeSpeakers` includes `player.playerId`, **gray** otherwise. **Name always shown** beside it (the row already shows `displayName` — never icon-only, colorblind floor). Subscribe to `activeSpeakers` reactively (`useVoiceStore((s) => s.activeSpeakers)`). When the viewer hasn't joined the mic check (`status !== 'connected'`), all dots are gray/neutral — that's correct (you can't see speakers in a room you haven't joined). Respect `prefers-reduced-motion`: the green dot may pulse while speaking, but under reduced motion it's a solid green with no pulse (EXPERIENCE.md reduced-motion rule — instant state change, no pulse).
  - [x] **Empty state (AC 3).** When the sorted roster has exactly **one** entry (the viewer alone), render the empty-state message `"Waiting for your team."` (EXPERIENCE.md §Empty states) **in place of** the single-row list — the share panel stays (that's how they invite the team). Two-or-more players → the normal roster. (Count the roster, not "players minus me" — a solo facilitator and a solo joiner both see it.)
  - [x] New strings in `apps/client/src/ui/copy.ts` (one voice source, dry/deadpan): e.g. `READY = 'Ready'`, `MARK_READY = 'Mark ready'`, `READY_INDICATOR = 'Ready'`, `MIC_CHECK_CTA = 'Join mic check'`, `WAITING_FOR_TEAM = 'Waiting for your team.'`, plus an aria label for the speaker dot (e.g. `SPEAKING = 'speaking'` / `MIC_QUIET = 'quiet'`). Reuse the existing `VOICE_*` strings for the connect microcopy.
  - [x] **Error surface:** add `PLAYER_READY_FAILED` to the Lobby `ASSIGN_ERROR_CODES` set so a ready-toggle failure paints the existing inline banner (it's the same surface; the set already owns `TEAM_ASSIGN`/`PLAYER_REMOVE`/`PREP` codes).

- [x] **Task 8 — Client component tests via the TD-1 harness (AC: 1, 2, 3)**
  - [x] **TD-1 is done** — the client now has jsdom + React Testing Library + `user-event` + jest-dom wired into Vitest, with helpers in `apps/client/src/test/` (`mockSocket.ts`, `fixtures.ts` `makeSession`/`makePlayer`, `setup.ts`) and an existing `apps/client/src/ui/__tests__/Lobby.test.tsx` scaffold. **Unlike Story 2.7, this story SHIPS component tests** — the "no harness" excuse is gone. Follow the established convention: `vi.mock('../../net/socket.js', …)` + `createMockSocket()`; seed `useGameStore.setState({ session, myPlayerId })`; query by accessible role/label/text; assert the typed emit.
  - [x] **Lobby (`Lobby.test.tsx`, extend it):**
    - **Ready toggle (AC 1):** the viewer's own row shows a Ready control with correct `aria-pressed` from `isReady`; clicking emits `PLAYER_READY { isReady: <toggled> }`; a row that is `isReady: true` shows the ready indicator.
    - **Ready indicators reflect the snapshot (AC 1):** seed two players with different `isReady` → the right rows show ready.
    - **Speaker dots (AC 2):** seed `useVoiceStore.setState({ activeSpeakers: ['p1'], status: 'connected' })` → player `p1`'s row dot is in the active/green state, others gray (query by the dot's accessible label). Name is present beside the dot.
    - **Empty state (AC 3):** a single-player session renders "Waiting for your team." and no roster row; a two-player session renders the roster and not the empty-state message.
  - [x] **Mic-check affordance:** the "Join mic check" button renders when `voiceStore.status === 'idle'` and clicking it invokes `connectVoice` (mock `../../voice/connectVoice.js`); `connecting`/`connected`/`unavailable` render the right microcopy. (Connect *internals* are already covered by `connectVoice.test.ts` — here only assert the affordance drives it.)
  - [x] **voiceStore active-speaker unit test** if not already covered by Task 5's `connectVoice.test.ts` (the store setter + clear-on-reset behaviour).

- [x] **Task 9 — Gates: tests, typecheck, build, live smoke + Jay interactive (AC: 1, 2, 3)**
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore` (the new `PlayerReadyPayload` flows through client + server; the `phase` threading and identity change compile cleanly).
  - [x] `pnpm -r test` → all green: shared (new payload compiles), server (new `setPlayerReady` + `PLAYER_READY` + migrated/extended voice suites), client (new Lobby/mic-check/voiceStore component+unit tests). Confirm **no regression count drop** — and that the **migrated `voiceHandlers.test.ts`** is green on the durable-id model (the old socket.id-keyed seeding is gone).
  - [x] `pnpm --filter @bomb-squad/client build` → succeeds.
  - [x] **Live smoke against real Redis + LiveKit (document in Completion Notes; reuse the throwaway-container + headless `socket.io-client` pattern from 2.6/2.7, `tsx` no-watch).** Headlessly verifiable: (a) a joined player's `VOICE_TOKEN` now mints a grant with `room === lobby:{sessionId}` and `identity === <durableId>` (proves the regression fix + lobby scope); (b) `PLAYER_READY { isReady: true }` → the broadcast `SESSION_STATE` shows that player's `isReady` flipped, persisted in Redis; idempotent repeat → no second broadcast; (c) AR15: grep stdout for the join code → 0 hits. The **live speaker dots** (real mic → LiveKit ActiveSpeakers → green) are browser-only — state exactly what was and wasn't verified headlessly.
  - [x] **Jay verifies interactively (not done until his observed result is in Completion Notes)** — two browsers against the real Docker stack (`https://localhost`; voice needs the HTTPS origin — see the LiveKit-WSL2 verification memory): (a) two players **Join mic check**; when one talks, **their dot goes green** on the other's roster and **stays gray** when silent — the "Sam, check your mic" moment; (b) toggling **Ready** flips the indicator live on the other browser; (c) a **single-player** lobby shows "Waiting for your team."; (d) opening **Preparation** hands voice off from the lobby room to the bomb room with no error. Record Jay's observed outcome for each.

## Dev Notes

### What this story is — and is not

2.5 was **deliberately built last in Epic 2** (after 2.6/2.7 and the Epic-3 voice chain) — the Sprint-2 retro: *"2.5 last on master (its mic-check rides on 3.2's voice room, its UI rides on 2.7's rewritten Lobby)."* So you are **not** building the lobby from scratch — you're adding three things to a mature, durable-id Lobby that already has the roster, team assignment, Remove, and Open-Preparation:

1. **Ready state** — a new self-service `PLAYER_READY` toggle (the codebase's first non-facilitator, non-join mutation), flipping the already-existing `PlayerInfo.isReady`.
2. **Mic check** — a dedicated **`lobby:{sessionId}` LiveKit room** every participant joins (a gesture-driven connect), with per-row **speaker dots** driven by LiveKit `ActiveSpeakersChanged`.
3. **Empty state** — "Waiting for your team." when the viewer is alone.

…on top of **fixing two latent voice regressions** that 2.7 left behind (below), without which the mic check cannot work at all.

**Out of scope:** the in-round speaker **pill** + self-**mute** control (Story 3.4 — reuses the `voiceStore.activeSpeakers` primitive this story introduces); push-to-talk (EXPERIENCE.md: open-mic V1, PTT in settings — later); spectator-lounge listen-only enforcement (3.3 — the lobby room is a *deliberate* bidirectional exception); an all-ready **gate** on starting (decided informational); between-round ready gating (8.6); token re-mint on role change (3.5); mid-round disconnect/pause (8.7).

### Decisions locked at story creation (Jay, via create-story)

- **Mic check = a dedicated `lobby:{sessionId}` LiveKit room**, joined by every participant for the duration of the lobby; per-player green/gray dots come from LiveKit `ActiveSpeakersChanged` (local to each connected client — **no socket broadcast of speaking state**, no Redis writes at audio rate). Chosen over a local-only Web-Audio self-check and over reusing the per-team bomb rooms, because only one shared room delivers the EXPERIENCE.md journey ("each player shows a green dot when they say hello; one stays gray so the facilitator can prompt them") with the facilitator hearing *and seeing* everyone. The cost is a small server-side token-scope extension (Task 2) — the wire stays frozen.
- **Ready = informational, self-toggle.** Each player sets their own ready; the roster reflects it in real time; the facilitator can Open Preparation regardless (no all-ready gate). Matches AC 1 (which only requires the roster to *reflect* ready state) and keeps the facilitator in control.

### 🚨 Two latent voice regressions this story must fix (read before touching voice)

Both stem from Story 2.7 re-keying `players` from `socket.id` to a durable `playerId` and sweeping authority gates — but the **voice path was not in that sweep**, and tests masked it:

| File | Bug | Effect today | Fix |
|---|---|---|---|
| `apps/server/src/handlers/voiceHandlers.ts` | `state.players[socket.id]` + `identity: socket.id` | `VOICE_TOKEN` returns `NOT_IN_SESSION` for everyone (player key is a UUID, not `socket.id`) | resolve via `socket.data.playerId`; mint `identity: socket.data.playerId` |
| `apps/client/src/ui/VoiceController.tsx` | `session.players[getSocket().id]` to detect self | the bomb-room voice CTA never renders | resolve self via `useGameStore(s => s.myPlayerId)` (as `Lobby.tsx:89` does) |

The server-test mask: `voiceHandlers.test.ts` seeds `players` keyed by `socket.id` (line 72/172), so the gate "passes" in the test while failing in production. Task 4 migrates that suite to the durable-id model and adds the regression test. **The identity fix is not optional polish** — AC 2's roster dots require LiveKit participant identity to equal the roster `playerId`.

### The mic-check data flow (canonical — implement exactly this)

```
JOIN (each participant, gesture-driven, in the lobby):
  client: connectVoice()  ->  VOICE_TOKEN (empty payload)
  server: resolve player by socket.data.playerId; mint identity = playerId,
          room = lobby:{sessionId}  (because state.status === 'lobby'),
          canPublish + canSubscribe (mic check: everyone audible to everyone)
  client: Room.connect(url, token); setMicrophoneEnabled(true)

SPEAKING (no socket, no Redis — pure LiveKit presence):
  LiveKit RoomEvent.ActiveSpeakersChanged -> participants[]
  connectVoice maps participant.identity (== playerId) -> voiceStore.activeSpeakers
  150ms stop-grace on clearing (suppress flicker); newly-speaking lights immediately
  Lobby row dot: green iff player.playerId ∈ activeSpeakers, else gray (name always shown)

READY (game state — the socket/Redis path):
  client: PLAYER_READY { isReady } (self; no playerId on the wire)
  server: resolve caller by socket.data.playerId; setPlayerReady reducer via updateJSON; broadcast SESSION_STATE
  Lobby row: ready indicator from player.isReady (server-truth, no optimistic flip)

HAND-OFF (facilitator opens preparation):
  status -> 'preparation'; App swaps Lobby -> Preparation; Lobby unmount -> disconnectVoice()
  bomb-view VoiceController later connects fresh -> bomb-room:{sessionId}:{teamId}
```

Two channels, two stores: **speaking presence is voice (`voiceStore`, never game-authoritative, AR12); ready is game state (`gameStore`/Redis).** Do not cross them — never put `isReady` in `voiceStore`, never broadcast speaking state over the game socket.

### Reuse, don't reinvent

- **`updateJSON` (Story 2.6)** for the `PLAYER_READY` mutation — the same race-safe load-modify-store primitive 2.7 used for its removals. Do **not** hand-roll a `getJSON`+`setJSON`.
- **`setPlayerReady` mirrors `assignTeam.ts`/`removePlayerFromSession.ts`** — pure, same-reference idempotency, spread-only. The handler mirrors `TEAM_ASSIGN`/`PLAYER_REMOVE` minus the facilitator gate.
- **`connectVoice` / `voiceStore` / `requestVoiceToken` (Story 3.2)** for the connection — the controller already handles fresh-token, mic publish, teardown, epoch-guarded re-entrancy, and the "unavailable → game continues" posture. You add **one** listener (`ActiveSpeakersChanged`) and **one** store field (`activeSpeakers`); don't fork the controller.
- **`VoiceController`'s gesture + microcopy pattern** for the lobby connect affordance — same `connectVoice()` from a click, same `VOICE_*` copy, same dismissible-failure shape.
- **TD-1's `src/test/` harness** (mockSocket, fixtures, jsdom) for the component tests — the convention is written down in `src/test/README.md`; follow it.

### Architecture compliance checklist (what this story is judged against)

- **Handler = I/O; logic = pure.** `setPlayerReady` imports only shared types; the handler adds pipeline + guards only. No `Math.random()` anywhere.
- **State residence / O(1):** ready is one `updateJSON` on the session key; voice token resolve is one `getJSON`. No scans, no Postgres, no tick-rate writes. **Speaking presence touches neither Redis nor the game socket** — it lives entirely in LiveKit + `voiceStore`.
- **Voice never gates game state (AR12 / ADR-007 / Pattern 7):** the lobby works fully with voice `unavailable`; a mic-check failure is dismissible microcopy. `connectVoice` writes only `voiceStore`.
- **Server-authoritative / typed:** `PLAYER_READY` resolves the caller server-side (never a client-supplied id); the new event is typed in `packages/shared`; no stringly-typed emits, no `any`/`@ts-ignore`.
- **Client render-only:** Ready toggle, dots, and empty-state derive from snapshots (`gameStore.session`, `voiceStore.activeSpeakers`); no optimistic flips, no `useState` mirror of server fields.
- **Secrets/AR15:** the join code and the voice token never logged; the token is never in any broadcast.
- **Color reservations (DESIGN.md):** green is **only** the speaker dot ("audible") and only as its sanctioned semantic — ready indicators use neutral ink, not LED green/red. `speaker-self` blue stays identity-only (the "You" tag). Respect `prefers-reduced-motion` (no dot pulse).

### UX compliance (EXPERIENCE.md / DESIGN.md / mockup 2)

- IA §2: "Lobby — show team roster, role pickers, join-code share, **Ready state, voice mic-check**." 2.4 delivered roster + role pickers + share; 2.7 added Remove; **2.5 delivers Ready + mic-check + empty-state** — the last lobby pieces.
- Mic-check journey (EXPERIENCE.md §narrative): *"Each player shows a green speaker dot when they say hello. One player's dot stays gray. Priya pings: 'Sam, can you check your mic?'"* — per-row dot, name always shown, gray = silent/absent.
- Speaker indicator spec: *"pulses while the participant transmits, with a 150ms grace to suppress flicker on stop. Names always shown; never icon-only."* Honor the grace (Task 5) and the colorblind floor (name beside dot).
- Empty states: *"lobby with 1 player: 'Waiting for your team.'"* — verbatim string.
- Reduced motion: disable the speaker-indicator pulse under `prefers-reduced-motion` → solid state, instant change.
- Voice microcopy is **separate** from socket-connecting copy; failure copy: *"Voice unavailable — game continues without it"* (already in `copy.ts` as `VOICE_UNAVAILABLE`).
- Microcopy dry/deadpan; all new strings in `copy.ts`; server error messages render verbatim (already human-readable).

### Baseline — TD-1 harness is uncommitted in the working tree

`master` is at `e9de0d6`. **TD-1 (client component-test framework) is `done` but lives as uncommitted working-tree changes** at story-creation time (`git status`: modified `apps/client/vite.config.ts`, `apps/client/package.json`, `pnpm-lock.yaml`, new `apps/client/src/test/`, new `Landing.test.tsx`/`Lobby.test.tsx`/`Preparation.test.tsx`). Build on the working tree as it stands — the jsdom env, the `src/test/` helpers, and the `Lobby.test.tsx` scaffold are available; do not "restore" them. If a `pnpm install` is needed for the new devDeps, run it (TD-1 added `@testing-library/*` + `jsdom` to `apps/client`).

### Existing code you build on (read before editing)

- `packages/shared/src/events/payloads.ts` (add `PlayerReadyPayload`), `client-to-server.ts` (add `PLAYER_READY`), `index.ts` (export). `types/session.ts` — `PlayerInfo.isReady` already present; **do not change the shape**.
- `apps/server/src/voice/mintToken.ts` — `resolveVoiceScope` (add the lobby branch + `lobbyRoomName`; thread `phase`), `bombRoomName`/`spectatorLoungeName` (the naming pattern to mirror), `VoiceScopeError` (the lobby branch sidesteps it for un-teamed players).
- `apps/server/src/handlers/voiceHandlers.ts` — the `VOICE_TOKEN` handler (fix the `socket.id` resolve + identity; thread `state.status` as `phase`).
- `apps/server/src/handlers/sessionHandlers.ts` — `registerSessionHandlers` (`PLAYER_READY` handler lands beside `TEAM_ASSIGN`/`PLAYER_REMOVE`), the `parse*` validator idiom, `SessionSocketData` (`sessionId`/`playerId` already present), `updateJSON` usage from the 2.6/2.7 removals.
- `apps/server/src/session/assignTeam.ts` + `removePlayerFromSession.ts` — pure-reducer template for `setPlayerReady`. `apps/server/src/state/redis.ts` `updateJSON`.
- `apps/client/src/voice/connectVoice.ts` — `createVoiceController` (add the `ActiveSpeakersChanged` listener + teardown), `VoiceRoom` structural interface (add `ActiveSpeakersChanged` to the `on`/`off` surface). `apps/client/src/store/voiceStore.ts` (add `activeSpeakers`). `apps/client/src/ui/VoiceController.tsx` (self-resolution fix; gesture pattern to mirror for the lobby affordance).
- `apps/client/src/ui/Lobby.tsx` — the post-2.7 roster (rows, "You" tag via `myPlayerId`, facilitator controls, error banner, `ASSIGN_ERROR_CODES`); add Ready toggle + indicators + dots + empty-state. `apps/client/src/ui/copy.ts` — voice strings exist; add the lobby strings. `apps/client/src/store/gameStore.ts` — `session`, `myPlayerId` (reactive self id).
- `apps/client/src/test/` (TD-1) — `mockSocket.ts`, `fixtures.ts` (`makeSession`/`makePlayer`), `setup.ts`, `README.md`; `apps/client/src/ui/__tests__/Lobby.test.tsx` (scaffold to extend).
- `livekit-client` `RoomEvent.ActiveSpeakersChanged` — the SDK event; the active set is delivered as `Participant[]`; read `.identity` (now the durable `playerId`).

### Previous-story intelligence

- **2.7 (durable identity)** is the reason the voice regressions exist — and the reason the fix is mechanical (`socket.id` → `socket.data.playerId` server, `getSocket().id` → `myPlayerId` client). 2.7's own notes show the *client* self-resolution sweep (it fixed `ActiveRound`/`Preparation`/`productionDispatch` but missed `VoiceController`); finish that sweep here.
- **2.6 (`updateJSON`)** — the race-safe primitive + the fake store's `updateJSON`/`overrides` seams for the `PLAYER_READY_FAILED` test.
- **3.2 (voice)** — `connectVoice`'s epoch-guarded teardown discipline is non-negotiable: every listener you add must be removed in `clearRoomBindings`, every timer cancelled in teardown (the controller exists precisely because the browser doesn't GC LiveKit rooms/audio).
- **TD-1** — the component-test convention (mock `getSocket`, fixtures, accessible queries, assert emits). Jest on server, **Vitest on client**; strict teardown both sides.
- **LiveKit on WSL2** (memory): a two-browser voice verification needs the HTTPS origin and a browser-reachable `LIVEKIT_URL` (+ the other infra fixes) — the voice client code is not the bug. Jay's interactive pass must run against `https://localhost` via the Docker stack, not the host dev server.

### Project Context Rules (from `_agent_docs/project-context.md`)

- TypeScript throughout; `tsc --noEmit` zero errors; no `@ts-ignore`.
- Pure reducers `(state, event) => newState`, zero infra imports; handlers own all I/O (parse → load → reduce → persist → emit). State never mutated in place — spread/map; unknown/invalid input falls through returning state unchanged.
- Redis = all in-flight session state, O(1) per action; Postgres untouched. Socket event types live in `packages/shared/src/events/` only; no untyped `emit(string, any)`.
- Voice is an isolated subsystem — its state lives in `voiceStore`, never gates a game transition; LiveKit's Redis is not application state.
- React render-only; presentation state in `useState`, server snapshots in Zustand (`useStore(selector)` for reactive reads). No `Math.random()` — ids via `randomUUID()` (none minted here; the durable id already exists).
- Server-authoritative validation; never trust client-supplied identity — `PLAYER_READY` resolves the caller server-side. Secrets (join code, voice token) never logged, never broadcast (AR15).

### Project Structure Notes

- **New — server:** `session/setPlayerReady.ts`, `session/__tests__/setPlayerReady.test.ts`. **Modified — server:** `handlers/sessionHandlers.ts` (+`parsePlayerReadyPayload`, `PLAYER_READY` handler), `handlers/__tests__/sessionHandlers.test.ts` (+ suite), `voice/mintToken.ts` (+`lobbyRoomName`, lobby scope, `phase`), `voice/__tests__/mintToken.test.ts` (+ lobby matrix), `handlers/voiceHandlers.ts` (regression fix + `phase`), `handlers/__tests__/voiceHandlers.test.ts` (durable-id migration + regression test).
- **Modified — shared:** `events/payloads.ts`, `events/client-to-server.ts`, `events/index.ts` (one new event + payload). `PlayerInfo`/`SessionState` shapes **unchanged**.
- **Modified — client:** `store/voiceStore.ts` (+`activeSpeakers`), `voice/connectVoice.ts` (+`ActiveSpeakersChanged` + 150ms grace), `voice/__tests__/connectVoice.test.ts` (+ tests), `ui/VoiceController.tsx` (self-resolution fix), `ui/Lobby.tsx` (Ready + dots + empty-state + mic-check affordance — or a small `LobbyMicCheck` component), `ui/copy.ts` (+ strings), `ui/__tests__/Lobby.test.tsx` (extend). Possibly `ui/index.ts` if a new component is added.
- **No changes:** `gameStore` shape (reads only), `App.tsx` routing (the lobby/prep swap already exists), `packages/shared` types beyond the one event, configs (TD-1 already wired the test env).
- Naming: `PLAYER_READY` SCREAMING_SNAKE; `setPlayerReady`/`parsePlayerReadyPayload`/`lobbyRoomName`/`setActiveSpeakers` camelCase; `LobbyMicCheck` PascalCase (if added).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.5: Lobby Roster, Ready State & Mic Check] (the three ACs verbatim; 2.4/2.6/2.7 fences)
- [Source: _agent_docs/implementation-artifacts/sprint-2-retro-2026-06-13.md:77-79] (2.5 built last; "its mic-check rides on 3.2's voice room, its UI rides on 2.7's rewritten Lobby")
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md:29,75,89,108,226] (lobby = roster + ready + mic-check; speaker-indicator 150ms grace + names-always-shown; "Waiting for your team."; reduced-motion; the mic-check journey)
- [Source: packages/shared/src/types/session.ts:24-32] (`PlayerInfo.isReady` already present — provenance change only, no shape change)
- [Source: packages/shared/src/events/payloads.ts:169-201; client-to-server.ts] (where `PlayerReadyPayload`/`PLAYER_READY` go; `VOICE_TOKEN` empty-payload contract stays frozen)
- [Source: apps/server/src/voice/mintToken.ts] (`resolveVoiceScope` role→room→grant; `bombRoomName`/`spectatorLoungeName`/`VoiceScopeError`; add the lobby branch + `phase`)
- [Source: apps/server/src/handlers/voiceHandlers.ts] (the `state.players[socket.id]` + `identity: socket.id` regression to fix; thread `state.status` as phase)
- [Source: apps/server/src/handlers/__tests__/voiceHandlers.test.ts:62-72,172] (the socket.id-keyed seeding that masks the regression — migrate to durable id)
- [Source: apps/server/src/handlers/sessionHandlers.ts] (`registerSessionHandlers`; `TEAM_ASSIGN`/`PLAYER_REMOVE` pipeline to mirror; `SessionSocketData`; `updateJSON` reuse)
- [Source: apps/server/src/session/assignTeam.ts; removePlayerFromSession.ts; state/redis.ts updateJSON] (pure-reducer template; race-safe primitive)
- [Source: apps/client/src/voice/connectVoice.ts; store/voiceStore.ts] (the controller to extend with `ActiveSpeakersChanged`; the store's voice-only invariant; `room`/`identity` comment already anticipating "3.4's speaker pill")
- [Source: apps/client/src/ui/VoiceController.tsx:~/* selfId */] (the `getSocket().id` self-resolution regression to fix; the gesture-driven `connectVoice()` + microcopy pattern to mirror for the lobby)
- [Source: apps/client/src/ui/Lobby.tsx:83-89,107-122,178-263] (post-2.7 roster + "You" tag via `myPlayerId` + `ASSIGN_ERROR_CODES` + scope-fence comment to fill in)
- [Source: apps/client/src/App.tsx] (surface routing: `session.status === 'lobby' → Lobby`, `'preparation' → Preparation` — the voice hand-off boundary)
- [Source: _agent_docs/implementation-artifacts/td-1-client-component-test-framework.md] (the jsdom + RTL harness + `src/test/` convention this story's component tests use)
- [Source: _agent_docs/implementation-artifacts/2-7-lobby-resilience-and-facilitator-player-controls.md] (durable-id model; the client self-resolution sweep that missed VoiceController; reattach/identity context)
- [Source: _agent_docs/implementation-artifacts/2-6-capacity-and-join-window-guards.md] (`updateJSON` primitive + fake-store seams for the `*_FAILED` test)
- [Source: _agent_docs/project-context.md] (pure-reducer/handler-I/O split; voice-never-gates-game; O(1) Redis; server-authoritative; TS-throughout; AR15; color reservations)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, gds-dev-story workflow)

### Debug Log References

- `pnpm --filter @bomb-squad/shared build` — green (new `PlayerReadyPayload` resolves for client + server).
- `pnpm -r exec tsc --noEmit` — 0 errors, no `@ts-ignore` anywhere in `src/`.
- `pnpm -r test` — shared 136/136, server 375/375, client 269/269 (all green, no regression-count drop).
- `pnpm --filter @bomb-squad/client build` — succeeds.
- `scripts/smoke-2-5.ts` — **PASSED** (2026-06-15) against a throwaway plain Redis (the published host `6379` was another stack's passworded Redis — the worktree port-collision trap; spun a clean `redis:7-alpine` on `6399` and pointed the smoke at it via `SMOKE_REDIS_URL`). Token minting is pure local JWT signing, so a valid-length dummy LiveKit secret (`SMOKE_LIVEKIT_API_*`) was injected — `.env` ships a 9-char placeholder the SDK signer rejects; the real creds drive the running stack for Jay's interactive voice pass. Output: all of (a) VOICE_TOKEN `room === lobby:{sessionId}` + `identity === durable joinerId` + JWT `video.room` === lobby room; (b) PLAYER_READY broadcast `isReady === true` + Redis-persisted + idempotent-repeat-no-rebroadcast; (c) AR15 join code in 0 log lines.

### Completion Notes List

**Implemented (Tasks 1–8, all automated gates in Task 9):**

- **Task 1 — shared contract.** Added `PlayerReadyPayload { isReady: boolean }` (no `playerId` on the wire — self-only), the `PLAYER_READY` client→server event (no ack), and the barrel export. No `SessionState`/`PlayerInfo` shape change. Rebuilt `@bomb-squad/shared`.
- **Task 2 — voice regression fix + lobby scope.** `voiceHandlers.ts` now resolves the requester by `socket.data.playerId` (durable id) and mints `identity` = durable id (was `socket.id`, always-undefined post-2.7 → `NOT_IN_SESSION` for everyone). `mintToken.ts` gained `lobbyRoomName`, an optional `phase` on `VoiceParticipant`, and a `phase === 'lobby'` branch at the top of `resolveVoiceScope` that scopes EVERY participant to `lobby:{sessionId}` bidirectional (un-teamed Bomb-Room roles no longer throw). Documented the deliberate lobby-only FR39 spectator-publish exception in code. The handler threads `phase: state.status`.
- **Task 3 — reducer + handler.** New pure `setPlayerReady` (same-reference idempotency, spread-only). New `PLAYER_READY` handler — the codebase's first *self-service* mutation (no facilitator gate; caller resolved from `socket.data.playerId`), race-safe via the 2.6 `updateJSON` primitive, with a lobby-phase guard inside the mutate and the standard try/catch → `PLAYER_READY_FAILED`. Added `parsePlayerReadyPayload` (strict-boolean).
- **Task 4 — server tests.** Migrated `voiceHandlers.test.ts` off the `socket.id`-keyed seeding to the durable-id model + added the regression test (durable id is a roster key, socket.id is not → grant succeeds) and the lobby-scope cases. Added the lobby matrix to `mintToken.test.ts`. Added a full `PLAYER_READY` handler suite (happy/toggle/idempotent/invalid-payload/`NOT_IN_SESSION`/non-lobby-guard/`updateJSON`-throw/AR15) + the `setPlayerReady` reducer unit suite.
- **Task 5 — client voice presence.** `voiceStore` gained `activeSpeakers: string[]` + `setActiveSpeakers`, cleared on every non-connected transition. `connectVoice` binds `RoomEvent.ActiveSpeakersChanged`, maps `participant.identity` (== durable playerId) → store, lights new speakers immediately, and graces *stops* by 150ms (per-identity clear timers, all cancelled in teardown). Tests added (immediate light, grace clear, resume-cancels-timer, teardown).
- **Task 6 — VoiceController fix + lobby affordance.** `VoiceController` now resolves self via `useGameStore(s => s.myPlayerId)` (was `getSocket().id` — undefined post-2.7, CTA never rendered). New render-only `LobbyMicCheck` (gesture-driven `connectVoice`, `VOICE_*` microcopy mirror, dismissible failure, teardown-on-unmount for the lobby→bomb-room hand-off).
- **Task 7 — Lobby UI.** Per-row speaker dot (green `bg-speaker-active` + `motion-safe:animate-pulse`, gray otherwise; accessible label `"<name> speaking|quiet"`, name always shown), per-row ready indicator (neutral ink), a self-row Ready self-toggle (`aria-pressed`, emits `PLAYER_READY`, server-truth — no optimistic flip), the single-player empty state ("Waiting for your team." replaces the lone row; share panel stays), `LobbyMicCheck` mounted in the share panel, and `PLAYER_READY_FAILED` added to `ASSIGN_ERROR_CODES`. New copy strings.
- **Task 8 — component tests.** Extended `Lobby.test.tsx` (ready toggle aria-pressed + emit, ready indicators from snapshot, speaker dots by accessible label, empty state, mic-check affordance drives `connectVoice`, status microcopy) + new `voiceStore.test.ts`.

**Live smoke (Task 9) — PASSED** (2026-06-15, headless, real Redis). `scripts/smoke-2-5.ts` boots the real session + voice handlers in-process against a throwaway `redis:7-alpine` and asserted: (a) a joined player's `VOICE_TOKEN` mints `room === lobby:{sessionId}` with `identity ===` the durable playerId (regression fix + lobby scope, JWT decoded); (b) `PLAYER_READY{isReady:true}` flips that player's `isReady` in the broadcast AND in Redis, and an idempotent repeat produced no second broadcast; (c) AR15 — the join code appeared in 0 log lines. Run it with `SMOKE_REDIS_URL=… SMOKE_LIVEKIT_API_KEY=… SMOKE_LIVEKIT_API_SECRET=<32+ chars> pnpm --filter @bomb-squad/server exec tsx ../../scripts/smoke-2-5.ts`. The live speaker dots (real mic → LiveKit ActiveSpeakers → green) are browser-only and were NOT exercised headlessly — they are part of Jay's interactive pass.

**Jay interactive (Task 9, last subtask) — PASSED** (2026-06-15, master stack rebuilt with `docker compose up -d --build`; app served over `http://localhost` because the dev override `Caddyfile.dev` serves plain HTTP so the page can open `ws://` LiveKit without a mixed-content block). Jay's observed results:
- (a) Mic check — two players Join mic check; talking lights the green dot / silence stays gray on the other roster: **works.**
- (b) Ready — toggling Ready flips the indicator live on the other browser: **works.**
- (c) Empty state — a single-player lobby shows "Waiting for your team.": **works.**
- (d) Hand-off — opening Preparation hands voice off lobby-room → bomb-room with no error: **works.**

**Investigated + resolved (not a 2.5 defect):** Jay first saw the *facilitator* fail to connect to the mic-check room. Server + LiveKit logs proved 2.5 was correct — the facilitator got a valid `lobby:{sessionId}` token (`canPublish/canSubscribe: true`) and reached LiveKit signaling (`starting RTC session`), but LiveKit logged `removing participant without connection` exactly 15s later (server-side ICE timeout: the media PeerConnection never formed). The failing window was **Firefox**; the two **Chrome** windows connected fine. Root cause = the **localhost-dev LiveKit override** (`livekit.dev.yaml`) forces ICE over **TCP only** (`udp_port: 0`, because WSL2 drops the UDP-mux NAT mapping), and Firefox's ICE-TCP support is weaker than Chrome's → it times out. Retried the facilitator in **Chrome → connected** (confirmed role-agnostic). This is a WebRTC-transport limitation of the dev environment (Firefox + TCP-forced ICE), tracked under Story 3.2 / 10-3 (NAT/TURN robustness) — out of scope for 2.5, which doesn't touch transport. A separate config smell surfaced in the LiveKit logs (`secret is too short, should be at least 32 characters` — `.env` ships a 9-char placeholder `LIVEKIT_API_SECRET`); harmless for the dev check (tokens still validate) but worth tightening per the LiveKit-WSL2 memory.

### File List

**Shared (modified):**
- `packages/shared/src/events/payloads.ts` — `PlayerReadyPayload`
- `packages/shared/src/events/client-to-server.ts` — `PLAYER_READY` event
- `packages/shared/src/events/index.ts` — export `PlayerReadyPayload`

**Server (new):**
- `apps/server/src/session/setPlayerReady.ts`
- `apps/server/src/session/__tests__/setPlayerReady.test.ts`

**Server (modified):**
- `apps/server/src/voice/mintToken.ts` — `lobbyRoomName`, `phase`, lobby scope branch
- `apps/server/src/voice/__tests__/mintToken.test.ts` — lobby matrix
- `apps/server/src/handlers/voiceHandlers.ts` — durable-id resolve + identity + `phase`
- `apps/server/src/handlers/__tests__/voiceHandlers.test.ts` — durable-id migration + regression + lobby cases
- `apps/server/src/handlers/sessionHandlers.ts` — `parsePlayerReadyPayload`, `ReadyOutcome`, `PLAYER_READY` handler
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` — `PLAYER_READY` handler suite

**Client (new):**
- `apps/client/src/ui/LobbyMicCheck.tsx`
- `apps/client/src/store/__tests__/voiceStore.test.ts`

**Client (modified):**
- `apps/client/src/store/voiceStore.ts` — `activeSpeakers` + setter + clear-on-transition
- `apps/client/src/voice/connectVoice.ts` — `ActiveSpeakersChanged` binding + 150ms stop-grace
- `apps/client/src/voice/__tests__/connectVoice.test.ts` — active-speaker tests
- `apps/client/src/ui/VoiceController.tsx` — self-resolution via `myPlayerId`
- `apps/client/src/ui/Lobby.tsx` — ready toggle/indicators, speaker dots, empty state, mic-check mount, error code
- `apps/client/src/ui/copy.ts` — lobby ready/mic-check strings
- `apps/client/src/ui/index.ts` — export `LobbyMicCheck`
- `apps/client/src/ui/__tests__/Lobby.test.tsx` — 2.5 component tests

**Tooling (new):**
- `scripts/smoke-2-5.ts` — headless live smoke (ready to run against the Docker stack)

### Change Log

- 2026-06-15 — Story 2.5 implemented (Tasks 1–8 + automated gates): `PLAYER_READY` self-toggle (shared event + pure reducer + race-safe handler), the two latent 2.7 voice regressions fixed (server durable-id resolve/identity; client `VoiceController` self-resolution), lobby `lobby:{sessionId}` mic-check room scope, client active-speaker presence with 150ms stop-grace, and the Lobby ready/dots/empty-state UI. Live smoke + Jay's interactive verification pending the Docker stack.

## Review Findings

_Code review 2026-06-15 (gds-code-review, 3 layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). All 3 ACs verified satisfied; the items below are refinements, not AC blockers. All 4 patches applied + 1 deferred — `tsc --noEmit` 0 errors, client 271/271 (+2 new), `pnpm --filter @bomb-squad/client build` green._

_⚠️ Two patches are user-visible (mic-check microcopy text; mic-check button hidden while solo). Jay's prior interactive PASS predates them — recommend a 30-second re-confirm of the lobby mic-check surface before final sign-off._

_**Jay re-confirmed interactively (2026-06-16):** the two user-visible patches (lobby-neutral mic-check microcopy; mic-check button hidden while solo) observed working as intended. Story flipped to `done`._

- [x] [Review][Patch] Hide the mic-check affordance when solo (resolves the solo-no-dot tension) — `Lobby.tsx` now renders `LobbyMicCheck` only when `roster.length > 1` (decided 2026-06-15, Jay). Keeps AC 3's empty state and avoids the dead-end "Join mic check → no dot" path. [apps/client/src/ui/Lobby.tsx]
- [x] [Review][Patch] Lobby mic-check shows Bomb-Room connect microcopy — added lobby-neutral `MIC_CHECK_CONNECTING` ('Joining mic check…') / `MIC_CHECK_CONNECTED` ('Mic check connected.'); `LobbyMicCheck` now uses them instead of the Bomb-Room `VOICE_*` strings; Lobby test updated. [apps/client/src/ui/LobbyMicCheck.tsx, apps/client/src/ui/copy.ts]
- [x] [Review][Patch] Stale green speaker dot on ungraceful voice drop — `connectVoice` now binds `RoomEvent.ParticipantDisconnected` to evict the id from `displayedSpeakers` (and cancel its pending stop-grace timer) + republish; unbound in `clearRoomBindings`. Two tests added. [apps/client/src/voice/connectVoice.ts]
- [x] [Review][Patch] Empty-roster boundary renders a blank panel — empty-state guard changed from strict `=== 1` to `<= 1`. [apps/client/src/ui/Lobby.tsx]
- [x] [Review][Defer] Duplicate display names collide in speaker-dot aria-labels [apps/client/src/ui/Lobby.tsx:230] — deferred, pre-existing (name uniqueness is a join-validation concern, not introduced by 2.5)
