# Sprint Change Proposal — Epic 2 Lobby Follow-up (Remove Player, Refresh Resilience, Prefilled-Link Join)

- **Date:** 2026-06-12
- **Author:** Game Developer (correct-course workflow)
- **Trigger stories:** 2-2-facilitator-hosts-a-session, 2-3-player-joins-via-code-and-picks-a-role, 2-4-team-and-per-player-role-assignment (validation pass)
- **Scope classification:** Minor–Moderate (Direct Adjustment — one new story added to Epic 2; no epic restructuring)
- **Status:** Approved (created at user direction)

---

## Section 1 — Issue Summary

Three gaps surfaced while validating the Epic 2 lobby ACs (Stories 2.2–2.4):

1. **No facilitator player-removal control.** The Facilitator can assign teams/roles
   (`TEAM_ASSIGN`, Story 2.4) but has no way to remove a player from the lobby — a
   mis-joined, duplicate, or AFK player is permanent until the session is abandoned.
   Neither the epics nor the UX spec define a remove affordance; this is a genuine
   requirements gap, not an implementation miss.

2. **Browser refresh leaves a ghost roster entry.** Player identity is the ephemeral
   `socket.id`; there is no `disconnect` handler anywhere in the join/roster path. A
   refreshed player's old entry persists for everyone, the rejoin misses the
   idempotent-rejoin guard and adds a duplicate, the "You" tag is lost, and ghost
   entries count toward `MAX_PLAYERS` (a flapping client can falsely exhaust
   capacity). **Evidence:** already documented as deferrals in
   `_agent_docs/implementation-artifacts/deferred-work.md` under the story-2.2 and
   story-2.3 code reviews, both of which call for a follow-up story with a stable
   player id and a disconnect/cleanup path.

3. **Prefilled share link offers no way to join.** `Lobby` builds a share link with
   `?join=<code>`; `Landing.tsx` consumes it and fills the six code cells but
   deliberately never auto-submits (name/role gate the emit). Submission only fires
   from keystroke handlers inside the code cells (UX spec: "Submits on 6th char
   without explicit button press"), so a player arriving via the link — code already
   complete — fills name and role and then has **no visible affordance to join**;
   the only workaround is retyping the 6th character. The UX component pattern never
   anticipated a complete-but-unsubmitted code state.

## Section 2 — Impact Analysis

- **Epic impact:** Epic 2 only. Scope grows by one story (2.7); Stories 2.1–2.6 and
  their sequence are unchanged. No future epic is invalidated. Mid-round
  disconnect/reattach remains out of scope here — it is FR13 (Epic 8, disconnect
  auto-pause) and the voice token re-mint path (Epic 3); Story 2.7 scopes cleanup to
  the **lobby phase only**, which actually simplifies the Epic 8 work (lobby ghosts
  no longer exist by then).
- **Story impact:** New Story 2.7 (this proposal). Story 2.3's AC ("submits on the
  6th character") stays valid — 2.7 adds a complementary affordance rather than
  changing the typing behavior.
- **Artifact conflicts:**
  - `_agent_docs/planning-artifacts/epics.md` — Epic 2 needs Story 2.7 appended
    (requirements home for all three fixes).
  - `_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md` —
    Join-code input component pattern must define the prefilled/complete state
    (visible Join button); Lobby surface must include a Facilitator-only remove
    control (destructive → secondary confirm per the existing button pattern).
  - `_agent_docs/implementation-artifacts/sprint-status.yaml` — add `2-7` entry.
  - GDD / game-architecture — **no conflict**: GDD's join flow is high-level
    (Jackbox-style, facilitator-driven pacing); architecture patterns (typed events
    in `packages/shared`, pure reducer + handler I/O) absorb a `PLAYER_REMOVE`
    event and a `disconnect` handler without change.
- **Technical impact:** New shared event type(s) (`PLAYER_REMOVE`, removal
  error/notice), a server `disconnect` handler with lobby-phase roster cleanup, a
  stable player identity decoupled from `socket.id` (the deferred-work items name
  this as the prerequisite), and client Landing/Lobby UI changes. The accepted
  `SESSION_JOIN` load-modify-store race (2.3 deferral) is unchanged and stays with
  Story 2.6.

## Section 3 — Recommended Approach

**Direct Adjustment** — add Story 2.7 to Epic 2 and sync the UX spec. Effort: Low–Medium
(one story, established patterns). Risk: Low. Rollback and MVP review were considered and
rejected: nothing delivered is wrong, the lobby flow demonstrably works end-to-end; these
are completeness gaps in the original requirements plus a known, logged deferral coming due.
Timeline impact: one additional story in Epic 2.

Note the synergy: once 2.7 lands, a refreshed player's ghost is cleaned up on disconnect
**and** the prefilled link gives them a one-click path back in — refresh recovery falls out
of fixes 2 + 3 together without needing full session-reattach.

## Section 4 — Detailed Change Proposals

### 4.1 epics.md — add Story 2.7 (after Story 2.6)

```
### Story 2.7: Lobby Resilience & Facilitator Player Controls

As a Facilitator and players,
I want misjoined players removable, refreshed players cleanly handled, and share links that actually let you join,
So that the lobby stays accurate and nobody gets stranded by a refresh or a prefilled link.

**Acceptance Criteria:**

**Given** the lobby roster
**When** the Facilitator chooses Remove on a player row and passes the secondary confirm
**Then** a `PLAYER_REMOVE` is accepted only from the Facilitator, the player disappears from the roster for all participants, capacity is freed, and the removed client is returned to the landing screen with a human-readable notice.

**Given** a non-Facilitator socket (or the Facilitator targeting themselves)
**When** it attempts `PLAYER_REMOVE`
**Then** the server rejects it with a typed authority/validation error and no state changes.

**Given** a joined player in the lobby phase
**When** their socket disconnects (refresh, tab close, network drop)
**Then** their roster entry is removed and broadcast, so ghost entries never persist nor count toward capacity. (Lobby phase only — mid-round disconnect handling remains Epic 8 / FR13.)

**Given** a player who refreshed during the lobby
**When** they rejoin via the share link
**Then** they re-enter the lobby without duplicate roster entries or capacity errors caused by their own stale entry.

**Given** a join link with `?join=` prefilling a complete code
**When** the code cells are full but no submitting keystroke occurred
**Then** a visible "Join" button is shown that submits once display name and role are set — typing the 6th character continues to auto-submit as before.
```

Rationale: closes the three validated gaps inside Epic 2's existing FR envelope
(FR2, FR4, FR5 — roster accuracy and capacity integrity are FR4/FR5 concerns).

### 4.2 EXPERIENCE.md — component pattern + surface updates

- **Join-code input** (Component Patterns): OLD ends "Submits on 6th char without
  explicit button press." NEW appends: "If the code is complete without a submitting
  keystroke (e.g. a `?join=` prefilled link), a visible Join button appears and
  submits once name and role are set."
- **Lobby surface** (Top-level surfaces #2): OLD "show team roster, role pickers,
  join-code share, 'Ready' state, voice mic-check." NEW appends "Facilitator-only
  per-row Remove control (destructive → secondary confirm)."
- **Microcopy**: add removal notice — "The Facilitator removed you from this
  session." (dry, deadpan, no apology).

### 4.3 sprint-status.yaml

Add `2-7-lobby-resilience-and-facilitator-player-controls: backlog` after the 2-6
entry. Epic 2 remains `in-progress`.

## Section 5 — Implementation Handoff

- **Scope:** Minor–Moderate → Developer agent, no PM/Architect escalation.
- **Next steps:** run `gds-create-story` for Story 2.7 when it comes up in sequence
  (recommended before or alongside 2.5, since roster accuracy underpins the ready
  state and mic check), then `gds-dev-story`. The deferred-work entries from the
  2.2/2.3 reviews (stable player id, disconnect cleanup) are the implementation
  checklist seed and should be marked resolved by Story 2.7's review.
- **Success criteria:** all five ACs in §4.1 pass; deferred-work ghost-entry items
  closed; no regression of Story 2.3's type-to-submit AC.
