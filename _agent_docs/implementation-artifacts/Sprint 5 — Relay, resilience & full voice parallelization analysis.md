# Sprint 5 — Relay, resilience & full voice: parallelization analysis

Sprint 5 stories: `8-7` Pause (Facilitator & disconnect), `8-8` Retry a failed round, `8-9` Relay orchestration & odd-team equalisation, `8-10` Scoring, final scoreboard & session-end persistence, `3-3` Spectator Lounge listen-only, `3-4` Speaker indicator & mute controls, `3-5` Token re-mint on role change, `3-6` Graceful voice degradation.

This is the biggest sprint so far (8 stories vs. Sprint 3/4's 5), but it splits cleanly along a **subsystem fault line**: four server-state Epic-8 stories (relay/resilience/scoring) and four client-side Epic-3 voice stories. The two tracks touch almost-disjoint file sets, so the cross-worktree merge surface is the smallest of any sprint so far — smaller even than Sprint 4.

## What's already in place that shapes the waves

- **The events contracts are almost entirely pre-scaffolded** — even more than Sprint 4. `FACILITATOR_PAUSE` / `FACILITATOR_RESUME` / `ROUND_RETRY` (+ `RoundRetryPayload`), `PAUSED` / `RESUMED` (+ `PauseResumePayload`), `SCOREBOARD` (+ `ScoreboardPayload`), and `VOICE_TOKEN` (+ request/grant/error payloads) all already exist in `packages/shared/src/events/*`. So the `events/*` reconcile that bit Sprints 2–3 is essentially gone this sprint. The one shared-**type** change that remains is `SessionState.status` — currently `'lobby' | 'preparation' | 'active' | 'between-rounds' | 'ended'` (session.ts:57), with **no `'paused'` member**. 8-7 adds it. That single enum line is the hottest shared edit in the sprint, and it lives entirely inside the Epic-8 worktree.
- **The voice token grants for 3-3 / 3-5 are already built.** `mintToken.ts`'s `resolveVoiceScope` already returns `spectator → spectator-lounge:{sessionId}, canPublish:false, canSubscribe:true` (listen-only enforced at the grant, FR39) and `facilitator → lounge, canPublish:true`. So 3-3's *server* AC ("denied at the token-grant level, not merely hidden in the UI") is **already satisfied by 3-2's mintToken** — 3-3 is the *client* side (spectator connects to the lounge and renders a listen-only state). Likewise 3-5's re-scope-on-new-role math already exists; 3-5 is the *wiring* (re-request a token when the role flips, discard the old one).
- **The speaker-presence and degradation primitives already exist in `voiceStore`.** `activeSpeakers` is in the store specifically "for 3.4's speaker pill" (voiceStore.ts:31), and the `'unavailable'` status is the home for 3.6's degradation microcopy (voiceStore.ts:15). So 3-4 and 3-6 build on primitives 3-2 already shipped.
- **The relay rotation pointer already advances.** `openPreparation.ts` advances every team's `currentDefuserIndex` when opening prep from `'between-rounds'` (the round-2+ rotation step, lines 13–40), and `startRound.ts` already picks `relayOrder[currentDefuserIndex]`. The `startRound`/`openPreparation` comments explicitly call this "the 8.6/8.9 seam." 8-9 builds the *termination + equalisation* logic on top of this existing pointer — it doesn't invent rotation from scratch.
- **Scoring state is already accumulated.** `team.cumulativeTimeMs` + `team.roundTimesMs[]` are populated by `resolveRound.ts` (with the elapsed-time convention 8-10 is told to sum, lines 20–26), and `buildScoreboard.ts` already projects a *provisional* leader for the between-rounds preview, with an explicit note that "the session winner is authoritative only at session end (Story 8.10)." 8-10 turns this preview projection into the final, persisted scoreboard.
- **8-8 has a pre-flagged reconcile waiting for it.** `cancelPreparation.ts` infers its phase + does a blind rotation `−1`, and deferred-work.md:7 says verbatim: *"Already flagged in-code for 8.8 reconciliation; resolve when retry lands."* 8-8 owns that cleanup.
- **No story-context files exist** for any of the eight (confirmed: none of `8-7…8-10` / `3-3…3-6` are in implementation-artifacts; sprint-status has all eight at `backlog`). `gds-create-story` must run for each before dev.
- **Heads-up: `8-1` is in flight.** Sprint 4's Wave-2 story (`8-1` round config & difficulty gating) just moved to `ready-for-dev` and touches `sessionHandlers.ts` + `ROUND_CONFIGURE`. If it lands concurrently, the Epic-8 worktree below should rebase on it — same `sessionHandlers.ts` neighbourhood.

## Wave 1 — start now, two parallel worktrees

### Worktree A — Epic 8 server cluster: `8-7` Pause + `8-8` Retry + `8-9` Relay orchestration

These three are one **server-state chain**, not three independent stories. They all read-modify-write `SessionState` and pile onto the **same three files**:

- `packages/shared/src/types/session.ts` — `8-7` adds `'paused'` to the status enum (and likely a "who dropped / opened-from" field); `8-9` may add equalisation bookkeeping.
- `apps/server/src/handlers/sessionHandlers.ts` — `8-7` wires the `FACILITATOR_PAUSE`/`FACILITATOR_RESUME` handlers **and** the mid-round branch of the `disconnect` handler (today's `disconnect` explicitly defers `preparation/active/between-rounds/ended` drops to "Epic 8 / FR13's pause concern," sessionHandlers.ts:1286); `8-8` wires `ROUND_RETRY`; `8-9` owns relay termination + the odd-team volunteer assignment.
- `apps/server/src/session/*` + `apps/server/src/round/*` — `8-8` reconciles `cancelPreparation.ts` (the pre-flagged `−1`) and reuses `startRound`'s `templateSeed`/`teamSeed` to regenerate the identical bomb; `8-9` extends `openPreparation.ts`'s pointer advance with a "everyone has defused / relay complete" terminal check; `8-7` freezes the live timer key.

Splitting these across worktrees would manufacture exactly the `session.ts` + `sessionHandlers.ts` reconcile that Sprint 3/4 warned about — they chain in one worktree like Sprint 3's voice pair and Sprint 4's module pair, just one story wider. **Suggested internal order:** `8-9` (rotation termination — the relay's spine) → `8-7` (pause/resume + disconnect) → `8-8` (retry, which reconciles `cancelPreparation` and reuses the seeds). Order is by file-collision hygiene, not hard dependency; none of the three blocks another logically.

**The meatiest item here is 8-7's mid-round disconnect → auto-pause → resume restore.** Per the Story 2.7 scope note (epics.md:571), 2.7 introduced the durable identity primitive *specifically so 8.7 could build mid-round reattach on it* — on resume, 8.7 must re-send each team's `BOMB_INIT` and re-establish `teamRoom` membership. That's a real correctness surface, and it's the recurring socket.id-vs-durable-id sweep ([[identity-key-change-needs-client-sweep]]): the gate reads `socket.data.playerId`, but the *client* must re-identify on reconnect or the restore silently misses.

### Worktree B — Epic 3 voice client: `3-3` Spectator Lounge + `3-4` Speaker indicator/mute + `3-6` Graceful degradation

The three voice stories whose **trigger is not relay rotation** (that's 3-5 — see Wave 2). They're predominantly client work on a shared set of voice files — `apps/client/src/store/voiceStore.ts`, `apps/client/src/voice/connectVoice.ts`, and new voice UI components — so they bundle for the same reason the Epic-8 trio does: splitting them just collides on `voiceStore`. Their server side is already done (mintToken grants from 3-2). Specifically:

- `3-3` — spectator client connects to `spectator-lounge:{sessionId}` and renders listen-only; the grant denial is *already enforced server-side*, so this is connect + UI state.
- `3-4` — speaker pills (name always visible, self = cool blue / others = LED green, 150ms stop-grace) off the existing `activeSpeakers` primitive, plus a bottom-left self-mute toggle.
- `3-6` — the dismissible "Voice unavailable — game continues without it" banner off the existing `'unavailable'` status, plus the TURN-relay connect path with microcopy distinct from the game-socket connecting state. **3-6 carries an infra dependency:** the corporate-NAT/TURN AC needs coturn's `--external-ip`, which deferred-work.md:48 explicitly parks for "the voice stories" — resolve it here (env-driven `--external-ip=${TURN_EXTERNAL_IP}`), or the relay path can't actually be verified.

The fault line between A and B is the cleanest in the project: **A is server session/round + Facilitator HUD; B is voice client + coturn config.** They share no files. Unlike Sprint 3 (where both worktrees edited `events/*`), there's essentially nothing to reconcile across this boundary.

> **If you'd rather widen Wave 1 to a third worktree:** `3-6` is the most separable voice story (it leans on infra + a banner more than on the shared `activeSpeakers`/pill surface), so it could split out from B. I'd keep it bundled — it still edits `voiceStore`/`connectVoice` alongside 3-3/3-4, and the gain is marginal. Two worktrees remains the honest width per track.

## Wave 2 — blocked on Wave 1 (both downstream of `8-9`)

Two stories wait, and both wait on the **same thing: 8-9's relay rotation** producing a role change / a session end. They're in different subsystems, so once 8-9 lands they can run in parallel on master (or sequentially — both are small).

- **`8-10` Scoring, final scoreboard & session-end persistence** — its mechanics build on already-merged state (`cumulativeTimeMs`, `buildScoreboard`, the `resolveRound` elapsed convention), but its *correctness* depends on the rest of the cluster: "session ends" is defined by **8-9's relay-complete terminal check**, "the better of the two times is kept" is **8-8's** retry output, and failed-round time already flows from `resolveRound`. Run 8-10 before 8-9/8-8 land and you're testing the final scoreboard against an incomplete relay and un-deduped retry times. So it sequences last — exactly Sprint 4's "8-1 last because it *is* the tier-pool expansion A edits" and Sprint 3's "do 2-5 last." It also dodges a third `sessionHandlers.ts`/`session.ts` (`ended` + final-scoreboard fields) collision with the Wave-1 cluster.
- **`3-5` Token re-mint on role change** — the AC *is* "a player changes from Defuser to Spectator on relay rotation → fresh token, old one never reused." The re-mint trigger is **8-9's rotation flipping a player's role**; you cannot verify re-mint without rotation actually changing a role. The mintToken re-scope already exists (3-2), so 3-5 is mostly: on the role-change broadcast, client re-requests `VOICE_TOKEN` and tears down the old connection. Small, but untestable until 8-9 rotates someone.

> **If you'd rather widen Wave 2:** 8-10 and 3-5 are disjoint (server scoring/persist vs. voice client re-request), so run them as two parallel worktrees off master once 8-9 merges, rather than serially.

## Merge surface

The smallest of any sprint, and almost entirely *inside* worktree A:

- **`session.ts` status enum** (`+'paused'`, 8-7; `ended`/final-scoreboard fields, 8-10) — the one hot shared-type line, owned end-to-end by the Epic-8 track across the wave boundary.
- **`sessionHandlers.ts`** — pause/resume + mid-round disconnect (8-7), retry (8-8), relay termination + volunteer (8-9), session-end persist (8-10). All Epic-8; serialized by keeping the trio in one worktree and 8-10 in Wave 2. Watch for a rebase against `8-1` if it lands first.
- **`session/*` + `round/*`** — `cancelPreparation`/`startRound`/`openPreparation`/`resolveRound`/`buildScoreboard`, all internal to the Epic-8 track.
- **`voiceStore.ts` / `connectVoice.ts` + voice UI** — internal to worktree B (and 3-5 in Wave 2).
- **Cross-worktree (A↔B): effectively none.** No shared file. `mintToken.ts` is server-side but already complete and untouched by the Epic-8 track.

## Execution gotchas (from past sprints)

- **Worktree B is the first full voice sprint since Sprint 3** — the LiveKit/coturn five-fix checklist applies hard: http origin, browser-reachable `LIVEKIT_URL`, `node_ip`, SFU/SDK protocol match, ≥32-char secret ([[livekit-wsl2-localhost-voice-verification]]). Provision the gitignored `.env` (incl. LiveKit/TURN secrets) and always `--build` with a worktree-scoped compose project name, or voice silently connects to the wrong/old stack ([[worktree-fullstack-testing-gap]]). 3-6's TURN-relay AC must be verified against the **real coturn container** with `--external-ip` set — not a mock.
- **Worktree A freezes and restores the server timer** (8-7 pause). Verify it **without `tsx watch`** — a watch restart drops the in-memory expiry wakes, and worktree host-port collisions land you on the wrong passworded Redis/Postgres ([[timer-verification-tsx-watch-gotcha]]). Provision `.env` + `--build` per worktree ([[worktree-fullstack-testing-gap]]).
- **8-7's resume restore is a durable-identity correctness item, not a lobby nicety** — re-send each team's `BOMB_INIT` + re-establish `teamRoom` on resume, and confirm the *client* re-identifies on reconnect, since there's no component-test harness to catch a client-side identity miss ([[identity-key-change-needs-client-sweep]]).
- **Human-verification ACs everywhere** — all eight are user-visible/e2e: 8-7 ("Holding the clock" + amber drop strip + freeze), 8-8 (identical bomb on retry), 8-9 (everyone defuses once + odd-team extra round), 8-10 (final scoreboard + Postgres write), 3-3 (spectator hears, can't talk), 3-4 (speaker pills + mute), 3-5 (fresh token after rotation), 3-6 (degradation banner + TURN path). Each needs the explicit "Jay verifies interactively" subtask, not done until his observed result is in Completion Notes ([[human-verification-ac-rule]]).
- Run `gds-create-story` for all eight first — none have context files yet.

## TL;DR

Kick off two parallel worktrees now: **A = `8-9`+`8-7`+`8-8`** (the Epic-8 server-state chain — relay termination, pause/disconnect, retry — bundled because they all rewrite `session.ts` + `sessionHandlers.ts`) and **B = `3-3`+`3-4`+`3-6`** (voice client — listen-only lounge, speaker pills/mute, degradation — whose token grants and store primitives 3-2 already shipped). The A/B fault line is clean: zero shared files. Then finish on master with **`8-10`** (final scoring/persist) and **`3-5`** (token re-mint), both blocked on `8-9`'s rotation producing a session-end / role-change — run them as two parallel worktrees once 8-9 lands. The shared-events reconcile that defined earlier sprints is gone (PAUSE/RETRY/SCOREBOARD/VOICE_TOKEN are pre-scaffolded); the only hot shared edit is `session.ts`'s `+'paused'`, and it stays inside worktree A. Provision `.env` + `--build` per worktree, verify voice against the real LiveKit/coturn containers (set coturn `--external-ip` for 3-6), and run the timer-freeze test without `tsx watch`.
