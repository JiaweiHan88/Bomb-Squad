---
title: 'Bomb Squad — Sprint Sequencing Plan'
project: 'Bomb Squad'
date: '2026-06-10'
author: 'Jay'
companion_to: 'sprint-status.yaml'
sequencing: 'playability-first (walking-skeleton pulled forward)'
---

# Bomb Squad — Sprint Sequencing Plan

This plan orders the 59 stories for **fastest path to a playable game**, not strict epic order. The driving principle (Architecture AR5 + GDD core hypothesis) is to reach **"a Defuser and an Expert defuse Wires over voice"** as early as possible, then expand outward.

**⏫ = story pulled forward ahead of its home epic** to unblock playability. Within-epic dependency order is still respected; these are cross-epic sequencing moves, not reordering inside an epic.

---

## Milestone A — Core Hypothesis: *Playable Wires over voice* 🎯

The walking skeleton. At the end of Milestone A you can run the real validation test from the GDD: two players, one sees the bomb, one sees the manual, they solve Wires by talking.

### Sprint 0 — Foundation
The deployable base every later story plugs into.
- `1-1` Monorepo & build scaffold
- `1-2` Shared contracts (core types + typed events)
- `1-3` Deterministic seed-chain utility
- `1-4` Server bootstrap (Fastify + Socket.IO + health)
- `1-5` Data-store adapters (Redis + Postgres pool)
- `1-6` Pure-reducer harness + open/closed bomb reducer
- `1-7` Client bootstrap (React/Vite/Zustand + typed socket client)
- `1-8` Docker Compose stack & smoke test *(can run minimal here; full TURN/LiveKit not needed until Sprint 3)*

### Sprint 1 — Minimal session + bomb shell
Get players into a session and render a bomb.
- `2-1` Design tokens, UI shell & state patterns
- `2-2` Facilitator hosts a session
- `2-3` Player joins via code & picks a role
- `2-4` Team & per-player role assignment
- `4-1` 3D bomb scene & camera rig
- `4-2` Chassis & bomb metadata rendering
- `4-3` Module slots & solve LEDs

### Sprint 2 — Wires playable end-to-end
The cut that proves the loop. **This sprint pulls forward the skeleton-critical Epic 8 stories (Q-4 from the readiness audit).**
- `5-1` Module plugin scaffold, sandbox & click primitive
- `5-2` Expert manual viewer
- `5-3` **Wires module (walking skeleton)**
- `4-4` Diegetic timer LCD with client extrapolation
- `4-5` Strike indicator & strike roll-up
- `4-7` Snapshot sync & optimistic render at 60fps
- ⏫ `8-2` Per-team bomb generation
- ⏫ `8-3` Round start, Defuser assignment & preparation control
- ⏫ `8-4` Server-authoritative timer & strike escalation
- ⏫ `8-5` Round resolution (defused / detonated / time-expired)

### Sprint 3 — Voice on the skeleton
Make it the *talking* game. **Pulls forward the Bomb Room voice subset ahead of full Epic 3.**
- ⏫ `3-1` Role-scoped LiveKit token minting
- ⏫ `3-2` Bomb Room bidirectional channel
- `2-5` Lobby roster, ready state & mic check
- `2-6` Capacity & join-window guards
- `2-7` Lobby resilience & facilitator player controls *(added per sprint-change-proposal-2026-06-12-epic-2-lobby-followup; scheduled here at Sprint 1 retro; **scope widened at Sprint 2 retro (AI2)** — now owns the durable-identity primitive the 4.7 authority gate + 8.7 mid-round restore depend on, see epics.md Story 2.7 scope note)*

> **✅ Milestone A exit:** the core hypothesis is testable. Defuser + Expert defuse Wires over voice, with a real server-authoritative timer, strikes, and round resolution.

---

## Milestone B — Full Easy loop + competitive relay

### Sprint 4 — Easy modules complete + round framing
- `5-4` The Button module
- `5-5` Passwords module
- `4-6` Preparation placeholder bomb view
- `8-1` Round configuration & difficulty gating
- `8-6` Between-round flow & scoreboard preview

### Sprint 5 — Relay, resilience & full voice
- `8-7` Pause — Facilitator & disconnect
- `8-8` Retry a failed round
- `8-9` Relay orchestration & odd-team equalisation
- `8-10` Scoring, final scoreboard & session-end persistence
- `3-3` Spectator Lounge listen-only channel
- `3-4` Speaker indicator & mute controls
- `3-5` Token re-mint on role change
- `3-6` Graceful voice degradation

> **✅ Milestone B exit:** a complete, competitive, multi-round relay session on the three Easy modules with full voice — shippable for a first internal playtest.

---

## Milestone C — Content breadth

### Sprint 6 — Medium modules
*(Provision the KTANE manual v1 PDF asset first — glyph/grid/maze references.)*
- `6-1` Keypads · `6-2` Who's on First · `6-3` Wire Sequences · `6-4` Mazes

### Sprint 7 — Hard modules
- `7-1` Complicated Wires · `7-2` Simon Says · `7-3` Memory · `7-4` Morse Code
  *(Simon Says 3-table and Memory 5-stage are the largest single stories — Q-3.)*

---

## Milestone D — Advanced features + hardening

### Sprint 8 — Advanced features
- `9-1` Asymmetric Expert Roles
- `9-2` Spectator lifeline token economy
- `9-3` Send a lifeline hint
- `9-4` Spectator Lounge view *(resolve GDD A3: free-navigate assumed)*

### Sprint 9 — Polish & release gates
- `10-1` Game-state SFX
- `10-2` 60fps profiling & frame-budget hardening
- `10-3` WebRTC reliability behind symmetric NAT *(GDD A4 — test before first real event)*
- `10-4` Accessibility gate sign-off
- `10-5` Playtest instrumentation & desync hardening

---

## Pulled-forward summary

| Story | Home epic | Pulled into | Why |
|---|---|---|---|
| `8-2` Bomb generation | 8 | Sprint 2 | Need a real bomb to defuse |
| `8-3` Round start / Defuser assign | 8 | Sprint 2 | Nothing is playable without round start |
| `8-4` Server timer & escalation | 8 | Sprint 2 | The clock is the pressure; server owns it |
| `8-5` Round resolution | 8 | Sprint 2 | Defuse/explode must actually end the round |
| `3-1` LiveKit token mint | 3 | Sprint 3 | Prerequisite for any voice |
| `3-2` Bomb Room channel | 3 | Sprint 3 | The hypothesis is "over voice" |

Everything else follows epic order. The remaining Epic 8 stories (relay, pause, retry, scoring) and the rest of Epic 3 (lounge, mute, re-mint, degradation) land in Milestone B once the skeleton is proven.
