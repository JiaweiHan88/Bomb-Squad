# Sprint 4 Retrospective — "Easy modules complete + round framing"

- **Date:** 2026-06-19
- **Facilitator:** Link Freeman (Game Developer)
- **Participants:** Jay (Project Lead), Link Freeman (Game Developer), Cloud Dragonborn (Game Architect), Samus Shepard (Game Designer), Paige (Tech Writer)
- **Scope:** Sprint 4 of the sprint plan — planned `5-4`, `5-5`, `4-6`, `8-1`, `8-6`; plus tech-debt `TD-4` (landed at sprint start) and `TD-5` (player-simulator, created and closed in-window). All done.
- **Note:** Sprint retro, not an epic retro — Epics 4, 5, and 8 remain `in-progress` by design (playability-first sequencing). Epic-retrospective keys in `sprint-status.yaml` stay untouched.

---

## Sprint Summary

| Metric | Result |
|---|---|
| Stories completed | **7** — 5 planned (`5-4`, `5-5`, `4-6`, `8-1`, `8-6`) + `TD-4` (toolchain) + `TD-5` (player-simulator) |
| Code reviews | 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on every feature story; patches applied before `done`. TD-5 closed on e2e + live evidence (Jay's call) without a separate review. |
| Tests | shared **211**, server **427**, client **310** — all green; `tsc --noEmit` 0 errors across all workspaces |
| New capability | **TD-5** headless bot swarm — solo multiplayer verification (Docker-free in-process e2e + live Docker stack), unblocking human-verify for 2-team / rotating-defuser flows |
| Human verification | `8-1` and `8-6` gates **cleared live** on the Docker stack using the TD-5 bot swarm; `4-6` / `5-4` / `5-5` verified interactively in-sprint |
| Production / host incidents | 0 |

**Delivered:** the three Easy modules complete — The Button (`5-4`, live-timer-into-RELEASE seam) + Passwords (`5-5`, unique-word generation) joining Wires — plus the round framing: the value-free Preparation placeholder bomb (`4-6`), facilitator round configuration & difficulty gating (`8-1`, the two-pool split), and the all-teams-resolved between-round flow + reconnect-safe scoreboard preview (`8-6`). Capped by `TD-5`, a headless bot swarm that makes solo multiplayer verification possible.

> **Milestone B is in reach:** a complete, multi-round, two-team relay session on the three Easy modules is now playable *and* verifiable by one person. The remaining gap to "shippable internal playtest" is the relay/resilience/voice remainder (Sprint 5).

## Sprint 3 Retro Follow-Through

| # | Sprint 3 action item | Status |
|---|---|---|
| 1 | Grep-to-zero gate for cross-cutting refactors | ✅ **Applied** — 8.1's facilitator panel gates on `myPlayerId`, not `getSocket().id` ([[identity-key-change-needs-client-sweep]] held). Not stress-tested this sprint (no shared-primitive re-keying). |
| 2 | Close Epic-1 AI4; push coturn/TURN/TLS to Story 10-3 | ✅ Parked correctly — no voice work in Sprint 4. |
| Deferred | `updateJSON` real-concurrency test (owned by CI-Redis) | ⚠️ **Recurred** — the load-modify-store race bit again during TD-5 bring-up (concurrent `TEAM_ASSIGN` only the last write survived). **3rd appearance** (2.6, Sprint 3, TD-5) → escalated to an action item this retro per the S3 recurrence rule. |

## What Went Well

1. **The deferred-ledger now spawns *infrastructure*, and closed a full loop in one session.** 8.6's human-verification gate was consciously *deferred* (Jay's call, 2026-06-17, tracked in `deferred-work.md`); `TD-5` was then created specifically to unblock it, built, and used to clear **both** 8.6 and 8.1's gates live on the Docker stack — all within one session. Same shape as Sprint 3's 2.1→TD-1 (testing capability), now applied to *verification* capability.
2. **Copy-the-template module discipline held a third time.** Button and Passwords were built file-for-file off the 5.3 Wires template; the rule-data-shared-by-solver-and-manual pattern and the untouched `bombReducer` (open/closed) held. Button's one real novelty — the live displayed-timer digit rides in on the `RELEASE` action so the clock never enters the pure reducer — is exactly the seam Story 8.4's server timer was built for, and TD-5's bot reused that same pure path to solve hold-buttons.
3. **The two-pool split (8.1) prevented a self-inflicted disaster.** AC-1 literally listed un-generatable modules (Medium/Hard tiers). Separating `TIER_CATALOG` (display/gating) from `TIER_POOLS` (runtime generation) kept a bad pool from ever reaching `generateLayout`; both client and server reject un-generatable ids at *configure* time, not at ROUND_START.
4. **3-layer review kept earning its place — real bugs the unit suites couldn't reach.** 8.1: `timerMs` had no upper bound → 32-bit `setTimeout` overflow could detonate a round at t≈0. 5.5: random start positions could be born already spelling the solution (~1/7776 → instant SUBMIT solve). 8.6: timer-LCD keeps counting after resolution; the between-rounds gate conflates "timer key gone" with "team resolved." All non-obvious, all caught pre-`done`.
5. **8.6's all-teams-resolved gate fixed a genuine correctness bug.** Story 8.5 flipped status to `between-rounds` on the *first* team to resolve — which, with parallel two-team play, would route a still-playing team off its bomb mid-round. The gate now fires only when every participating team has resolved; proven by a concurrent two-team test (fires exactly once) plus a first-team-stays-active test.

## What Hurt

1. **Human verification is the solo-dev critical path.** It forced 8.6 to `done` with the gate *deferred* (against [[human-verification-ac-rule]]) because the dev harness structurally cannot form two teams with rotating defusers. Right call, tracked — but a `done` story carried an unverified gate for ~2 days. (This is the hurt that *became* the sprint's best win, via TD-5.)
2. **Interactive verification still catches what tests can't, late.** 4.6's solve-LED leak — a green light on an empty Preparation bay, from the `DEV_PLACEHOLDER` fallback — was found only by Jay's first look, not by the jsdom suite (R3F is never mounted in jsdom). The visual/3D render-correctness gap named in earlier sprints persists.
3. **AC under-specification surfaced mid-dev.** TD-5's AC-2 assumed player-bots could self-assign teams, but `TEAM_ASSIGN` is facilitator-only — forcing a two-mode (autonomous + hybrid) redesign mid-build. Handled and documented, but even a well-grounded story missed a server-authority constraint until code.
4. **A trusted-client-input deferral is now more relevant.** 5.4 deferred "the server must recompute the displayed `RELEASE` timer digit; never trust the client `timerDigits`." Epic 8 has since landed the production `MODULE_INTERACT` path, so the obligation is closer to live — and TD-5 concretely demonstrates a client supplying those digits (faithfully, but a malicious client could forge them).

## Key Insights

1. **A named constraint that blocks a *class* of work becomes a tooling story that removes it permanently.** 2.1→TD-1 (testing harness); 8.6-deferral→TD-5 (verification harness). The deferred-ledger is now a capability-generation engine, not just a fix-tracker.
2. **Human verification is now partially automatable.** TD-5 converts "needs N humans / N browsers" into "1 human + a bot swarm" for everything except LiveKit voice and 3D-feel. The residual human-only surface is narrowing to exactly what bots can't do — which makes it worth defining, per story, *what the human still needs to validate* (Action Item 2).
3. **"Done" and "verified" decoupled this sprint — and it only worked because the deferral was explicit and tracked.** A `done` story with an open human-verify gate is a small debt; the rule held because the ledger named an owner (TD-5) and a closing condition.

## Action Items (confirmed by Jay)

| # | Action | Owner | Done when |
|---|---|---|---|
| 1 | **Escalate the load-modify-store / concurrency theme** (3rd recurrence: 2.6, S3, TD-5 bring-up). Two prongs: (a) bots/clients must **serialize lobby-authority mutations** — never fire concurrent `TEAM_ASSIGN`/authority writes against the single session key (TD-5's sequential-assign is the reference); (b) the server `updateJSON` **real-concurrency test** stays owned by CI-Redis and is added the moment that infra lands. | Game Developer / Architect | (a) applied in TD-5 and any future multi-emit client; (b) real-Redis WATCH/MULTI race test added when CI-Redis exists |
| 2 | **Every story ships explicit human-validation instructions** (Jay's request, verbatim: *"I would like to have instruction of what human can validate after implementation of every story."*). Each story's human-verification subtask must spell out — in plain steps — exactly what Jay validates after implementation, distinct from automated/bot coverage: what to look at, what "correct" looks like, and (where applicable) the TD-5 bot command to stand up the multiplayer state. Extends [[human-verification-ac-rule]] from "a gate exists" to "the gate has runnable instructions." | Game Developer (in `create-story` / `dev-story`) | The next story authored carries a concrete, step-by-step human-validation section; pattern applied from Sprint 5 onward |
| 3 | **Server recomputes the displayed `RELEASE` timer digit; never trust client `timerDigits`** (5.4 deferral, now relevant since production `MODULE_INTERACT` exists). Add to the Epic 8 server-hardening checklist. | Game Developer | The Button's server interaction path recomputes the digit from the authoritative timer instead of trusting the payload |

**Deferred (watch, no action this cycle):**
- **R3F / 3D visual render-correctness is still eye-only** (4.6 solve-LED leak). Don't stand up visual-regression infra mid-sprint; watch for recurrence — escalate if a third visual-only defect ships.

## Sprint 5 Preview & Inherited Obligations

Sprint 5 ("Relay, resilience & full voice"): `8-7` Pause/disconnect, `8-8` Retry a failed round, `8-9` Relay orchestration & odd-team equalisation, `8-10` Scoring / final scoreboard / session-end persistence, plus the voice remainder `3-3`/`3-4`/`3-5`/`3-6`. (A parallelization analysis already exists.)

Dependencies on Sprint 4 — satisfied, with new leverage:
- **`8-7` (pause/disconnect)** inherits the durable-id reconnect class (2.7) — and **TD-5 can now simulate disconnect/reconnect** (it captures each bot's `reattachToken`), so this story gets a verification path the dev harness never had.
- **`8-9` (relay orchestration)** defines the "every player defuses once" round count — exactly the rotation TD-5 already exercises (`currentDefuserIndex` wrap). The 8.6 verification **confirmed a significant gap to close in Sprint 5: there is no automatic final scoreboard / session end today** (the between-round loop is facilitator-driven and the rotation wraps indefinitely). This is by design (8.10 + 8.9 are backlog), not a misalignment — but Sprint 5 owns delivering the terminal state.
- **`8-10` (final scoreboard / persistence)** builds directly on 8.6's `TeamState.roundTimesMs` per-round history.
- **Apply Action Item 2 from the first Sprint 5 story**: ship human-validation instructions, leaning on TD-5 to stand up the multiplayer state.

## Readiness Assessment

- **Quality:** all Sprint 4 gates green (typecheck; shared 211 / server 427 / client 310; builds); every feature story passed 3-layer adversarial review with patches applied before `done`. TD-5 closed on workspace typecheck + `pnpm verify` 6/6 + a live Docker smoke.
- **Deployment:** local-only by design; the full prod Docker/Caddy stack was brought up and exercised this session (server healthy, client + Caddy serving, bots driving real rounds). Dev-override (`http://localhost`) used for the bot/human verification.
- **Stakeholders:** solo project; Jay's interactive Docker-stack passes are the acceptance mechanism — exercised on 4.6, 5.4, 5.5, and (via the TD-5 bot swarm) 8.1 + 8.6 this sprint.
- **Stability:** no open blockers. Known accepted limitations — `updateJSON` real-concurrency unverified (now Action Item 1b, CI-Redis), coturn/TURN behind symmetric NAT (10-3), trusted `RELEASE.timerDigits` (Action Item 3), no terminal session state yet (8.9/8.10), R3F visual correctness eye-only — all tracked.
- **Verdict:** **Sprint 4 is genuinely done.** The Easy-module set is complete and the round framing is in place and verified end-to-end by one person — the headline being that the deferred-ledger generated the very tool (TD-5) that made solo multiplayer verification possible, then used it to close its own gates. Sprint 5 may start; carry the three action items, and apply the human-validation-instructions rule from its first story.
