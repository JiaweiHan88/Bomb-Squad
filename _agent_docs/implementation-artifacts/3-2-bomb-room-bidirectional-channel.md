---
baseline_commit: 0b4bc80
context:
  - _agent_docs/implementation-artifacts/3-1-role-scoped-livekit-token-minting.md
  - _agent_docs/project-context.md
---

# Story 3.2: Bomb Room Bidirectional Channel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser or Expert (a Bomb Room participant),
I want to join the Bomb Room voice channel and talk bidirectionally,
so that my team can communicate to defuse the bomb.

## Acceptance Criteria

1. **Given** the client workspace, **When** `livekit-client` is added, **Then** it is a dependency of `apps/client` **only** (never `apps/server`, never `packages/shared`), pinned to the 2.x line that pairs with the server's `livekit-server-sdk@^2.15.x`, and `tsc --noEmit` is clean across all workspaces with no `@ts-ignore`. _(AR12; project-context Build)_
2. **Given** a Bomb Room participant (a `defuser`/`expert` resolved to a team), **When** they connect to voice, **Then** the client requests a token via the existing `VOICE_TOKEN` socket event with an **empty** payload, receives `{ url, token, room, identity }`, connects a LiveKit `Room` to `url` with `token`, **publishes** its microphone track, and **subscribes to and plays** every remote participant's audio track — i.e. audio is bidirectional in `bomb-room:{sessionId}:{teamId}`. _(FR38; AR12; epic AC1)_
3. **Given** voice connects or fails, **When** the connection state changes, **Then** it is tracked **only** in the separate `voiceStore` (Zustand) as `idle → connecting → connected`, and any failure (token error, connect rejection, timeout, transport drop) resolves to `unavailable`; **no** voice code writes `gameStore` or gates/advances any game-state transition. _(epic AC2; AR12 / ADR-007 / Architecture Pattern 7 — voice never blocks game state; project-context)_
4. **Given** the game continues, **When** voice is `unavailable` (never connected, or dropped mid-session), **Then** the bomb, timer, modules, and all socket-driven game flow remain fully interactive — voice failure surfaces as non-blocking microcopy only ("Voice unavailable — game continues without it"), never a blocking modal. _(NFR3 accessibility floor; EXPERIENCE.md "Voice failure path")_
5. **Given** the participant leaves voice (component unmount, navigates away, or explicit disconnect), **When** teardown runs, **Then** the LiveKit `Room` is `disconnect()`-ed, the microphone capture is released, and every attached `<audio>` element is detached/removed — no leaked media tracks, audio elements, or event listeners across a connect→disconnect→reconnect cycle. _(project-context R3F/dispose discipline applied to media; resource hygiene)_
6. **Given** any voice token request or connection, **When** it is logged or surfaced, **Then** the JWT token value is **never** written to the browser console or any log, and a fresh token is requested per connect attempt (no caching/reuse of a prior token — keeps Story 3.5 re-mint-on-role-change correct). _(project-context Security; 3.1 AC#2 parity on the client; FR41 forward-compat)_
7. **Given** the real LiveKit container, **When** Jay runs the interactive two-participant check, **Then** two Bomb Room participants on the **same team** (one Defuser, one Expert) hear each other bidirectionally, and killing/blocking voice leaves both clients fully able to keep playing. Result recorded in Completion Notes. _(human-verification rule — 3.2 is the canonical "two people talk" check; NFR3)_

## Tasks / Subtasks

- [x] **Task 1 — Add the `livekit-client` dependency to the client workspace (AC: #1)**
  - [x] Add `livekit-client` (latest 2.x — pairs with `livekit-server-sdk@2.15.x` already on the server) to `apps/client/package.json` dependencies, then `pnpm install` from the repo root (pnpm workspaces — never install into a sub-package cwd; a fresh worktree needs a full root install to hydrate all four projects — see 3.1 Debug Log). → pinned `^2.19.2` (latest 2.x), installed `2.19.2`.
  - [x] Do **not** add `livekit-server-sdk` to the client and do **not** add `livekit-client` to `packages/shared` (shared stays pure TS, zero runtime framework deps — project rule). No server change in this story. → verified absent from server/shared package.json; zero server files touched.
  - [x] Verify `tsc --noEmit` is clean for client, shared, and server after install (no `@ts-ignore`). → `pnpm -r typecheck` clean; no `@ts-ignore` introduced.

- [x] **Task 2 — Voice connection module `apps/client/src/voice/` (AC: #2, #5, #6)**
  - [x] Create `apps/client/src/voice/connectVoice.ts` exporting an imperative connection controller — `connectVoice()` / `disconnectVoice()` — that owns the LiveKit `Room` lifecycle and is the ONLY place `livekit-client` is imported. Keep it framework-agnostic (no React, no JSX) so it can be unit/integration-exercised and so the R3F/UI layers stay dumb. → `createVoiceController(deps)` factory (DI for tests) + a default singleton bound to `connectVoice`/`disconnectVoice`. No React import.
  - [x] **Token request:** call the existing typed event — `getSocket().timeout(10000).emit('VOICE_TOKEN', {}, ack)` (empty payload by contract — the server derives room+grants from session state; see 3.1). The ack is `VoiceTokenGrantPayload | VoiceTokenErrorPayload`. Mirror the `.timeout()` error-first pattern from `Landing.tsx:150` (`SESSION_CREATE`). On `{ error }` or timeout → set `voiceStore` `unavailable` and return (no throw to the UI). → `requestVoiceToken()` does exactly this; error/timeout/missing-ack → `{ ok: false }` → `unavailable`.
  - [x] **Connect:** `const room = new Room(roomOptions); await room.connect(url, token); await room.localParticipant.setMicrophoneEnabled(true);`. Use `RoomEvent.TrackSubscribed` to attach each remote audio track to a freshly created `HTMLAudioElement` (`track.attach()`), append it to the DOM (or a hidden container) so it actually plays, and `RoomEvent.TrackUnsubscribed` / participant-disconnect to `track.detach()` and remove the element. Set `voiceStore` `connected` once the room connects. → done; hidden `<audio>` appended to `document.body` (DOM-guarded for the node test runner); `RoomEvent.Disconnected` → `unavailable` mid-session.
  - [x] **Autoplay gotcha:** browser autoplay policy blocks audio playback until a user gesture. `connectVoice()` MUST be invoked from within a user-gesture handler (a click), and mic capture (`getUserMedia` via `setMicrophoneEnabled`) likewise needs the gesture + a permission prompt. Do not auto-connect on mount with no gesture — see Task 4. → connect runs only from the Task 4 click handler; best-effort `room.startAudio()` in the gesture chain to recover blocked playback without failing the connection.
  - [x] **Teardown (AC #5):** on `disconnectVoice()` / unmount: remove all `RoomEvent` listeners, detach+remove every audio element, stop the local mic track, and `await room.disconnect()`. Guard against double-connect (ignore a `connect` while already `connecting`/`connected`) and double-disconnect. A reconnect after disconnect must start from a clean slate (fresh token per AC #6). → `phase` guard on both ends; `clearRoomBindings` removes listeners + audio els; `setMicrophoneEnabled(false)` + `room.disconnect()`.
  - [x] **No secret logging (AC #6):** never `console.log` the token or the full grant; if you log connection lifecycle, log only `{ room, identity, status }`. Request a fresh token each connect — never stash and reuse a prior token. → `connectVoice.ts` has zero `console.*`; token is never stored beyond the local connect scope; fresh `requestToken()` per connect.

- [x] **Task 3 — Extend `voiceStore` (separate from gameStore) (AC: #3)**
  - [x] Keep `apps/client/src/store/voiceStore.ts` as its own Zustand store (it already exists as a status-only stub: `idle | connecting | connected | unavailable`). Add only what the connection layer needs to drive UI: keep `status`, add optional `room?: string` and `identity?: string` (handy for 3.4's speaker pill), and an optional `error?: string` for the microcopy. Do NOT add anything game-authoritative. → added `room?/identity?/error?` + explicit transitions (`setConnecting/setConnected/setUnavailable/reset`); nothing game-authoritative.
  - [x] **Hard boundary (AC #3):** `connectVoice` updates **only** `voiceStore`. It must never import or call `useGameStore`, and no game reducer/handler may read `voiceStore`. Voice connecting/failing must not change `gameStore.connection`, the session, the bomb, or any phase. (This is the AR12/ADR-007 invariant and the core of epic AC2.) → `connectVoice.ts` does not import `gameStore`; the load-bearing test asserts `gameStore` is byte-identical across connect/fail.

- [x] **Task 4 — Wire the Bomb Room join entry point (AC: #2, #4)**
  - [x] Add a minimal, gesture-driven entry so a Bomb Room participant can join voice and be verifiable now, **without** pulling in Story 3.4's speaker-pill/mute UI or Story 2.5's full lobby mic-check. Recommended: a small headless-ish `VoiceController` (or a single "Connect to Bomb Room voice" affordance) that (a) reads the local player from `gameStore.session.players[getSocket().id]` to confirm a Bomb Room role + team, (b) calls `connectVoice()` from the click handler, and (c) renders only the EXPERIENCE microcopy states — "Connecting to Bomb Room…" (connecting) and "Voice unavailable — game continues without it" (unavailable, dismissible/non-blocking). No speaker indicator, no mute toggle (those are 3.4). → `ui/VoiceController.tsx`: gates on defuser/expert + team, click→`connectVoice()`, renders only microcopy (idle CTA / connecting / connected / dismissible unavailable). No pill, no mute.
  - [x] **Role/room note:** the client is room-agnostic — it connects to whatever `room` the server-minted token returns. Per the Story 3.1 review decision, a `facilitator` is now scoped to the **Spectator Lounge** (canPublish:true), NOT the Bomb Room; the facilitator's on-demand PTT *into* a Bomb Room is a deferred future story. So this story's Bomb Room participants are effectively `defuser`/`expert`. Do not hardcode role→room on the client; trust the token's `room`. → no role→room mapping on the client; the affordance shows only for defuser/expert-with-team, and connect trusts the token's `room`.
  - [x] Mount the entry point where a Bomb Room participant actually is during play (e.g. alongside the active-round operator overlay / `ActiveRound`), but keep it non-blocking and unmount-safe (Task 2 teardown). → mounted in `ActiveRound`'s relative wrapper; unmount → `disconnectVoice()`.

- [x] **Task 5 — Tests (AC: #2, #3, #5)**
  - [x] **Voice independence (the load-bearing test):** assert that exercising the voice path — including the failure path — never mutates `gameStore`. A focused unit/integration test that drives `connectVoice` with a stubbed token ack + a faked `Room` and asserts `useGameStore.getState()` is unchanged while `useVoiceStore.getState().status` walks `connecting → connected` (and `→ unavailable` on the error ack). (Vitest, the client runner.) → `connectVoice.test.ts` "voice never mutates gameStore" (success + failure).
  - [x] **Status state machine:** token `{ error }` → `unavailable`; timeout → `unavailable`; successful connect → `connected`; `disconnectVoice()` → back to `idle`. Mock the socket ack and the LiveKit `Room` (do not require a real SFU in unit tests — the real-container check is Task 6). → covered across `connectVoice.test.ts` (faked Room) + `requestVoiceToken.test.ts` (mocked socket: grant/error/timeout).
  - [x] **Teardown/no-leak:** after connect→disconnect, assert the faked `Room.disconnect()` was called, listeners removed, and audio elements detached (spy on `track.detach`). Reconnect requests a fresh token (assert a second `VOICE_TOKEN` emit). → teardown test asserts `disconnect()`, `setMicrophoneEnabled(false)`, `el.remove()`, and zero remaining listeners; reconnect test asserts the token is requested twice.
  - [x] Keep `tsc --noEmit` green; run the full client suite (`vitest run`) — it must stay green (currently 204/204) plus the new voice tests. → client `219/219` (204 baseline + 15 new); `tsc --noEmit` clean; server `319/319` unaffected.

- [x] **Task 6 — Worktree env + the interactive "two people talk" verification (AC: #7) — Jay verifies** ✅ PASSED 2026-06-14
  - [x] Bring up the full stack against the **real LiveKit container** (do not mock the SDK for this check — AR16). Worktree gotchas ([[worktree-fullstack-testing-gap]], [[timer-verification-tsx-watch-gotcha]]): the `.env` is gitignored/absent in a fresh worktree (provision it, incl. `LIVEKIT_URL/API_KEY/API_SECRET/TURN_SECRET/TURN_TTL` — 3.1 already provisioned one here), and a main-built image runs stale code — `docker compose up -d --build` with a **worktree-scoped project name** so ports/containers don't collide with the main stack or another worktree. → brought up under project `ktane-wt-3x` with `--build`; required several env/infra fixes to make real-browser voice work (see Completion Notes "Verification infra fixes").
  - [x] **Jay verifies interactively:** open two browser sessions, create a session, put both on the **same team** (one Defuser, one Expert), connect both to Bomb Room voice via the Task 4 affordance (allow mic permission). Confirm: (1) each hears the other (bidirectional); (2) the speaker's audio is audible without a page reload; (3) killing the LiveKit container or denying mic leaves both clients fully able to keep playing the bomb (game never blocks). Localhost is a valid WebRTC origin for this check; corporate-NAT/TURN hardening is Story 10-3. → Jay confirmed bidirectional audio between two same-team browsers (Defuser + Expert); audible with no reload. (Minor audio clipping observed — expected single-mic/single-speaker acoustic loopback on one machine, not a code defect.)
  - [x] Record the observed result (heard/both directions, and game-continues-on-voice-drop) in Completion Notes — the story is not done until Jay's observed result is written down. ([[human-verification-ac-rule]]) → recorded below.

## Dev Notes

### What this story is (and is not)

This is the **client consumer half** of the voice subsystem — it spends the `VOICE_TOKEN` that Story 3.1 mints. It adds `livekit-client`, builds the `apps/client/src/voice/` connection layer, fleshes out the `voiceStore` stub, and gives a Bomb Room participant a way to actually join and talk. It is the first story that connects to the real SFU, so it carries the canonical **"two people hear each other"** human check.

**Explicitly NOT in this story (do not build these here):**
- **Speaker indicator pill + self-mute control → Story 3.4.** Publish the mic, but render no speaker pills and no mute toggle. (`UX-DR5` / EXPERIENCE IA items 4 & 5 are 3.4.)
- **Spectator Lounge listen-only specifics → Story 3.3.** The generic connection layer you build will be reused there; here, focus on the Bomb Room (publish + subscribe). The grant-level publish denial for spectators is already enforced by 3.1's token — you don't re-implement it.
- **Token re-mint on role change → Story 3.5.** You request a fresh token per connect (AC #6), which sets 3.5 up, but you do not implement role-change detection/rotation.
- **Full graceful-degradation polish, reconnect/backoff, NAT/TURN hardening → Story 3.6 / 10-3.** Your degradation requirement is only AC #3/#4: failure → `unavailable`, game keeps working.

### Critical architectural constraint — voice never gates game state

AR12 + ADR-007 + Architecture Pattern 7: voice is an **independent subsystem that never blocks game state**. Concretely:
- Voice connection state lives in `voiceStore` ONLY — never in `gameStore`. `connectVoice` must not import `useGameStore`. (It may *read* `gameStore.session` to discover the local player's role/team for the join entry point, but it writes only `voiceStore`.)
- A voice failure resolves to `status: 'unavailable'` and surfaces as dismissible microcopy. It must never throw into the game UI, never flip `gameStore.connection`, and never block a phase transition. AC #5's no-leak teardown and the Task 5 independence test are how we prove this.
- The reverse is also true: the game socket (`gameStore.connection`, SESSION_STATE, BOMB_INIT, TIMER_UPDATE) is a **separate** Socket.IO connection from the LiveKit WebRTC transport. They share nothing but the `socket.id`/`identity` string.

### Authority / contract recap from Story 3.1 (the event you consume)

`VOICE_TOKEN` is already declared in `packages/shared/src/events/client-to-server.ts` as an **ack-based** event:
```ts
VOICE_TOKEN: (
  payload: VoiceTokenRequestPayload,            // empty by contract
  ack: (result: VoiceTokenGrantPayload | VoiceTokenErrorPayload) => void,
) => void;
```
- `VoiceTokenRequestPayload` is intentionally empty — **send `{}`**. The server derives room + grants from the Redis-loaded session state for your socket; a client cannot ask for a room or a publish grant it shouldn't have (FR39, enforced at the grant, not the UI).
- `VoiceTokenGrantPayload = { url, token, room, identity }`. `identity` is your `socket.id` (the server uses it as the LiveKit participant identity — handy for 3.4's active-speaker → name mapping). `room` is `bomb-room:{sessionId}:{teamId}` for a Defuser/Expert with a team. **Never log `token`.**
- `VoiceTokenErrorPayload = { error }` — possible errors from 3.1: `NOT_IN_SESSION`, `VOICE_SCOPE_UNAVAILABLE` (e.g. a Bomb Room role with no team yet), `VOICE_TOKEN_FAILED`. Treat all as → `unavailable` (optionally show the generic microcopy); do not branch UI on the specific string in this story.

### Files to touch

- **NEW** `apps/client/src/voice/connectVoice.ts` — imperative LiveKit Room lifecycle (the only `livekit-client` import site).
- **NEW** `apps/client/src/voice/__tests__/connectVoice.test.ts` — independence + state-machine + teardown tests (Vitest, faked Room + stubbed ack).
- **NEW (or minimal)** `apps/client/src/ui/VoiceController.tsx` (or a small affordance in the existing operator overlay) — gesture-driven join + microcopy only.
- **UPDATE** `apps/client/src/store/voiceStore.ts` — extend the existing stub (status + optional room/identity/error); keep it a standalone store.
- **UPDATE** `apps/client/package.json` — add `livekit-client`.
- **UPDATE** wherever the join entry point mounts (e.g. `apps/client/src/ui/ActiveRound.tsx` or the operator overlay) — non-blocking, unmount-safe.

Read these existing files before editing (current behavior you must not break):
- `apps/client/src/store/voiceStore.ts` — the stub you extend (don't replace the store; don't fold it into gameStore).
- `apps/client/src/net/socket.ts` — `getSocket()` is the single typed socket handle; emit only typed events (`socket.emit(string, any)` is forbidden). `VOICE_TOKEN` is already typed.
- `apps/client/src/ui/Landing.tsx:150` — the `.timeout(ms).emit(EVENT, payload, errFirstAck)` pattern to mirror for the token request.
- `apps/client/src/store/gameStore.ts` — read `session.players[socket.id]` for role/team at the join entry point; do NOT write it from voice.
- `apps/client/src/ui/ActiveRound.tsx` (added by master via Story 8.5) — likely mount point for the Bomb Room operator overlay.

### Latest tech information — `livekit-client`

- The client SDK is the **`livekit-client`** package (separate from the server's `livekit-server-sdk`). Use the **2.x** line — it interoperates with the `livekit/livekit-server:v1.8` container already in `docker-compose.yml` and the `livekit-server-sdk@2.15.x` tokens from 3.1. Pin/confirm the installed version; no `@ts-ignore`.
- Minimal connect shape (confirm against the installed version's types):
  ```ts
  import { Room, RoomEvent, type RemoteTrack, type RemoteAudioTrack } from 'livekit-client';

  const room = new Room();
  room
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === 'audio') {
        const el = track.attach();      // returns an HTMLAudioElement, autoplay
        el.style.display = 'none';
        document.body.appendChild(el);  // must be in the DOM to play
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
    .on(RoomEvent.Disconnected, () => useVoiceStore.getState().setStatus('idle'));

  await room.connect(url, token);                       // url + token from VOICE_TOKEN ack
  await room.localParticipant.setMicrophoneEnabled(true); // publishes mic (needs gesture + permission)
  ```
- **Autoplay / gesture:** `room.connect` may succeed but audio playback and `getUserMedia` require a user gesture; LiveKit exposes `room.startAudio()` / `RoomEvent.AudioPlaybackStatusChanged` to recover blocked playback. Drive the connect from a click. If audio is blocked, surface a "click to enable audio" affordance rather than failing.
- **HTTPS:** WebRTC needs a secure context off localhost. `localhost` is treated as secure, so the two-tab dev check works without TLS; production TLS termination is already in the infra plan (Caddy/Nginx) — not this story.
- **Dispose:** LiveKit `Room` and attached media are not GC'd for you — mirror the project's Three.js dispose discipline: detach tracks, remove audio elements, `room.disconnect()` on teardown (AC #5).

### Testing standards summary

- Pure/independence logic → **Vitest** (`apps/client` runner). The load-bearing test is "voice path never mutates `gameStore`" (AC #3). Fake the LiveKit `Room` and stub the `VOICE_TOKEN` ack — do not require a real SFU in unit tests (AR16: real-container checks are the human-verify step, not the unit layer).
- R3F/UI components are rendering-only — the `VoiceController` should hold no game logic; if it needs a logic test, the logic has leaked into the component (move it to `connectVoice.ts`).
- The real LiveKit-container, two-participant "hear each other" verification is the **human-verify deliverable** (Task 6) and gates done — not an automated test.
- `tsc --noEmit` green across workspaces; no `@ts-ignore`.

### Project Structure Notes

- New client voice code lives under `apps/client/src/voice/` — a new peer of `net/`, `modules/`, `scenes/`, matching the existing per-concern client layout; the `livekit-client` import is confined there.
- `packages/shared` stays pure TS: the voice **event/payload types already live there** (added by 3.1) and are imported on both sides; the `livekit-client` runtime import must never enter `packages/shared`.
- No server files change in this story (the server already mints + acks via 3.1's `voiceHandlers.ts`).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Client state:** Zustand; on a render loop use `useStore.getState()`, not the reactive hook. Voice status changes are display-rate (not per-frame), so reactive selectors in React display components are fine — but keep `voiceStore` separate from `gameStore`.
- **Socket.IO / Shared Types:** typed `ClientToServerEvents` only; `socket.emit(string, any)` is forbidden. `VOICE_TOKEN` is already typed — use it.
- **R3F components are rendering-only:** zero game logic in components; voice connection logic lives in the `voice/` module, not in JSX.
- **Three.js / media disposal:** R3F does not GC Three.js objects, and the browser does not GC LiveKit tracks/audio elements — dispose explicitly on unmount (AC #5).
- **Voice / LiveKit gotchas (project-context):** the Spectator Lounge is a one-way listen path (Story 3.3); spectators must never publish into the Bomb Room (already grant-enforced by 3.1). Tokens are re-minted on role change and never reused across roles (Story 3.5) — so request a fresh token per connect and never cache-and-reuse (AC #6). **Test the Facilitator PTT bridge explicitly** — but that bridge is a deferred future story (see 3.1 review decision); not in 3.2.
- **Security:** never hardcode LiveKit keys/URL on the client — the `url` comes from the server's `VOICE_TOKEN` ack (server Config), never a client constant. Never log the token.
- **Build:** `tsc --noEmit` zero errors before commit; no `@ts-ignore`; TypeScript only; separate `tsconfig.json` per workspace.
- **WebRTC infra (already in place):** `docker-compose.yml` runs `livekit/livekit-server:v1.8`, `LIVEKIT_URL=ws://livekit:7880`, single UDP mux `7882`; `env.ts` validates the secrets; coturn is present for TURN. No infra change needed for 3.2; the two-tab localhost check does not exercise TURN (that's 10-3).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 3.2: Bomb Room Bidirectional Channel] — user story + ACs (join `bomb-room:{sessionId}:{teamId}`, publish+subscribe; voice state in a separate store, never gates game state).
- [Source: _agent_docs/planning-artifacts/epics.md#AR12] — voice topology + "voice is an independent subsystem that never blocks game state."
- [Source: _agent_docs/planning-artifacts/epics.md] — FR38 (two channels), NFR3 (connect within 10s behind NAT; game playable if voice drops), UX-DR5 (speaker pill — Story 3.4).
- [Source: _agent_docs/implementation-artifacts/3-1-role-scoped-livekit-token-minting.md] — the `VOICE_TOKEN` event contract you consume (empty request; `{url,token,room,identity}` / `{error}` ack), the facilitator→Spectator-Lounge review decision, and the worktree env provisioning already done.
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Remote Multiplayer UX] — Bomb Room = Defuser/Experts/Facilitator bidirectional; Spectator Lounge listen-only.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md] — voice connecting microcopy ("Connecting to Bomb Room…"), voice-failure path ("Voice unavailable — game continues without it"), speaker pill + mute are operator-overlay items (3.4).
- [Source: _agent_docs/project-context.md#Voice / LiveKit Gotchas, #React / R3F Gotchas, #Socket.IO / Shared Types, #Security] — separate store, dispose discipline, typed events, no-secret-logging.
- [Source: apps/client/src/store/voiceStore.ts] — the status stub to extend.
- [Source: apps/client/src/net/socket.ts, apps/client/src/ui/Landing.tsx:150] — `getSocket()` + `.timeout().emit(ack)` pattern to mirror.
- [Source: livekit-client 2.x — Room/RoomEvent/track.attach()/setMicrophoneEnabled] — https://docs.livekit.io/reference/client-sdk-js/

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- `pnpm install` (root) — `livekit-client@2.19.2` added to `apps/client` only; `pnpm -r typecheck` clean across all four workspaces.
- `pnpm --filter @bomb-squad/client test` → `219/219` (204 baseline + 15 new voice tests).
- `pnpm -r test` → server `319/319`, all workspaces green (no cross-workspace regression; voice is client-only).
- Node engine warning (`wanted node >=20 <21`, host is v25) is pre-existing and benign — install + tests succeed.

### Completion Notes List

**Implemented (Tasks 1–5, all ACs except the human-verify AC #7):**

- **AC #1** — `livekit-client@^2.19.2` (installed `2.19.2`, latest 2.x) is a dependency of `apps/client` ONLY; confirmed absent from `apps/server` and `packages/shared`. `tsc --noEmit` clean across all workspaces, no `@ts-ignore`. Zero server files changed.
- **AC #2** — `apps/client/src/voice/connectVoice.ts` requests a token via `getSocket().timeout(10000).emit('VOICE_TOKEN', {}, ack)` (empty payload), connects a LiveKit `Room`, publishes the mic (`setMicrophoneEnabled(true)`), and subscribes/plays every remote audio track (`RoomEvent.TrackSubscribed` → `track.attach()` → hidden `<audio>` in `document.body`). Bidirectional by construction.
- **AC #3** — voice status lives ONLY in `voiceStore` (Zustand), walking `idle → connecting → connected`, with every failure (token error, connect rejection, missing/timed-out ack, `RoomEvent.Disconnected`) → `unavailable`. `connectVoice.ts` does not import `gameStore`. The load-bearing test asserts `gameStore` is byte-identical (`.toBe`) across both the success and failure voice paths.
- **AC #4** — `VoiceController` renders the failure state as dismissible microcopy ("Voice unavailable — game continues without it") with no modal and no game-state coupling; the bomb/timer/modules stay fully interactive.
- **AC #5** — teardown (`disconnectVoice()` / unmount) removes all `RoomEvent` listeners, detaches + removes every audio element, releases the mic (`setMicrophoneEnabled(false)`), and `await room.disconnect()`. `phase` guards block double-connect/double-disconnect; reconnect starts clean. Verified by the teardown/no-leak test (asserts `disconnect()`, `el.remove()`, and zero remaining listeners).
- **AC #6** — `connectVoice.ts` has zero `console.*` (the JWT is never logged); a fresh token is requested per connect (`requestToken()` each time, never cached). Reconnect test asserts the token is requested twice across connect→disconnect→connect.

**Design notes for the reviewer:**

- `connectVoice.ts` is split into a `createVoiceController(deps)` factory (dependency-injectable `createRoom` + `requestToken` for tests) and a default singleton bound to the exported `connectVoice`/`disconnectVoice`. This let the load-bearing independence + teardown tests run with a faked `Room` and stubbed token — no real SFU in the unit layer (AR16).
- The connection layer is DOM-optional: it attaches audio via the SDK always, and only touches `document.body` when `document` exists, so the Vitest node runner needs no jsdom (none is installed in this repo).
- Best-effort `room.startAudio()` is called inside the connect gesture chain to recover blocked autoplay; a rejection is swallowed (blocked playback must not fail the connection — the full click-to-enable affordance is deferred polish, Story 3.6).

**Task 6 / AC #7 — ✅ PASSED (Jay, 2026-06-14):** Two same-team browsers (one Defuser, one Expert) connected to Bomb Room voice and **heard each other bidirectionally**, audible with no page reload. Minor audio clipping was observed — that is the expected acoustic loopback of running both clients through one machine's single mic + speaker, not a code defect. Stack brought up under worktree project `ktane-wt-3x` against the real LiveKit container.

**Verification infra fixes (needed to make real-browser voice work; surfaced by this first SFU integration):**

These were NOT client-code changes to the feature — they are environment/infra corrections the human-verify exposed. Several are localhost-dev-only and are flagged for production follow-up:

1. **`docker-compose.yml` — server `LIVEKIT_URL` was the internal hostname `ws://livekit:7880`.** That value is handed verbatim to the **browser** in the `VOICE_TOKEN` grant, and a browser can't resolve the compose service name (`ERR_NAME_NOT_RESOLVED`). The server never *dials* LiveKit (it only signs JWTs locally), so the override served no purpose. Fixed to the browser-reachable `${LIVEKIT_URL:-ws://localhost:7880}`. **This is a real latent 3.1 bug** — production needs a routable public URL (a `wss://` through the proxy), see follow-up.
2. **`livekit.yaml` — `node_ip: "127.0.0.1"`** (LOCALHOST DEV). Without it LiveKit advertised its container-internal ICE candidate (172.18.x.x), unreachable from a host browser → "negotiation timed out". Prod must use a routable IP / `use_external_ip` (Story 10-3 / deployment).
3. **`livekit.yaml` — `udp_port: 0`** (LOCALHOST DEV, force ICE/TCP on 7881). Docker-Desktop/WSL2's single-port UDP mux NAT was unreliable. (With the SFU upgrade in #4, UDP began working again too — observed `connectionType: udp` — but TCP-only is kept for WSL2 reliability.) Prod should restore the single UDP mux (`udp_port: 7882`).
4. **`docker-compose.yml` — bumped the SFU `livekit/livekit-server:v1.8` → `v1.13.1`.** The browser SDK `livekit-client@2.19.2` speaks protocol 17 and probes `/rtc/v1`; the year-old v1.8 SFU only spoke protocol 15, causing a missing-`/rtc/v1` 404 and a ~15s reconnect loop. v1.13.x is the matching protocol-17 generation. Tokens minted by `livekit-server-sdk@2.15` are accepted unchanged (JWT format is stable). **Worth a quick infra review** — either keep the SFU current or pin `livekit-client` to the v1.8-paired 2.x line (AC #1 "pairs with the server"); the modern pair is the cleaner choice.
5. **`Caddyfile` — `:80` now serves the app over plain http** instead of 301-redirecting to https (LOCALHOST DEV). The page origin must be http so it can open the `ws://localhost:7880` LiveKit socket without a mixed-content block; `localhost` is a secure context even over http, so mic capture still works. Prod restores the http→https redirect and terminates LiveKit as `wss://` (Story 10-3 TLS).
6. **`.env` — regenerated `LIVEKIT_API_KEY` + a ≥32-char `LIVEKIT_API_SECRET`** (with Jay's approval). The 3.1-provisioned secret was the short `devsecret`, which LiveKit logs as `ERROR: secret is too short`.

Also observed (correct behavior, not a bug): when a second browser could not acquire the mic (permission blocked), `setMicrophoneEnabled(true)` threw, the client tore the room down cleanly (`CLIENT_REQUEST_LEAVE`, zero tracks published) and resolved to `unavailable` — exactly the AC #4 graceful-failure path. NOTE for **Story 3.6**: a mic-denied Bomb Room participant currently gets no voice at all (not even listen-only); a subscribe-only fallback could be considered there (out of scope for 3.2's "publish + subscribe").

**Production follow-ups to file (not 3.2 scope):** (a) a dedicated client-facing `LIVEKIT_PUBLIC_URL` (`wss://…`) distinct from any internal URL, returned in the grant; (b) restore the Caddy http→https redirect + LiveKit `wss://` TLS termination and the UDP mux / routable node_ip — these belong to **Story 10-3 (NAT/TURN/TLS hardening)** and deployment.

### File List

- **NEW** `apps/client/src/voice/connectVoice.ts` — imperative LiveKit `Room` lifecycle + `requestVoiceToken`; the only `livekit-client` import site.
- **NEW** `apps/client/src/voice/__tests__/connectVoice.test.ts` — independence (load-bearing) + state-machine + teardown/no-leak + fresh-token tests (faked Room + stubbed token).
- **NEW** `apps/client/src/voice/__tests__/requestVoiceToken.test.ts` — real `VOICE_TOKEN` `.timeout().emit` path via mocked socket (grant / error / timeout).
- **NEW** `apps/client/src/ui/VoiceController.tsx` — gesture-driven Bomb Room join affordance + microcopy only (no pill, no mute).
- **UPDATE** `apps/client/src/store/voiceStore.ts` — extended the stub with `room?/identity?/error?` + explicit transitions (`setConnecting/setConnected/setUnavailable/reset`); still a standalone store.
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount `VoiceController` in the relative wrapper (non-blocking, unmount-safe).
- **UPDATE** `apps/client/src/ui/index.ts` — export `VoiceController`.
- **UPDATE** `apps/client/src/ui/copy.ts` — Bomb Room voice microcopy strings.
- **UPDATE** `apps/client/package.json` — add `livekit-client@^2.19.2`.
- **UPDATE** `pnpm-lock.yaml` — lockfile for the new dependency.
- **UPDATE** `docker-compose.yml` — fix the browser-facing `LIVEKIT_URL` (was the internal `ws://livekit:7880`); bump SFU `livekit/livekit-server:v1.8 → v1.13.1` to match the client protocol. _(infra fixes surfaced by the AC #7 human-verify — see Completion Notes)_
- **UPDATE** `livekit.yaml` — localhost-dev `node_ip: 127.0.0.1` + `udp_port: 0` (force ICE/TCP) so WSL2/Docker media reaches a host browser. _(dev-only; prod restores UDP mux + routable IP — Story 10-3)_
- **UPDATE** `Caddyfile` — `:80` serves the app over http (no https redirect) so the page can open the `ws://` LiveKit socket without mixed-content. _(dev-only; prod restores redirect + wss TLS — Story 10-3)_
- **UPDATE (untracked, dev-only)** `.env` — regenerated `LIVEKIT_API_KEY` + a ≥32-char `LIVEKIT_API_SECRET` (replaced the short `devsecret` LiveKit rejected). Not committed (gitignored).

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-13 | Story 3.2 created (ready-for-dev): client Bomb Room voice — `livekit-client` + `apps/client/src/voice/` connection layer consuming 3.1's `VOICE_TOKEN`, `voiceStore` fleshed out, voice-independence tests, real-container two-participant human check. |
| 2026-06-14 | Implemented Tasks 1–5 (AC #1–#6): added `livekit-client@2.19.2` (client only), built `voice/connectVoice.ts` (token request + Room lifecycle + teardown), extended `voiceStore`, added the gesture-driven `VoiceController` mounted in `ActiveRound`, and 15 new Vitest tests (independence/state-machine/no-leak/fresh-token). Client `219/219`, server `319/319`, `tsc` clean. Status → review. AC #7 (two-participant human check) pending Jay. |
| 2026-06-14 | **AC #7 PASSED (Jay):** two same-team browsers heard each other bidirectionally over the real LiveKit SFU. Required env/infra fixes surfaced by this first real-SFU integration: corrected the browser-facing `LIVEKIT_URL` (was internal `ws://livekit`), bumped SFU v1.8→v1.13.1 (protocol-17 match for `livekit-client@2.19`), localhost-dev `node_ip`/TCP-only LiveKit + Caddy http serving, and a ≥32-char LiveKit secret. Production follow-ups (public `wss://` URL, restore redirect/UDP/TLS) flagged for Story 10-3. All 6 tasks complete. |
| 2026-06-14 | **Code review (gds-code-review):** all 7 ACs verified MET; 3 patches applied + verified (client `221/221`, tsc clean). Critical: `connect()` epoch guard so a teardown mid-connect disposes the room instead of orphaning a live SFU connection + hot mic (+2 regression tests). Low: `.catch`-guarded floating disconnects. Medium: isolated the localhost-dev infra into `Caddyfile.dev`/`livekit.dev.yaml`/`docker-compose.override.yml` — production `Caddyfile`/`livekit.yaml` restored to secure-by-default (HTTPS redirect + UDP mux). 1 finding deferred to Story 3.6 (blocked-autoplay recovery). **Re-verification PASSED (Jay):** two-tab voice re-checked against the isolated dev override — bidirectional audio + game-continues-on-voice-kill confirmed. |

## Review Findings

_Code review 2026-06-14 (gds-code-review: Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 7 ACs verified MET by the Acceptance Auditor; the items below are robustness/process gaps found in the implementation, not AC failures._

- [x] [Review][Patch] Isolate committed dev-only infra into a dev override (resolved decision, Jay 2026-06-14) — the dev-only `Caddyfile :80` plain-http block and `livekit.yaml` `node_ip: 127.0.0.1` + `udp_port: 0` contradict project-context's prod WebRTC/TLS rules ("HTTPS required for WebRTC in all non-localhost environments"; single UDP mux on 7882) and nothing prevents them reaching a deploy branch. **Resolution:** restore the production `Caddyfile` (`:80 { redir https… }`) and production `livekit.yaml` (UDP mux 7882, routable/`use_external_ip` node_ip), and move the WSL2-localhost overrides into a separate dev-only file (e.g. `livekit.dev.yaml` + `docker-compose.override.yml` volume mount, and a `Caddyfile.dev` or dev block) so prod files stay correct by default. The `docker-compose.yml` `LIVEKIT_URL` env-default fix and the SFU v1.8→v1.13.1 bump stay (both are correct for all environments). _(project-context WebRTC & Build rules; all three review layers)_
- [x] [Review][Patch] `connect()` never re-checks `phase` after its `await` points → a teardown during the in-flight connect orphans a live Room + hot mic [apps/client/src/voice/connectVoice.ts:129-172]. If `disconnect()` runs while `await deps.requestToken()` (L129) or `await r.connect()`/`setMicrophoneEnabled()` (L157-160) is pending, `disconnect()` sees `room === null` (not assigned until L170), resets to idle and returns; `connect()` then resumes, sets `room = r` / `phase = 'connected'`, and leaks a fully-live SFU connection with a published mic that nothing will tear down. The `VoiceController` unmount-during-"connecting" path (L40-44) makes this reachable; also covers the StrictMode double-mount race. Fix: capture a connect epoch (or re-check `phase !== 'connecting'`) after each await and abort+tear-down `r` if a teardown intervened. _(blind+edge; Critical — undermines AC #5)_
- [x] [Review][Patch] Floating `void r.disconnect()` on the connect-error path is unawaited and uncaught → unhandled promise rejection [apps/client/src/voice/connectVoice.ts:164]. Every other disconnect is awaited; this one (half-open cleanup) can reject if the transport is already dead. Fix: `void r.disconnect().catch(() => undefined);` (mirror the swallowed-rejection pattern used elsewhere). _(blind+edge)_
- [x] [Review][Defer] Blocked autoplay leaves status `connected` with no audible remote audio and no retry affordance [apps/client/src/voice/connectVoice.ts:178] — deferred. `room.startAudio()` rejection is intentionally swallowed (best-effort, inside the gesture chain); the full "click to enable audio" affordance is explicitly Story 3.6 polish per the spec's Dev Notes.

**Dismissed as noise (6):** Caddy multi-`reverse_proxy` route ordering (Caddy sorts by matcher specificity; the AC #7 end-to-end check proved socket.io + token routing work through this exact file); `getSocket()` throw/undefined-id in `VoiceController` (not reachable in the `ActiveRound` mount context — socket exists long before; undefined-id is handled, returns null); duplicate `TrackSubscribed` → duplicate `<audio>` (SDK does not double-fire per track); `document.body` null at head-time (component mounts in the body tree); `TokenResult.grant` carries the raw JWT (never actually logged — local-scope only); bulk `detachAll()` omits `track.detach()` (`room.disconnect()` releases the tracks; AC #5's literal "elements removed" is satisfied).

### Review Patches Applied (2026-06-14)

All 3 patch findings fixed and verified (client `221/221` — 219 baseline + 2 new regression tests; `tsc --noEmit` clean across workspaces):

1. **`connect()` epoch guard (Critical).** Added a `connectEpoch` counter bumped by every `disconnect()`; `connect()` re-checks it after the token await and after the room connect/publish await. If a teardown/unmount raced in, `connect()` now aborts and disposes the room it brought up (new `abandonRoom()` helper: drops listeners + media, releases the mic, `disconnect()`s) instead of assigning `room`/`phase='connected'`. No more orphaned live SFU connection + hot mic on unmount-during-connect. Covered by two new tests (disconnect during token request; disconnect during `room.connect()`).
2. **Floating disconnect rejections (Low).** The error-path `void r.disconnect()` and the teardown-path `await r.disconnect()` are now `.catch(() => undefined)`-guarded so a rejected disconnect of an already-dead transport can't surface as an unhandled rejection (teardown often runs from `void disconnectVoice()` on unmount).
3. **Dev-infra isolation (Medium, resolved decision).** Restored production `Caddyfile` (`:80 { redir https… }`) and `livekit.yaml` (`udp_port: 7882`, no loopback `node_ip`). Moved the WSL2-localhost hacks into new dev-only files — `Caddyfile.dev`, `livekit.dev.yaml`, mounted by a new `docker-compose.override.yml` (auto-applied by a bare `docker compose up`). A prod deploy that runs `docker compose -f docker-compose.yml up` bypasses the override and keeps the HTTPS redirect + UDP mux. Verified via `docker compose config` (dev → `.dev` files) vs `docker compose -f docker-compose.yml config` (prod → base files). The `docker-compose.yml` `LIVEKIT_URL` env-default and SFU v1.13.1 bump were kept (correct for all environments).

**File List additions (review patches):** `apps/client/src/voice/connectVoice.ts` (epoch guard + `abandonRoom` + `.catch` guards), `apps/client/src/voice/__tests__/connectVoice.test.ts` (+2 regression tests), `Caddyfile` + `livekit.yaml` (restored to prod-correct), **NEW** `Caddyfile.dev`, **NEW** `livekit.dev.yaml`, **NEW** `docker-compose.override.yml`.

> **Re-verification — ✅ PASSED (Jay, 2026-06-14):** rebuilt the worktree stack (`docker compose -p ktane-wt-3x up -d --build`, dev override auto-applied — confirmed `.dev` files mounted, all 7 services healthy, app served over http :80, LiveKit on v1.13.1 with `nodeIP 127.0.0.1`) and re-ran the two-tab AC #7 check after the infra isolation. Bidirectional audio confirmed between two same-team browsers, and the game kept running when voice was killed. The dev override reproduces the exact verified runtime config, and the production `Caddyfile`/`livekit.yaml` now stay secure-by-default. Review patches verified end-to-end and ready to commit.
