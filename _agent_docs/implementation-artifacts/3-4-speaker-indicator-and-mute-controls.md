---
baseline_commit: dd9a72c3e49f1ec4ee032cdb08df975fd4f1ef01
context:
  - _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md
  - _agent_docs/implementation-artifacts/3-3-spectator-lounge-listen-only-channel.md
  - _agent_docs/project-context.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md
---

# Story 3.4: Speaker Indicator & Mute Controls

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see who is talking and to mute/unmute myself,
so that communication stays clear and I can manage my own audio.

## Acceptance Criteria

1. **Given** a connected voice participant who is transmitting, **When** their audio is active, **Then** an in-round **speaker pill** renders for them with **their name always visible (never icon-only)** — **self** uses cool blue (`--color-speaker-self` `#4FB8FF`), **other** active speakers use LED green (`--color-speaker-active` `#3DFF7A`) — and the pill **pulses** while they transmit. The pill set is driven **only** by `voiceStore.activeSpeakers` (already populated by `connectVoice` from LiveKit `ActiveSpeakersChanged`, Story 2.5), so the **150ms stop-grace flicker suppression is already applied upstream — do NOT re-implement it in the component**. _(FR40; epic AC1; DESIGN.md `{components.speakerIndicator}`)_
2. **Given** the in-round HUD, **When** speaker pills render, **Then** they sit **top-left** and never overlap the timer region (the timer is the loudest element by design — Stories 4.4/4.5 own the timer LCD; the pill must not collide with it). This is the **active-round** indicator, **distinct from and richer than** the Story 2.5 lobby roster speaker **dot** (pill = avatar dot **+ name + pulse**, not a bare dot). _(EXPERIENCE.md HUD hierarchy: "Active speaker pill — top-left, never overlapping timer")_
3. **Given** a Bomb Room participant (a publisher — Defuser/Expert/Facilitator who connected with `publish: true`), **When** they toggle the **self-mute control (bottom-left, always reachable)**, **Then** their microphone mutes/unmutes via the existing LiveKit `setMicrophoneEnabled` path (mute ⇒ `setMicrophoneEnabled(false)`, unmute ⇒ `setMicrophoneEnabled(true)`), the muted flag is tracked in `voiceStore` (`muted`), and the control's **own visual shows the muted state** (strike-through mic glyph, `--color-voice-muted` `#6B6470`). _(FR40; epic AC2; EXPERIENCE.md "Self mic / mute control — bottom-left, always reachable")_
4. **Given** a listen-only spectator (connected with `publish: false`, no mic — Story 3.3), **When** the in-round surface renders, **Then** the **self-mute control does NOT render** for them (there is no microphone to mute), while the **speaker pills still render** so a spectator can see who in the Bomb Room is talking. _(role-gating; a spectator has no publishable track — muting a non-existent mic is meaningless)_
5. **Given** `prefers-reduced-motion: reduce`, **When** a speaker pill is active, **Then** the **pulse is disabled and swapped for an instant/static active state** (reuse the established `motion-safe:` gate already used by the Story 2.5 lobby dot — `motion-safe:animate-pulse`). _(EXPERIENCE.md Reduced Motion: "Disable … speaker indicator pulse → swap for instant state changes")_
6. **Given** the voice subsystem, **When** mute state or speaker presence changes, **Then** it is tracked **only** in `voiceStore`; no voice code writes `gameStore`, gates a game-state transition, or sends voice presence over the game socket. Mute is a **local LiveKit publish toggle** — other clients observe it naturally via `ActiveSpeakersChanged` (a muted self simply drops out of the active set); the game stays fully playable regardless of voice. _(AR12 / ADR-007 / Architecture Pattern 7 — voice never blocks game state; same invariant proven in 3.2/3.3)_
7. **Given** the real LiveKit container, **When** Jay runs the interactive check, **Then** with two Bomb Room participants talking: each sees the **other's pill in LED green and their own in cool blue, names visible, pulsing while talking**; toggling **self-mute stops their audio reaching the other client and flips their control to the muted glyph**; un-muting restores it; and **killing voice leaves both clients fully able to keep playing**. Result recorded in Completion Notes. _(human-verification rule; NFR3; [[human-verification-ac-rule]])_

## Tasks / Subtasks

- [x] **Task 1 — `voiceStore`: add local mute state (AC: #3, #6)**
  - [x] Read `apps/client/src/store/voiceStore.ts` in full FIRST. It already holds `status` + `room`/`identity`/`error` + `activeSpeakers` and is voice-presentation-ONLY (never game-authoritative). Add a `muted: boolean` field (default `false`) + a `setMuted(muted: boolean)` action.
  - [x] Reset `muted` to `false` on every transition that drops the connection so a stale mute can't survive a reconnect: clear it in `setConnecting`, `setUnavailable`, and `reset` (mirror how those already clear `activeSpeakers`). `setConnected` should leave `muted` at its just-reset `false` (a fresh connect starts un-muted). Keep this store the SOLE home for mute state — no `gameStore` field.

- [x] **Task 2 — `connectVoice.ts`: a local mute toggle on the live room (AC: #3, #6)**
  - [x] Read `apps/client/src/voice/connectVoice.ts` in full FIRST. It is the SOLE `livekit-client` import site and writes ONLY `voiceStore`. It already calls `r.localParticipant.setMicrophoneEnabled(...)`. Story 3.3 threaded a `publish` flag — capture whether **this** connect published (e.g. retain the `publish` value the connect ran with) so mute is a safe no-op for a listen-only spectator.
  - [x] Add a `setMuted(muted: boolean)` method to the controller that, **only when `phase === 'connected'` and this connect published**, calls `await room.localParticipant.setMicrophoneEnabled(!muted)` and then `useVoiceStore.getState().setMuted(muted)`. Wrap the SDK call in try/catch — a failed toggle must NOT throw into the UI (mirror the existing teardown try/catch); on failure, do not flip the store flag. For a non-publishing / non-connected controller, `setMuted` is a no-op.
  - [x] Export a singleton binding `setVoiceMuted = (muted: boolean) => controller.setMuted(muted)` alongside `connectVoice`/`disconnectVoice`. Do NOT add a second `livekit-client` consumer and do NOT branch on role here — the caller (the mute control, which only renders for a publisher) owns the decision.

- [x] **Task 3 — `SpeakerIndicator` pill component (AC: #1, #2, #5)**
  - [x] NEW `apps/client/src/ui/SpeakerIndicator.tsx` — a rendering-only component that reads `voiceStore.activeSpeakers` (reactive selector), `gameStore.session.players` (for display names), and `gameStore.myPlayerId` (self). Render **one pill per id in `activeSpeakers`**, top-left, each showing `players[id].displayName` (name ALWAYS visible — never icon-only) beside a small avatar/voice dot.
  - [x] **Color rule:** the pill for `id === myPlayerId` uses `speaker-self` (cool blue, identity-only); every other active speaker uses `speaker-active` (LED green). The color tokens already exist in `index.css` (`--color-speaker-self`, `--color-speaker-active`, `--color-voice-muted`) — use the Tailwind utilities (`text-speaker-self` / `bg-speaker-active` / `ring-speaker-active`, etc.), do NOT hardcode hex.
  - [x] **Pulse + reduced motion (AC #5):** gate the pulse behind `motion-safe:` exactly like the lobby dot (`Lobby.tsx:242` uses `motion-safe:animate-pulse`). NOTE the DESIGN.md spec is an **800ms** pulse (`DESIGN.md:138-139`); Tailwind's default `animate-pulse` is 2s. Either reuse `animate-pulse` for consistency with the lobby dot OR add an 800ms keyframe token in `index.css` to match DESIGN — dev's call, but it MUST be `motion-safe:`-gated so reduced-motion users get a static active state. **DECISION: reused `motion-safe:animate-pulse` for consistency with the lobby dot + zero Tailwind-config risk.**
  - [x] **Do NOT** re-implement the 150ms stop-grace (it is already applied in `connectVoice`'s `ActiveSpeakersChanged` handler — the component just reflects `activeSpeakers`). **Do NOT** render the lobby dot here — this is the in-round HUD pill, a separate component. Positioning must not overlap the timer zone (the timer LCD is Stories 4.4/4.5; keep the pill in the top-left and out of the top-center/top-right timer area).

- [x] **Task 4 — `MuteControl` self-mute component (AC: #3, #4)**
  - [x] NEW `apps/client/src/ui/MuteControl.tsx` — a rendering-only, gesture-driven toggle anchored **bottom-left**. It calls `setVoiceMuted(next)` from `voice/connectVoice.ts` and reflects `voiceStore.muted` in its own glyph: a normal mic when un-muted, a **strike-through mic glyph in `voice-muted`** when muted (AC #3's "indicator shows a muted state"). Provide an accessible label (`aria-label` / `aria-pressed`) — never icon-only for a screen reader.
  - [x] **Render gating (AC #4):** show ONLY for a self who is a Bomb Room **publisher** AND voice is `connected`. Resolve self the durable way (`useGameStore(s => s.myPlayerId)` → `session.players[selfId]`, NOT `getSocket().id` — the roster is keyed by durable id since Story 2.7); a publisher is `role === 'defuser' || role === 'expert'` with the relevant Bomb Room seat (mirror the `VoiceController` self-resolution). A spectator (`publish: false`, no mic) renders nothing here. Idle/connecting/unavailable → nothing (there's no live mic to toggle). **NOTE: mirrored VoiceController's gate exactly (defuser/expert + team); facilitator voice is not wired by VoiceController, so rendering a mute control for it would be a dead control — connectVoice.setMuted also no-ops for any non-publisher (belt-and-suspenders).**
  - [x] Keep all toggle logic in `connectVoice.ts` (`setVoiceMuted`); the component is rendering-only (project-context: components zero game logic).

- [x] **Task 5 — Microcopy + mount (AC: #2, #3)**
  - [x] Add mute/indicator microcopy to `apps/client/src/ui/copy.ts`. Suggested: `MUTE_SELF = 'Mute'`, `UNMUTE_SELF = 'Unmute'`, `MUTED_STATUS = 'Muted'` (accessible labels for the toggle; dry/deadpan operator-world voice). Reuse the existing `SPEAKING` / `MIC_QUIET` labels for the pill's `aria-label` if useful, or add pill-specific labels — keep consistent with EXPERIENCE.md voice/tone. Do NOT reuse the lobby-only strings where they'd misname the surface. **Added `MUTE_SELF`/`UNMUTE_SELF`/`MUTED_STATUS`; pill reuses `SPEAKING`.**
  - [x] Mount both components in `apps/client/src/ui/ActiveRound.tsx` (the in-round surface), alongside the existing `<VoiceController />`. `<SpeakerIndicator />` mounts for **all** in-round roles (any connected participant should see who's talking, incl. a spectator watching the Bomb Room). `<MuteControl />` self-gates internally (Task 4) so mounting it unconditionally is fine. Keep both non-blocking and within the existing `relative` HUD wrapper; respect the corner placement (pill top-left, mute bottom-left, the 3.2 connect CTA stays bottom-right).
  - [x] Export both new components from `apps/client/src/ui/index.ts` (barrel) to match the existing convention.

- [x] **Task 6 — Tests (AC: #1, #3, #4, #5, #6)**
  - [x] **`voiceStore` mute state:** `setMuted(true/false)` flips `muted`; `setConnecting` / `setUnavailable` / `reset` all clear `muted` back to `false` (no stale mute across reconnect). (Vitest — extend/add a `voiceStore` test.)
  - [x] **`connectVoice.setMuted`:** with a faked `Room` + `publish: true` connect, `setMuted(true)` calls `setMicrophoneEnabled(false)` and sets `voiceStore.muted === true`; `setMuted(false)` calls `setMicrophoneEnabled(true)` and clears it. With a `publish: false` (spectator) connect, `setMuted(true)` is a **no-op** (no `setMicrophoneEnabled`, `muted` stays false). A throw from `setMicrophoneEnabled` does NOT flip the store flag and does NOT escape. (Extend `apps/client/src/voice/__tests__/connectVoice.test.ts`.)
  - [x] **Voice independence (reuse the 3.2/3.3 invariant):** mute toggling never mutates `gameStore` (`useGameStore.getState()` byte-identical across `setMuted`). (Mirror the existing "voice never mutates gameStore" test.)
  - [x] **`SpeakerIndicator` render:** given `activeSpeakers = [self, other]` + a session roster, renders both names; the self pill carries the `speaker-self` class and the other the `speaker-active` class; empty `activeSpeakers` → renders nothing. (React Testing Library — the client render-test pattern; a light test, components rendering-only.)
  - [x] **`MuteControl` role-gating render:** shows for a connected Bomb Room publisher and reflects `voiceStore.muted` (mic vs strike-through glyph); renders **nothing** for a spectator and when not `connected`. Keep `tsc --noEmit` green; run the full client suite (`vitest run`) — it must stay green plus the new tests. (3.3 left the client suite at 315/315.) **Client suite now 335/335; `tsc --noEmit` clean.**

- [ ] **Task 7 — Worktree env + the interactive "see who's talking + mute" verification (AC: #7) — Jay verifies**
  - [ ] **WSL2/Docker voice five-fix checklist** ([[livekit-wsl2-localhost-voice-verification]], [[worktree-fullstack-testing-gap]]): bring up the FULL stack against the **real LiveKit container** (do NOT mock the SDK — AR16). The worktree `.env` must carry a **≥32-char** `LIVEKIT_API_SECRET` (Story 3.3 already bumped it in this worktree — confirm it's still ≥32 chars). Run `docker compose -p ktane-s5-voice up -d --build` (worktree-scoped project name so ports/containers don't collide with the main stack or another worktree). Confirm the dev override `.dev` files are mounted (`docker compose -p ktane-s5-voice config | grep -E 'livekit.dev.yaml|Caddyfile.dev'`) and all services healthy before testing.
  - [ ] **Jay verifies interactively:** open TWO browser sessions, both **Defuser/Expert** on the same team (Bomb Room). Connect both to voice and talk. Confirm: (1) each sees the **other's pill in LED green** and their **own in cool blue**, **names visible**, **pulsing while talking** (and the pulse holds ~150ms after they stop, no flicker); (2) toggling **self-mute** stops your audio reaching the other client and flips your mute control to the **strike-through/muted** glyph; un-muting restores audio; (3) a spectator sees the pills but has **no mute control**; (4) killing the LiveKit container leaves BOTH clients fully able to keep playing.
  - [ ] Record the observed result (pill colors/names/pulse, mute stops audio + shows muted, spectator has no mute, game-continues-on-drop) in Completion Notes — the story is NOT done until Jay's observed result is written down. ([[human-verification-ac-rule]])

## Dev Notes

### What this story is (and is NOT) — READ THIS FIRST

3.4 is **CLIENT-ONLY** and **additive UI on top of the already-built voice plumbing**. The hard parts already exist:
- **Speaker presence** (`voiceStore.activeSpeakers`) is already populated by `connectVoice` from LiveKit `ActiveSpeakersChanged`, **with the 150ms stop-grace flicker suppression already implemented** (Story 2.5, exercised in `connectVoice.test.ts`). 3.4 just **renders** that set as an in-round pill — it does NOT touch the grace logic.
- **The mic publish toggle** already exists: `r.localParticipant.setMicrophoneEnabled(true|false)`. Mute is `setMicrophoneEnabled(false)`; unmute is `true`. 3.4 adds a thin `setMuted` controller method + a `voiceStore.muted` flag + the bottom-left control.
- **Color tokens** already exist in `index.css` (`--color-speaker-self` `#4FB8FF`, `--color-speaker-active` `#3DFF7A`, `--color-voice-muted` `#6B6470`). Use the Tailwind utilities; never hardcode hex.

So the entire delta is: a `muted` flag in `voiceStore`, a `setMuted` method in `connectVoice`, two small rendering-only components (`SpeakerIndicator` top-left, `MuteControl` bottom-left), their mount in `ActiveRound`, microcopy, tests, and the human-verify.

**Explicitly NOT in this story:**
- **The lobby speaker dot** — that's Story 2.5, already shipped in `Lobby.tsx`. Mirror its `motion-safe:animate-pulse` + `activeSpeakers.includes(...)` pattern, but the in-round pill is a separate component (richer: name + avatar + pulse, self/other color split, top-left HUD placement).
- **Any server / token change** — done in 3.1/3.2/3.3. Mute is a local LiveKit publish toggle; it is NOT a token re-mint and NOT a game-socket event. Touching `mintToken.ts`/`voiceHandlers.ts` is out of scope.
- **Token re-mint on role change → Story 3.5.**
- **Graceful-degradation polish / reconnect-backoff / NAT-TURN → Story 3.6 / 10-3.** Your only degradation requirement is the unchanged AC #6: voice failure → `unavailable`, game keeps working.
- **The timer LCD / strike HUD** (Stories 4.4/4.5) — just keep the pill out of the timer's top-center/right zone; do not build the timer.

### The two real subtleties

1. **Self vs other coloring + "the muted self has no pill."** `activeSpeakers` only contains ids that are *currently transmitting*. A **muted** self is not transmitting, so the self pill disappears while muted — which is correct. That means **AC #3's "my indicator shows a muted state" is satisfied by the `MuteControl`'s own glyph, not by a self pill** (the self pill only shows the cool-blue *speaking* state when you are actually talking and un-muted). Don't try to force a persistent self pill; let the mute control carry the muted visual.
2. **Mute must be a safe no-op for non-publishers / not-connected.** A listen-only spectator (`publish: false`, Story 3.3) has no local mic track; calling `setMicrophoneEnabled` for them is meaningless. Gate at two layers: the `MuteControl` doesn't render for a spectator (Task 4), AND `connectVoice.setMuted` no-ops unless `phase === 'connected'` and this connect published (Task 2) — belt-and-suspenders so a stray call can't prompt a mic or throw.

### Critical architectural constraint — voice never gates game state (unchanged from 3.2/3.3)

AR12 + ADR-007 + Architecture Pattern 7: voice is an **independent subsystem that never blocks game state**.
- Mute state and speaker presence live in `voiceStore` ONLY. `connectVoice` must not import/write `useGameStore` (components may *read* `gameStore` for the roster/self at the render layer). A mute toggle, a voice failure, or a drop must never flip `gameStore.connection` or block a phase.
- Mute does **not** travel over the game Socket.IO connection. It's a local LiveKit publish toggle; other clients observe it through `ActiveSpeakersChanged` (a muted participant drops out of the active set). The load-bearing test (assert `gameStore` byte-identical across the mute path) is how we prove independence — extend it.

### Files to touch

- **UPDATE** `apps/client/src/store/voiceStore.ts` — add `muted: boolean` (default false) + `setMuted`; clear `muted` in `setConnecting`/`setUnavailable`/`reset`.
- **UPDATE** `apps/client/src/voice/connectVoice.ts` — add `setMuted(muted)` (guarded: connected + published; try/catch; writes only `voiceStore`); export `setVoiceMuted`. Retain the `publish` value the current connect ran with so mute no-ops for a spectator. Keep it the SOLE `livekit-client` site.
- **NEW** `apps/client/src/ui/SpeakerIndicator.tsx` — top-left in-round pills from `voiceStore.activeSpeakers` × `gameStore.session.players`; self=cool-blue, others=LED-green; `motion-safe:` pulse.
- **NEW** `apps/client/src/ui/MuteControl.tsx` — bottom-left self-mute toggle; renders only for a connected Bomb Room publisher; reflects `voiceStore.muted` (mic vs strike-through glyph).
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount `<SpeakerIndicator />` (all roles) + `<MuteControl />` (self-gates) in the existing relative HUD wrapper, next to `<VoiceController />`.
- **UPDATE** `apps/client/src/ui/copy.ts` — add `MUTE_SELF` / `UNMUTE_SELF` / `MUTED_STATUS` (+ any pill aria labels).
- **UPDATE** `apps/client/src/ui/index.ts` — export `SpeakerIndicator` + `MuteControl`.
- **UPDATE** `apps/client/src/voice/__tests__/connectVoice.test.ts` — add `setMuted` (publisher toggles mic, spectator no-op, throw-is-swallowed) + independence tests; add `voiceStore` mute tests and component render tests (new test files as needed).
- **NONE under `apps/server/` or `packages/shared/`** — voice plumbing + token grants already done.

Read these existing files before editing (current behavior you must not break):
- `apps/client/src/store/voiceStore.ts` — the store you extend; note how `activeSpeakers` is cleared on non-connected transitions (mirror it for `muted`).
- `apps/client/src/voice/connectVoice.ts` — the controller; the `publish` flag (3.3), the `connectEpoch` guard, the `setMicrophoneEnabled` calls, and the singleton bindings to mirror for `setVoiceMuted`.
- `apps/client/src/ui/Lobby.tsx` (≈ lines 231-251) — the Story 2.5 speaker **dot** pattern: `activeSpeakers.includes(player.playerId)` → `bg-speaker-active motion-safe:animate-pulse`, and the `player.playerId === selfId` → `text-speaker-self` self treatment. Mirror the idea; build the richer pill.
- `apps/client/src/ui/VoiceController.tsx` — the in-round voice affordance + the durable-id self-resolution (`myPlayerId` → `session.players[selfId]`, with the `defuser`/`expert` + team gate) to copy for `MuteControl`'s publisher gate.
- `apps/client/src/ui/ActiveRound.tsx` — the relative HUD wrapper + the existing `<VoiceController />` mount (bottom-right); add the new corners around it.
- `apps/client/src/index.css` — the voice color tokens (`--color-speaker-self/active`, `--color-voice-muted`) and the absence of a custom pulse keyframe (Tailwind `animate-pulse` is the default; DESIGN wants 800ms — decide and document).

### Latest tech information — `livekit-client` (unchanged from 3.2/3.3)

- Use the installed `livekit-client@2.19.x` (protocol 17) — pairs with the dev-override SFU `livekit/livekit-server:v1.13.1`. No new dependency for 3.4.
- Mute/unmute: `room.localParticipant.setMicrophoneEnabled(false|true)` toggles publishing of the local mic track. It returns a promise; await it and swallow rejections (never throw into the UI). A muted local participant stops appearing in remote `ActiveSpeakersChanged`, so other clients' pills clear for you naturally — no extra signaling.
- Active speakers: `RoomEvent.ActiveSpeakersChanged` delivers the CURRENT speaking set; `connectVoice` already maps it to durable playerIds and applies the 150ms stop-grace before writing `voiceStore.activeSpeakers`. The component is a pure reflection of that set.
- Reduced motion: gate any pulse animation behind `motion-safe:` (Tailwind) — the project's accessibility floor (`scenes/dom.ts` `prefersReducedMotion`, and `Lobby.tsx`'s `motion-safe:animate-pulse`).

### Testing standards summary

- Vitest (`apps/client` runner) + React Testing Library for component renders. Fake the LiveKit `Room`, stub the `VOICE_TOKEN` ack — no real SFU in unit tests (AR16). The load-bearing tests: (1) `setMuted` toggles the mic for a publisher and no-ops for a spectator; (2) mute toggling never mutates `gameStore`; (3) the pill colors self vs other correctly and hides when `activeSpeakers` is empty; (4) `MuteControl` is hidden for a spectator / when not connected.
- Components rendering-only — keep mute logic in `connectVoice.ts` and presence in `voiceStore`. No game logic in JSX (project-context).
- The real-container two-browser "see who's talking + mute stops audio" check is the **human-verify deliverable** (Task 7) and gates done — not automated.
- `tsc --noEmit` green across workspaces; no `@ts-ignore`; full client suite stays green (3.3 left it at `315/315`).

### Project Structure Notes

- Voice runtime stays confined to `apps/client/src/voice/` (the `livekit-client` import never enters `packages/shared` or `apps/server`); presence/mute state in `apps/client/src/store/voiceStore.ts`.
- The two new components are per-concern UI peers of the existing `VoiceController` under `apps/client/src/ui/`, mounted in `ActiveRound`. No server/shared structure change.
- HUD corners in `ActiveRound`: pill = top-left, mute = bottom-left, the 3.2 connect CTA = bottom-right; the timer (top-center/right) is reserved for Stories 4.4/4.5 — do not encroach.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Client state:** Zustand; voice status/presence/mute are display-rate so reactive selectors in display components are fine — keep `voiceStore` separate from `gameStore`; never read `voiceStore` from a game reducer, never write `gameStore` from voice code.
- **R3F / components rendering-only:** zero game logic in components; the mute toggle logic lives in `voice/connectVoice.ts`, presence in `voiceStore`, not JSX.
- **Voice / LiveKit gotchas:** spectators must never publish into the Bomb Room (grant-enforced, 3.1) — so they have no mic and get no mute control. Mute is a local publish toggle, NOT a token re-mint (that's 3.5) and NOT a game-socket message.
- **Socket.IO / Shared Types:** typed events only; `socket.emit(string, any)` forbidden. Mute does not use the game socket at all.
- **Accessibility:** never icon-only — speaker pills always show the name; the mute control carries an `aria-label`/`aria-pressed`. Respect `prefers-reduced-motion` (`motion-safe:` gate) — the established floor.
- **Security:** never hardcode LiveKit keys/URL on the client; never log the token (unchanged — 3.4 adds no token handling).
- **Build:** `tsc --noEmit` zero errors; no `@ts-ignore`; TypeScript only.

### Continuity from Stories 3.2 / 3.3 (read their Completion Notes)

- 3.2 built `connectVoice.ts` as a `createVoiceController(deps)` factory + default singleton (`connectVoice`/`disconnectVoice`), populated `voiceStore.activeSpeakers` from `ActiveSpeakersChanged` with the **150ms stop-grace already implemented**, and added the `connectEpoch` guard. Add `setMuted`/`setVoiceMuted` to that same factory + singleton; don't break the epoch guard.
- 3.3 threaded a `publish` flag through `connect()` (spectator connects listen-only, no mic). Reuse that `publish` value to gate mute: a `publish: false` connect has no mic, so `setMuted` must no-op. 3.3 also left the client suite at **315/315** and bumped this worktree's `.env` `LIVEKIT_API_SECRET` to ≥32 chars for the human-verify (reuse it).
- The lobby already proves the speaker-presence → green-pulse render path (`Lobby.tsx`); the in-round pill is the same data, richer presentation, plus the self/cool-blue split.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 3.4: Speaker Indicator & Mute Controls] — user story + ACs (pulsing pill, name always visible, self cool blue / others LED green, 150ms grace; self-mute bottom-left, muted indicator).
- [Source: _agent_docs/planning-artifacts/epics.md] — FR40 (speaker indicator + per-player mute + graceful degradation, connect within 10s).
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#components.speakerIndicator] — pill = avatar dot + name; Active: ring 2px `{colors.voice.speakerActive}` (#3DFF7A) + 800ms pulse; muted: `{colors.voice.muted}` (#6B6470) strike-through mic glyph; self `{colors.voice.speakerSelf}` (#4FB8FF).
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD hierarchy] — "Active speaker pill — top-left, never overlapping timer"; "Self mic / mute control — bottom-left, always reachable"; "Names always shown; never icon-only"; Reduced motion: disable speaker indicator pulse → instant state.
- [Source: _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md] — `connectVoice.ts` controller, `voiceStore`, `activeSpeakers` + 150ms grace, the load-bearing independence test, the `connectEpoch` guard.
- [Source: _agent_docs/implementation-artifacts/3-3-spectator-lounge-listen-only-channel.md] — the `publish` flag (spectator listen-only, no mic) to gate mute; the ≥32-char `.env` secret; client suite 315/315.
- [Source: apps/client/src/store/voiceStore.ts] — the store to extend (`activeSpeakers` clearing pattern to mirror for `muted`).
- [Source: apps/client/src/voice/connectVoice.ts] — `setMicrophoneEnabled` usage, the `publish` flag, the singleton bindings.
- [Source: apps/client/src/ui/Lobby.tsx#speaker dot] — `activeSpeakers.includes(...)` + `bg-speaker-active motion-safe:animate-pulse` + `text-speaker-self` self treatment to mirror.
- [Source: apps/client/src/ui/VoiceController.tsx] — durable-id self-resolution + publisher gate to copy for `MuteControl`.
- [Source: apps/client/src/index.css#COLORS — voice] — `--color-speaker-active` #3dff7a, `--color-speaker-self` #4fb8ff, `--color-voice-muted` #6b6470 (use the Tailwind utilities).
- [Source: livekit-client 2.x — LocalParticipant.setMicrophoneEnabled / RoomEvent.ActiveSpeakersChanged] — https://docs.livekit.io/reference/client-sdk-js/

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- `apps/client`: `npx tsc --noEmit` → exit 0 (zero errors, no `@ts-ignore`).
- `apps/client`: `npx vitest run` → **40 files / 335 tests passed** (was 315/315 at end of 3.3; +20 new across voiceStore mute, connectVoice.setMuted, SpeakerIndicator, MuteControl).
- No ESLint config exists in this repo (`tsc --noEmit` is the configured code-quality gate per `project-context.md`).

### Completion Notes List

**Scope delivered (Tasks 1–6, automated gates green):**
- **`voiceStore.muted`** — added `muted: boolean` (default `false`) + `setMuted` action; cleared on `setConnecting` / `setUnavailable` / `reset` so a stale mute can't survive a reconnect (`setConnected` leaves the just-reset `false`). Store remains the SOLE home for mute state — no `gameStore` field.
- **`connectVoice.setMuted` + `setVoiceMuted`** — a thin local LiveKit publish toggle on the existing controller: guarded by `phase === 'connected'` **and** a new controller-scoped `published` flag (captures the Story 3.3 `publish` value of the current connect), so it's a safe no-op for a listen-only spectator or a not-connected client. SDK call is try/catch-wrapped (mirrors teardown) — a failed toggle never throws into the UI and never optimistically flips the store flag. Singleton `setVoiceMuted` exported alongside `connectVoice`/`disconnectVoice`; still the SOLE `livekit-client` site, no role branching here.
- **`SpeakerIndicator.tsx`** (NEW, top-left) — rendering-only; one pill per id in `voiceStore.activeSpeakers`, name ALWAYS visible, self = `text-speaker-self` (cool blue) / others = `text-speaker-active` (LED green), dot pulse gated behind `motion-safe:animate-pulse` (reused the lobby-dot pattern; AC #5). Pure reflection of `activeSpeakers` — the 150ms stop-grace stays upstream in `connectVoice`. Empty set → renders nothing (a muted self drops out of `activeSpeakers`, so the muted visual is carried by `MuteControl`, not a self pill — the documented subtlety).
- **`MuteControl.tsx`** (NEW, bottom-left) — rendering-only toggle; renders ONLY for a connected Bomb Room publisher (durable-id self-resolution mirroring `VoiceController`: defuser/expert + team), nothing for a spectator or any non-`connected` state. Reflects `voiceStore.muted` via an inline mic glyph (strike-through line + `text-voice-muted` when muted) and `aria-label`/`aria-pressed` (never icon-only). Toggle logic stays in `connectVoice` (`setVoiceMuted`).
- **Mount + barrel** — both mounted in `ActiveRound.tsx` inside the existing `relative` HUD wrapper (pill top-left for all roles, mute bottom-left self-gating, 3.2 CTA still bottom-right; timer top-center/right left clear for 4.4/4.5); both exported from `ui/index.ts`.
- **Independence invariant held** — extended the load-bearing test: `gameStore` is byte-identical across `setMuted(true)`→`setMuted(false)`. No `gameStore` write, no game-socket event — mute is a local publish toggle only (AR12 / ADR-007).

**Task 7 — env prepped, Jay's interactive verify still OUTSTANDING (gates done):**
- Worktree `.env` `LIVEKIT_API_SECRET` confirmed **45 chars** (≥32 ✓); dev overrides (`livekit.dev.yaml`, `Caddyfile.dev`) confirmed mounted via `docker compose -p ktane-s5-voice config`.
- **NOT YET DONE:** the real-container two-browser human-verify (AC #7) per [[human-verification-ac-rule]]. Story is NOT done until Jay's observed result (pill colors/names/pulse, mute stops audio + flips glyph, spectator has no mute, game continues on voice kill) is recorded here. To run: `docker compose -p ktane-s5-voice up -d --build`, then two browsers (both Defuser/Expert, same team) — see Task 7 steps. _Jay's observed result: **<pending>**._

### File List

- **UPDATE** `apps/client/src/store/voiceStore.ts` — `muted` field + `setMuted`; cleared on non-connected transitions.
- **UPDATE** `apps/client/src/voice/connectVoice.ts` — `published` capture + `setMuted` controller method + `setVoiceMuted` singleton export.
- **NEW** `apps/client/src/ui/SpeakerIndicator.tsx` — top-left in-round speaker pills.
- **NEW** `apps/client/src/ui/MuteControl.tsx` — bottom-left publisher-only self-mute toggle.
- **UPDATE** `apps/client/src/ui/ActiveRound.tsx` — mount `<SpeakerIndicator />` + `<MuteControl />`.
- **UPDATE** `apps/client/src/ui/copy.ts` — `MUTE_SELF` / `UNMUTE_SELF` / `MUTED_STATUS`.
- **UPDATE** `apps/client/src/ui/index.ts` — barrel exports for the two new components.
- **UPDATE** `apps/client/src/store/__tests__/voiceStore.test.ts` — `voiceStore.muted` tests.
- **UPDATE** `apps/client/src/voice/__tests__/connectVoice.test.ts` — `setMuted` (publisher toggle, spectator no-op, not-connected no-op, throw-swallowed, gameStore independence).
- **NEW** `apps/client/src/ui/__tests__/SpeakerIndicator.test.tsx` — pill render/colors/empty/motion-safe.
- **NEW** `apps/client/src/ui/__tests__/MuteControl.test.tsx` — role/connection gating + muted visual.

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-20 | Tasks 1–6 implemented (CLIENT-ONLY): `voiceStore.muted` + `setMuted`; `connectVoice.setMuted`/`setVoiceMuted` guarded local publish toggle (`published` capture); `SpeakerIndicator` (top-left, self cool-blue/others LED-green, motion-safe pulse) + `MuteControl` (bottom-left, publisher-only, strike-through muted glyph); mounted in `ActiveRound`, barrel-exported, microcopy added. Tests: client suite 315→335, `tsc --noEmit` clean. Task 7 human-verify (AC #7) outstanding — env confirmed ready (`.env` secret 45 chars, dev overrides mounted). Status stays in-progress pending Jay's interactive result. |
| 2026-06-20 | Story 3.4 created (ready-for-dev): CLIENT-ONLY speaker pill + self-mute. Renders existing `voiceStore.activeSpeakers` (150ms grace already upstream) as a top-left in-round pill (self cool-blue / others LED-green, name always visible, motion-safe pulse); adds a `muted` flag to `voiceStore` + a `setMuted`/`setVoiceMuted` local LiveKit publish toggle in `connectVoice.ts` + a bottom-left `MuteControl` (publisher-only — spectators have no mic). No server/token/socket change (mute is local; re-mint is 3.5). Tests + the real-container two-browser "see who's talking + mute stops audio" human-verify. |
