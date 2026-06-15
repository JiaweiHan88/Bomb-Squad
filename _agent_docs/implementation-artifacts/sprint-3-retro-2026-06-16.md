# Sprint 3 Retrospective — "Voice on the skeleton"

- **Date:** 2026-06-16
- **Facilitator:** Link Freeman (Game Developer)
- **Participants:** Jay (Project Lead), Link Freeman (Game Developer), Cloud Dragonborn (Game Architect), Samus Shepard (Game Designer), Paige (Tech Writer)
- **Scope:** Sprint 3 of the sprint plan — planned `3-1`, `3-2`, `2-5`, `2-6`, `2-7`; plus tech-debt `TD-1`, `TD-2`, `TD-3` that landed in-window. All 8 done.
- **Note:** Sprint retro, not an epic retro — Epics 2 and 3 remain `in-progress` by design (playability-first / voice-subset-pull-forward sequencing). Epic-retrospective keys in `sprint-status.yaml` stay untouched. (`TD-4` was in `review` at retro time — not counted in the delivered set.)

---

## Sprint Summary

| Metric | Result |
|---|---|
| Stories completed | **8** — 5 planned (`3-1`, `3-2`, `2-6`, `2-7`, `2-5`) + 3 tech-debt (`TD-1`, `TD-2`, `TD-3`) |
| Code reviews | 8/8 through the 3-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor); all patches applied before `done` |
| Tests | client **271**, server **~375**, shared **136** — all green; `tsc --noEmit` 0 errors across all workspaces; all builds green |
| New test capability | **TD-1** stood up jsdom + React Testing Library + `user-event` client component tests (`src/test/` helpers); **2.5** was the first story to *ship* component tests on it |
| Stack upgrades | **TD-2** safe dependency bumps + Node engine alignment; **TD-3** React 18→19 + R3F 8→9 coordinated upgrade |
| Voice milestone | Real LiveKit SFU (v1.13.1): two-browser bidirectional Bomb Room audio verified by Jay on the prod Docker/Caddy stack |
| Parallelism | Worktree tracks (3.1+3.2 voice chain `ktane-wt-3x`; 2.6+2.7 lobby hardening); 2.5 last on master per the voice-parallelization plan |
| Production / host incidents | 0 |

**Delivered:** role-scoped LiveKit token minting (3.1) → Bomb Room bidirectional channel against a real SFU (3.2) → race-safe capacity / join-window via the new `updateJSON` primitive (2.6) → **the durable player-id identity primitive** + lobby resilience controls (2.7) → lobby roster / ready / mic-check (2.5), plus the client component-test harness (TD-1) and the dependency/runtime refresh (TD-2/TD-3).

> **Milestone A is now the *talking* game.** A Defuser + Expert defuse Wires over real voice, the server owns the clock/strikes/resolution, and the lobby is durable across refreshes with a working mic check.

## Sprint 2 Retro Follow-Through

| # | Sprint 2 action item | Status |
|---|---|---|
| 1 | Fix `solutionIndex` at the source (don't carry the answer in module data) | ✅ **Done** (`d1cd6d5`) — confirmed the leak was *live* (4.7 had wired the broadcast); now recomputed server-side at cut time |
| 2 | Widen Story 2.7 to own durable identity as a gameplay-authority dependency | ✅ **Done** — 2.7 delivered the durable-id primitive minted at first join… **but the consumer sweep was incomplete (What Hurt #1)** |
| 3 | Name the network-realism deferred class in `deferred-work.md` | ✅ **Done** — index table present (4.7 reconcile, strike-before-`BOMB_INIT`, clock-offset, two-team `resolveRound`, socket.id identity + operational gotchas) |
| Carry (Epic-1 AI4) | Host-facing LiveKit/coturn spike **before** 3.1's ACs are finalized | ⚠️ **Effectively skipped / back-filled** — the infra discovery happened during 3.2's interactive verification, not as an up-front spike; the coturn/TURN relay path is still un-exercised (What Hurt #5) |

## What Went Well

1. **The socket.id deferral finally reached its home.** Opened in **2.2**, re-flagged through 2.3/2.4, "metastasized" in the Sprint 2 retro — 2.7 paid it off with a durable player id decoupled from the rotating `socket.id`. The deferred-ledger's 3rd-appearance → owner-story heuristic worked end to end again.
2. **The deferred-gap → TD-story → resolution pipeline closed a full loop.** 2.1 deferred component tests ("no infra"); **TD-1** built the jsdom + RTL harness; **2.5 shipped the first real client component tests** on it. The ledger converted an "excuse" into delivered capability within the same epic arc.
3. **`updateJSON` became the standard mutation path.** The race-safe WATCH/MULTI primitive (2.6) was immediately reused by 2.7's removals and 2.5's ready-toggle — no new hand-rolled load-modify-store anywhere. Open/closed + reuse discipline holding.
4. **Voice hit the real network and held.** 3.2 brought up a real LiveKit SFU; Jay confirmed two-browser bidirectional Bomb Room audio on the prod Docker/Caddy stack, and killing voice never blocked the game. AR12 (voice-never-gates-game) held *mechanically* — `connectVoice` writes only `voiceStore`, enforced by the load-bearing "voice path never mutates gameStore" test.
5. **The 3-layer review kept earning its place on infra.** It caught a process-fatal adapter bug (2.6 `txConn` with no `'error'` listener), a Critical connect-epoch teardown leak (3.2 orphaned live SFU + hot mic on unmount-during-connect), and the dev-infra-in-prod-files hazard (3.2) — none reachable by the unit suites.

## What Hurt

1. **The durable-id sweep was incomplete — and it was a *known, named* gap.** 3.1's review explicitly said *"fold the voice handler into the 2.7 durable-id fix."* 2.7 swept the identity authority gates but **missed `voiceHandlers.ts` and `VoiceController.tsx`** (a separately-registered handler file; a client component outside the enumerated sweep). Result: two latent regressions shipped silently — `VOICE_TOKEN` returned `NOT_IN_SESSION` for *everyone*, and the bomb-room voice CTA *never rendered* — caught and fixed only by **2.5**. Tests masked the server half: `voiceHandlers.test.ts` seeded `players` by `socket.id`, so the gate "passed" in test while failing in production. A cross-cutting refactor with an explicitly-flagged dependent still fell through the seam.
2. **Dev-only infra hacks nearly shipped to prod.** To make WSL2 voice work, 3.2's first pass committed `Caddyfile :80` plain-HTTP + `livekit.yaml node_ip:127.0.0.1 / udp_port:0` straight into the **production** files. Review caught it and isolated everything into `Caddyfile.dev` / `livekit.dev.yaml` / `docker-compose.override.yml` so prod files stay secure-by-default. Real-environment verification pressure pushed environment-specific hacks into shared config.
3. **`updateJSON`'s real concurrency is still unverified in CI.** The headline race test (2.6) exercises the in-memory fake — a *different code path* from the real ioredis WATCH/MULTI adapter. With no CI Redis, the actual race is unproven by any standing test. This gap has now surfaced twice (2.6 and again here).
4. **The scariest bugs were in shared infra.** 2.6's dedicated transaction connection shipped **without an `'error'` listener** (an emitted error would crash the whole Node process), plus a WATCH leak on a throwing `mutate` and a `commit:true`/`value:undefined` key-corruption path. All three found only by adversarial review — infra bugs have the largest blast radius and the least test coverage.
5. **Epic-1 AI4 (the host voice spike) was effectively skipped.** Meant to de-risk voice infra *before* 3.1's ACs; instead the discovery landed during 3.2's interactive verification — the five WSL2 fixes (browser-reachable `node_ip`, http origin for `ws://` without mixed-content, ≥32-char secret, SFU protocol bump, ICE-TCP fallback). It worked out, but the longest-standing action item was back-filled at verification time, and Firefox's ICE-over-TCP timeout resurfaced in 2.5's interactive pass. The **coturn/TURN relay path behind symmetric NAT remains un-exercised.**

## Key Insights

1. **A *named* dependency is not a *discharged* one.** The 3.1→2.7→2.5 voice-identity miss proves that flagging a cross-cutting consumer in a review doesn't make the sweep find it. The fix is mechanical: grep the old pattern to **zero across every file** — separate handler registrations and client components included — at the refactor's `done`, recorded in Completion Notes.
2. **Verification pressure leaks into config.** First contact with a real subsystem (voice on WSL2) produces environment hacks; without a dev/prod config split *by default*, those hacks land in prod files. 3.2's `*.dev` + `docker-compose.override.yml` is now the standing pattern for environment-specific infra.
3. **The dev-harness ceiling now has a matching, named *test* gap.** Sprint 2 named the latency/reconnect/concurrency class; Sprint 3 showed the test gap — the one primitive built to handle concurrency (`updateJSON`) has no real-concurrency test. It's correctly parked behind CI-Redis infra, but it's now an explicit, tracked hole, not an oversight.

## Action Items (confirmed by Jay)

| # | Action | Owner | Done when |
|---|---|---|---|
| 1 | **Grep-to-zero gate for cross-cutting refactors.** When a shared primitive/identity is re-keyed or renamed, the story is not `done` until the old pattern (e.g. `state.players[socket.id]`, `getSocket().id`) greps to **zero across all files** — separately-registered handlers + client components included — with the grep result recorded in Completion Notes. | Game Developer | Applied at the next shared-primitive refactor; zero-grep evidence in that story's Completion Notes |
| 2 | **Close Epic-1 AI4 (resolved-by-absorption)** — Bomb Room voice is verified end-to-end on the real SFU. Re-file only the **un-exercised coturn/TURN/TLS-behind-symmetric-NAT** path as an explicit obligation on **Story 10-3** (and the production follow-ups already noted in 3.2: client-facing `LIVEKIT_PUBLIC_URL` `wss://`, restore http→https redirect + UDP mux + routable node_ip). Stop re-committing AI4. | Game Architect | AI4 marked closed in this retro; 10-3 carries the TURN/TLS obligation in its Dev Notes |

**Deferred (no action this cycle, confirmed by Jay):**
- **`updateJSON` real-concurrency test** — keep as a named deferred item owned by whenever CI-Redis infra lands (add a real-Redis/testcontainers integration test for the WATCH/MULTI race then). Don't stand up CI infra mid-feature-sprint. Has appeared twice (2.6, Sprint 3) — escalate to an action item if it recurs.

## Sprint 4 Preview & Inherited Obligations

Sprint 4 ("Easy modules complete + round framing"): `5-4` The Button, `5-5` Passwords, `4-6` Preparation placeholder bomb view, `8-1` Round configuration & difficulty gating, `8-6` Between-round flow & scoreboard preview. (A parallelization analysis already exists: *"Sprint 4 — Easy modules + round framing parallelization analysis.md"*.)

Dependencies on Sprint 3 work — all satisfied:
- **5-4 / 5-5** reuse the proven 5.1 module template + the `WiresRule[]` dual-consumption pattern (one rule array consumed by both solver and manual so they can't diverge), the `updateJSON` mutation primitive, and **durable identity** for the `MODULE_INTERACT` authority gate. `bombReducer.ts` must stay untouched (open/closed).
- **TD-1's component-test harness is now available** — Button/Passwords DefuserViews + manual pages should ship component tests (no "no infra" excuse), per the 2.5 precedent.
- **TD-3 just upgraded React 19 / R3F 9** — new module R3F views run on the freshly-upgraded renderer; watch for R3F 9 regressions in the new `DefuserView`s during interactive verify.
- **Apply Action Item 1's grep-to-zero gate** if any Sprint 4 story re-touches a shared primitive.

Not in Sprint 4 (correctly parked): the **voice remainder** — 3-3 spectator lounge, 3-4 speaker pill + mute (reuses 2.5's `voiceStore.activeSpeakers` + 150ms stop-grace primitive), 3-5 token re-mint on role change, 3-6 graceful degradation, and the **facilitator PTT-into-Bomb-Room bridge** (new scope, surfaced in 3.1's review) — all sit in Sprint 5 ("Relay, resilience & full voice").

## Readiness Assessment

- **Quality:** all Sprint 3 gates green (typecheck, ~782 tests across workspaces, builds); every story passed 3-layer adversarial review with patches applied before `done`.
- **Deployment:** local-only by design; verified on the real prod Docker/Caddy stack (`https://localhost` for game, dev-override `http://localhost` for the `ws://` LiveKit check). Prod config now secure-by-default after the 3.2 dev/prod split. Nothing pending.
- **Stakeholders:** solo project; Jay's interactive prod-stack passes are the acceptance mechanism (Sprint 1 AI2), exercised on every user-visible story (3.2 two-browser voice; 2.5 mic-check + ready + re-confirm of the review patches).
- **Stability:** no open blockers. Known accepted limitations — `updateJSON` real-concurrency unverified (deferred to CI-Redis), coturn/TURN behind symmetric NAT (10-3), Firefox ICE-over-TCP on WSL2 (dev-environment transport limit, not a code defect), reattach edge cases in 2.7 (team-seat durability, TTLs — V1 lobby scope) — all tracked.
- **Verdict:** **Sprint 3 is genuinely done.** Milestone A is mechanically complete *and* talking. No epic-definition updates required — the voice-subset pull-forward held, and every significant discovery was absorbed via the deferred-ledger / named-owner mechanism. The one process miss (incomplete cross-cutting sweep) is now covered by Action Item 1. Sprint 4 may start; `TD-4` (in `review`) should land first since it touches the build toolchain the module work runs on.
