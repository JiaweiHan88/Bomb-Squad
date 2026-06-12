# Sprint 1 Retrospective — Minimal Session + Bomb Shell

- **Date:** 2026-06-12
- **Facilitator:** Link Freeman (Game Developer)
- **Participants:** Jay (Project Lead), Link Freeman (Game Developer), Cloud Dragonborn (Game Architect), Samus Shepard (Game Designer), Paige (Tech Writer)
- **Scope:** Sprint 1 of the sprint plan — Stories 2.1, 2.2, 2.3, 2.4 (Epic 2 lobby slice) + 4.1, 4.2, 4.3 (Epic 4 bomb shell). All 7 done.
- **Note:** Sprint retro, not an epic retro — Epics 2 and 4 remain in-progress by design (playability-first sequencing). Epic retrospective keys in sprint-status.yaml stay untouched.

---

## Sprint Summary

| Metric | Result |
|---|---|
| Stories completed | 7/7 |
| Code reviews | 7/7 passed 3-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor); all patches applied before `done` |
| Test growth | client 6 → 76, server 64 → 147, shared 24 — ~295 total, all green |
| Gates | `tsc --noEmit` 0 errors across all workspaces on every story; all builds green |
| Correct-course events | 1 — Epic 2 lobby follow-up (new Story 2.7), approved & artifacts synced |
| Deferred-work ledger | ~14 new entries; ledger directly spawned Story 2.7 |
| Production / host incidents | 0 |

Delivered: Tailwind v4 design-token system + operator shell (2.1) → `SESSION_CREATE` vertical slice establishing the canonical handler pipeline + TestSocketServer harness (2.2) → join-via-code + roster (2.3) → facilitator team/role assignment with the codebase's first authority gate (2.4) → R3F letterboxed stage + camera rig (4.1) → diegetic chassis metadata, serial findable <10 s (4.2) → registry-driven module bays + solve LEDs (4.3).

## Epic 1 Retro Follow-Through

| # | Action item | Status |
|---|---|---|
| 1 | "Local Environment Constraints" section in project-context.md | ❌ Not done — **re-committed this retro (action item 3)** |
| 2 | Spec-hygiene rule (vendor numbers need derivation) in project-context | ❌ Not done — folded into action item 3 |
| 3 | "Verify" tasks capture observed runtime output | ✅ Done and stuck — live headless smokes with grep evidence (AR15) on every server story; Playwright+SwiftShader smokes with per-check results on every scene story. The one lapse (2.1's unexecuted smoke checkbox) was caught by the Acceptance Auditor and re-run by Jay. |
| 4 | Host-facing LiveKit/coturn spike before Epic 3 | ⏳ Pending — due before Story 3.1 ACs are finalized (Sprint 3) |

## What Went Well

1. **Worktree-based parallel development, second sprint running** (Jay's highlight). Lobby (Epic 2) and bomb shell (Epic 4) ran in parallel worktrees; the deliberate "App.tsx stays one surgical branch" discipline in 4.1–4.3 made merges trivial.
2. **Handler pipeline compounding.** 2.2 established validate → load → guard → pure fn → persist-then-emit → broadcast plus its test harness; 2.3 and 2.4 were near-mechanical "second/third verses." The pattern every Epic 8 facilitator action will copy now exists and is review-proven.
3. **Pure-fn + thin-component house pattern is reflexive.** `platform.ts`, `joinCode.ts`, `stage.ts`, `layout.ts`, `chassis.ts`, `moduleLed.ts` — all logic testable in Node, React layers kept dumb. Review lessons propagated forward: 4.1's count-range overlap finding led 4.2/4.3 to pre-emptively sweep full count domains.
4. **Security posture arrived intact on first contact.** Authority checked against Redis-loaded state, gate-before-target-checks (no probe leakage), facilitator-role minting rejected at the boundary, AR15 (join code never logged) verified live by grep in three consecutive stories.
5. **Runtime-evidence culture (Epic 1 action item 3) held** — and the human visual pass proved its worth (Jay: seeing features "in production" matters; 4.2/4.3 explicitly flagged feel checks only a human can do).
6. **Review quality trended up:** 2.1 took 8 patches; 2.3's Acceptance Auditor returned fully clean (0 patches); 2.4 took 1.

## What Hurt

1. **Worktree full-stack testing gap** (Jay's primary pain point). The lightweight smoke path (throwaway redis/postgres + `tsx` on worktree source) works, but full-compose testing inside a worktree breaks two ways: gitignored `.env` files don't exist in a fresh worktree, and docker images built from the main checkout silently run stale code while appearing current. Gets worse in Sprint 2 (snapshot sync, Epic 8 pulls) and Sprint 3 (LiveKit/coturn). → Action item 1.
2. **Requirements gaps surfaced post-implementation → Story 2.7** (remove player; refresh ghost-roster; prefilled link with no submit affordance). **Jay's ruling: this is the system working as intended** — exhaustively pre-specifying every UX state isn't realistic; the validation-pass → correct-course loop is the designed mechanism, and more UI/UX follow-up stories are expected along the way. Not a process failure.
3. **Deferred-work ledger density.** ~14 new entries vs. a handful resolved; the socket.id-identity deferral recurred across three story reviews before 2.7 gave it a home; three handlers share the same accepted load-modify-store race. **Jay's ruling: observe, no action.** Watch heuristic adopted: a deferral appearing in a third story review is the signal to propose a story (that signal is what produced 2.7).
4. **Spec-vs-repo drift, small blast radius:** Story 2.2's spec assumed Vitest on the server where the repo uses Jest. Caught, followed-the-repo, documented, settled (server=Jest, client=Vitest). Same failure *shape* as Sprint 0's port-range incident — an unchecked environmental assertion in a spec — at trivial cost this time.

## Action Items (confirmed by Jay)

| # | Action | Owner | Done when |
|---|---|---|---|
| 1 | **Worktree test-environment provisioning:** documented procedure (script or checklist) to provision env files from the main checkout and run compose with a worktree-scoped project name, always building images from the worktree context (`--build`) so stale main-built images can never be tested by mistake. Minimal published-port set (WSL2 ~256-port cap — one full stack at a time). | Game Developer | Procedure exists and is used by the first Sprint 2 story needing the full stack |
| 2 | **Standing story rule — human verification subtask:** every story with a user-visible, e2e-testable surface carries an explicit "Jay verifies interactively" subtask; observed result recorded in Completion Notes before `done`. | Game Developer (story creation) | Present in every applicable Sprint 2 story spec |
| 3 | **Clear the overdue Epic-1 debt:** add "Local Environment Constraints" section + spec-hygiene rule to `project-context.md`, folding in the worktree-testing guidance from item 1 (WSL2 port cap, bind-mount recreate quirk, vendor-number derivation rule, worktree env/image rules). | Game Architect | Section exists; cited by the first infra-touching story (Epic 3 at the latest) |

**Watch items (no action, per Jay):** deferred-work ledger density — escalate any deferral on its third story-review appearance into a story proposal.

## Sprint 2 Preview & Critical Path

Sprint 2 ("Wires playable end-to-end"): 5.1, 5.2, 5.3, 4.4, 4.5, 4.7 + pulled-forward 8.2, 8.3, 8.4, 8.5.

Inherited obligations, each with a named owner-story:

- **8.2** — first server-side *runtime* import of `packages/shared` values (`hash`, `makeSeededRng`): the deferred `.ts`-source exports strategy (open since 1.2/1.3) comes due here. Also owns the `batteryCount` clamp (4.2 deferral).
- **8.4** — make the transient-`'struck'` MODULE_UPDATE broadcast an explicit server contract (4.3's flag; required for correct strike-flash attribution). Also the StrikeCount resting-`3` modeling question (1.3 deferral).
- **5.1** — absorb the module-reducer output guard (1.6 deferral) into the module plugin contract.
- **4.4** — vendor DSEG7 as ttf/woff for WebGL text (troika cannot load woff2; same drill as the 4.2 mono font).
- **Action item 1 (worktree stack)** should land before the stories that need full-stack verification.

## Scheduling Decision

- **Story 2.7 (lobby resilience & facilitator player controls) → Sprint 3**, alongside 2.5/2.6 and the voice pull-forwards. Sprint 2 stays purely on the walking skeleton. Sprint plan updated.

## Readiness Assessment

- **Quality:** all Sprint 1 gates green (typecheck, ~295 tests, builds); every story passed adversarial review with patches applied.
- **Deployment:** local-only by design; nothing pending.
- **Stakeholders:** solo project; Jay's interactive passes are the acceptance mechanism (now formalized via action item 2).
- **Stability:** no open blockers. Known accepted limitations (socket.id identity, lobby races) are scheduled (2.7 / 2.6) or watch-listed.
- **Verdict:** Sprint 1 is genuinely done. Sprint 2 may start once stories are created; no epic-definition updates required (the one significant discovery — the 2.7 requirements gap — was already absorbed via the approved correct-course).
