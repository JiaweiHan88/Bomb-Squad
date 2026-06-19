---
baseline_commit: bbecffcbf149624162cf2cb51c2cec1cbc8e38ff
context:
  - _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md
  - _agent_docs/implementation-artifacts/3-3-spectator-lounge-listen-only-channel.md
  - _agent_docs/implementation-artifacts/3-4-speaker-indicator-and-mute-controls.md
  - _agent_docs/implementation-artifacts/deferred-work.md
  - _agent_docs/project-context.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md
---

# Story 3.6: Graceful Voice Degradation

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the game to keep working if voice drops,
so that a WebRTC failure never blocks play.

## Acceptance Criteria

1. **Given** voice fails to connect OR drops mid-session, **When** the failure is detected, **Then** the voice surface renders a **dismissible banner** reading exactly **"Voice unavailable — game continues without it"** (`VOICE_UNAVAILABLE`), and **all game UI remains fully interactive** — no modal, no game-state gate, no blocked phase. The banner is dismissible; dismissing it MUST NOT remove the player's ability to re-attempt voice (AC #2 reconnect affordance). _(FR40; epic AC1; EXPERIENCE.md "voice lost: dismissible banner"; AR12 / ADR-007 — voice never blocks game state.)_
2. **Given** a player whose voice is in the `unavailable` state (failed connect or mid-session drop), **When** they want voice back, **Then** a **reconnect affordance** is available (a "Reconnect voice" control) that re-runs the existing `connectVoice({ publish })` path with a **fresh token** — there is NO automatic exponential-backoff/retry loop in this story (that hardening is Story 10-3). The reconnect uses the same role-gated mode (Bomb Room publish vs Spectator listen-only) the player already had. _(graceful-degradation polish; 3.4 Dev Notes "reconnect/backoff … → 3.6"; manual reconnect only.)_
3. **Given** a participant joining voice (corporate-NAT path), **When** the client connects to LiveKit, **Then** the `VOICE_TOKEN` grant carries **TURN ICE servers** (a `turn:` relay with short-TTL TURN-REST credentials derived server-side from `TURN_SECRET`) and the client passes them to `room.connect(...)` via `rtcConfig.iceServers`, so that when direct/STUN paths fail the connection is **attempted via the TURN relay path** (coturn). When no TURN is configured (`TURN_URL` unset), the grant omits `iceServers` and the client connects exactly as today (no regression). _(FR40 "graceful degradation"; epic AC2; Architecture Pattern 7 / ADR-007; deferred-work.md:48 coturn `--external-ip`.)_
4. **Given** the coturn service, **When** it advertises a relay allocation, **Then** its external address is **env-driven** (`--external-ip=${TURN_EXTERNAL_IP}`) so `XOR-RELAYED-ADDRESS` is a routable host IP rather than the container-internal RFC1918 address. `TURN_EXTERNAL_IP` is optional/empty-tolerant (an unset value must not break the localhost dev stack, where relay over loopback works without it). _(deferred-work.md:48 — "Resolve in the voice stories: env-driven `--external-ip=${TURN_EXTERNAL_IP}`".)_
5. **Given** the voice "connecting" UI, **When** voice is establishing, **Then** its microcopy is **visibly distinct from the game-socket connecting state** — voice uses the role-specific `VOICE_CONNECTING` ("Connecting to Bomb Room…") / `VOICE_LOUNGE_CONNECTING` ("Connecting to the Bomb Room…"), NOT the generic game-socket `CONNECTING` ("Connecting…"). _(epic AC2 "connecting microcopy is distinct from the game-socket connecting state"; already established in 3.2/3.3 — verify + keep distinct.)_
6. **Given** a participant whose `room.connect()` succeeded but whose **remote audio autoplay was blocked by the browser** (`room.startAudio()` rejected), **When** the in-round surface renders, **Then** a **"click to enable audio" affordance** is shown so they can resume playback with a gesture; clicking it calls `room.startAudio()` again and dismisses the affordance on success. This is purely additive playback recovery — the participant is still `connected` and the game is unaffected. _(deferred-work.md:190 — "The full 'click to enable audio' affordance is explicitly Story 3.6"; AR12 non-blocking.)_
7. **Given** the voice subsystem under any failure (token error, connect rejection, mid-session drop, blocked autoplay, TURN-only path), **When** it degrades, **Then** it writes **only** `voiceStore` — no `gameStore` write, no game-socket emit, no phase gate. The game (bomb timer, modules, socket events, scoreboard) stays fully playable. _(AR12 / ADR-007 / NFR3 — same independence invariant proven in 3.2/3.3/3.4; the load-bearing `gameStore`-byte-identical test is extended to cover reconnect + startAudio paths.)_
8. **Given** the real LiveKit **and coturn** containers, **When** Jay runs the interactive check, **Then**: (a) killing the LiveKit container mid-session shows the dismissible "Voice unavailable…" banner and **both clients keep playing**, and the **Reconnect voice** control brings voice back after the container returns; (b) with the client forced onto the relay path (`iceTransportPolicy: 'relay'`, dev toggle), two Bomb Room participants **still hear each other** — proving media actually traverses coturn (verify a `typ relay` candidate / coturn relay log); (c) the voice "connecting" copy is visibly different from the game-socket "Connecting…"; (d) if autoplay is blocked, the "click to enable audio" affordance restores sound. Result recorded in Completion Notes. _(human-verification rule; NFR3; deferred-work.md:186 "verify voice only against real LiveKit + coturn containers"; [[livekit-wsl2-localhost-voice-verification]], [[human-verification-ac-rule]].)_

## Tasks / Subtasks

- [x] **Task 1 — Server: mint TURN ICE servers into the `VOICE_TOKEN` grant (AC: #3)**
  - [x] NEW pure module `apps/server/src/voice/turnCredentials.ts`. Read `apps/server/src/voice/mintToken.ts` FIRST to mirror its pure/injected style (no `process.env`, no I/O — caller injects config). Export `mintTurnIceServers(opts: { turnUrl?: string; turnSecret: string; identity: string; ttlSeconds: number; nowSeconds: number }): IceServer[] | undefined`. When `turnUrl` is empty/undefined → return `undefined` (TURN not configured; no regression). Otherwise compute **coturn `--use-auth-secret` TURN-REST credentials**: `username = `${nowSeconds + ttlSeconds}:${identity}``; `credential = createHmac('sha1', turnSecret).update(username).digest('base64')` (Node `crypto`). Return one ICE server: `{ urls: [`${turnUrl}?transport=udp`, `${turnUrl}?transport=tcp`], username, credential }` where `turnUrl` is a full `turn:host:3478` URI. Inject `nowSeconds` (do NOT call `Date.now()` inside — keeps it pure + testable, mirroring the seed-chain/reducer purity rule).
  - [x] Define the shared `IceServer` shape in `packages/shared/src/events/payloads.ts` (next to `VoiceTokenGrantPayload`): `{ urls: string[]; username?: string; credential?: string }` (mirrors the WebRTC `RTCIceServer`). Export it from `packages/shared/src/events/index.ts`. Add an **optional** `iceServers?: IceServer[]` field to `VoiceTokenGrantPayload`. Optional so a TURN-less config omits it and the client path is unchanged. **NEVER log `credential`** (same secret-handling rule as the token).
  - [x] `apps/server/src/config/env.ts`: add **`TURN_URL`** (optional, browser-reachable `turn:host:3478` URI — like `LIVEKIT_URL`, this is handed to the BROWSER, so it must be client-reachable, not a compose service name) to the schema as a **nullable/optional** field (absent ⇒ no TURN). Reuse the already-validated `TURN_SECRET` + `TURN_TTL`. Add `TURN_URL` to `.env.example` (commented, with the localhost dev value `turn:localhost:3478`) and the `Config` type.
  - [x] `apps/server/src/handlers/voiceHandlers.ts`: extend `VoiceConfig` with `TURN_URL?: string` + `TURN_SECRET: string` (it already receives `TURN_TTL`). After `mintVoiceToken(...)`, call `mintTurnIceServers({ turnUrl: config.TURN_URL, turnSecret: config.TURN_SECRET, identity: playerId, ttlSeconds, nowSeconds: Math.floor(Date.now()/1000) })` and attach the result to the grant as `iceServers` (only when defined). Keep the handler's read-only/no-game-write contract. Confirm `apps/server/src/index.ts` passes `TURN_URL`/`TURN_SECRET` through to `registerVoiceHandlers` (it already passes `TURN_TTL`).

- [x] **Task 2 — Client: pass TURN `rtcConfig` to `room.connect()` (AC: #3, #8b)**
  - [x] Read `apps/client/src/voice/connectVoice.ts` in full FIRST — it is the SOLE `livekit-client` import site and writes ONLY `voiceStore`. The `VoiceRoom` interface (≈ line 51) currently declares `connect(url, token)`. Widen it to `connect(url: string, token: string, options?: RoomConnectOptions)` and have the default `createRoom` adapter pass options through to the real `room.connect(url, token, options)`. Thread the grant's `iceServers` from `requestVoiceToken`'s ack into the connect call as `{ rtcConfig: { iceServers } }` (only when present). `livekit-client@2.19.x` accepts `rtcConfig` on `RoomConnectOptions`.
  - [x] Add a **dev-only force-relay toggle** for human-verify: read `import.meta.env.VITE_FORCE_TURN_RELAY` (or a `?relay` query param) and, when set, pass `rtcConfig.iceTransportPolicy = 'relay'` so ALL media is forced through coturn (proves the relay path actually works). MUST default OFF in production builds. Document the toggle in Dev Notes + the human-verify steps.
  - [x] Do NOT change the failure handling: a connect rejection (incl. a relay-only path that can't reach coturn) still goes `unavailable` via the existing catch. Keep the `connectEpoch` guard, the `published` capture (3.4), and the listen-only (`publish: false`, 3.3) behavior intact.

- [x] **Task 3 — Client: blocked-autoplay "click to enable audio" affordance (AC: #6, #7)**
  - [x] `voiceStore.ts`: add an `audioBlocked: boolean` field (default `false`) + `setAudioBlocked(blocked: boolean)` action. Clear it to `false` on every non-connected transition (`setConnecting`/`setUnavailable`/`reset`) exactly like `activeSpeakers`/`muted` are cleared (mirror the 3.4 pattern). Keep `voiceStore` the SOLE home — no `gameStore` field.
  - [x] `connectVoice.ts`: today `void r.startAudio().catch(() => undefined)` (≈ line 333) silently swallows a blocked-autoplay rejection (deferred-work.md:190). Change it to set `useVoiceStore.getState().setAudioBlocked(true)` on rejection (still never throwing, still not failing the connection). Add a controller method `resumeAudio()` (+ exported singleton `resumeVoiceAudio`) that, only when `phase === 'connected'`, calls `await room.startAudio()` and on success sets `setAudioBlocked(false)`; on failure leaves it `true` (try/catch, never throws). Also subscribe to LiveKit `RoomEvent.AudioPlaybackStatusChanged` if convenient to clear the flag when playback resumes on its own — optional; the explicit affordance is the deliverable.
  - [x] NEW `apps/client/src/ui/AudioUnblockPrompt.tsx` — rendering-only; renders ONLY when `voiceStore.status === 'connected' && voiceStore.audioBlocked`. A gesture-driven control calling `resumeVoiceAudio()`; accessible label (never icon-only). Mount it in `ActiveRound.tsx` inside the existing relative HUD wrapper (a corner that doesn't collide with pill top-left / mute bottom-left / connect CTA bottom-right). Export from `ui/index.ts`.

- [x] **Task 4 — Client: dismissible banner + Reconnect affordance polish (AC: #1, #2, #5, #7)**
  - [x] Read `apps/client/src/ui/VoiceController.tsx` in full FIRST. The `unavailable` branch (≈ lines 100-111) already renders the dismissible `VOICE_UNAVAILABLE` + `VOICE_DISMISS`. Add a **"Reconnect voice"** control inside that same `unavailable` branch (alongside Dismiss) that calls `connectVoice({ publish })` — reusing the already-computed `publish`/mode for this role. After dismiss, the banner hides but reconnect must stay reachable: keep the Reconnect control rendered in the `unavailable` state even when the text banner is dismissed (e.g. dismissing hides the message line, not the reconnect button) — closing AC #1's "dismissing must not strip the ability to re-attempt voice."
  - [x] Add `VOICE_RECONNECT = 'Reconnect voice'` to `apps/client/src/ui/copy.ts` (dry/deadpan operator voice, consistent with the existing `VOICE_*` strings). Reuse the existing `VOICE_UNAVAILABLE`/`VOICE_DISMISS`.
  - [x] **Verify (don't rebuild) AC #5 distinctness:** confirm the `connecting` branch uses `VOICE_CONNECTING`/`VOICE_LOUNGE_CONNECTING` (role-specific) and never the generic game-socket `CONNECTING`. No change expected — this is a guard against regressing the distinct-microcopy AC.
  - [x] Keep `VoiceController` rendering-only (project-context: components zero game logic — connect/reconnect logic stays in `connectVoice.ts`). No `gameStore` write anywhere in this component beyond the existing read-only selectors.

- [x] **Task 5 — Infra: env-driven coturn `--external-ip` (AC: #4)**
  - [x] `docker-compose.yml` coturn service: append an env-driven `--external-ip=${TURN_EXTERNAL_IP}` arg to the `command` list. Empty-tolerant: an unset `TURN_EXTERNAL_IP` must not wedge the localhost dev stack (relay over loopback works without it). Prefer a form that is a no-op when empty — e.g. gate it so an empty value doesn't pass a malformed `--external-ip=` (document the chosen approach; a wrapper/entrypoint or `${TURN_EXTERNAL_IP:+--external-ip=$TURN_EXTERNAL_IP}` semantics). Keep the rest of the coturn command (auth-secret, realm, port range, fingerprint, TLS hardening) unchanged.
  - [x] `.env.example`: add `TURN_EXTERNAL_IP=` (commented; "host public IP, deploy-time value; leave empty for localhost dev") and `TURN_URL=turn:localhost:3478` (commented; browser-reachable). Note in a comment that `TURN_URL`'s host must be reachable FROM THE BROWSER (same caveat as `LIVEKIT_URL`).
  - [x] Update `_agent_docs/implementation-artifacts/deferred-work.md`: mark the coturn `--external-ip` item (line ~48) resolved by this story (or strike it), per the workflow's "resolve in the voice stories" instruction.

- [x] **Task 6 — Tests (AC: #1, #2, #3, #6, #7)**
  - [x] **`turnCredentials` (server, pure):** `mintTurnIceServers` returns `undefined` when `turnUrl` is empty; with a `turnUrl` it returns one ICE server whose `username` is `${now+ttl}:${identity}` and `credential` is the base64 HMAC-SHA1 of that username under `turnSecret` (assert against an independently computed digest), and `urls` includes both `?transport=udp` and `?transport=tcp`. (Vitest, `apps/server`.)
  - [x] **`voiceHandlers` grant:** with `TURN_URL` set, the `VOICE_TOKEN` ack grant includes `iceServers`; with `TURN_URL` unset, the grant has NO `iceServers` key (no regression). Assert the token/credential are still never logged. (Extend `apps/server/src/handlers/__tests__/voiceHandlers.test.ts`.)
  - [x] **`connectVoice` rtcConfig:** with a faked `Room`, a grant carrying `iceServers` makes `connect()` receive `{ rtcConfig: { iceServers } }`; a grant WITHOUT `iceServers` calls `connect(url, token)` with no rtcConfig (or `undefined`) — no crash. The force-relay toggle, when set, adds `iceTransportPolicy: 'relay'`. (Extend `apps/client/src/voice/__tests__/connectVoice.test.ts`.)
  - [x] **`audioBlocked` + `resumeAudio`:** a rejected `startAudio()` on connect sets `voiceStore.audioBlocked === true` (connection still succeeds → `connected`); `resumeVoiceAudio()` calls `room.startAudio()` and clears the flag on success, leaves it set on failure, and never throws; `audioBlocked` is cleared on `setConnecting`/`setUnavailable`/`reset`. (Extend `voiceStore` + `connectVoice` tests.)
  - [x] **Reconnect + independence:** from `unavailable`, the Reconnect control re-invokes `connectVoice({ publish })` with the role's mode; the load-bearing independence test stays green — `useGameStore.getState()` byte-identical across a failure → reconnect → `startAudio` cycle (extend the existing "voice never mutates gameStore" assertion to cover the new paths). `AudioUnblockPrompt` renders only when `connected && audioBlocked`. `tsc --noEmit` green across workspaces; full client + server suites stay green (3.4 left client at **335/335**).

- [ ] **Task 7 — Worktree env + the real-container degradation/relay verification (AC: #8) — Jay verifies**
  - [ ] **WSL2/Docker voice five-fix checklist** ([[livekit-wsl2-localhost-voice-verification]], [[worktree-fullstack-testing-gap]]): bring up the FULL stack against the **real LiveKit AND coturn containers** (do NOT mock — AR16, deferred-work.md:186). Worktree `.env` must carry a **≥32-char** `LIVEKIT_API_SECRET` (3.3/3.4 already bumped it — confirm), plus `TURN_URL=turn:localhost:3478`, a non-default `TURN_SECRET` (matches coturn's `--static-auth-secret`), and `TURN_EXTERNAL_IP` empty for localhost. Run `docker compose -p ktane-s5-voice up -d --build` (worktree-scoped project name). Confirm dev overrides mounted (`docker compose -p ktane-s5-voice config | grep -E 'livekit.dev.yaml|Caddyfile.dev'`) and all services healthy (incl. coturn).
  - [ ] **Jay verifies interactively:** (a) **Drop + reconnect:** two Defuser/Expert on a team, both on voice; `docker compose -p ktane-s5-voice stop livekit` → both see the dismissible "Voice unavailable — game continues without it" banner AND keep playing (timer/modules/socket all live); `start livekit` → click **Reconnect voice** → voice returns. (b) **Relay path:** with `VITE_FORCE_TURN_RELAY=1` (or `?relay`) both clients connect and **still hear each other**, and a `typ relay` ICE candidate appears (chrome://webrtc-internals) / coturn logs a relay allocation — proving media traverses coturn. (c) **Distinct copy:** voice "Connecting to Bomb Room…" is visibly different from the game-socket "Connecting…". (d) **Autoplay:** if a tab blocks autoplay, the "click to enable audio" prompt restores sound.
  - [ ] Record the observed result (banner + game-continues, reconnect works, relay candidate seen, distinct copy, audio-unblock) in Completion Notes — the story is NOT done until Jay's observed result is written down. ([[human-verification-ac-rule]])

## Dev Notes

### What this story is (and is NOT) — READ THIS FIRST

3.6 closes Epic 3's voice work with **graceful degradation**: keep the game fully playable when voice fails, and make the TURN relay path real (it is currently dead code). Three concrete deltas, two of which are mostly plumbing on top of what 3.2–3.4 already built:

1. **Degradation banner + Reconnect (AC #1, #2, #5)** — the dismissible "Voice unavailable…" banner and the role-specific connecting microcopy **already exist** (`VoiceController.tsx` + `copy.ts`, built incidentally in 3.2/3.3). The only real gap: after a drop, dismissing the banner leaves the player with **no way back to voice**. Add a **manual "Reconnect voice"** control. No auto-backoff (that's 10-3).
2. **TURN relay wiring (AC #3, #4)** — coturn runs (`docker-compose.yml`) but **LiveKit/the client never use it**: `livekit.yaml` has no `turn:` block, the grant has no `iceServers`, and coturn lacks `--external-ip`. Wire it end-to-end: server mints ephemeral **TURN-REST** creds from the existing `TURN_SECRET`, ships them in the `VOICE_TOKEN` grant as `iceServers`, the client passes them as `rtcConfig.iceServers` to `room.connect()`, and coturn gets an env-driven `--external-ip`. This is the meat of the story.
3. **Blocked-autoplay affordance (AC #6)** — deferred-work.md:190 explicitly assigns the "click to enable audio" recovery to 3.6. Today `room.startAudio()` rejection is silently swallowed, so a participant can show `connected` yet hear nothing. Surface a click-to-resume prompt.

**Explicitly NOT in this story (Story 10-3 / later):**
- **Auto reconnect/backoff with jitter, symmetric-NAT hardening, TLS `turns://` on 443.** 3.6 ships plaintext `turn:host:3478` (UDP+TCP) + a manual Reconnect. Robust corporate-NAT traversal is **Story 10-3** ("WebRTC reliability behind symmetric NAT", sprint-status `10-3-webrtc-reliability-behind-symmetric-nat`).
- **LiveKit's own `use_external_ip`/UDP-mux production tuning** (`livekit.yaml` comment "Robust NAT/TURN traversal is Story 10-3"). Do NOT flip `use_external_ip` here; the dev override (`livekit.dev.yaml`, `udp_port: 0`, `node_ip: 127.0.0.1`) stays as-is.
- **Token re-mint on role change → Story 3.5.** 3.6 does not change role→room→grant routing; it only ADDS `iceServers` to the existing grant.
- **Any new game-socket event / game-state coupling.** Everything degradation-related lives in `voiceStore` + `connectVoice` (AR12 / ADR-007).

### The real subtleties

1. **coturn `--use-auth-secret` ⇒ TURN-REST ephemeral credentials, not static creds.** coturn is started with `--use-auth-secret --static-auth-secret=${TURN_SECRET}`. That enables the **TURN REST API** mechanism: the client's TURN `username` is `<unix-expiry>[:<id>]` and the `credential` is `base64(HMAC_SHA1(TURN_SECRET, username))`. The server already holds `TURN_SECRET` (validated in `config/env.ts`) — so it can mint short-lived TURN creds **without any coturn round-trip**. Bound the expiry by the same `ttlSeconds` already used for the LiveKit token (capped at `MAX_VOICE_TOKEN_TTL_S`). The `credential` is a secret — **never log it** (same rule as the LiveKit token).
2. **`TURN_URL` is a BROWSER target, exactly like `LIVEKIT_URL`.** The server never dials TURN; it only hands the URI to the client. So `TURN_URL` must be **client-reachable** — `turn:localhost:3478` in WSL2 dev, a public `turn:host:3478` in prod. A compose service name (`turn:coturn:3478`) is unresolvable in a browser (same trap documented for `LIVEKIT_URL` in `docker-compose.yml` lines 119-124). Keep it OPTIONAL: unset ⇒ grant omits `iceServers` ⇒ client connects exactly as today (zero regression, and most dev runs don't need explicit TURN because loopback ICE already works).
3. **Verifying the relay actually carries media needs a force-relay toggle.** With default ICE, the browser will almost always pick a direct/host candidate on localhost and never touch coturn — so "TURN is wired" looks identical to "TURN is dead." The only honest proof is `iceTransportPolicy: 'relay'` (dev toggle), which forbids host/srflx candidates and forces media through coturn. If audio still flows under forced relay, the relay path is real. This toggle MUST be dev-only (default off in prod).
4. **`audioBlocked` is not a failure — keep it orthogonal to `status`.** A blocked-autoplay participant is genuinely `connected` (transport up, tracks subscribed) but silent. Model it as a SEPARATE `voiceStore.audioBlocked` flag, NOT a new `status` value, so it composes with `connected` and never trips the `unavailable` banner. Clear it on any disconnect transition (mirror `activeSpeakers`/`muted`).

### Critical architectural constraint — voice never gates game state (unchanged from 3.2/3.3/3.4)

AR12 + ADR-007 + Architecture Pattern 7: voice is an **independent subsystem that never blocks game state**.
- All new state (`audioBlocked`, the reconnect trigger, ICE servers) lives in `voiceStore` / `connectVoice` ONLY. `connectVoice` must not import or write `useGameStore`; components may *read* `gameStore` (roster/self/mode) at the render layer only.
- No degradation path emits a game-socket event or flips `gameStore.connection`/blocks a phase. The load-bearing test (assert `gameStore` byte-identical across the failure→reconnect→startAudio cycle) is how we prove it — extend the existing one from 3.2/3.4.
- The grant's `iceServers` is the ONLY server-side change, and it is read-only/no-game-write — `voiceHandlers` keeps its 3.1 contract (resolve requester from authoritative state, mint, ack; never mutate session state).

### Files to touch

- **NEW** `apps/server/src/voice/turnCredentials.ts` — pure `mintTurnIceServers` (TURN-REST HMAC-SHA1 creds; `nowSeconds` injected; `undefined` when no `turnUrl`).
- **UPDATE** `packages/shared/src/events/payloads.ts` — `IceServer` type + optional `iceServers?: IceServer[]` on `VoiceTokenGrantPayload`.
- **UPDATE** `packages/shared/src/events/index.ts` — export `IceServer`.
- **UPDATE** `apps/server/src/config/env.ts` — optional `TURN_URL` (+ `Config` type); reuse `TURN_SECRET`/`TURN_TTL`.
- **UPDATE** `apps/server/src/handlers/voiceHandlers.ts` — `VoiceConfig` gains `TURN_URL?`/`TURN_SECRET`; attach `iceServers` to the grant via `mintTurnIceServers`.
- **UPDATE** `apps/server/src/index.ts` — thread `TURN_URL`/`TURN_SECRET` into `registerVoiceHandlers` (already passes `TURN_TTL`).
- **UPDATE** `apps/client/src/store/voiceStore.ts` — `audioBlocked: boolean` (default false) + `setAudioBlocked`; clear on `setConnecting`/`setUnavailable`/`reset`.
- **UPDATE** `apps/client/src/voice/connectVoice.ts` — widen `VoiceRoom.connect` to accept `RoomConnectOptions`; thread grant `iceServers` → `rtcConfig.iceServers`; dev force-relay toggle; set `audioBlocked` on blocked `startAudio()`; add `resumeAudio`/`resumeVoiceAudio`. Stays the SOLE `livekit-client` site.
- **NEW** `apps/client/src/ui/AudioUnblockPrompt.tsx` — renders only when `connected && audioBlocked`; calls `resumeVoiceAudio()`.
- **UPDATE** `apps/client/src/ui/VoiceController.tsx` — add "Reconnect voice" control in the `unavailable` branch (survives banner dismiss); verify connecting copy stays role-specific.
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount `<AudioUnblockPrompt />` in the relative HUD wrapper (corner clear of pill/mute/CTA).
- **UPDATE** `apps/client/src/ui/copy.ts` — add `VOICE_RECONNECT`.
- **UPDATE** `apps/client/src/ui/index.ts` — export `AudioUnblockPrompt`.
- **UPDATE** `docker-compose.yml` — coturn `--external-ip=${TURN_EXTERNAL_IP}` (empty-tolerant).
- **UPDATE** `.env.example` — `TURN_URL` (commented, `turn:localhost:3478`) + `TURN_EXTERNAL_IP=` (commented).
- **UPDATE** `_agent_docs/implementation-artifacts/deferred-work.md` — mark the coturn `--external-ip` item (line ~48) resolved.
- **UPDATE** tests: `apps/server/src/voice/__tests__/turnCredentials.test.ts` (NEW), `apps/server/src/handlers/__tests__/voiceHandlers.test.ts`, `apps/client/src/voice/__tests__/connectVoice.test.ts`, `apps/client/src/store/__tests__/voiceStore.test.ts`, plus a light `AudioUnblockPrompt`/`VoiceController` reconnect render test.

Read these existing files before editing (current behavior you must not break):
- `apps/client/src/voice/connectVoice.ts` — the `createVoiceController` factory + singletons; the `VoiceRoom` interface `connect(url, token)` (≈ line 51) to widen; the `connectEpoch` guard; `published` capture (3.4); the swallowed `startAudio()` (≈ line 333) to change; the catch → `setUnavailable` path to leave intact.
- `apps/client/src/store/voiceStore.ts` — the store; how `activeSpeakers`/`muted` are cleared on non-connected transitions (mirror for `audioBlocked`).
- `apps/client/src/ui/VoiceController.tsx` — the existing `unavailable` dismissible branch (lines 100-111) + the role/mode resolution (`publish`, `VOICE_*` copy) to reuse for Reconnect.
- `apps/server/src/handlers/voiceHandlers.ts` — the grant assembly (lines 124-135) where `iceServers` attaches; the `MAX_VOICE_TOKEN_TTL_S` cap + `ttlSeconds`.
- `apps/server/src/voice/mintToken.ts` — the pure/injected style for `turnCredentials.ts`.
- `apps/server/src/config/env.ts` — the env schema (`TURN_SECRET`/`TURN_TTL` validation) to extend with `TURN_URL`.
- `docker-compose.yml` (coturn service, lines 70-103) — the command list to extend; the `LIVEKIT_URL`-is-a-browser-target comment (119-124) that `TURN_URL` mirrors.

### Latest tech information — `livekit-client` 2.19.x + coturn 4.6

- `room.connect(url, token, options?: RoomConnectOptions)` — `RoomConnectOptions.rtcConfig` is a standard `RTCConfiguration`; set `iceServers` (TURN list) and, for the dev verify, `iceTransportPolicy: 'relay'`. The client merges these with any ICE servers LiveKit signals. Installed `livekit-client@2.19.x` (protocol 17) pairs with the dev-override SFU `livekit/livekit-server:v1.13.1` — no new dependency.
- **TURN-REST credential (coturn `--use-auth-secret`)**: `username = "<unixExpiry>:<id>"`, `credential = base64(HMAC_SHA1(staticAuthSecret, username))`. Node: `crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64')`. This is the long-standing coturn/“TURN REST API” scheme — no library needed.
- `RoomEvent.AudioPlaybackStatusChanged` + `room.canPlaybackAudio` / `room.startAudio()` — LiveKit's autoplay-recovery surface. `startAudio()` must be called from a user gesture; resolve ⇒ playback resumed, reject ⇒ still blocked (don't throw).
- coturn `coturn/coturn:4.6` `--external-ip=<ip>` sets the address advertised in `XOR-RELAYED-ADDRESS`; without it the container's internal RFC1918 address is advertised and external clients send relay traffic to an unroutable IP (deferred-work.md:48). Empty-tolerant wiring required so localhost dev (loopback relay) still works.

### Testing standards summary

- Vitest across `apps/server` + `apps/client`; React Testing Library for component renders. Fake the LiveKit `Room`, stub the `VOICE_TOKEN` ack — no real SFU/coturn in unit tests (AR16). Load-bearing tests: (1) `mintTurnIceServers` HMAC correctness + `undefined`-when-unconfigured; (2) grant includes/omits `iceServers` by config; (3) `connect()` receives `rtcConfig.iceServers` (and `iceTransportPolicy: 'relay'` under the toggle); (4) blocked `startAudio()` → `audioBlocked` true, `resumeVoiceAudio` clears it, never throws; (5) `gameStore` byte-identical across failure→reconnect→startAudio (independence); (6) `AudioUnblockPrompt` gated on `connected && audioBlocked`.
- Components rendering-only — connect/reconnect/resume logic stays in `connectVoice.ts`, state in `voiceStore` (project-context: zero game logic in JSX).
- The real-container two-browser drop+reconnect + forced-relay check is the **human-verify deliverable** (Task 7) and gates done — not automated. Verify ONLY against real LiveKit + coturn (deferred-work.md:186).
- `tsc --noEmit` green across workspaces; no `@ts-ignore`; full suites stay green (3.4 left client at `335/335`).

### Project Structure Notes

- Voice runtime stays confined to `apps/client/src/voice/` (the `livekit-client` import never enters `packages/shared` or `apps/server`); the server's new TURN logic is a pure module under `apps/server/src/voice/` mirroring `mintToken.ts`.
- `IceServer` is a shared contract (`packages/shared`), so client and server agree on the grant shape — typed events only, no `socket.emit(string, any)`.
- HUD corners in `ActiveRound` already occupied: pill top-left (3.4), mute bottom-left (3.4), connect/reconnect CTA bottom-right (3.2/this story). Place `AudioUnblockPrompt` where it won't collide and won't encroach the timer top-center/right (4.4/4.5).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Client state:** Zustand; voice status/`audioBlocked`/ICE config are display/connection concerns — keep `voiceStore` separate from `gameStore`; never read `voiceStore` from a game reducer, never write `gameStore` from voice code.
- **Components rendering-only:** zero game logic in components; reconnect/resume logic lives in `voice/connectVoice.ts`, not JSX.
- **Voice / LiveKit gotchas:** spectators stay listen-only (grant-enforced, 3.1/3.3) — the reconnect reuses the player's existing `publish` mode, so a spectator reconnects listen-only. Adding `iceServers` does NOT widen grants. Mute/role-remint are out of scope (3.4/3.5).
- **Socket.IO / Shared Types:** typed events only; the grant gains a typed optional `iceServers` field — no untyped emits. Degradation never uses the game socket.
- **Security:** never hardcode LiveKit/TURN keys or URLs on the client (server hands `url`/`iceServers` in the grant); **never log the LiveKit token OR the TURN `credential`** (both secret). `TURN_URL` is config, not secret.
- **Accessibility:** never icon-only — the Reconnect + "click to enable audio" controls carry `aria-label`s. Respect `prefers-reduced-motion` for any new animation (`motion-safe:` gate — the established floor).
- **Build:** `tsc --noEmit` zero errors; no `@ts-ignore`; TypeScript only.

### Continuity from Stories 3.2 / 3.3 / 3.4 (read their Completion Notes)

- 3.2 built `connectVoice.ts` as a `createVoiceController(deps)` factory + singletons, the `connectEpoch` guard, and the `VOICE_TOKEN` ack → connect flow. The swallowed `startAudio()` it added (best-effort autoplay) is the exact line 3.6 upgrades into the `audioBlocked` affordance (deferred-work.md:190 routed it here).
- 3.3 threaded the `publish` flag (spectator listen-only). Reconnect reuses it so a spectator reconnects listen-only; the grant's new `iceServers` is role-agnostic.
- 3.4 added `voiceStore.muted` + the `published` capture + the load-bearing `gameStore`-independence test, and left the client suite at **335/335** and the worktree `.env` `LIVEKIT_API_SECRET` ≥32 chars (45). Mirror the `muted`/`activeSpeakers` clear-on-transition pattern for `audioBlocked`; extend the independence test, don't replace it.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 3.6: Graceful Voice Degradation] — user story + ACs (dismissible "Voice unavailable — game continues without it" banner, game UI fully interactive; corporate-NAT → TURN relay path attempted; voice connecting microcopy distinct from game-socket).
- [Source: _agent_docs/planning-artifacts/epics.md] — FR40 (speaker indicator + per-player mute + graceful degradation); NFR3 (voice store independent of game state; voice failure non-blocking).
- [Source: _agent_docs/game-architecture.md#Pattern 7 — LiveKit Voice Topology / ADR-007] — voice is an independent, non-blocking subsystem; separate connection state + microcopy; "never gate a game-state transition on voice connectivity"; corporate-NAT WebRTC is the top technical risk.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:48] — coturn lacks `--external-ip` → unroutable `XOR-RELAYED-ADDRESS`; resolve here with env-driven `--external-ip=${TURN_EXTERNAL_IP}`.
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:190] — blocked-autoplay remote audio has no recovery affordance; "the full 'click to enable audio' affordance is explicitly Story 3.6."
- [Source: _agent_docs/implementation-artifacts/deferred-work.md:186] — verify voice only against real LiveKit + coturn containers.
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md] — "Voice connecting — separate microcopy from socket connecting; voice failure must not block game UI"; "connection lost: blocking modal with retry; voice lost: dismissible banner"; accessibility floor: "game must remain playable if voice drops."
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#toast] — toast/banner tokens (graphite bg, cream ink, brass border, 4px radius) for the banner/prompt styling.
- [Source: apps/client/src/ui/VoiceController.tsx:100-111] — existing dismissible `unavailable` branch to extend with Reconnect; role/mode resolution to reuse.
- [Source: apps/client/src/voice/connectVoice.ts] — the controller (`connect(url, token)` to widen; `connectEpoch`; `published`; swallowed `startAudio()` ≈ line 333; catch→`setUnavailable`).
- [Source: apps/client/src/store/voiceStore.ts] — `activeSpeakers`/`muted` clear-on-transition pattern to mirror for `audioBlocked`.
- [Source: apps/server/src/handlers/voiceHandlers.ts:124-135] — grant assembly where `iceServers` attaches; `MAX_VOICE_TOKEN_TTL_S`/`ttlSeconds`.
- [Source: apps/server/src/voice/mintToken.ts] — pure/injected style for `turnCredentials.ts`.
- [Source: apps/server/src/config/env.ts:20-24,93-109] — env schema (`TURN_SECRET`/`TURN_TTL`) to extend with `TURN_URL`.
- [Source: docker-compose.yml:70-103,119-124] — coturn command (add `--external-ip`); `LIVEKIT_URL`-is-a-browser-target comment that `TURN_URL` mirrors.
- [Source: livekit.yaml:19-22 / livekit.dev.yaml] — `use_external_ip`/UDP-mux is Story 10-3 (do not change); the dev override stays.
- [Source: livekit-client 2.x — Room.connect(rtcConfig) / Room.startAudio / RoomEvent.AudioPlaybackStatusChanged] — https://docs.livekit.io/reference/client-sdk-js/
- [Source: coturn 4.6 — `--use-auth-secret` TURN REST API / `--external-ip`] — HMAC-SHA1(base64) ephemeral credentials; advertised relay address.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- Root `pnpm typecheck` (`pnpm -r exec tsc --noEmit`) → exit 0 (all workspaces clean; no `@ts-ignore`).
- `@bomb-squad/shared` build (`tsc`) → exit 0; tests **211/211** passed.
- `@bomb-squad/server` tests (Jest) → **433/433** passed (29 suites; +6 new across `turnCredentials` + TURN-relay grant cases).
- `@bomb-squad/client` tests (Vitest) → **358/358** passed (42 files; was 335/335 at end of 3.4 → +23 new across `voiceStore.audioBlocked`, `connectVoice` rtcConfig/force-relay/audioBlocked/resumeAudio, `AudioUnblockPrompt`, `VoiceController` reconnect).
- `docker compose -p ktane-s5-voice config` → exit 0; coturn renders `--external-ip=127.0.0.1` (TURN_EXTERNAL_IP unset → loopback default).
- No ESLint config in this repo (`tsc --noEmit` is the configured code-quality gate per `project-context.md`).

### Completion Notes List

**Scope delivered (Tasks 1–6, all automated gates green):**

- **TURN relay path wired end-to-end (was dead code).** Server: NEW pure `apps/server/src/voice/turnCredentials.ts` `mintTurnIceServers()` — coturn `--use-auth-secret` TURN-REST credential (`username = <expiry>:<identity>`, `credential = base64(HMAC-SHA1(TURN_SECRET, username))`), `nowSeconds` injected for purity, returns `undefined` when no `TURN_URL` (no regression). `voiceHandlers` attaches `iceServers` to the `VOICE_TOKEN` grant only when present, and the log line carries a boolean `turn:` (never the credential). New optional `TURN_URL` in `config/env.ts` + `Config`; `TURN_SECRET`/`TURN_URL` threaded through `index.ts`. Shared: new `IceServer` type + optional `iceServers?` on `VoiceTokenGrantPayload`. Client: `connectVoice` widens `VoiceRoom.connect` to accept `RoomConnectOptions` and passes `{ rtcConfig: { iceServers } }` ONLY when the grant carries TURN — a TURN-less connect stays exactly `connect(url, token)` (the existing 2-arg assertions still hold).
- **Dev-only force-relay verification toggle.** `VITE_FORCE_TURN_RELAY=1` or a `?relay` query param sets `rtcConfig.iceTransportPolicy: 'relay'`, forcing all media through coturn (the only honest proof the relay works on localhost). Off by default; injected as `forceRelay` dep so it's unit-testable.
- **Blocked-autoplay "click to enable audio" (deferred-work.md:190).** `voiceStore.audioBlocked` flag (cleared on every non-connected transition, mirroring `muted`/`activeSpeakers`); a rejected `startAudio()` on connect now sets it (epoch-guarded, still never fails the connection) instead of being swallowed; `resumeAudio()`/`resumeVoiceAudio()` retries `startAudio()` and clears the flag on success. NEW `AudioUnblockPrompt.tsx` (bottom-center, self-gates on `connected && audioBlocked`) mounted in `ActiveRound`.
- **Dismissible banner + manual Reconnect.** `VoiceController`'s `unavailable` branch keeps the dismissible "Voice unavailable — game continues without it" banner and adds a **"Reconnect voice"** control that re-runs `connectVoice({ publish })` in the player's existing role mode (Bomb Room publish vs spectator listen-only). Dismissing now hides only the message line — the Reconnect control stays reachable (AC #1/#2). No auto-backoff (that's 10-3). AC #5 verified unchanged: connecting copy stays role-specific (`VOICE_CONNECTING`/`VOICE_LOUNGE_CONNECTING`), distinct from the game-socket `CONNECTING`.
- **Infra:** coturn gains `--external-ip=${TURN_EXTERNAL_IP:-127.0.0.1}`. **Design decision (deviation from the story's "empty-tolerant" wording):** an empty `--external-ip=` arg is malformed for coturn, and in a list-form command Compose cannot drop an empty element — so I defaulted to the loopback `127.0.0.1`, which is the *correct* advertised relay address for this published-port localhost stack (host:3478/40000-40031 → container) and lets the forced-relay verify work out of the box. Production MUST override `TURN_EXTERNAL_IP` with the host's public IP (documented in `.env.example`). `deferred-work.md`'s coturn `--external-ip` item (and the blocked-autoplay item) struck as resolved.
- **Independence invariant held (AR12/ADR-007).** Extended the load-bearing test: `gameStore` is byte-identical across the blocked-autoplay → `resumeAudio` path; reconnect re-runs `connectVoice` with no `gameStore` write. No game-socket event, no phase gate — the game stays fully playable through every degradation path.

**Worktree env prepped for the human-verify:** worktree `.env` has `LIVEKIT_API_SECRET` (45 chars ≥32 ✓), `TURN_URL=turn:localhost:3478`, `TURN_SECRET=changeme` (matches coturn's `--static-auth-secret`), `TURN_EXTERNAL_IP=127.0.0.1`. `docker compose config` validated.

**Task 7 — Jay's interactive verify OUTSTANDING (gates final done, [[human-verification-ac-rule]]):** AC #8 is NOT satisfied until Jay records the observed result here. To run: `docker compose -p ktane-s5-voice up -d --build`, then two browsers (both Defuser/Expert, same team). Confirm (a) `stop livekit` → both see the dismissible banner + keep playing, then **Reconnect voice** restores after `start livekit`; (b) with `VITE_FORCE_TURN_RELAY=1` both still hear each other + a `typ relay` candidate appears in chrome://webrtc-internals / coturn logs a relay allocation; (c) voice "Connecting to Bomb Room…" reads differently from the socket "Connecting…"; (d) a blocked-autoplay tab shows "Click to enable audio" and clicking restores sound. _Jay's observed result: **<pending>**._

### File List

- **NEW** `apps/server/src/voice/turnCredentials.ts` — pure `mintTurnIceServers` (TURN-REST HMAC-SHA1 creds; `nowSeconds` injected; `undefined` when no `turnUrl`).
- **UPDATE** `packages/shared/src/events/payloads.ts` — `IceServer` type + optional `iceServers?` on `VoiceTokenGrantPayload`.
- **UPDATE** `packages/shared/src/events/index.ts` — export `IceServer`.
- **UPDATE** `apps/server/src/config/env.ts` — optional `TURN_URL` (schema + `Config` + return).
- **UPDATE** `apps/server/src/handlers/voiceHandlers.ts` — `VoiceConfig.TURN_URL?`/`TURN_SECRET`; attach `iceServers` to the grant; boolean `turn:` log (no credential).
- **UPDATE** `apps/server/src/index.ts` — thread `TURN_SECRET`/`TURN_URL` into `registerVoiceHandlers`.
- **UPDATE** `apps/client/src/store/voiceStore.ts` — `audioBlocked` + `setAudioBlocked`; cleared on non-connected transitions.
- **UPDATE** `apps/client/src/voice/connectVoice.ts` — widen `VoiceRoom.connect` to `RoomConnectOptions`; thread grant `iceServers` → `rtcConfig`; `forceRelay` dep + `defaultForceRelay`; blocked-autoplay → `audioBlocked`; `resumeAudio`/`resumeVoiceAudio`.
- **NEW** `apps/client/src/ui/AudioUnblockPrompt.tsx` — click-to-enable-audio affordance (self-gates `connected && audioBlocked`).
- **UPDATE** `apps/client/src/ui/VoiceController.tsx` — Reconnect control in the `unavailable` branch (survives dismiss).
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount `<AudioUnblockPrompt />`.
- **UPDATE** `apps/client/src/ui/copy.ts` — `VOICE_RECONNECT`, `VOICE_ENABLE_AUDIO`.
- **UPDATE** `apps/client/src/ui/index.ts` — barrel export `AudioUnblockPrompt`.
- **NEW** `apps/server/src/voice/__tests__/turnCredentials.test.ts` — HMAC correctness + `undefined`-when-unconfigured.
- **UPDATE** `apps/server/src/handlers/__tests__/voiceHandlers.test.ts` — TURN_URL set/unset grant + credential-leak guard.
- **UPDATE** `apps/client/src/voice/__tests__/connectVoice.test.ts` — rtcConfig/force-relay + audioBlocked/resumeAudio + independence.
- **UPDATE** `apps/client/src/store/__tests__/voiceStore.test.ts` — `audioBlocked` transitions.
- **NEW** `apps/client/src/ui/__tests__/AudioUnblockPrompt.test.tsx` — gate + wired affordance.
- **NEW** `apps/client/src/ui/__tests__/VoiceController.test.tsx` — Reconnect affordance + survives-dismiss.
- **UPDATE** `docker-compose.yml` — coturn `--external-ip=${TURN_EXTERNAL_IP:-127.0.0.1}`.
- **UPDATE** `.env.example` — `TURN_URL` + `TURN_EXTERNAL_IP` (commented) + shared-secret note.
- **UPDATE** `.env` (worktree, gitignored) — `TURN_URL` + `TURN_EXTERNAL_IP` for the human-verify.
- **UPDATE** `_agent_docs/implementation-artifacts/deferred-work.md` — struck the coturn `--external-ip` + blocked-autoplay items (resolved here).

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-20 | Tasks 1–6 implemented (automated gates green). Server: NEW pure `turnCredentials.ts` (TURN-REST HMAC-SHA1), `iceServers` on the `VOICE_TOKEN` grant (gated on optional `TURN_URL`), env/handler/index wiring. Shared: `IceServer` type + optional grant field. Client: `connectVoice` threads `rtcConfig.iceServers` (2-arg connect preserved when TURN-less) + dev force-relay toggle; `voiceStore.audioBlocked` + `resumeVoiceAudio` for blocked autoplay; NEW `AudioUnblockPrompt`; `VoiceController` gains a Reconnect control that survives banner dismiss. Infra: coturn `--external-ip=${TURN_EXTERNAL_IP:-127.0.0.1}`. Tests: server 433/433 (+6), client 335→358 (+23), shared 211/211; root `tsc --noEmit` clean; `docker compose config` validates. deferred-work coturn + blocked-autoplay items struck. Task 7 human-verify (AC #8) outstanding — env prepped (`.env`: TURN_URL/TURN_EXTERNAL_IP, secret 45 chars). Status stays in-progress pending Jay's interactive result. |
| 2026-06-20 | Story 3.6 created (ready-for-dev): graceful voice degradation. Three deltas — (1) dismissible "Voice unavailable…" banner + new manual **Reconnect voice** affordance (banner/copy already exist from 3.2/3.3; no auto-backoff — that's 10-3); (2) **wire the dead TURN relay path** — server mints TURN-REST ephemeral creds from `TURN_SECRET` into the `VOICE_TOKEN` grant as `iceServers`, client passes `rtcConfig.iceServers` to `room.connect()`, coturn gains env-driven `--external-ip=${TURN_EXTERNAL_IP}`, new optional `TURN_URL` (browser-reachable); (3) **blocked-autoplay "click to enable audio"** affordance (deferred-work.md:190, routed to 3.6) via `voiceStore.audioBlocked` + `resumeVoiceAudio`. Voice stays independent of game state (AR12/ADR-007; independence test extended). Human-verify against real LiveKit + coturn (drop+reconnect, forced-relay media path, distinct connecting copy, audio-unblock). |
