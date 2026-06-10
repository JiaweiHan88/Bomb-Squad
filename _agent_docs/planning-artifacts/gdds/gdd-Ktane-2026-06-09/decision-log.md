# Bomb Squad — GDD Decision Log

**Project:** Ktane / Bomb Squad
**GDD Session Started:** 2026-06-09
**Mode:** Facilitative

---

## Session 1 — 2026-06-09

### Setup
- GDD workspace created at `_agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/`
- Source inputs: game brief (`brief-Ktane-2026-06-09/brief.md`), project context, KTANE manual (PDF)
- Game type confirmed: Party Game (primary), Puzzle (mechanical substrate)
- Module rules extracted from KTANE manual v1 (verification code 241) for all 6 V1 modules

### Extracted from Brief (pre-populated, pending Jay confirmation)
- Core fantasy: "Your team survives (or spectacularly fails) a bomb defusal by communicating precisely under pressure — and then argues about it for the rest of the day."
- 4 pillars identified in brief: Communication is the mechanic / Pressure is shared / Fairness through structure / Low floor, replayable ceiling
- V1 module set: Wires, The Button, Keypads, Simon Says, Memory, Morse Code
- Relay race format confirmed
- Player count: 2–16 (up to 8v8)

---

### Decision 001 — Pillar 4 Reframing
**Original (brief):** "Low floor, replayable ceiling"
**Revised:** "The bomb is always new; the team gets better."
**Rationale:** Original framing described a quality, not a design constraint. Revised pillar anchors replayability to two specific drivers: per-round randomization (module combos + values) and accumulated team communication fluency across sessions.
**Status:** Confirmed by Jay, 2026-06-09

### Decision 004 — Module Scope (V1)
**Decision:** All modules from the KTANE manual v1 included in V1. V2 will research existing custom modules from the community.
**Note:** Standard modules only — 11 total (see difficulty gating). Needy modules excluded from V1; see Decision 005.
**Status:** Confirmed by Jay, 2026-06-09

### Finalization — 2026-06-10
**Discipline pass findings addressed:**
- Core fantasy + vision statement restored to Executive Summary
- MVP hypothesis added to Goals
- "Purposefully contained internal tool" framing restored
- Relay debrief reframed as story-generation mechanism (not just fairness)
- React Three Fiber removed from Art section (implementation detail)
- Code-level architecture patterns removed from Technical section; replaced with player-experience constraints + architecture doc pointer
- 60 fps "from day one" enforcement posture added to Architecture Constraints
- WebRTC mitigation action added (test behind symmetric NAT; document TURN ports)
- Between-rounds state defined (scoreboard preview; Facilitator manually advances)
- Late join policy defined (no mid-round; between rounds with Facilitator approval)
- Defuse rotation order defined (Facilitator-chosen; default join order)
- Preparation phase duration tagged as ASSUMPTION (2–5 min)
- Lifeline overlay behaviour specified (8-second auto-dismiss, non-interactive)
- Pause mechanic defined (timer + bomb state freeze; voice remains active)
- Video feeds duplicate removed from Out of Scope
- Rationale added for parallel defuse and session recording/replay exclusions
- Fairness assumption A7 added (identical layouts + independent values)
- Lifeline duration assumption A8 added
- Prep phase duration assumption A9 added
- Art tone confirmed by Jay: grounded/stylised, not cartoonish
**Open items remaining (non-blocking for architecture):**
- Timer values (A1) — pending playtesting
- Module visual user testing (A6) — before V1 release
- Colorblind accessibility [NOTE FOR DESIGNER] — before V1 release

### Decision 012 — Success Metrics
**Decision:** Commercial-grade metrics adopted. Key targets: ≥90% first-time module defusal rate, ≥85% session completion, p50 round time within 3–5 min target, ≥40% 30-day team retention, ≥2 sessions/team/month, ≤3 min facilitator setup, ≥60 fps, ≥95% WebRTC connection success, ≤100ms state sync, ≤1% crash rate.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 011 — Mid-Round Disconnect
**Decision:** Round pauses on disconnect. Facilitator decides whether to restart the round or continue with reduced team. Orphaned manual chapters (in Asymmetric Roles mode) are redistributed to remaining Experts on continue.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 010 — Odd Team Sizes
**Decision:** The shorter team plays one extra round (volunteer Defuser) to equalise round count across both teams before session scoring. Facilitator assigns the volunteer.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 009 — Proposal 3: Strike Carryover
**Decision:** Rejected.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 008 — Proposal 2: Spectator Lifelines
**Decision:** Included. Spectators earn lifeline tokens (1 per round spectated). Spent tokens push a pre-defined hint prompt to the active team — no free text. Prompt options: "Re-read the [module] section", "Check the serial number", "You missed a condition", "You're on the right track", "Wrong approach". Facilitator-toggleable.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 007 — Proposal 1: Asymmetric Expert Roles
**Decision:** Included as a Facilitator-toggleable difficulty modifier. Chapters auto-assigned round-robin (randomly distributed as evenly as possible) at round start. Only activates with 2+ Experts; 1 Expert retains full manual access.
**Status:** Confirmed by Jay, 2026-06-10

### Decision 006 — Difficulty-Gated Module Pool
**Decision:** 11 standard modules tiered as: Easy (Wires, Button, Passwords), Medium (+ Keypads, Who's on First, Wire Sequences, Mazes), Hard (+ Complicated Wires, Simon Says, Memory, Morse Code). Facilitator can override pool per session.
**Status:** Confirmed by Jay, 2026-06-09

### Decision 005 — Needy Modules
**Decision:** Needy modules (Venting Gas, Capacitor Discharge, Knobs) excluded from V1. Deferred to V2.
**Constraint:** Implementation must treat needy modules as a first-class future concern. The bomb renderer, module state machine, and Defuser UI must be designed so needy module support requires no structural rewrite — only additive work.
**Status:** Confirmed by Jay, 2026-06-09

### Decision 003 — Bomb Configuration
**Decision:**
- Module count: Facilitator-configurable (3–11), difficulty provides recommended default range
- Round timer: Target 3–5 min/round; exact values deferred to playtesting (placeholder values in GDD)
- Module pool: Hybrid — difficulty gates pool, Facilitator can override per session
**Rationale:** Configurable count gives facilitators flexibility without making setup heavy. 3–5 min target keeps spectator wait time acceptable. Hybrid pool balances progressive difficulty with facilitator control.
**Status:** Confirmed by Jay, 2026-06-09

### Decision 002 — Strike Timer Speedup
**Decision:** Timer speedup after each strike is a configurable session setting, 0–50% per strike, compounding. Default: 25%.
**Rationale:** Preserves original KTANE escalation feel while giving the Facilitator a fairness knob for competitive relay play. 0% = flat clock (clean competitive comparison); 50% = maximum pressure.
**Status:** Confirmed by Jay, 2026-06-09
