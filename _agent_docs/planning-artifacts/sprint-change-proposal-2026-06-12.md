# Sprint Change Proposal — Story 1.8 WebRTC Port Model Sync

- **Date:** 2026-06-12
- **Author:** Game Developer (correct-course workflow)
- **Trigger story:** 1-8-docker-compose-stack-and-smoke-test
- **Scope classification:** Minor (Direct Adjustment — documentation sync to validated, committed reality)
- **Status:** Approved

---

## Section 1 — Issue Summary

During the Story 1.8 validation pass (rebuild images + run `scripts/smoke-test.sh`), the
WebRTC UDP port model defined in the planning artifacts proved **technically unworkable as
specified** and was corrected in code.

The spec called for LiveKit RTP/ICE on `50000–50199/udp` and coturn TURN relay on
`40000–40199/udp` — two **200-port published ranges** (400 host UDP forwards total).

**Evidence (discovery during implementation):**
- Deterministic Docker bind failures: `Error response from daemon: ports are not available:
  exposing port UDP 0.0.0.0:50074 -> 127.0.0.1:0` (and `:51025` after a first shift attempt).
- Either service alone published its 200 ports; **both together failed** — the second to
  publish exceeded Docker Desktop's WSL2 userland-proxy forwarded-port cap (~256).
- LiveKit's range additionally overlapped the **Windows OS-reserved UDP band `50000–50059`**
  (`netsh interface ipv4 show excludedportrange protocol=udp`).

**Root-cause insight (the real fix):** the 200-port ranges were over-provisioned for the
topology. LiveKit is an **SFU** — it muxes *all* participants over a **single** UDP port
(`rtc.udp_port`), so port count is constant regardless of player count. coturn allocates
**~1 relay port per relayed peer**, so a full 16-player session needs ~16 (32 with 2×
headroom). Validated model: **LiveKit `7882/udp` (single mux port)** + **coturn
`40000–40031/udp` (32)** — disjoint, ~33 total forwards, under the cap, clear of the
Windows-reserved band, and closer to LiveKit's recommended production config.

The code (`docker-compose.yml`, `livekit.yaml`, `scripts/smoke-test.sh`, `docs/deployment.md`)
was corrected and committed on branch `fix/story-1-8-stack-validation` (`225a7ce`); the full
7-service stack now boots health-checked and the smoke test exits 0 (7/7), with the negative
check exiting non-zero as required. **This proposal syncs the remaining planning artifacts to
that validated reality.**

## Section 2 — Impact Analysis

- **Epic impact:** None structural. Epic 1 (Foundation & Walking Skeleton) scope, story set,
  and sequence are unchanged. No epics added, removed, or reordered → `sprint-status.yaml`
  requires no change. Story 1.8 remains at `review`.
- **Story impact:** Story 1.8 only. AC3, AC4, Task 2, Task 4, Task 5, the Dev-Notes "Ports"
  block, and the "Project Context Rules" excerpt carried stale port numbers (text only — the
  delivered implementation already matches the new model).
- **Artifact conflicts:**
  - `_agent_docs/planning-artifacts/epics.md` — NFR15 (L103) and Story 1.8 AC mirror (L407)
    still named the *original* `50000–60000/udp`.
  - `_agent_docs/game-architecture.md` — Deployment "Ports" bullet (L533) named `50000–50199`
    / `40000–40199`.
  - `_agent_docs/project-context.md` — WebRTC (L187) and Deployment (L203) named the original
    `50000–60000 UDP`.
- **IaC / deployment (already corrected in `225a7ce`):** `docker-compose.yml`, `livekit.yaml`,
  `scripts/smoke-test.sh`, `docs/deployment.md`.
- **No impact:** UX specs, narrative, GDD mechanics, client/server application source.

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment.** Effort: **Low**. Risk: **Low**.

Pure documentation sync to match an already-implemented and validated change. The
acceptance criteria are amended to describe the *correct* observable outcome (the ports that
actually work and are documented); no implementation work is created or redone.

- **Option 2 (Rollback):** Not viable — there is nothing to roll back; the new model is
  strictly better and already green.
- **Option 3 (MVP review):** Unnecessary — MVP scope and the 16-player capacity target are
  fully preserved (an SFU's single mux port and coturn's 32-port relay both comfortably serve
  16 players).

## Section 4 — Detailed Change Proposals

Canonical validated port set:
`443` HTTPS · `80` HTTP→HTTPS · `7880` LiveKit HTTP/WS · `7881` LiveKit TCP ·
**`7882/udp` LiveKit RTP/ICE (single UDP mux port)** · `3478` TCP+UDP TURN ·
**`40000–40031/udp` coturn TURN relay** (mux port and relay range disjoint).

### Stories
- **Story 1.8 — AC3:** ports list `50000–50199/udp … 40000–40199/udp` →
  `7882/udp (LiveKit RTP/ICE single mux port) … 40000–40031/udp`.
- **Story 1.8 — AC4:** retitled "disjoint, published UDP **ports**"; LiveKit
  "RTP/ICE range (50000–50199)" → "muxed over a single UDP port (7882)"; coturn
  `40000–40199` → `40000–40031`; added 16-player sizing rationale.
- **Story 1.8 — Tasks 2/4/5 + Dev-Notes "Ports" + "Project Context Rules":** all port
  numbers swapped to the canonical set; Task 5 port assertions updated to Compose-v5
  `--protocol udp …` syntax and the `7882` mux-port / disjoint guard.
- **Story 1.8 — Completion Notes:** the "amend AC on next correct-course pass" note marked
  **done** (this proposal).

### Architecture
- `game-architecture.md` Deployment "Ports" bullet → canonical set, plus a sentence
  explaining the SFU mux model, coturn per-peer relay sizing, and the WSL2 forwarded-port
  cap / Windows reserved-band rationale.

### Epics
- `epics.md` NFR15 and Story 1.8 AC mirror → `7882/udp (LiveKit RTP/ICE mux)` +
  `40000–40031/udp (coturn TURN relay)` (replacing the original `50000–60000/udp`).

### Project Context
- `project-context.md` WebRTC + Deployment rules → LiveKit single mux port `7882`; coturn
  relay `40000–40031/udp` added.

## Section 5 — Implementation Handoff

- **Scope:** Minor → **Developer agent**, direct implementation (completed in this pass).
- **Deliverables:** amended Story 1.8 ACs/tasks/notes; synced `epics.md`,
  `game-architecture.md`, `project-context.md`; this proposal document.
- **Success criteria:** no stale `50000`/`60000`/`50199`/`40199` port references remain in
  the planning/story/architecture/project-context artifacts (except historical "why we
  changed" notes); all artifacts state the canonical set. **Verified** via grep after edits.
- **Sprint status:** no epic/story structural change → `sprint-status.yaml` untouched;
  Story 1.8 stays `review`.

## Change Log
- 2026-06-12 — Proposal created and approved. AC3/AC4 + Story 1.8 body, `epics.md`,
  `game-architecture.md`, and `project-context.md` synced to the validated port model
  (LiveKit `7882/udp` mux + coturn `40000–40031/udp`). Implementation (IaC) already landed in
  commit `225a7ce` on `fix/story-1-8-stack-validation`.
