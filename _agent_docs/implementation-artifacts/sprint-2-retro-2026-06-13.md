# Sprint 2 Retrospective — "Wires playable end-to-end"

- **Date:** 2026-06-13
- **Facilitator:** Link Freeman (Game Developer)
- **Participants:** Jay (Project Lead), Link Freeman (Game Developer), Cloud Dragonborn (Game Architect), Samus Shepard (Game Designer), Paige (Tech Writer)
- **Scope:** Sprint 2 of the sprint plan — Stories 5.1, 5.2, 5.3, 4.4, 4.5, 4.7 + pulled-forward 8.2, 8.3, 8.4, 8.5. All 10 done.
- **Note:** Sprint retro, not an epic retro — Epics 4, 5, 8 remain in-progress by design (playability-first sequencing). Epic-retrospective keys in sprint-status.yaml stay untouched.

---

## Sprint Summary

| Metric | Result |
|---|---|
| Stories completed | 10/10 |
| Code reviews | 10/10 passed 3-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor); all patches applied before `done` |
| Test growth | shared 24 → **136**, server 147 → **301**, client 76 → **204** — ~**641 total**, all green (~+390 in one sprint) |
| Gates | `tsc --noEmit` 0 errors across all workspaces on every story; all builds green |
| Parallelism | 4-wide worktrees with chained-story bundling (`4.4+4.5` and `8.3+8.4` each shared one worktree) |
| Human verification | Every user-visible story verified by Jay on the **full Docker/Caddy prod stack** (`https://localhost`), stronger than the dev-server path the specs asked for |
| Production / host incidents | 0 |

**Delivered:** module plugin contract + sandbox + click primitive (5.1) → expert manual viewer (5.2) → **Wires module — the walking skeleton's payload** (5.3) → diegetic timer LCD with client extrapolation (4.4) → strike indicator + roll-up (4.5) → snapshot sync & optimistic 60fps render (4.7), plus the server-authoritative spine: per-team bomb generation (8.2), round-start / rotation / preparation (8.3), authoritative timer + strike escalation (8.4), round resolution (8.5).

> **Milestone A's loop is now mechanically complete — everything except voice.** A Defuser sees the bomb, an Expert reads the manual, the server owns the clock and strikes, and the round actually resolves (defused / detonated / time-expired). Sprint 3 makes it the *talking* game.

## Sprint 1 Retro Follow-Through

| # | Action item | Status |
|---|---|---|
| 1 | Worktree full-stack test-env provisioning procedure | ✅ **Done & used** — full-stack verification ran on the real Docker stack in 8.3 / 8.4 / 8.5 / 4.7. *Gap:* it does not cover the runtime gotchas (tsx-watch wake-drop, live host-port collision); those bit again and were captured as agent-memory, not procedure. |
| 2 | Standing rule: "Jay verifies interactively" subtask on every e2e surface | ✅ **Done & stuck** — present in every applicable story; demonstrably caught defects no test reached (8.3 prep ×3, 4.7 ×2, 4.5 glow). |
| 3 | "Local Environment Constraints" section in binding `project-context.md` (Architect) | ❌ **Was not done — overdue twice (originated Epic 1).** Knowledge exists, but in auto-recalled agent-memory files. **Resolution this retro (Jay): accept agent-memory as canonical; close the item, stop re-committing it** (the memory is auto-recalled each session, which serves the original goal). |
| Watch | Deferred-ledger 3rd-appearance → propose a story | ✅ **Fired correctly** — socket.id-as-identity reached its home (Story 2.7), scheduled for Sprint 3. |

Carry-forward from **Epic 1 retro**: AI4 (host-facing LiveKit/coturn spike) is **still pending** — now due before Story 3.1's ACs are finalized (Sprint 3). It is the longest-standing open action and sits on the Sprint 3 critical path.

## What Went Well

1. **The dev-demo template paid off exactly as designed.** Story 5.1 built `dev-demo` as the exemplar; Story 5.3 (Wires) copied it *file-for-file* + **exactly three integration lines** (client barrel import + `SANDBOX_MODULES` entry, `MODULE_REDUCERS` entry). **`bombReducer.ts` was untouched through the entire module addition** — open/closed held under real load, not just in theory. Implementer's verdict: "the template scales to a real module with zero friction." The `WiresRule[]` pattern (one rule array consumed by *both* the solver and the manual, so they cannot diverge) is now the recommended shape for the Button/Passwords decision tables.
2. **Worktree parallelism matured into bundling.** Sprint 1 ran two parallel tracks; Sprint 2 ran four — and the new move was *bundling chained stories into one worktree* (4.4→4.5, 8.3→8.4) so a hard dependency never crossed a merge boundary. The merge surface stayed small and additive (shared `events/`), every merge trivial.
3. **Inherited-obligation tracking worked end-to-end.** Sprint 1's retro named owner-stories for five deferrals; **every one came due and was resolved by its named owner this sprint** — 8.2 took the shared-`.ts` runtime-export strategy + battery clamp, 8.4 made transient-`'struck'` an explicit server contract and settled the resting-`StrikeCount=3` question, 5.1 absorbed the reducer output guard, 4.4 vendored DSEG7 for WebGL text. The deferred-work ledger is functioning as a real planning instrument, not a graveyard.
4. **Runtime-evidence culture deepened a level.** Verification moved from dev-server to the **full prod Docker/Caddy stack over `https://localhost`** — 8.3's three-browser facilitator+2-player session exercising the real same-origin Caddy `/socket.io/*` proxy; 8.4's autonomous, server-emitted `BOMB_EXPLODED` observed in the defuser console with *no client action* (the clearest possible proof of server authority).
5. **Human verification kept earning its place.** Jay's interactive passes surfaced real defects no automated check reached: three preparation-flow gaps (8.3, all fixed), timer-glow washing the LCD digits at 2–3 strikes (4.5), the LCD not freezing + the resolution banner's scroll-repaint flicker on resolve (4.7 → both fixed in 8.5). Sprint 1 Action Item 2 is directly responsible.

## What Hurt

1. **The socket.id-as-identity deferral has metastasized — and changed category.** It now touches 6+ reviews (2.2 / 2.3 / 2.4 lobby, 5.2 manual relay, 8.3 stale-defuser, 4.7 mid-round restore). Critically, **4.7 turned it into a *correctness* dependency, not lobby cosmetics**: the `MODULE_INTERACT` authority gate refuses a reconnected Defuser (`NOT_TEAM_DEFUSER`) and never re-sends `BOMB_INIT`. Story 2.7 is the home and is in Sprint 3 — but it was scoped as *lobby* resilience while the dependency is now *gameplay* authority.
2. **The cross-worktree seam is nobody's story — and it holds the one live risk.** `solutionIndex` (the Wires answer) is baked into module `data` in 5.3 (forced by the reducer signature carrying no `BombContext`). It hasn't leaked only because the `BOMB_INIT` broadcast seam at `sessionHandlers.ts:678` is *still empty*: 8.2 generates+persists, 8.3 emits `SESSION_STATE` but leaves the bomb-broadcast seam unfilled. The cheat value leaks the moment the 8.2↔8.3 merge wiring fills that seam — exactly the integration point neither parallel worktree owned.
3. **A whole class of bugs is structurally invisible to the dev harness.** Single-process, localhost (~1 ms), same-origin, human-speed. 4.7's wrong-cut pre-flash rolls back via a 2 s timer instead of reconciling the contradicting `armed` snapshot — "visible on real-latency connections, invisible on the ~1 ms localhost where verification passed." Same shape as the strike-before-`BOMB_INIT` race, the clock-offset-on-reconnect bias, and the two-team `resolveRound` lost-update (which needed a review patch). **Reconnect + real latency + true concurrency is one coherent deferred class** — correctly deferred story-by-story, but never named as a single risk until now.
4. **Operational gotchas bit again despite Sprint 1 AI1.** Story 8.4's verification burned real debugging time on (a) `tsx watch` restarting the worker and dropping the in-memory `setTimeout` expiry wake (single-process V1), and (b) a worktree host-port collision landing the dev server on the wrong, passworded Redis (`NOAUTH`). Neither was a code defect; both are now agent-memory entries. They're *runtime/operational*, which the env-file provisioning procedure (AI1) structurally doesn't cover.

## Key Insights

1. **Open/closed is proven, not aspirational** — a real gameplay module shipped with zero core-reducer diff. The Epic 5/6/7 module pipeline is de-risked.
2. **The deferred-work ledger is the project's actual planning spine** — named owner-stories converted 100% of Sprint 1's inherited obligations on schedule, and the 3rd-appearance watch heuristic correctly produced Story 2.7.
3. **The dev harness has a hard ceiling**: it cannot reach reconnect / latency / concurrency correctness. Sprint 3 (voice = the first real-network subsystem, the first true cross-client presence) walks straight into that ceiling — so the network-realism class graduates from "scattered deferrals" to "named risk we plan around."

## Action Items (confirmed by Jay)

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | **Fix `solutionIndex` at the source — don't carry the answer in module data.** Recompute server-side at interaction time so there is nothing to strip. | Game Developer | ✅ **DONE** (commit `d1cd6d5`). `WiresState` now carries the public `BombContext`, not `solutionIndex`; `wiresReducer` recomputes `solveWires(colours, ctx)` per cut. tsc 0 / 136·204·301 green / build green. **Severity correction:** the leak was **already LIVE** — Story 4.7 (after the 5.3 review) wired the production `MODULE_INTERACT`→`MODULE_UPDATE` + `BOMB_INIT` broadcast with no stripping, so the answer was reaching the Defuser's client as of `c46f5cf`. The "pre-leak" assessment below was wrong; the source-fix closes it. |
| 2 | **Widen Story 2.7's scope before Sprint 3 story-creation** to own *durable identity as the gameplay-authority + mid-round-restore dependency*, not only lobby resilience. | Game Developer (story creation) | ✅ **DONE.** `epics.md` Story 2.7 gains a durable-identity AC + scope note (2.7 owns the identity primitive; 8.7/FR13 still owns the pause/restore ceremony built on it); `sprint-plan.md` annotated; 4.7/8.7 deferrals already cite 2.7. |
| 3 | **Name the network-realism deferred class in `deferred-work.md`** — one grouping index for the latency/reconnect/concurrency entries. | Game Developer | ✅ **DONE** (commit `d1cd6d5`). Index table added (4.7 reconcile, strike-before-`BOMB_INIT`, clock-offset, two-team `resolveRound`, socket.id identity) + the operational env gotchas, citing owners 8-7 / 10-3 / 10-5. |
| 4 | **Close Epic-1/Sprint-1 AI3 (env-constraints).** Accept auto-recalled agent-memory as canonical; stop re-committing the `project-context.md` section. | Game Architect | ✅ **DONE** — decision recorded (this retro); not carried forward again. |

**Critical path before Sprint 3:**

1. **Host-facing LiveKit/coturn spike** (Epic-1 AI4, still pending) — must complete before Story 3.1's ACs are finalized. Longest-standing open action; voice cannot be honestly speced without it.
2. **Action item 1 (`solutionIndex` source-fix)** — land before/with the `BOMB_INIT` broadcast wiring so the answer never ships pre-computed.

**Watch items (no action):** the operational gotchas (tsx-watch in-memory-wake drop on restart; worktree host-port collision onto a passworded store) apply *hard* to the Sprint 3 voice worktrees — already captured in agent-memory, cited in the Sprint 3 plan; verify voice only against real LiveKit + coturn containers.

## Sprint 3 Preview & Inherited Obligations

Sprint 3 ("Voice on the skeleton"): pulled-forward 3.1 (LiveKit token mint) + 3.2 (Bomb Room channel), plus 2.5 / 2.6 / 2.7 (lobby roster/ready/mic-check, capacity guards, resilience).

Planned shape (from the voice-parallelization analysis): two Wave-1 worktrees — **A** = 3.1+3.2 (voice chain), **B** = 2.6+2.7 (lobby hardening) — then 2.5 last on master (its mic-check rides on 3.2's voice room, its UI rides on 2.7's rewritten Lobby). Merge surface is additive on shared `events/` (`VOICE_TOKEN` from A, `PLAYER_REMOVE` + capacity error from B).

Inherited obligations, each with a named owner-story:

- **2.7 (widened, per AI2)** — durable player id; unblocks reconnect/rejoin, the 4.7 `MODULE_INTERACT` authority gate, and 8.7 mid-round Defuser restore. Voice tokens are also per-player-keyed, so 3.1/3.2 inherit the same socket.id fragility — sequence identity early.
- **3.1** — config is already validated (`LIVEKIT_URL`/`API_KEY`/`API_SECRET`/`TURN_SECRET`/`TURN_TTL`) and the LiveKit container is wired (`livekit/livekit-server:v1.8`, UDP mux 7882); 3.1 adds the npm SDKs and mints immediately. **Blocked on the AI4 host-facing spike for AC realism.**
- **3.2** — fills the existing shape-only `voiceStore` stub; per AR12/ADR-007 voice never gates game state, so it touches no reducer/session logic.

## Readiness Assessment

- **Quality:** all Sprint 2 gates green (typecheck, ~641 tests, builds); every story passed 3-layer adversarial review with patches applied.
- **Deployment:** local-only by design; verified on the real prod Docker/Caddy stack (`https://localhost`). Nothing pending.
- **Stakeholders:** solo project; Jay's interactive prod-stack passes are the acceptance mechanism (formalized as Sprint 1 AI2, exercised on every user-visible story).
- **Stability:** no open blockers. The one real risk (`solutionIndex`) turned out to be a **live answer-leak** (4.7 had already wired the broadcast — not pre-leak as first assessed) and is now **closed at the source** (commit `d1cd6d5`). Known accepted limitations (socket.id identity, single-process timer wakes, latency/concurrency class) are scheduled (2.7, widened) or named as a tracked watch-cluster.
- **Verdict:** **Sprint 2 is genuinely done.** Milestone A's loop is mechanically complete pending voice. No epic-definition updates required — the playability-first sequencing held, and every significant discovery was absorbed via the deferred-ledger / named-owner mechanism. Sprint 3 may start once the AI4 voice spike lands and stories are created.
