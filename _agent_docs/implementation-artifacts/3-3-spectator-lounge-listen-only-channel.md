---
baseline_commit: b536b0148a179fdc0749212811b2b3d67c1e52d6
context:
  - _agent_docs/implementation-artifacts/3-1-role-scoped-livekit-token-minting.md
  - _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md
  - _agent_docs/project-context.md
---

# Story 3.3: Spectator Lounge Listen-Only Channel

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Spectator,
I want to hear the Bomb Room (via the Spectator Lounge) without being able to speak into it,
so that I can follow the action without disrupting the team.

## Acceptance Criteria

1. **Given** a committed `spectator` in an active round, **When** they choose to connect to voice (gesture-driven, like the Bomb Room affordance), **Then** the client requests a token via the existing `VOICE_TOKEN` event (empty payload), receives `{ url, token, room, identity }` with `room === spectator-lounge:{sessionId}`, connects a LiveKit `Room`, and **subscribes to and plays** every remote audio track — i.e. the spectator HEARS the lounge. _(FR38/FR39; epic AC1; resolveVoiceScope already returns the lounge room — server is done)_
2. **Given** a connecting spectator, **When** the LiveKit `Room` is established, **Then** the client **does NOT publish a microphone track and does NOT call `getUserMedia`** — no mic-permission prompt is shown to a spectator, because the spectator is listen-only. (The server grant already has `canPublish: false`; the client must not even attempt to publish.) _(FR39 listen-only; project-context Voice gotchas; do not trigger a needless mic prompt)_
3. **Given** a spectator client (or any code path) attempts to publish audio into the lounge/Bomb Room, **When** the attempt reaches LiveKit, **Then** it is **denied at the token-grant level, not merely hidden in the UI** — this AC is ALREADY SATISFIED by Story 3.1/3.2's `resolveVoiceScope` (`spectator → canPublish: false`). The dev MUST NOT re-implement or touch server token minting; verify by reading `apps/server/src/voice/mintToken.ts` and confirm the spectator branch (`canPublish: role === 'facilitator'`, i.e. `false` for a spectator). _(FR39; epic AC2 — server-enforced, do NOT re-do)_
4. **Given** the spectator voice connection state changes, **When** it walks `idle → connecting → connected` (or any failure → `unavailable`), **Then** it is tracked **only** in `voiceStore`; no voice code writes `gameStore` or gates a game-state transition. The Spectator Lounge surface (and the whole game) remains fully interactive whether voice connects, fails, or drops. _(AR12 / ADR-007 / Pattern 7 — voice never blocks game state; same invariant proven in 3.2)_
5. **Given** the spectator leaves voice (component unmount, navigates away, round ends, role changes), **When** teardown runs, **Then** the LiveKit `Room` is `disconnect()`-ed and every attached `<audio>` element is detached/removed — no leaked media or listeners across connect→disconnect→reconnect. (Reuse the existing `disconnectVoice()` teardown — do not write a parallel one.) _(AC #5 parity with 3.2; resource hygiene)_
6. **Given** the spectator-facing entry point renders listen-only microcopy, **When** the spectator is connecting/connected/failed, **Then** the copy reflects **listening to the Bomb Room** (e.g. "Listening to the Bomb Room", not "Connect to Bomb Room voice"/"Bomb Room voice connected") — a spectator is not "in" the Bomb Room. Failure still shows the shared dismissible "Voice unavailable — game continues without it". No speaker pill, no mute toggle (Story 3.4). _(EXPERIENCE.md Flow 4: "Listen-only voice — he hears the Bomb Room but cannot speak in"; UX role-gating)_
7. **Given** the real LiveKit container, **When** Jay runs the interactive check, **Then** with one Bomb Room participant (Defuser/Expert) talking and one Spectator connected to the Lounge: the **Spectator HEARS the Bomb Room audio**, the **Spectator gets NO mic prompt and CANNOT publish** (any publish attempt is grant-denied), and killing voice leaves both clients fully able to keep playing. Result recorded in Completion Notes. _(human-verification rule — 3.3 is the canonical "spectator hears but cannot talk" check; NFR3)_

## Tasks / Subtasks

- [x] **Task 1 — Confirm the server is already done; touch NO server code (AC: #3)**
  - [x] Read `apps/server/src/voice/mintToken.ts` `resolveVoiceScope`. Confirm the spectator branch returns `room = spectator-lounge:{sessionId}`, `grant.canPublish = false` (it is `canPublish: role === 'facilitator'`), `canSubscribe: true`. This is FR39, enforced at the grant — **AC #3 is already satisfied. Do not modify any file under `apps/server/`.** ✅ Verified: `mintToken.ts:115-123` — spectator → `spectator-lounge:${sessionId}`, `canPublish: role === 'facilitator'` (false), `canSubscribe: true`. No server file touched.
  - [x] Note the lobby-phase exception: in `phase === 'lobby'` EVERY participant (incl. spectator) gets `canPublish: true` for the mic check (Story 2.5). That is intentional and NOT this story — the listen-only rule governs the in-round Spectator Lounge. Do not "fix" the lobby branch. ✅ Confirmed (`mintToken.ts:100-108`); left untouched.

- [x] **Task 2 — Listen-only connect path in `connectVoice.ts` (AC: #1, #2, #5)**
  - [x] Read `apps/client/src/voice/connectVoice.ts` in full FIRST. The controller is already room-agnostic: it requests a token, connects to whatever `room` the token returns, subscribes/plays all remote audio (`RoomEvent.TrackSubscribed → track.attach()`), tracks `activeSpeakers`, and tears down cleanly. The ONLY Bomb-Room-specific line is `await r.localParticipant.setMicrophoneEnabled(true)` (publishes the mic).
  - [x] Add a **listen-only / subscribe-only** connect mode so a spectator connects WITHOUT publishing a mic. ✅ Threaded `publish = true` param through `connect(publish)`; the `setMicrophoneEnabled(true)` call is now guarded `if (publish)`, so for a spectator `getUserMedia` is never invoked (no mic prompt — AC #2). Token request, room connect, subscribe/play, teardown, epoch guard, `startAudio()` all unchanged and reused.
  - [x] Keep the connection layer the SOLE `livekit-client` import site and keep it writing ONLY `voiceStore`. ✅ No role branch inside the controller — the caller passes `publish: false`; the controller stays role-agnostic and trusts the token's room.
  - [x] Teardown (AC #5) is the existing `disconnectVoice()` — no new teardown path. ✅ Test confirms a subscribe-only connect→disconnect removes the audio element + unbinds every listener; `setMicrophoneEnabled(false)` stays as the harmless try/catch no-op.

- [x] **Task 3 — Spectator-facing listen-only entry point (AC: #1, #4, #6)**
  - [x] Read `apps/client/src/ui/VoiceController.tsx`. ✅ Chose **shape (a)** (lowest churn — `<VoiceController />` is already mounted in `ActiveRound` for all roles). Extended it to also handle `role === 'spectator'`: a listen-only CTA + lounge microcopy that calls `connectVoice({ publish: false })`. The Bomb Room branch (`defuser`/`expert` + team → `publish: true`) is untouched.
  - [x] The entry MUST be gesture-driven. ✅ CTA `onClick={() => void connectVoice({ publish })}` — same click-driven `connectVoice`/`startAudio` chain. Renders only connecting / connected (lounge wording) / dismissible `unavailable`; reused the existing `useState(dismissed)` + `useEffect(status==='unavailable')` re-show. **No speaker pill, no mute toggle.**
  - [x] Unmount-safe (AC #5): ✅ the existing `useEffect(() => () => void disconnectVoice(), [])` teardown already covers both modes (one shared mount).
  - [x] Resolve self via `useGameStore(s => s.myPlayerId)`. ✅ Reused the existing durable-id self-resolution (`session.players[selfId]`); gated the lounge affordance on `self.role === 'spectator'`. No socket.id regression.

- [x] **Task 4 — Listen-only microcopy + mount (AC: #6)**
  - [x] Add lounge microcopy to `apps/client/src/ui/copy.ts`. ✅ Added `VOICE_LOUNGE_CTA = 'Listen to the Bomb Room'`, `VOICE_LOUNGE_CONNECTING = 'Connecting to the Bomb Room…'`, `VOICE_LOUNGE_CONNECTED = 'Listening to the Bomb Room.'`; failure reuses shared `VOICE_UNAVAILABLE` + `VOICE_DISMISS`. Did not reuse the Bomb Room `VOICE_*` strings.
  - [x] Mount the spectator entry where a spectator actually is in-round. ✅ Shape (a): `<VoiceController />` is already mounted in `ActiveRound` for all roles, so no new mount — the spectator now gets the affordance from the existing mount. Non-blocking + unmount-safe.

- [x] **Task 5 — Tests (AC: #1, #2, #4, #5)**
  - [x] **Listen-only connect (the load-bearing AC #2 test):** ✅ `connect(false)` + faked `Room` asserts `setMicrophoneEnabled` is **never called**, remote audio still subscribed/attached (`track.attach`), `voiceStore.status` walks `connecting → connected`, room/identity = the lounge grant.
  - [x] **Voice independence (reuse 3.2's invariant):** ✅ added `publish:false` success AND failure tests — `useGameStore.getState()` byte-identical (session/bomb/connection) while `voiceStore` transitions.
  - [x] **Teardown/no-leak:** ✅ subscribe-only connect→disconnect calls `room.disconnect()`, removes the audio element, unbinds every listener, back to `idle`; reconnect requests a fresh token (2× `requestToken`).
  - [x] Kept connect logic in `connectVoice.ts`, components rendering-only (no new UI component, so no render test needed). `tsc --noEmit` green; full client suite green: **315/315** (was 221 at 3.2 baseline; suite has grown — +5 new 3.3 tests, 25/25 in `connectVoice.test.ts`).

- [ ] **Task 6 — Worktree env + the interactive "spectator hears but can't talk" verification (AC: #7) — Jay verifies**
  - [ ] **WSL2/Docker voice five-fix checklist (HARD — first full voice sprint since Sprint 3; see [[livekit-wsl2-localhost-voice-verification]], [[worktree-fullstack-testing-gap]]):** bring up the FULL stack against the **real LiveKit container** (do NOT mock the SDK — AR16). The worktree `.env` is gitignored/absent — provision it (incl. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, a **≥32-char** `LIVEKIT_API_SECRET`, `TURN_SECRET`, `TURN_TTL`). Run `docker compose up -d --build` with a **worktree-scoped project name** (e.g. `-p ktane-s5-voice`) so containers/ports don't collide with the main stack or another worktree, and a main-built image doesn't run stale code. The 3.2 dev override (`docker-compose.override.yml` + `Caddyfile.dev` + `livekit.dev.yaml`) auto-applies on a bare `docker compose up` and already encodes the five fixes: (1) browser-reachable `LIVEKIT_URL` (`ws://localhost:7880`, never the internal `ws://livekit`), (2) `node_ip: 127.0.0.1`, (3) SFU/SDK protocol match (`livekit/livekit-server:v1.13.1` ↔ `livekit-client@2.19.x`, protocol 17), (4) Caddy serving the app over plain http on :80 (http origin → `ws://` allowed; localhost is a secure context for mic), (5) the ≥32-char secret. Confirm `.dev` files are mounted (`docker compose config`) and all services healthy before testing.
  - [ ] **Jay verifies interactively:** open TWO browser sessions. Put one as a **Defuser or Expert** (Bomb Room) and one as a **Spectator**. Connect the Bomb Room participant to voice and have them talk; connect the Spectator via the new listen-only affordance. Confirm: (1) the **Spectator HEARS the Bomb Room** audio (audible without a reload); (2) connecting as a Spectator shows **NO mic-permission prompt** and the Spectator has **no way to publish** (and any attempt is grant-denied — listen-only at the token level); (3) killing the LiveKit container or otherwise dropping voice leaves BOTH clients fully able to keep playing (game never blocks). Localhost is a valid WebRTC origin; corporate-NAT/TURN hardening is Story 10-3.
  - [ ] Record the observed result (spectator-hears-yes, spectator-cannot-talk/no-mic-prompt, game-continues-on-drop) in Completion Notes — the story is NOT done until Jay's observed result is written down. ([[human-verification-ac-rule]])

## Dev Notes

### What this story is (and is NOT) — READ THIS FIRST

3.3 is **CLIENT-ONLY**. The server half (mint a listen-only token routing a spectator to `spectator-lounge:{sessionId}` with `canPublish: false`) was **already shipped by Stories 3.1/3.2** in `apps/server/src/voice/mintToken.ts`. **Do not modify any server file.** AC #3 ("denied at the token-grant level, not merely hidden in the UI") is already TRUE — you only verify it.

The client connection layer (`connectVoice.ts`) built in 3.2 is **already room-agnostic** and already subscribes-to-and-plays all remote audio and tracks `activeSpeakers`. So the entire client delta for 3.3 is small:
1. A **listen-only (no-publish) connect mode** so a spectator connects without acquiring/publishing a mic (AC #2) — one `publish` flag through `connect()`, skipping `setMicrophoneEnabled(true)`.
2. A **spectator-facing entry point** with lounge microcopy (today `VoiceController` returns `null` for spectators).
3. Tests + the human-verify.

**Explicitly NOT in this story:**
- **Any server / token change** — done in 3.1/3.2. Touching `mintToken.ts`/`voiceHandlers.ts` is out of scope and a regression risk.
- **Speaker pill + self-mute → Story 3.4.** Render no pill, no mute. (`voiceStore.activeSpeakers` already exists and is populated — do not build the pill UI here.)
- **Token re-mint on role change → Story 3.5.** You request a fresh token per connect (the existing controller already does), which sets 3.5 up; you do not implement role-change rotation.
- **Graceful-degradation polish / reconnect-backoff / NAT-TURN → Story 3.6 / 10-3.** Your degradation requirement is only AC #4: failure → `unavailable`, game keeps working (already the controller's behavior).
- **The Epic 9 Spectator Lounge VIEW (split-pane bomb + manual, lifeline tokens, chat).** 3.3 is ONLY the listen-only voice channel, not the full lounge surface. The in-round spectator surface today is the `WATCHING_THE_BOMB_ROOM` placeholder in `ActiveRound`; mount the voice affordance there without building the Epic 9 lounge.

### The one real implementation subtlety — don't prompt a spectator for a mic (AC #2)

`connectVoice.ts` `connect()` currently calls `await r.localParticipant.setMicrophoneEnabled(true)` **unconditionally**. If a spectator runs the existing connect path as-is, the browser would prompt for mic permission and the SDK would attempt to publish — which the `canPublish: false` grant rejects (LiveKit refuses the publish), but the user still got an unwanted mic prompt and `getUserMedia` still ran. AC #2 requires the client to **not even attempt** to publish: thread a `publish` flag (default `true` for Bomb Room) and **skip the `setMicrophoneEnabled` call** when `false`. This keeps the spectator truly listen-only and prompt-free. Do NOT instead call `setMicrophoneEnabled(false)` for spectators — calling it with `false` is fine as a no-op, but the point is to never request the mic; the cleanest is to skip the publish line entirely.

Subscribe/play is unchanged: `RoomEvent.TrackSubscribed` already attaches every remote audio track to a hidden DOM `<audio>` so the spectator HEARS the lounge (AC #1). The lounge is where the Bomb Room audio is bridged for spectators (server-side room topology, already in place).

### Critical architectural constraint — voice never gates game state (unchanged from 3.2)

AR12 + ADR-007 + Architecture Pattern 7: voice is an **independent subsystem that never blocks game state**.
- Voice state lives in `voiceStore` ONLY. `connectVoice` must not import/write `useGameStore` (it may *read* `gameStore.session` only at the UI entry point to find the local player's role). A spectator's voice failing/dropping must never flip `gameStore.connection` or block a phase.
- The game socket (Socket.IO) and the LiveKit WebRTC transport are separate connections sharing only the `identity` string. The load-bearing test (assert `gameStore` byte-identical across the voice path, success and failure) is how we prove it — extend it for the `publish:false` path.

### Contract recap — the event you consume (from Story 3.1)

`VOICE_TOKEN` is an ack-based typed event in `packages/shared` — **send `{}`** (empty); the server derives room + grants from the Redis-loaded session state for your socket. For a `spectator` it returns:
- `room = spectator-lounge:{sessionId}`, `identity = your durable playerId`, plus `url` + the signed `token` (grant `canPublish: false`, `canSubscribe: true`).
- The client is **room-agnostic** — it connects to whatever `room` the token returns. Do NOT hardcode `spectator-lounge` on the client; trust the token. Never log the token.
- Possible error payloads (`{ error }`): `NOT_IN_SESSION`, `VOICE_SCOPE_UNAVAILABLE`, `VOICE_TOKEN_FAILED` — treat all as `→ unavailable` (the controller already does).

### Files to touch

- **UPDATE** `apps/client/src/voice/connectVoice.ts` — add a `publish` flag (default `true`); skip `setMicrophoneEnabled(true)` when `false`. Keep it the sole `livekit-client` site; keep writing only `voiceStore`. (Read fully first — note the `connectEpoch` guard and the `connect(publish?)` signature must propagate through the exported `connectVoice`.)
- **UPDATE** `apps/client/src/ui/VoiceController.tsx` *(shape (a))* — add a `spectator` branch that connects listen-only with lounge microcopy; OR
- **NEW** `apps/client/src/ui/SpectatorVoiceController.tsx` *(shape (b))* — a sibling listen-only affordance (mirror `VoiceController`'s structure/teardown/dismiss pattern).
- **UPDATE** `apps/client/src/ui/copy.ts` — add lounge microcopy (`VOICE_LOUNGE_*`); reuse `VOICE_UNAVAILABLE` + `VOICE_DISMISS`.
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount the spectator affordance in the spectator (`else`/`WATCHING_THE_BOMB_ROOM`) branch (only needed for shape (b); shape (a) already rides the existing `<VoiceController />` mount).
- **UPDATE** `apps/client/src/ui/index.ts` — export the new component (only if shape (b)).
- **UPDATE** `apps/client/src/voice/__tests__/connectVoice.test.ts` — add the listen-only (no-publish) + independence + teardown tests.
- **NONE under `apps/server/` or `packages/shared/`** — server is done; shared types already exist.

Read these existing files before editing (current behavior you must not break):
- `apps/client/src/voice/connectVoice.ts` — the controller you extend (epoch guard, subscribe/play, teardown, activeSpeakers). The `publish` change must not regress the Bomb Room path.
- `apps/client/src/ui/VoiceController.tsx` — the Bomb Room affordance; the self-resolution (`myPlayerId`), dismiss pattern, and unmount teardown to mirror.
- `apps/client/src/ui/ActiveRound.tsx` — role routing; the spectator placeholder branch + the existing `<VoiceController />` mount.
- `apps/client/src/store/voiceStore.ts` — already has `status` + `room/identity/error` + `activeSpeakers` + transitions; nothing new needed here (do NOT add game-authoritative state).
- `apps/server/src/voice/mintToken.ts` — READ ONLY, to confirm AC #3 (spectator `canPublish: false`). Do not edit.

### Latest tech information — `livekit-client` (unchanged from 3.2)

- Use the installed `livekit-client@2.19.x` (protocol 17) — pairs with the dev-override SFU `livekit/livekit-server:v1.13.1`. No new dependency for 3.3.
- Subscribe/play: `RoomEvent.TrackSubscribed → track.attach()` returns an `HTMLAudioElement`; it must be appended to the DOM to actually play (the controller already does this into a hidden `<audio>` on `document.body`).
- Listen-only: simply **do not call** `room.localParticipant.setMicrophoneEnabled(true)` — the participant joins with `roomJoin + canSubscribe` and publishes nothing. `getUserMedia` is only triggered by `setMicrophoneEnabled(true)`, so skipping it means no mic prompt (AC #2).
- Autoplay: even listen-only playback is autoplay-gated — connect from a click and keep the best-effort `room.startAudio()` in the gesture chain (the controller already does).
- Dispose: detach tracks, remove audio elements, `room.disconnect()` on teardown — the existing `disconnectVoice()` already does this.

### Testing standards summary

- Vitest (`apps/client` runner). The load-bearing tests: (1) `publish:false` connect NEVER calls `setMicrophoneEnabled` yet still subscribes/plays; (2) the listen-only voice path never mutates `gameStore` (success + failure). Fake the LiveKit `Room`, stub the `VOICE_TOKEN` ack — no real SFU in unit tests (AR16).
- Components rendering-only — keep connect logic in `connectVoice.ts`. A spectator role-gating render test is optional.
- The real-container two-browser "spectator hears but cannot talk" check is the **human-verify deliverable** (Task 6) and gates done — not automated.
- `tsc --noEmit` green across workspaces; no `@ts-ignore`; full client suite stays green (3.2 left it at `221/221`).

### Project Structure Notes

- Client voice runtime stays confined to `apps/client/src/voice/`; the `livekit-client` import never enters `packages/shared` or `apps/server`.
- The spectator entry point is a per-concern UI peer of the existing `VoiceController` under `apps/client/src/ui/`.
- No server/shared structure change — the room topology + listen-only grant already exist (3.1/3.2).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Client state:** Zustand; voice status is display-rate so reactive selectors in display components are fine — keep `voiceStore` separate from `gameStore`; never read `voiceStore` from a game reducer.
- **Socket.IO / Shared Types:** typed `ClientToServerEvents` only; `socket.emit(string, any)` forbidden. `VOICE_TOKEN` is already typed — reuse it (empty payload).
- **R3F / components rendering-only:** zero game logic in components; the listen-only connect logic lives in `voice/connectVoice.ts`, not JSX.
- **Media disposal:** the browser does not GC LiveKit tracks/audio elements — dispose on unmount (the existing teardown does).
- **Voice / LiveKit gotchas:** the Spectator Lounge is a one-way listen path; spectators must never publish into the Bomb Room (grant-enforced by 3.1 — AC #3). Request a fresh token per connect, never cache/reuse (sets up 3.5; the controller already does). Tokens are re-minted on role change (3.5), not here.
- **Security:** never hardcode LiveKit keys/URL on the client — `url` comes from the `VOICE_TOKEN` ack. Never log the token.
- **Build:** `tsc --noEmit` zero errors; no `@ts-ignore`; TypeScript only.
- **WebRTC infra:** the dev override (`docker-compose.override.yml` + `Caddyfile.dev` + `livekit.dev.yaml`) encodes the WSL2 five fixes from 3.2's human-verify; bring the stack up with `docker compose up -d --build -p ktane-s5-voice` and confirm `.dev` files are mounted. Provision the gitignored worktree `.env` with a ≥32-char `LIVEKIT_API_SECRET`. ([[livekit-wsl2-localhost-voice-verification]], [[worktree-fullstack-testing-gap]])

### Continuity from Story 3.2 (read its Completion Notes / Review)

- 3.2 built `connectVoice.ts` as a `createVoiceController(deps)` factory (DI'd `createRoom` + `requestToken`) + a default singleton bound to `connectVoice`/`disconnectVoice` — exercise the listen-only path through the factory with a faked `Room`/stubbed ack.
- 3.2's review added a `connectEpoch` guard so a teardown mid-connect disposes the room instead of orphaning a live SFU connection + hot mic. **Your `publish` change must not break the epoch guard** — keep the post-await epoch re-checks intact (a listen-only connect has no mic to leak, but the room-leak guard still applies).
- 3.2 surfaced (NOTE for 3.6): a mic-denied Bomb Room participant gets no voice at all, not even listen-only. That subscribe-only fallback is a 3.6 concern — but note 3.3's listen-only connect mode is exactly the reusable primitive 3.6 could lean on.
- The first SFU integration needed several env/infra fixes (browser-reachable `LIVEKIT_URL`, SFU v1.13.1, http origin, ≥32-char secret, dev override). These are committed in the worktree as the dev override — reuse them; do not re-derive.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 3.3: Spectator Lounge Listen-Only Channel] — user story + ACs (spectator hears the lounge as listen-only; publish denied at the token-grant level, not the UI).
- [Source: _agent_docs/planning-artifacts/epics.md] — FR38 (two channels), FR39 (spectator listen-only, token-grant enforced), AR12 / NFR3 (voice independent; playable if voice drops).
- [Source: _agent_docs/implementation-artifacts/3-1-role-scoped-livekit-token-minting.md] — `VOICE_TOKEN` contract + `resolveVoiceScope` (spectator → lounge, `canPublish: false`); facilitator→lounge decision.
- [Source: _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md] — the client connection layer (`connectVoice.ts`), `voiceStore`, the load-bearing independence test, the WSL2 five-fix human-verify + dev override.
- [Source: apps/server/src/voice/mintToken.ts#resolveVoiceScope] — the spectator branch (`spectator-lounge`, `canPublish: role === 'facilitator'` ⇒ false for spectator). AC #3 already satisfied; READ ONLY.
- [Source: apps/client/src/voice/connectVoice.ts] — room-agnostic controller; the unconditional `setMicrophoneEnabled(true)` is the ONLY line to gate behind `publish`.
- [Source: apps/client/src/ui/VoiceController.tsx] — Bomb Room affordance (returns null for spectator today); the pattern to extend/mirror for listen-only.
- [Source: apps/client/src/ui/ActiveRound.tsx] — spectator placeholder (`WATCHING_THE_BOMB_ROOM`) + existing `<VoiceController />` mount.
- [Source: apps/client/src/store/voiceStore.ts] — status + room/identity/error + activeSpeakers; already sufficient.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Flow 4] — "Listen-only voice — he hears the Bomb Room but cannot speak in." (lounge microcopy intent).
- [Source: _agent_docs/project-context.md#Voice / LiveKit Gotchas, #Socket.IO / Shared Types, #Security] — listen-only path, typed events, no-secret-logging.
- [Source: livekit-client 2.x — Room/RoomEvent/track.attach()/setMicrophoneEnabled] — https://docs.livekit.io/reference/client-sdk-js/

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- Client unit suite: `apps/client` `vitest run` → **38 files, 315/315 passing** (incl. `connectVoice.test.ts` 25/25 — 20 prior + 5 new 3.3 tests).
- Typecheck: `pnpm -r exec tsc --noEmit` → exit 0 (all workspaces). No `@ts-ignore` added.
- Worktree had no `node_modules` on entry — ran `pnpm install` (575 pkgs) before tests ([[worktree-fullstack-testing-gap]]).

### Completion Notes List

**Scope (CLIENT-ONLY, as the story specifies):** the server already routes a spectator to `spectator-lounge:{sessionId}` with `canPublish: false` (3.1/3.2). No server/shared file touched.

- **AC #3 (verify-only):** confirmed `apps/server/src/voice/mintToken.ts:115-123` — spectator → `spectator-lounge`, `canPublish: role === 'facilitator'` (⇒ false), `canSubscribe: true`. Listen-only is grant-enforced. Left untouched (incl. the intentional lobby-phase `canPublish: true` exception).
- **AC #1/#2 (the real delta):** added a `publish = true` flag to `connect()` in `connectVoice.ts`; the `setMicrophoneEnabled(true)` call is now guarded `if (publish)`. A spectator connects with `publish: false`, so `getUserMedia` is **never invoked** → no mic-permission prompt, while remote audio is still subscribed + attached (the spectator HEARS the lounge). Controller stays role-agnostic and trusts the token's room; no `livekit-client` import or `gameStore` write leaked out.
- **AC #4 (independence):** the listen-only path writes ONLY `voiceStore`. New tests assert `gameStore` byte-identical across the `publish:false` path on both success and failure (failure → `unavailable`, game keeps running).
- **AC #5 (teardown):** reuses the existing `disconnectVoice()` — a subscribe-only connect has no local track to release (`setMicrophoneEnabled(false)` stays a harmless no-op). Test confirms connect→disconnect removes the audio element, unbinds every listener, `room.disconnect()`s, and a reconnect mints a fresh token. The 3.2 `connectEpoch` guard is intact (a listen-only connect has no mic to leak, but the room-leak guard still applies).
- **AC #6 (microcopy):** chose **shape (a)** — extended `VoiceController` (already mounted in `ActiveRound` for all roles, so zero new mount). Spectators get lounge copy (`VOICE_LOUNGE_*` = "Listen to the Bomb Room" / "Connecting to the Bomb Room…" / "Listening to the Bomb Room.") + the shared dismissible `VOICE_UNAVAILABLE`. No speaker pill, no mute toggle (Story 3.4). Bomb Room branch unchanged.

**Test coverage:** +5 tests in `connectVoice.test.ts` — (1) `publish:false` never calls `setMicrophoneEnabled` yet still subscribes/plays + reaches `connected`; (2) independence on success; (3) independence on failure; (4) subscribe-only teardown/no-leak; (5) reconnect mints a fresh token.

**Worktree env prep (Task 6, infra portion):** provisioned the gitignored `.env` — its `LIVEKIT_API_SECRET` was `devsecret` (9 chars), which LiveKit rejects; bumped to a 45-char dev secret (WSL2 five-fix #5, [[livekit-wsl2-localhost-voice-verification]]). Both the SFU (`LIVEKIT_KEYS`) and the server (`env_file: .env`) read the same `.env` secret, so they stay in sync. The dev override (`docker-compose.override.yml` → `livekit.dev.yaml` + `Caddyfile.dev`) auto-applies on a bare `docker compose up` and already encodes the other four fixes.

**⏸ HALT — Task 6 human-verify is OUTSTANDING (story stays in-progress, NOT review):** Docker Desktop's daemon is not currently reachable (`docker info` fails; only `desktop-linux` context exists, engine stopped), so I could not bring the stack up or run the two-browser check. Per [[human-verification-ac-rule]] the story is NOT done until Jay's observed result is recorded. **Jay, to finish 3.3:**
1. Start Docker Desktop, then from `/home/jiawei/Ktane-s5-voice` run: `docker compose -p ktane-s5-voice up -d --build` (worktree-scoped project name avoids colliding with the main stack / the epic8 worktree). Confirm `.dev` files are mounted: `docker compose -p ktane-s5-voice config | grep -E 'livekit.dev.yaml|Caddyfile.dev'`, and all services healthy.
2. Open TWO browser sessions: one as **Defuser/Expert** (Bomb Room, connect voice + talk), one as **Spectator** (click "Listen to the Bomb Room").
3. Verify and report back: (a) the **Spectator HEARS the Bomb Room** audio (no reload), (b) connecting as Spectator shows **NO mic-permission prompt** and there is no way to publish, (c) killing the LiveKit container leaves BOTH clients fully able to keep playing. I'll record your observed result here and flip the story to `review`.

### File List

- `apps/client/src/voice/connectVoice.ts` (UPDATE) — added `publish = true` param to `connect()`; guarded the mic publish behind it; threaded through exported `connectVoice({ publish })`.
- `apps/client/src/ui/VoiceController.tsx` (UPDATE) — shape (a): added the spectator listen-only mode (mode-gated CTA/microcopy + `connectVoice({ publish: false })`); Bomb Room branch unchanged.
- `apps/client/src/ui/copy.ts` (UPDATE) — added `VOICE_LOUNGE_CTA` / `VOICE_LOUNGE_CONNECTING` / `VOICE_LOUNGE_CONNECTED`.
- `apps/client/src/voice/__tests__/connectVoice.test.ts` (UPDATE) — +5 listen-only / independence / teardown / reconnect tests.
- `_agent_docs/implementation-artifacts/sprint-status.yaml` (UPDATE) — 3-3 → in-progress.
- `.env` (UPDATE, gitignored — not in git status) — `LIVEKIT_API_SECRET` bumped to ≥32 chars for the WSL2 voice check.
- No files under `apps/server/` or `packages/shared/` — server/shared already done in 3.1/3.2.

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-20 | Tasks 1–5 implemented (client-only): `publish` flag in `connectVoice.ts` (spectator → no mic prompt), spectator listen-only mode in `VoiceController` + lounge microcopy, +5 tests. Client suite 315/315, `tsc --noEmit` clean. Worktree `.env` LiveKit secret bumped to ≥32 chars. Task 6 human-verify OUTSTANDING (Docker daemon down) — story remains `in-progress` pending Jay's two-browser check. |
| 2026-06-19 | Story 3.3 created (ready-for-dev): CLIENT-ONLY spectator listen-only voice. Server grant (spectator → `spectator-lounge`, `canPublish: false`) already shipped in 3.1/3.2 — AC #3 verify-only. Client delta = a `publish` flag in `connectVoice.ts` (skip `setMicrophoneEnabled` for spectators → no mic prompt) + a spectator-facing listen-only affordance with lounge microcopy + tests + the real-container "spectator hears but cannot talk" human-verify (WSL2 five-fix dev override). |
