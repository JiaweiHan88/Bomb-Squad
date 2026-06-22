# Sprint Change Proposal — Sequential Round Play (Model B) Correction

- **Date:** 2026-06-20
- **Author:** Amelia (Dev) with Jay
- **Trigger story:** 8.9 (Relay Orchestration & Odd-Team Equalisation), status `review`, unmerged worktree `worktree-s5-epic8-relay`
- **Scope classification:** Moderate (backlog reorganization — new story + AC edits across two epics; no replan)
- **Decision:** Approved by Jay, 2026-06-20

---

## Section 1 — Issue Summary

The implemented game loop **arms both teams' bombs concurrently within a round** ("parallel defuse"). This is the exact option the design **explicitly deferred**. The intended design is **Model B: true sequential per-round play** — only one team's bomb is live at a time while the other team spectates.

This was discovered during a design Q&A review of the relay/voice/spectator flow (2026-06-20), not via a failing test — the test suite is green because it asserts the *reinterpreted* (parallel) behaviour.

### Evidence (the intent was captured; the code diverged from spec)

- `gdd.md:137` — "Both teams play the same rounds **sequentially**."
- `gdd.md:758` (explicit exclusions) — "**Parallel defuse (both teams playing simultaneously) — deferred**; sequential relay keeps spectators focused on **one bomb** and avoids a broadcast synchronisation layer."
- `game-architecture.md:182` — "**sequential relay means only the active team's bomb is live**, but team-scoping prevents leakage and supports spectators-of-other-team."
- `game-architecture.md:319` — "the **resting team / spectators-of-other-team** don't receive the active bomb's stream unless they're spectating it."
- `game-architecture.md:332` — "Spectator Lounge one-way bridge: the Bomb Room audio is forwarded to the lounge as a listen-only track."
- `epics.md:1299` (Story 8.9 AC3) — "they play the same rounds **sequentially (not in parallel)**, with the resting team able to spectate." (Correct intent, but ambiguous wording with no implementing story.)

### Root cause (four-point chain — factual, not blame)

1. The GDD's *disambiguating rationale* ("one bomb", "broadcast synchronisation layer", `gdd.md:758`) never traveled into the epic AC — only the bare phrase "play the same rounds sequentially" did.
2. The epic AC (`epics.md:1299`) is two-readable: "sequentially" can mean *rounds are sequenced* (trivially true with concurrent teams) or *teams alternate within a round*. The weaker reading was taken.
3. **No story owned the serialisation mechanism.** It was a single AC clause on Story 8.9, whose actual subject is rotation + odd-team equalisation — the easiest requirement to define away.
4. Story 8.3 (`startRound`) baked in concurrent arming (arms every populated team) before 8.9 existed; 8.9's dev then reinterpreted "sequential" down to "relay-structure level" to avoid reworking `ROUND_START` (8.9 Dev Notes: *"Do NOT try to serialise the two teams' bombs within a round; that is not this story's scope"*).

**Key consequence:** the shipped behaviour violates `game-architecture.md:182`. This correction is a return to spec, not a scope change.

---

## Section 2 — Impact Analysis

### Epic impact
- **Epic 8 (Game Loop & Scoring):** primary. New Story 8.11 added; clarifying AC edits to 8.3/8.4/8.5/8.6 + epic intro. 8.9 descoped (rotation/equalisation only), **not reverted** — its logic is correct and reused.
- **Epic 3 (Voice):** the Spectator Lounge one-way audio bridge (`game-architecture.md:332`) is **unbuilt** (grep confirmed: no egress/bridge code). New Story 3.7 added. Story 3.5 (re-mint on role change, backlog) gains the relay-rotation routing of resting players.
- **Epic 9 (Advanced Features):** 9.2 (lifelines) and 9.4 (spectator view) already assume one live bomb — dependency note on 8.11 added, no AC change.

### Story impact
- **NEW 8.11** — Sequential Round Orchestration (single active team, alternation, resting-team spectate routing, one clock).
- **NEW 3.7** — Bomb Room → Spectator Lounge one-way audio bridge.
- **8.9** — AC3 rewritten; Dev Notes reinterpretation struck; re-verification (Task 8) deferred until after 8.11.
- **8.3 / 8.4 / 8.5 / 8.6** — clarifying AC edits referencing 8.11.

### Artifact conflicts
- **GDD:** none — already correct (`137`, `758`).
- **Architecture:** **no change needed** — already mandates B (`182`/`319`/`332`). One margin cross-ref to Story 8.11 added so the spec↔story link is explicit.
- **UX:** EXPERIENCE.md / spectator flows already assume listen-only lounge + one bomb — consistent.

### Technical impact (code, lands in worktree as Story 8.11)
- `startRound.ts` / `ROUND_START` handler — pick the **active** team only; arm only its bomb (`round.defusers` = active team).
- Per-team arm loop + timer — one live clock per round, not one per team.
- Resting-team client routing — spectate surface + lounge voice (depends on 3.7 bridge for audio).

---

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment (Hybrid).** Effort **Medium**, risk **Low**.

- **Not** rollback: 8.9's rotation/`isRelayComplete`/equalisation logic is correct and stays.
- **Not** MVP review: Model B *is* the MVP; this restores it.
- New Story 8.11 gives the serialisation mechanism an accountable owner (the root-cause fix), with the GDD+architecture rationale embedded in the AC so it can't erode again.

**Execution location & sequencing (honours "amend 8.9 in worktree before merge"):**
All edits land in the worktree `worktree-s5-epic8-relay`, sequenced **8.9 (amend) → 8.7 (finish) → 8.11 (implement)**, then the worktree merges to master as one spec-correct unit — master never sees parallel-defuse.

- ⚠️ Low risk: if `epics.md` is edited on master before merge, expect a small planning-doc conflict.
- 8.9 re-verification (Task 8, open) re-runs **after** 8.11 lands, since 8.11 changes the round-start behaviour Jay verifies.

---

## Section 4 — Detailed Change Proposals

### Stories (epics.md)

**4.1 — Story 8.9 AC3 (rewrite)**
- OLD: "Given both teams / When rounds run / Then they play the same rounds sequentially (not in parallel), with the resting team able to spectate."
- NEW: single shared round number + single between-rounds gate; serialisation owned by Story 8.11; rationale citing `gdd.md:137/758`, `game-architecture.md:182`. Strike the 8.9 Dev-Notes "do NOT serialise" paragraph; replace with a pointer to 8.11.

**4.2 — NEW Story 8.11: Sequential Round Orchestration** (AC1 single active team / AC2 alternation / AC3 resting-team spectate routing / AC4 one clock). Implemented in worktree after 8.9+8.7.

**4.3 — Clarifying AC edits**
- 8.3 AC2: append "only the active team's bomb is armed; resting-team players route to spectate/lounge (Story 8.11)."
- 8.4 AC1: "single active round's timer (one live clock per round, not one per team)."
- 8.5: append "resolution applies to the active team's round; the resting team holds in spectate."
- 8.6 AC2: "the next team's turn in the alternation (its next Defuser in rotation)."
- Epic 8 intro: append sequential-play sentence (Story 8.11; `game-architecture.md:182`).

### Voice (epics.md, Epic 3)
**4.4 — NEW Story 3.7: Bomb Room → Spectator Lounge one-way audio bridge** (`game-architecture.md:332`). Pairs with 3.5 (re-mint on relay role change). Absorbs the two prior asks: spectators talking to each other, facilitator-in-lounge.

### Advanced features (epics.md, Epic 9)
**4.5 — Dependency note** on 9.2 + 9.4: depends on 8.11 (single active bomb).

### Architecture
**4.6 — No change.** Margin cross-ref at `game-architecture.md:182` → Story 8.11.

### Bookkeeping
**4.7 — sprint-status.yaml:** add `8-11-sequential-round-orchestration: backlog`; add `3-7-bomb-room-to-lounge-audio-bridge: backlog`; note 8.9 AC amended. **deferred-work.md:** add Epic 3 bridge + spectator-talk + facilitator-in-lounge items.

---

## Section 5 — Implementation Handoff

- **Scope:** Moderate → Product Owner / Developer coordination.
- **Doc/spec edits (this workflow):** applied by Dev (Amelia) in the worktree.
- **Code (Story 8.11 + 3.7):** Developer agent, in the worktree, sequenced after 8.7.
- **Success criteria:**
  - `ROUND_START` arms exactly one team's bomb; resting team routes to spectate/lounge; one authoritative clock per round.
  - 8.9 AC3 + Dev Notes no longer assert/permit concurrent arming.
  - GDD+architecture rationale embedded in 8.9/8.11 ACs.
  - Jay re-verifies the relay live (after 8.11) — both even and odd teams, one bomb live at a time, resting team spectates.

---

## Change Log
- 2026-06-20 — Proposal created and approved by Jay. Incremental review; new Story 8.11; amend 8.9 in worktree before merge.
