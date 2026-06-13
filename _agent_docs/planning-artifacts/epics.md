---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md
  - _agent_docs/game-architecture.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md
  - _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md
---

# Bomb Squad - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Bomb Squad, decomposing the requirements from the GDD, UX Design, and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

**Session & Lobby**
- FR1: Facilitator can create a private session and receive an unguessable join code + shareable link, with no account creation required.
- FR2: Players join via join code, choosing a display name and role (Defuser / Expert / Spectator); the host is the Facilitator.
- FR3: Facilitator assigns players to two teams (A/B) and sets per-player roles within each team.
- FR4: Lobby displays team roster, role pickers, join-code share affordance, per-player ready state, and a microphone check.
- FR5: System supports 2–16 players per session (two teams of up to 8 each).
- FR6: No mid-round joins; between rounds the Facilitator may add a player before advancing (late joiners may not defuse if relay slots are already assigned).

**Preparation**
- FR7: Preparation phase shows role-gated content — Defuser sees module *types only* on a placeholder bomb; Experts and Spectators browse the full manual.
- FR8: Preparation phase duration is Facilitator-controlled (default 2–5 min).

**Round Configuration & Control**
- FR9: Facilitator configures each round: difficulty tier, module count (3–11), timer duration, strike speed-up % (0–50%, compounding), and modifier toggles.
- FR10: Difficulty tier (Easy/Medium/Hard) gates the module pool and provides default module count + timer; Facilitator can override pool and count.
- FR11: Facilitator starts the round and assigns the Defuser by rotation order (default: team join order).
- FR12: Facilitator can pause between rounds at any time; pause freezes timer + bomb state while voice stays live; resume is manual.
- FR13: Mid-round player disconnect auto-triggers a pause; Facilitator resumes manually once players are ready.
- FR14: Facilitator can trigger a retry of a failed round (same layout, same values via reused seed); the better of the two times is recorded.
- FR15: Facilitator manually advances between rounds; a scoreboard preview is shown to all players between rounds.

**Bomb & Modules**
- FR16: Each bomb is rendered in real-time 3D in-browser; the Defuser can orbit (drag), zoom (scroll), focus a module (click → camera dolly), and return to overview (ESC).
- FR17: Each bomb has metadata used by module rules: serial number (last character always a digit), battery count, indicators (subset of {SND,CLR,CAR,IND,FRQ,SIG,NSA,MSA,TRN,BOB,FRK} lit/unlit), and ports (subset of {DVI-D,Parallel,PS/2,RJ-45,Serial,Stereo RCA}) — all randomised per team per round.
- FR18: Bomb contains 3–11 modules, defusable in any order; a green LED indicates a disarmed module; all modules disarmed = bomb defused.
- FR19: Module values are independently randomised per team per round via a deterministic seed chain; both teams receive identical layouts with independent values.
- FR20: Defuser interacts with modules via mouse click only (wire cut = click; button press = mousedown+up; button hold = sustained; keypad/maze/memory = click; Morse = click TX); voice is the communication channel.
- FR21: Module — **Wires** (3–6 wires, per-wire-count rule tables) with Defuser view, Expert manual pages, and server-side solve validation.
- FR22: Module — **The Button** (press/hold decision table + colour-strip release-on-timer-digit rule).
- FR23: Module — **Passwords** (5 cycling letter columns; spell a valid word from the 35-word list; SUBMIT).
- FR24: Module — **Keypads** (4 symbols; find the single column containing all four; press top-to-bottom order; custom glyph set).
- FR25: Module — **Who's on First** (two-step display-word → button-position → label-priority-list lookup).
- FR26: Module — **Wire Sequences** (paged panels; cumulative occurrence counting per wire colour; cut-by-letter rules).
- FR27: Module — **Mazes** (9 visual layouts identified by two marker positions; navigate light to target via arrow buttons; invisible walls).
- FR28: Module — **Complicated Wires** (per-wire attribute combination → cut-code truth table; C/D/S/P/B rules referencing bomb context).
- FR29: Module — **Simon Says** (colour-flash translation with three tables varying by strike count AND serial-vowel presence; growing sequence).
- FR30: Module — **Memory** (5 sequential stages; tracks both position and label across stages; incorrect press resets to stage 1).
- FR31: Module — **Morse Code** (decode flashing word → frequency lookup → set dial → TX; word-level decode, not char-by-char).

**Strikes & Timer**
- FR32: Incorrect module interaction records a team-wide strike (no individual attribution); the third strike triggers explosion.
- FR33: Each strike accelerates the countdown by the configured % (compounding; default 25% → ×1.00/×1.25/×1.56).
- FR34: Bomb timer is server-authoritative; clients display extrapolated server time; expiry is decided solely by the server.
- FR35: Timer and strike counter are always visible to the Defuser (diegetic, on the chassis).

**Manual & Experts**
- FR36: Experts read a digital manual (chapter list + content) navigated by click + keyboard arrows / PageUp-Down / `/` chapter search; scroll position persists per chapter.
- FR37: [Asymmetric Expert Roles on] The 11 chapters are auto-assigned round-robin across Experts at round start; each Expert can access only assigned chapters; activates only with ≥2 Experts (a solo Expert retains full access).

**Voice**
- FR38: Built-in WebRTC voice with two channels — Bomb Room (Defuser/Experts/Facilitator, bidirectional) and Spectator Lounge (listen-only to the Bomb Room).
- FR39: Spectators cannot broadcast into the Bomb Room (enforced at the token-grant level, not just UI).
- FR40: Voice presence shows an active-speaker indicator and per-player mute/unmute; voice must connect within 10s behind corporate NAT; the game remains fully playable if voice drops.
- FR41: LiveKit tokens are re-minted on role change (e.g. defuser ↔ spectator on relay rotation) and never reused across roles.

**Spectator Lifelines**
- FR42: [Lifelines on] Spectators earn 1 token per round spectated (max 3 held); spending a token pushes a pre-defined hint prompt (from a fixed list, no free text) to Defuser + Experts as an 8s non-blocking toast; Facilitator can disable per session.

**Relay, Scoring & Scoreboard**
- FR43: Sessions run as a sequential relay; both teams play the same rounds; every player defuses at least once.
- FR44: Odd team sizes — the shorter team plays one extra round (Facilitator assigns a volunteer Defuser) to equalise round count.
- FR45: Time-based scoring — elapsed defuse time recorded per round; failed rounds record time at the moment of failure; lowest cumulative time wins.
- FR46: Between-round scoreboard preview and an end-of-session final scoreboard with a round-by-round breakdown.

**Audio**
- FR47: SFX for game states — ticking countdown (tempo rises with strike escalation), module-typed solve chime, strike sound, explosion, defuse fanfare, lobby ambient; no music during rounds.

### NonFunctional Requirements

- NFR1: 60 fps sustained on a mid-range laptop over a 10-minute active session; any frame-budget violation is treated as a bug (gate from day one).
- NFR2: Bomb state sync latency ≤ 100 ms across clients; perceived click→outcome ≤ 100 ms via optimistic pre-flash (never pre-committing "solved").
- NFR3: WebRTC voice connects within 10s behind symmetric NAT; ≥ 95% connection success behind corporate firewalls.
- NFR4: Supports 2–16 simultaneous browser clients per session.
- NFR5: Session crash / desync rate ≤ 1%.
- NFR6: Facilitator setup time ≤ 3 min (session creation to first round started).
- NFR7: Browser support — Chrome 90+, Firefox 88+, Edge 90+ primary; Safari secondary; no mobile app, no Electron.
- NFR8: Server-authoritative; all client input is untrusted and validated server-side (identity, role, phase, bounds, resource).
- NFR9: Security — unguessable join codes (≥6 chars, crypto-random); HTTPS everywhere non-localhost; secrets via `.env` only; coturn creds time-limited HMAC-SHA1 (TTL ≤ 86400s); bomb solutions never sent to the client.
- NFR10: Deterministic seeded generation — reproducible from (sessionId, roundNumber, teamId); guarantees per-team fairness and retry reproducibility.
- NFR11: Colorblind floor — Wires, The Button, Simon Says, Complicated Wires must carry pattern/label redundancy (tracked as a gate, not polish).
- NFR12: Accessibility — non-bomb UI fully keyboard-traversable with visible focus ring; respect `prefers-reduced-motion`; no rapid-input modules.
- NFR13: Minimum viewport 1280×720 (resize gate below); 1920×1080 baseline up to 4K; mobile bounce screen.
- NFR14: Needy-module readiness — bomb layout, module state model, and Defuser UI must support V2 needy modules via additive changes only (no structural rewrite).
- NFR15: Self-hosted Docker Compose deployment; minimum host 2 vCPU / 4 GB RAM / 100 Mbps symmetric / 10 GB storage; documented ports (443, 7880, 7881, 3478, 7882/udp [LiveKit RTP/ICE mux], 40000–40031/udp [coturn TURN relay]).

### Additional Requirements

_Technical requirements from the Architecture document that shape implementation and story structure._

- AR1: pnpm-workspace monorepo; `packages/shared` is pure TypeScript with zero runtime deps on react/socket.io/server/client frameworks; per-workspace tsconfig; Vite client build; `tsc --noEmit` must pass with zero errors before commit.
- AR2: Pure-reducer game core `(state, event) => newState` — reducers import no infra (socket.io/ioredis/pg/fastify/react), never mutate in place, never use `Date.now()`/`Math.random()`/`setTimeout`, and fall through unknown actions returning state unchanged.
- AR3: Handlers own ALL I/O via the canonical flow: parse & validate → load from Redis → call reducer → persist → broadcast to the right room(s); persist-then-emit; never fire-and-forget async.
- AR4: `IModule` plugin registry — bomb reducer delegates by `moduleId` to `MODULE_REDUCERS` and is open/closed (never edited to add a module); modules ship one-by-one as additive directories.
- AR5: **Walking skeleton ships Wires first** to validate the core information-asymmetry hypothesis end-to-end before other modules.
- AR6: Deterministic seed chain `templateSeed → teamSeed → moduleSeed`; `hash` lives in `packages/shared/src/seeding/`, identical on client and server; `generate(seed, ctx)` synchronous and CPU-cheap; `BombContext` frozen read-only.
- AR7: Timer sync = authoritative `TimerState` descriptor (`startedAt`, `remainingAtStart`, `speedMultiplier`, `pausedAt`) broadcast on change only; client extrapolates per frame inside `useFrame`; server owns expiry; pause/resume rebases the segment.
- AR8: Per-module snapshot state sync — server broadcasts the affected module's full new state + bomb-level deltas; optimistic pre-flash rolls back against the next authoritative snapshot.
- AR9: All Socket.IO events defined in `packages/shared/src/events/` and imported via `ServerToClientEvents` / `ClientToServerEvents`; no untyped `socket.emit(string, any)`.
- AR10: Multi-session, single-process model keyed by `sessionId` in Redis; Socket.IO rooms namespaced `session:{id}`, `session:{id}:team:{teamId}`, `session:{id}:role:{role}`; process holds no authoritative in-memory game state (restart-tolerant).
- AR11: Redis keyspace with colon-delimited namespaces holds all in-flight state with O(1) hot-path access; PostgreSQL receives a single transaction at session end via `pg-pool` (never on the tick path).
- AR12: LiveKit voice topology — `bomb-room:{sessionId}:{teamId}` (bidirectional) + `spectator-lounge:{sessionId}` (listen-only); server mints role-scoped tokens (`canPublish:false` for spectators); Facilitator PTT bridge tested explicitly; voice is an independent subsystem that never blocks game state.
- AR13: Docker Compose services (client, server, redis, postgres, livekit, coturn, caddy) all with health checks; `scripts/smoke-test.sh` validates reachability; server waits on Redis + Postgres health before accepting connections.
- AR14: Error handling — reducers never throw (guard → no-op); handlers schema-validate (TypeBox) + bounds-check at the boundary, returning typed `ERROR` events; connection loss → pause/retry modal; voice loss → dismissible banner.
- AR15: Structured JSON logs keyed by `sessionId`/`teamId`/`roundNumber`; never log join codes, tokens, or bomb solutions; voice subsystem logs separately.
- AR16: Testing boundaries — pure logic (reducers/generate/solve) unit-tested in Node with Jest (zero infra); socket handlers via a `TestSocketServer` wrapper; R3F components by Playwright visual regression only; voice against a real LiveKit container in CI. Every module reducer tests happy-path, wrong-interaction, idempotency, immutability (frozen input), guard clauses, and reset.

### UX Design Requirements

_Actionable design work items extracted from DESIGN.md (visual identity) and EXPERIENCE.md (behavior, flow, IA)._

- UX-DR1: Implement the design-token system from DESIGN.md frontmatter — two color worlds (bomb-world diegetic + operator-world non-diegetic), five typeface families each with a single assigned role, 4px spacing unit with 32px HUD safe-area, and the radius scale. Enforce semantic color reservations (LED green = solved/safe; red = strike/error; amber = caution; cool blue = self/voice presence; cream = manual) — never decorative.
- UX-DR2: Timer component — 84px DSEG7 LCD red on near-black, the loudest element on screen, glow intensity rises per strike, glow-only animation (never animate digits); ramps tick audio under 30s / 10s, LCD glow pulses on the second under 10s.
- UX-DR3: Strike indicator — a row of 2 LED dots beside the timer with inactive/active glow states.
- UX-DR4: Module solve LED — 10px circular, unsolved/solved/striking states; green-glow on solve is the sole visual solve confirmation, paired with a module-typed solve chime.
- UX-DR5: Speaker indicator pill — avatar dot + always-visible name (never icon-only), idle/active/selfActive/muted states, pulse while transmitting with 150ms grace to suppress flicker.
- UX-DR6: Toast component — non-blocking, stacks top-right (max 3 visible), 5s standard / 8s lifeline, never animates the bomb scene layout.
- UX-DR7: Join-code input — 6 mono character cells, auto-uppercase, paste splits per-cell, submits on the 6th character without an explicit button.
- UX-DR8: Manual page surface — serif (Source Serif 4) ink on cream paper with grain + paper shadow and ≤1° rotation (never a generic web modal); two-column max (chapter list / content) with no nested scrolling regions.
- UX-DR9: Primary button — tactile 2px press effect; every destructive/irreversible action gets a secondary confirm step; no primary button is ever a destructive action.
- UX-DR10: Diegetic vs non-diegetic HUD split — timer, strikes, per-module solve LEDs, serial sticker, battery panel, indicator labels live ON the bomb chassis; speaker pill, self-mute, pause/disconnect banner, toasts, and round-end overlays are screen-space overlays. Enforce the ranked HUD hierarchy; nothing else in the HUD.
- UX-DR11: Microcopy voice — dry, deadpan, period-appropriate strings ("T-MINUS"; "DEFUSED." / "DETONATED." / "TIME EXPIRED."; "Strike. Don't do that again." once only; "Bring them in"; "Holding the clock"; "Spectator [name] sent a tip: [tip]").
- UX-DR12: State patterns — loading/connecting screen; separate voice-connecting microcopy ("Voice unavailable — game continues without it"); paused state (amber top strip, dimmed scene, names who dropped, resume requires facilitator + all ready); strike (600ms red module flash, no modal); solve (green flip + chime); defused (all-green 2s hold → between-round); detonated (explosion, red tint, 3s hold, no replay V1); empty states; error states (connection lost = blocking modal + retry; voice lost = dismissible banner).
- UX-DR13: Camera & interaction primitives — Defuser drag = orbit, scroll = zoom, click = focus/interact, ESC = reset; right/middle-click reserved; NO bomb-side keyboard shortcuts (prevents Defuser self-coaching); cursor hides after 2s idle on the bomb scene.
- UX-DR14: Accessibility floor — colorblind pattern/label redundancy on Wires, The Button, Simon Says, Complicated Wires (gate before V1); keyboard focus order + LED-green focus ring (2px outline, 2px offset); `prefers-reduced-motion` disables timer glow pulse / speaker pulse / strike flash (instant state changes, chime still plays); screen-reader support out of scope V1 (documented).
- UX-DR15: Game feel / juice — ≤100ms click→outcome budget; module-typed solve-chime pitches (so Experts hear which module solved); short declarative-absurd strike sound ("klaxon honk"); generous explosion (full-screen flash + bass drop + 1.5s silence); 3-note brass defuse fanfare (the most rewarding sound — spend budget here); no screen shake.
- UX-DR16: Responsive & platform gates — 1280×720 minimum with a "resize your window" gate below, 1920×1080 baseline up to 4K; 16:9 baseline, 16:10/21:9 letterbox the bomb scene vertically (never crop the chassis); mobile bounce screen; test on 1× and 2× DPR.

### FR Coverage Map

- FR1: Epic 2 — Facilitator creates session, gets join code + link
- FR2: Epic 2 — Players join via code, pick role
- FR3: Epic 2 — Team & role assignment
- FR4: Epic 2 — Lobby roster, role pickers, share, ready, mic check
- FR5: Epic 2 — 2–16 player support
- FR6: Epic 2 — No mid-round joins; between-round add
- FR7: Epic 4 — Prep: Defuser sees module types on placeholder bomb
- FR8: Epic 8 — Facilitator-controlled prep duration
- FR9: Epic 8 — Round configuration
- FR10: Epic 8 — Difficulty tier pool/count gating
- FR11: Epic 8 — Round start + Defuser assignment by rotation
- FR12: Epic 8 — Between-round pause
- FR13: Epic 8 — Disconnect auto-pause
- FR14: Epic 8 — Retry failed round (reused seed)
- FR15: Epic 8 — Manual advance + scoreboard preview
- FR16: Epic 4 — 3D bomb render + orbit/zoom/focus camera
- FR17: Epic 4 — Bomb metadata (serial/batteries/indicators/ports)
- FR18: Epic 4 — Module solve LEDs; all-disarmed = defused
- FR19: Epic 8 — Per-team seeded value randomisation orchestration
- FR20: Epic 5 — Click-only Defuser interaction primitive
- FR21: Epic 5 — Module: Wires
- FR22: Epic 5 — Module: The Button
- FR23: Epic 5 — Module: Passwords
- FR24: Epic 6 — Module: Keypads
- FR25: Epic 6 — Module: Who's on First
- FR26: Epic 6 — Module: Wire Sequences
- FR27: Epic 6 — Module: Mazes
- FR28: Epic 7 — Module: Complicated Wires
- FR29: Epic 7 — Module: Simon Says
- FR30: Epic 7 — Module: Memory
- FR31: Epic 7 — Module: Morse Code
- FR32: Epic 4 — Team-wide strike state + flash + counter
- FR33: Epic 8 — Strike escalation (timer speed-up, compounding)
- FR34: Epic 8 — Server-authoritative timer + expiry
- FR35: Epic 4 — Timer + strike counter always visible to Defuser
- FR36: Epic 5 — Expert digital manual viewer + navigation
- FR37: Epic 9 — Asymmetric Expert Roles (chapter allocation)
- FR38: Epic 3 — Two voice channels (Bomb Room + Spectator Lounge)
- FR39: Epic 3 — Spectator listen-only (token-grant enforced)
- FR40: Epic 3 — Speaker indicator, mute, graceful voice degradation
- FR41: Epic 3 — Token re-mint on role change
- FR42: Epic 9 — Spectator Lifelines (token economy + hint toast)
- FR43: Epic 8 — Sequential relay; every player defuses once
- FR44: Epic 8 — Odd-team extra round equalisation
- FR45: Epic 8 — Time-based cumulative scoring
- FR46: Epic 8 — Between-round + final scoreboard
- FR47: Epic 10 — Game-state SFX (no music in rounds)

## Epic List

### Epic 1: Foundation & Walking Skeleton
Stand up the monorepo, shared typed contracts, pure-reducer/handler scaffolding, deterministic seed utility, Redis/Postgres adapters, and Docker Compose so a Facilitator can launch the stack and a client can connect end-to-end. No player-facing FRs — delivers a deployable, connectable skeleton that every later epic plugs into.
**FRs covered:** *(infrastructure)* — AR1, AR2, AR3, AR6 (seed util), AR9, AR10, AR11, AR13, AR15; NFR15

### Epic 2: Lobby & Session Setup
A Facilitator hosts a private session, shares a join code, players join and pick roles, and the Facilitator assigns two teams with per-player roles — all visible in a calm lobby with a mic check.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6 — UX-DR7, UX-DR9, UX-DR12, UX-DR16

### Epic 3: Voice Communication
Players talk through built-in WebRTC — a bidirectional Bomb Room and a listen-only Spectator Lounge — with speaker presence, mute, and graceful degradation if voice drops.
**FRs covered:** FR38, FR39, FR40, FR41 — AR12, NFR3, UX-DR5

### Epic 4: Bomb Renderer & HUD
The Defuser sees and manipulates a real-time 3D bomb at 60fps — chassis, metadata, per-module solve LEDs, the diegetic timer LCD, and the strike indicator — with smooth client-extrapolated timer display and optimistic-render snapshots.
**FRs covered:** FR7, FR16, FR17, FR18, FR32, FR35 — AR7, AR8, NFR1, NFR2, NFR13, UX-DR2, UX-DR3, UX-DR4, UX-DR10, UX-DR13

### Epic 5: Core Modules — Easy (Walking Skeleton)
A team can fully defuse the three Easy modules over voice, with the Expert manual viewer. Ships Wires first to prove the core information-asymmetry loop, then The Button and Passwords.
**FRs covered:** FR20, FR21, FR22, FR23, FR36 — AR4, AR5, AR16, NFR11, UX-DR8, UX-DR14

### Epic 6: Core Modules — Medium
Adds the four Medium-tier modules as additive plugins.
**FRs covered:** FR24, FR25, FR26, FR27

### Epic 7: Core Modules — Hard
Adds the four Hard-tier modules — the multi-stage and strike/serial-dependent ones.
**FRs covered:** FR28, FR29, FR30, FR31 — UX-DR14

### Epic 8: Game Loop & Scoring
The full relay race: Facilitator configures and runs rounds, the server owns the clock and strike escalation, bombs generate per-team from the seed chain, pause/disconnect/retry work, and cumulative time produces a scoreboard.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR19, FR33, FR34, FR43, FR44, FR45, FR46 — AR6, AR7, AR11, UX-DR11, UX-DR12

### Epic 9: Advanced Features
The two Facilitator-toggleable modifiers: Asymmetric Expert Roles (round-robin chapter allocation) and Spectator Lifelines (token economy + hint toasts).
**FRs covered:** FR37, FR42 — UX-DR6

### Epic 10: Polish & Hardening
SFX wiring, 60fps profiling, WebRTC reliability behind symmetric NAT, accessibility gate sign-off, and playtest instrumentation.
**FRs covered:** FR47 — NFR1, NFR3 (A4), NFR5, NFR11, NFR12, UX-DR14, UX-DR15

---

## Epic 1: Foundation & Walking Skeleton

Stand up the monorepo, shared typed contracts, pure-reducer/handler scaffolding, deterministic seed utility, data-store adapters, and Docker Compose so a Facilitator can launch the stack and a client can connect end-to-end. Delivers a deployable, connectable skeleton that every later epic plugs into. (AR1, AR2, AR3, AR6, AR9, AR10, AR11, AR13, AR15; NFR15)

### Story 1.1: Monorepo & Build Scaffold

As a developer,
I want a pnpm-workspace monorepo with `packages/shared`, `apps/client`, and `apps/server` and a strict TypeScript build,
So that all later work has a consistent, type-safe foundation with clean dependency boundaries.

**Acceptance Criteria:**

**Given** a fresh checkout
**When** I run `pnpm install`
**Then** the workspace resolves `packages/shared`, `apps/client`, and `apps/server` with per-workspace `tsconfig.json` files
**And** `packages/shared` has zero runtime dependencies on react, socket.io, or any server/client framework.

**Given** the workspace is installed
**When** I run `pnpm -r exec tsc --noEmit`
**Then** it completes with zero errors and the command is wired as a pre-commit gate
**And** no file uses `// @ts-ignore`.

**Given** the client workspace
**When** I run the Vite dev server
**Then** it starts with HMR and native ESM and renders a placeholder app shell.

### Story 1.2: Shared Contracts — Core Types & Typed Events

As a developer,
I want the core game-state types and the typed Socket.IO event interfaces defined once in `packages/shared`,
So that client and server share a single source of truth and untyped events are impossible.

**Acceptance Criteria:**

**Given** `packages/shared/src/types`
**When** I import the core model
**Then** `SessionState`, `BombState`, `BombContext`, `ModuleState<S>`, `IModule`, `Reducer<S,A>`, and `TimerState` are defined per the architecture data model
**And** `BombContext.serialNumber` is documented/typed such that its last character is always a digit.

**Given** `packages/shared/src/events`
**When** the server or client wires Socket.IO
**Then** it uses `ServerToClientEvents` and `ClientToServerEvents` typed interfaces
**And** an untyped `socket.emit(string, any)` fails type-checking.

### Story 1.3: Deterministic Seed-Chain Utility

As a developer,
I want a deterministic hash + seed-chain utility in `packages/shared/src/seeding`,
So that bomb generation is reproducible and fair across teams without `Math.random()`.

**Acceptance Criteria:**

**Given** the seeding utility
**When** I derive `templateSeed = hash(sessionId + roundNumber)`, `teamSeed = hash(templateSeed + teamId)`, `moduleSeed = hash(teamSeed + moduleIndex)`
**Then** identical inputs always produce identical outputs on both client and server.

**Given** the same `(sessionId, roundNumber)`
**When** two different `teamId`s derive their seeds
**Then** the `templateSeed` is identical but the `teamSeed`s differ.

**Given** unit tests for the utility
**When** the suite runs in Node with zero infrastructure
**Then** determinism, distribution sanity, and cross-environment equality are all asserted.

### Story 1.4: Server Bootstrap — Fastify + Socket.IO + Health

As a Facilitator (operator),
I want the server process to boot, validate its config, attach Socket.IO, and expose health checks,
So that the stack is runnable and orchestration can wait on readiness.

**Acceptance Criteria:**

**Given** a valid `.env`
**When** the server starts
**Then** Fastify boots with `@fastify/type-provider-typebox`, Socket.IO is attached, and a `/health` endpoint returns OK only after dependencies are reachable.

**Given** a missing or invalid required environment variable
**When** the server starts
**Then** it fails fast at boot with a clear error and never serves traffic with bad config.

**Given** secrets (LiveKit keys, Redis URL, DB creds)
**When** the code is inspected
**Then** none are hardcoded — all are read from `.env`, and `.env` is git-ignored.

### Story 1.5: Data-Store Adapters — Redis Keyspace & Postgres Pool

As a developer,
I want Redis and PostgreSQL adapters with documented keyspace conventions and pooling,
So that in-flight state and the session-end archive have clean, O(1) access boundaries.

**Acceptance Criteria:**

**Given** the Redis adapter
**When** a key is written
**Then** it follows the colon-delimited namespace convention (`session:{id}:...`) and every documented read/write is O(1) (no full-session scans).

**Given** the Postgres adapter
**When** the server boots
**Then** it connects via `pg-pool` and reports health, but performs no writes on any game-action path (writes are reserved for session end).

**Given** either store is unreachable at boot
**When** health is checked
**Then** the server reports unhealthy and does not accept game connections.

### Story 1.6: Pure-Reducer Harness & Open/Closed Bomb Reducer

As a developer,
I want the pure-reducer core with an open/closed `bombReducer` delegating to a `MODULE_REDUCERS` registry,
So that game logic is unit-testable and new modules are purely additive.

**Acceptance Criteria:**

**Given** any reducer in the core
**When** its imports are inspected
**Then** it imports nothing from `socket.io`, `ioredis`, `pg`, `fastify`, or `react`, and uses no `Date.now()`/`Math.random()`/`setTimeout`.

**Given** the `bombReducer`
**When** it receives a `MODULE_ACTION` with an unknown `moduleIndex` or an unregistered `moduleId`
**Then** it returns the state unchanged (guard → no-op), never throws.

**Given** a frozen state object
**When** any reducer is called
**Then** it returns a new object via spread/map and does not throw on the frozen input.

**Given** a new module is added to `MODULE_REDUCERS`
**When** the change is reviewed
**Then** `bombReducer.ts` is unmodified.

### Story 1.7: Client Bootstrap — React/Vite/Zustand + Typed Socket Client

As a player,
I want the client app to load and establish a typed Socket.IO connection with Zustand state,
So that I can connect to a session and receive server state.

**Acceptance Criteria:**

**Given** the client app
**When** it mounts
**Then** it initializes Zustand stores (game, voice, ui) and a typed Socket.IO client wrapper using the shared event interfaces.

**Given** tick-rate state
**When** rendering on the game loop
**Then** the pattern accesses Zustand via `getState()` inside `useFrame` (never reactive `useStore()` for per-frame reads, never `useEffect`+`setInterval`).

**Given** the server emits a state event
**When** the client receives it
**Then** the corresponding Zustand store updates and the UI reflects the last-received snapshot (render-only, non-authoritative).

### Story 1.8: Docker Compose Stack & Smoke Test

As a Facilitator (operator),
I want a Docker Compose stack with all services health-checked and a smoke-test script,
So that I can spin up the whole game in under 3 minutes and verify it before a session.

**Acceptance Criteria:**

**Given** `docker compose up`
**When** the stack starts
**Then** `client`, `server`, `redis`, `postgres`, `livekit`, `coturn`, and `caddy` all start with health checks, and the game server waits on Redis + Postgres health before accepting connections.

**Given** the running stack
**When** I run `scripts/smoke-test.sh`
**Then** it validates every service is reachable and exits non-zero if any is not.

**Given** the deployment docs
**When** I read them
**Then** the required ports (443, 7880, 7881, 3478, 7882/udp [LiveKit RTP/ICE mux port], 40000–40031/udp [coturn TURN relay]) and minimum host spec (2 vCPU / 4 GB / 100 Mbps / 10 GB) are documented.

---

## Epic 2: Lobby & Session Setup

A Facilitator hosts a private session, shares a join code, players join and pick roles, and the Facilitator assigns two teams with per-player roles — all visible in a calm lobby with a mic check. (FR1–FR6; UX-DR7, UX-DR9, UX-DR11, UX-DR12, UX-DR16)

### Story 2.1: Design Tokens, UI Shell & State Patterns

As a player,
I want a consistent token-driven app shell with shared components, loading/connecting, viewport, and platform gates,
So that I always know the system's state, the UI is visually coherent, and I only play in a supported environment.

**Acceptance Criteria:**

**Given** the design-token system
**When** components are styled
**Then** the DESIGN.md tokens are implemented as the single source — two color worlds (bomb-world diegetic + operator-world non-diegetic), the five typeface families each in its assigned role, the 4px spacing unit with 32px HUD safe-area, and the radius scale — with semantic color reservations enforced (LED green = solved, red = strike, amber = caution, cool blue = self, cream = manual; never decorative).

**Given** the primary button component
**When** it is pressed
**Then** it shows the tactile 2px translateY press; every destructive/irreversible action requires a secondary confirm step; and no primary button is ever itself a destructive action.

**Given** a network call in progress
**When** the UI is waiting
**Then** a full-bleed loading screen with a status line is shown ("Connecting…") — never a silent blocking call.

**Given** a viewport below 1280×720
**When** the app loads
**Then** a "Resize your window — Bomb Squad needs more room" gate is shown instead of the game.

**Given** a mobile browser
**When** the app loads
**Then** a friendly bounce screen ("Bomb Squad is a desktop experience") is shown.

**Given** any operator-world UI
**When** it is styled
**Then** it uses the non-diegetic token palette (dark shell, cream ink) and microcopy is dry/deadpan/period-appropriate.

### Story 2.2: Facilitator Hosts a Session

As a Facilitator,
I want to create a private session and get a shareable link + join code,
So that I can bring my team in within minutes without any accounts.

**Acceptance Criteria:**

**Given** the landing screen
**When** I choose "Host a session"
**Then** a `SESSION_CREATE` is sent and the server returns a `sessionId` and a `joinCode` of ≥6 characters derived from `crypto.randomBytes` (never sequential).

**Given** a created session
**When** I view the lobby
**Then** the join code and a shareable link are displayed with a "Bring them in" share affordance, and no account creation was required.

### Story 2.3: Player Joins via Code and Picks a Role

As a player,
I want to enter a join code, pick a display name and role, and land in the lobby,
So that I can take part as Defuser, Expert, or Spectator.

**Acceptance Criteria:**

**Given** the join-code input
**When** I type or paste a code
**Then** it shows 6 mono character cells, auto-uppercases, splits a paste per cell, and submits on the 6th character without a separate button.

**Given** a valid code and an available session
**When** I submit with a display name and chosen role
**Then** `SESSION_JOIN` succeeds and I appear in the lobby roster with that role.

**Given** an invalid or full session code
**When** I submit
**Then** I receive a typed, human-readable error and remain on the join screen.

### Story 2.4: Team & Per-Player Role Assignment

As a Facilitator,
I want to assign players to two teams and set each player's role,
So that the relay has balanced teams with clear roles before a round starts.

**Acceptance Criteria:**

**Given** players in the lobby
**When** I assign a player to Team A or Team B and set their role (Defuser/Expert/Spectator)
**Then** a `TEAM_ASSIGN` is accepted only from a Facilitator and the roster updates for all participants.

**Given** a non-Facilitator socket
**When** it attempts `TEAM_ASSIGN`
**Then** the server rejects it with an authority error and no state changes.

### Story 2.5: Lobby Roster, Ready State & Mic Check

As a Facilitator and players,
I want a live roster with ready indicators and a mic check,
So that I can confirm everyone is present and audible before starting.

**Acceptance Criteria:**

**Given** the lobby
**When** players join or change role/ready
**Then** the roster reflects each player's team, role, and ready state in real time.

**Given** a player speaks during mic check
**When** their microphone produces audio
**Then** their speaker indicator shows active (green); a silent player's indicator stays gray so the Facilitator can prompt them.

**Given** a lobby with a single player
**When** it renders
**Then** an empty-state message ("Waiting for your team.") is shown.

### Story 2.6: Capacity & Join-Window Guards

As a Facilitator,
I want session capacity and join-window rules enforced,
So that sessions stay within 2–16 players and no one joins mid-round.

**Acceptance Criteria:**

**Given** a session at 16 players
**When** another player attempts to join
**Then** the join is rejected with a capacity error.

**Given** a round is active
**When** a new player attempts to join
**Then** the join is refused (no mid-round joins).

**Given** the session is between rounds
**When** the Facilitator adds a player before advancing
**Then** the player is admitted, but is flagged as ineligible to defuse if relay slots are already assigned.

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

**Given** the disconnect-cleanup and refresh-rejoin paths above
**When** a player's identity is resolved anywhere in the system
**Then** it resolves against a **durable player id minted at first join and decoupled from the ephemeral `socket.id`** — not the rotating socket id — so a reconnect re-attaches to the same player record. This durable id is the **system-wide identity primitive**, not a lobby-local construct: it is the same id the `MODULE_INTERACT` authority gate (Story 4.7) and the mid-round disconnect/pause restore (Story 8.7 / FR13) resolve against. The deferred `socket.id`-as-identity items from the 2.2 / 2.3 / 2.4 / 5.2 / 8.3 / 4.7 reviews are marked resolved by this story's review.

> **Scope note (widened — Sprint 2 retro Action Item 2).** Story 2.7 was originally framed as lobby-only resilience. The 4.7 snapshot-sync work made stable identity a *gameplay-authority correctness* dependency (a reconnected Defuser is refused `NOT_TEAM_DEFUSER` and never re-sent `BOMB_INIT`), not just a lobby-roster nicety. So 2.7 now **owns the durable-identity primitive** that downstream consumers depend on. It still does **not implement** mid-round reattach/resume — that ceremony (re-send each team's `BOMB_INIT`, re-establish `teamRoom` membership on resume) stays in **Story 8.7 / FR13**; 8.7 builds it on top of the identity 2.7 introduces. When `gds-create-story` runs for 2.7, carry this dependency into its Dev Notes and have 4.7 / 8.7 cite it.

---

## Epic 3: Voice Communication

Players talk through built-in WebRTC — a bidirectional Bomb Room and a listen-only Spectator Lounge — with speaker presence, mute, and graceful degradation if voice drops. (FR38–FR41; AR12, NFR3, UX-DR5)

### Story 3.1: Role-Scoped LiveKit Token Minting

As a player,
I want the server to mint a LiveKit token scoped to exactly my room and rights,
So that I can join voice with only the permissions my role allows.

**Acceptance Criteria:**

**Given** a participant with a role
**When** they request voice access
**Then** the server mints a LiveKit token scoped to exactly one room with exactly the grants for that role, and spectator tokens have `canPublish: false`.

**Given** any token request
**When** it is logged
**Then** the token value itself is never written to logs.

### Story 3.2: Bomb Room Bidirectional Channel

As a Defuser, Expert, or Facilitator,
I want to join the Bomb Room and talk bidirectionally,
So that the team can communicate to defuse the bomb.

**Acceptance Criteria:**

**Given** a Bomb Room participant
**When** they join `bomb-room:{sessionId}:{teamId}`
**Then** they can both publish and subscribe to audio.

**Given** the game socket
**When** voice connects or fails
**Then** voice connection state is tracked in a separate Zustand store and never gates a game-state transition.

### Story 3.3: Spectator Lounge Listen-Only Channel

As a Spectator,
I want to hear the Bomb Room without being able to speak into it,
So that I can follow the action without disrupting the team.

**Acceptance Criteria:**

**Given** a Spectator in `spectator-lounge:{sessionId}`
**When** they are connected
**Then** they receive the Bomb Room audio as a listen-only track and cannot publish into the Bomb Room.

**Given** a spectator client attempts to publish audio to the Bomb Room
**When** the attempt reaches LiveKit
**Then** it is denied at the token-grant level (not merely hidden in the UI).

### Story 3.4: Speaker Indicator & Mute Controls

As a player,
I want to see who is talking and to mute/unmute myself,
So that communication stays clear and I can manage my own audio.

**Acceptance Criteria:**

**Given** a participant transmitting
**When** their audio is active
**Then** their speaker pill pulses with their name always visible (never icon-only), self uses cool blue and other active speakers use LED green, with a 150ms grace to suppress flicker on stop.

**Given** my self-mute control (bottom-left)
**When** I toggle it
**Then** my microphone mutes/unmutes and my indicator shows a muted state.

### Story 3.5: Token Re-Mint on Role Change

As a player whose role changes between rounds,
I want a fresh voice token minted for my new role,
So that stale permissions can never leak across roles.

**Acceptance Criteria:**

**Given** a player changes from Defuser to Spectator (or vice versa) on relay rotation
**When** the role change is applied
**Then** a new LiveKit token is minted with the new room + grants and the old token is never reused.

**Given** a player who just became a Spectator
**When** their new token is issued
**Then** it has `canPublish: false` and routes them to the Spectator Lounge.

### Story 3.6: Graceful Voice Degradation

As a player,
I want the game to keep working if voice drops,
So that a WebRTC failure never blocks play.

**Acceptance Criteria:**

**Given** voice fails to connect or drops mid-session
**When** the failure is detected
**Then** a dismissible banner shows "Voice unavailable — game continues without it" and all game UI remains fully interactive.

**Given** a corporate-NAT environment
**When** a participant joins voice
**Then** connection is attempted via the TURN relay path and the connecting microcopy is distinct from the game-socket connecting state.

---

## Epic 4: Bomb Renderer & HUD

The Defuser sees and manipulates a real-time 3D bomb at 60fps — chassis, metadata, per-module solve LEDs, the diegetic timer LCD, and the strike indicator — with smooth client-extrapolated timer display and optimistic-render snapshots. (FR7, FR16, FR17, FR18, FR32, FR35; AR7, AR8, NFR1, NFR2, NFR13, UX-DR2, UX-DR3, UX-DR4, UX-DR10, UX-DR13)

### Story 4.1: 3D Bomb Scene & Camera Rig

As a Defuser,
I want to orbit, zoom, and focus on the 3D bomb,
So that I can inspect every face and describe what I see.

**Acceptance Criteria:**

**Given** the bomb scene
**When** I drag, scroll, click a module, or press ESC
**Then** drag orbits, scroll zooms, click focuses (camera dollies into the module), and ESC returns to overview; right-click and middle-click are reserved (no module interaction).

**Given** the bomb scene with no mouse movement
**When** 2 seconds elapse
**Then** the cursor hides.

**Given** a 16:10 or 21:9 viewport
**When** the scene renders
**Then** it letterboxes vertically and never crops the chassis.

### Story 4.2: Chassis & Bomb Metadata Rendering

As a Defuser,
I want the bomb to display its serial number, batteries, indicators, and ports as physical features,
So that I can read them aloud to the Experts.

**Acceptance Criteria:**

**Given** a `BombContext`
**When** the chassis renders
**Then** the serial sticker (mono font, last char a digit), battery panel, indicator labels (lit/unlit), and ports are visible as diegetic chassis features.

**Given** the Maya flow target
**When** I rotate the bomb to find the serial
**Then** the serial is findable in under 10 seconds with no menu-driven inspection.

### Story 4.3: Module Slots & Solve LEDs

As a Defuser,
I want each module slot to show a solve LED,
So that I can learn the bomb's progress by scanning for greens.

**Acceptance Criteria:**

**Given** a bomb with N modules
**When** it renders
**Then** module geometry/layout is data-driven from the registry (never hardcoded in JSX) and each module shows a 10px solve LED.

**Given** a module's status
**When** it is armed, solved, or struck
**Then** the LED shows dim-red, green-glow, or a 600ms red flash respectively, and green is the single source of truth for "solved."

### Story 4.4: Diegetic Timer LCD with Client Extrapolation

As a Defuser,
I want a smooth 7-segment countdown built into the chassis,
So that I can read and call out the remaining time precisely.

**Acceptance Criteria:**

**Given** a `TimerState` broadcast (`startedAt`, `remainingAtStart`, `speedMultiplier`, `pausedAt`)
**When** the client renders each frame
**Then** it extrapolates the displayed time inside `useFrame` using the server-time offset (no `setInterval`), at 84px DSEG7 red.

**Given** the timer is running
**When** digits change
**Then** only the glow animates — digits never animate — and under 10s the LCD glow pulses on the second.

**Given** the client's extrapolated clock reaches 0:00
**When** no server expiry has arrived
**Then** the bomb does not explode on the client (display-only; the server owns expiry).

### Story 4.5: Strike Indicator & Strike Roll-Up

As a Defuser,
I want a visible strike indicator that reacts to mistakes,
So that the whole team feels the shared pressure.

**Acceptance Criteria:**

**Given** the HUD
**When** the bomb has 0–2 strikes
**Then** a row of 2 LED dots beside the timer shows inactive/active states matching the strike count.

**Given** a module transitions to `struck`
**When** the bomb reducer rolls it up
**Then** the team strike count increments (shared, no individual attribution), the affected module flashes red 600ms, and no modal interrupts play.

### Story 4.6: Preparation Placeholder Bomb View

As a Defuser in the Preparation phase,
I want to see the module *types* on a placeholder bomb without their values,
So that I can orient to the layout while Experts study the manual.

**Acceptance Criteria:**

**Given** the Preparation phase
**When** the Defuser views the bomb
**Then** module types are shown on a placeholder bomb but no randomised values (wire colours, labels, symbols) are revealed.

**Given** the same Preparation phase
**When** an Expert or Spectator views their surface
**Then** they see the full manual (role-gated content split), confirming roles never see each other's primary surface.

### Story 4.7: Snapshot Sync & Optimistic Render at 60fps

As a Defuser,
I want my clicks to feel instant and the bomb to stay authoritative,
So that play is responsive without ever showing a wrong "solved" state.

**Acceptance Criteria:**

**Given** a validated state change
**When** the server broadcasts a `ModuleUpdate` (full module state + optional bombDelta)
**Then** the client applies the snapshot as the authoritative truth, scoped to `session:{id}:team:{teamId}`.

**Given** a Defuser click
**When** the optimistic path pre-flashes an affordance (e.g. a wire severing)
**Then** it never pre-commits `solved` — only the server's snapshot flips the solve LED — and a server rejection rolls the pre-flash back, all within a ≤100ms perceived budget.

**Given** the bomb view over a 10-minute session
**When** profiled on a mid-range laptop
**Then** it sustains 60fps — using `getState()` in `useFrame`, memoized module components, reused refs (no per-frame allocations), and disposed Three.js objects on unmount.

---

## Epic 5: Core Modules — Easy (Walking Skeleton)

A team can fully defuse the three Easy modules over voice, with the Expert manual viewer. Ships Wires first to prove the core information-asymmetry loop, then The Button and Passwords. (FR20, FR21, FR22, FR23, FR36; AR4, AR5, AR16, NFR11, UX-DR8, UX-DR14)

### Story 5.1: Module Plugin Scaffold, Sandbox & Click Primitive

As a developer,
I want the per-module file contract, client renderer registry, dev sandbox, and the Defuser click primitive,
So that modules can be built and tested in isolation and added additively.

**Acceptance Criteria:**

**Given** a new module directory
**When** it is created
**Then** it follows the contract: `generate.ts` (pure, seeded), `solve.ts` (pure), `reducer.ts` (pure), `DefuserView.tsx` (R3F rendering only), `ManualPages.tsx` (structured data), `types.ts` (re-exported from shared), `__tests__/`.

**Given** the module registry
**When** a module registers its renderer and `MODULE_REDUCERS` entry
**Then** it appears on the bomb with no change to `bombReducer.ts`.

**Given** `/dev/sandbox`
**When** a developer opens it
**Then** a single module can be generated from a seed and exercised in isolation.

**Given** a Defuser interaction
**When** it occurs
**Then** it is driven solely by mouse click (wire cut = click; button press = mousedown+up; hold = sustained); there are no bomb-side keyboard shortcuts.

### Story 5.2: Expert Manual Viewer

As an Expert,
I want a calm, navigable digital manual on paper-styled pages,
So that I can read the rules aloud while the bomb is screaming.

**Acceptance Criteria:**

**Given** the manual viewer
**When** I navigate
**Then** I can click chapters, use arrow keys / Page Up-Down, and press `/` to search chapters by name, with the current chapter highlighted; reaching a chapter from `/` takes under ~300ms.

**Given** I flip between chapters
**When** I return to one
**Then** my scroll position is preserved per chapter (I never lose my place).

**Given** any manual page
**When** it renders
**Then** it uses the serif typeface on cream paper with grain and a paper shadow (≤1° rotation), two-column max (chapter list / content) with no nested scrolling regions — never a generic web modal.

**Given** module manual content
**When** it is authored
**Then** it comes from `getManualPages()` as structured data, not raw HTML or untyped JSX.

**Given** an Expert's current chapter/page position
**When** they navigate
**Then** the current position is exposed as observable state and emitted via a typed event, so the Spectator Lounge (Story 9.4) can mirror it (GDD A3: spectator manual is locked to the Expert).

### Story 5.3: Wires Module (Walking Skeleton)

As a team,
I want to defuse the Wires module over voice,
So that we prove the core information-asymmetry loop end-to-end.

**Acceptance Criteria:**

**Given** a generated Wires module
**When** `generate(seed, ctx)` runs
**Then** it deterministically produces 3–6 coloured wires from the seed alone (no `Math.random()`).

**Given** a wire configuration and bomb context
**When** the correct wire (per the per-wire-count rule tables for 3/4/5/6 wires) is cut
**Then** the module solves (LED green, solve chime) with no strike.

**Given** an incorrect wire is cut
**When** the action is reduced
**Then** a team strike is recorded and the module is not solved; repeating the same cut is a no-op (idempotent).

**Given** the manual pages
**When** an Expert reads Wires
**Then** all four per-wire-count rule tables are present and wires carry pattern/label redundancy (not colour alone) for the colorblind floor.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy-path, wrong-interaction, idempotency, immutability (frozen input), guard clauses, and reset.

### Story 5.4: The Button Module

As a team,
I want to defuse The Button (press/hold + timed release),
So that we handle a module whose solution depends on bomb context and the live timer.

**Acceptance Criteria:**

**Given** a generated Button
**When** the press/hold decision rules are evaluated in order
**Then** the first matching rule (Blue+Abort→hold; >1 battery+Detonate→press; White+CAR→hold; >2 batteries+FRK→press; Yellow→hold; Red+Hold→press; else hold) determines the correct action.

**Given** a held button showing a coloured release strip
**When** the Defuser releases at a timer digit matching the strip rule (Blue→4, White→1, Yellow→5, other→1, in any position)
**Then** the module solves; releasing at a wrong digit records a strike.

**Given** the module visuals
**When** rendered
**Then** colour is paired with label/pattern redundancy (colorblind floor).

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset, passing the live timer value as state input (never `Date.now()`).

### Story 5.5: Passwords Module

As a team,
I want to defuse the Passwords module,
So that we solve a verbal/language module by cycling letters to a valid word.

**Acceptance Criteria:**

**Given** a generated Passwords module
**When** `generate` runs
**Then** the five letter columns are seeded such that exactly one combination spells a word from the 35-word valid list.

**Given** the columns cycled to a valid word
**When** SUBMIT is pressed
**Then** the module solves; SUBMIT on a non-listed word records a strike.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset.

---

## Epic 6: Core Modules — Medium

Adds the four Medium-tier modules as additive plugins, each with Defuser view, Expert manual pages, seeded generation, pure solve/reducer, and the standard six-case reducer test suite. (FR24, FR25, FR26, FR27)

### Story 6.1: Keypads Module

As a team,
I want to defuse the Keypads module,
So that we solve a symbol/spatial-vocabulary module.

**Acceptance Criteria:**

**Given** a generated Keypads module
**When** `generate` runs
**Then** four symbols are placed such that exactly one reference column contains all four.

**Given** the four buttons
**When** they are pressed in the order their symbols appear top-to-bottom in that column
**Then** the module solves; a wrong-order press records a strike.

**Given** the custom glyphs
**When** rendered
**Then** they visually reinforce the closest natural description so a first-time player can describe them under time pressure.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset.

### Story 6.2: Who's on First Module

As a team,
I want to defuse the Who's on First module,
So that we solve a two-step display-word → label-priority module.

**Acceptance Criteria:**

**Given** a generated module
**When** Step 1 maps the display word to a button position and Step 2 reads that button's label
**Then** pressing the first button on the module appearing in that label's priority list solves the module.

**Given** a press that is not the first priority-list match
**When** reduced
**Then** a strike is recorded and the module is not solved.

**Given** the manual pages
**When** an Expert reads them
**Then** the full display→position grid and all label priority lists are present.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset.

### Story 6.3: Wire Sequences Module

As a team,
I want to defuse the Wire Sequences module across paged panels,
So that we solve a module requiring cumulative occurrence tracking.

**Acceptance Criteria:**

**Given** multiple panels navigated with up/down
**When** wires are evaluated
**Then** occurrences are counted cumulatively across all panels per wire colour, and a wire is cut only if it connects to the letter(s) specified for its colour+occurrence.

**Given** a wire that should not be cut for its occurrence
**When** the Defuser cuts it
**Then** a strike is recorded.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset, including occurrence counting across panel navigation.

### Story 6.4: Mazes Module

As a team,
I want to defuse the Mazes module,
So that we solve a spatial-navigation module with invisible walls.

**Acceptance Criteria:**

**Given** a generated maze
**When** `generate` runs
**Then** one of the 9 layouts is selected and identified by its two circular marker positions.

**Given** the Defuser navigates the white light with arrow buttons
**When** a move would cross a wall (invisible on the bomb, shown in the manual)
**Then** the move is rejected and a strike is recorded; reaching the red triangle solves the module.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset.

---

## Epic 7: Core Modules — Hard

Adds the four Hard-tier modules — the multi-stage and strike/serial-dependent ones — as additive plugins with the standard contract and test suite. (FR28, FR29, FR30, FR31; UX-DR14)

### Story 7.1: Complicated Wires Module

As a team,
I want to defuse the Complicated Wires module,
So that we solve a per-wire truth-table module referencing bomb context.

**Acceptance Criteria:**

**Given** each wire's attribute combination (red stripe, blue stripe, star, LED)
**When** it is looked up in the 16-row truth table
**Then** the resulting code (C/D/S/P/B) is applied — C cut, D don't, S cut if last serial digit even, P cut if a parallel port exists, B cut if ≥2 batteries.

**Given** a wire that should not be cut under its code + bomb context
**When** the Defuser cuts it
**Then** a strike is recorded.

**Given** the module visuals
**When** rendered
**Then** stripe/star/LED attributes carry pattern/label redundancy (colorblind floor).

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset across representative truth-table rows.

### Story 7.2: Simon Says Module

As a team,
I want to defuse Simon Says with the correct colour-translation table,
So that we solve a sequence module whose mapping changes with strikes and the serial.

**Acceptance Criteria:**

**Given** a flashing colour sequence
**When** the Defuser translates each flash
**Then** the correct table is chosen by whether the serial contains a vowel (Table A) or not (Table B) AND by the current strike count (0/1/2) — all three strike rows per table implemented.

**Given** the sequence is entered correctly
**When** the last colour is pressed
**Then** the sequence grows by one; a wrong press records a strike (which itself changes the active translation row).

**Given** the module visuals
**When** rendered
**Then** colours carry pattern/label redundancy (colorblind floor).

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset and explicitly verifies all three strike-level tables for both vowel/no-vowel cases.

### Story 7.3: Memory Module

As a team,
I want to defuse the 5-stage Memory module,
So that we solve a sequential state machine that references earlier results.

**Acceptance Criteria:**

**Given** a Memory module
**When** each stage's display value is shown
**Then** the correct press is resolved per the stage tables, tracking both the position pressed and the label on that button as later stages require.

**Given** an incorrect press at any stage
**When** reduced
**Then** the module resets to stage 1 (not merely a strike on the current stage) and a strike is recorded.

**Given** all five stages are completed correctly in sequence
**When** the final correct press is made
**Then** the module solves.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset and explicitly verifies the reset-to-stage-1 behaviour and cross-stage references.

### Story 7.4: Morse Code Module

As a team,
I want to defuse the Morse Code module,
So that we solve a timing-interpretation module by decoding a word to a frequency.

**Acceptance Criteria:**

**Given** a flashing light transmitting a word in Morse
**When** the full word is decoded (not character-by-character to frequency) and looked up
**Then** the matching frequency from the table is found.

**Given** the dial is set to the correct frequency
**When** TX is pressed
**Then** the module solves; TX on a wrong frequency records a strike.

**Given** the generated word
**When** `generate` runs
**Then** it is one of the manual's listed words, chosen deterministically from the seed.

**Given** the reducer test suite
**When** it runs
**Then** it covers happy/wrong/idempotent/immutable/guard/reset.

---

## Epic 8: Game Loop & Scoring

The full relay race: Facilitator configures and runs rounds, the server owns the clock and strike escalation, bombs generate per-team from the seed chain, pause/disconnect/retry work, and cumulative time produces a scoreboard. (FR8–FR15, FR19, FR33, FR34, FR43–FR46; AR6, AR7, AR11, UX-DR11, UX-DR12)

### Story 8.1: Round Configuration & Difficulty Gating

As a Facilitator,
I want to configure each round's difficulty, module pool, count, timer, and modifiers,
So that I can tune the challenge to my team.

**Acceptance Criteria:**

**Given** the dashboard round-setup
**When** I pick a difficulty tier (Easy/Medium/Hard)
**Then** the module pool and default module count + timer are gated to that tier (Easy: Wires/Button/Passwords; Medium adds Keypads/Who's on First/Wire Sequences/Mazes; Hard adds Complicated Wires/Simon Says/Memory/Morse Code).

**Given** a chosen tier
**When** I override the module pool, module count (3–11), timer, strike speed-up % (0–50%), or modifier toggles
**Then** the overrides are accepted and a `ROUND_CONFIGURE` (Facilitator-only) records them.

**Given** the dashboard under social pressure
**When** it renders
**Then** it uses operator-world styling with no fast-blinking elements and no nested modals.

### Story 8.2: Per-Team Bomb Generation

As a team,
I want our bomb generated from the seed chain at round start,
So that both teams get identical layouts with independent, fair values.

**Acceptance Criteria:**

**Given** a round start with a config
**When** the server generates bombs
**Then** both teams derive the same `templateSeed` (identical layout) and distinct `teamSeed`s (independent values), assembling `BombContext` then all modules in one synchronous pass.

**Given** the generated `BombContext`
**When** it is passed to modules
**Then** it is frozen read-only and never mutated by any module.

**Given** the same `(sessionId, roundNumber, teamId)`
**When** generation is re-run
**Then** it reproduces the identical bomb (supporting retry).

### Story 8.3: Round Start, Defuser Assignment & Preparation Control

As a Facilitator,
I want to control the preparation phase and start the round with the right Defuser,
So that the team orients and the relay rotation is honoured.

**Acceptance Criteria:**

**Given** a configured round
**When** I open the Preparation phase
**Then** its duration is Facilitator-controlled (default 2–5 min) and players see role-gated prep content.

**Given** rotation order (default team join order)
**When** I start the round
**Then** the next player in rotation is assigned Defuser and `ROUND_START` (Facilitator-only) begins the round, routing players to their surfaces and voice channels.

### Story 8.4: Server-Authoritative Timer & Strike Escalation

As a team,
I want the countdown owned by the server with strike-based acceleration,
So that timing is fair, tamper-proof, and pressure escalates with mistakes.

**Acceptance Criteria:**

**Given** a round starts
**When** the timer begins
**Then** the server is the sole authority on expiry and broadcasts a `TimerState` descriptor only on change (start/strike/pause/resume).

**Given** a strike is recorded
**When** the timer rebases
**Then** the `speedMultiplier` compounds by the configured % (default 25% → ×1.00/×1.25/×1.56) applied from that moment.

**Given** the server-authoritative clock reaches expiry
**When** the deadline passes
**Then** the server declares the round failed — never a client's local clock.

### Story 8.5: Round Resolution

As a team,
I want each round to end clearly on defuse, explosion, or time-out,
So that our result and time are recorded correctly.

**Acceptance Criteria:**

**Given** all modules are solved
**When** the last one solves
**Then** the round ends "DEFUSED.", the elapsed time is recorded, the scene holds 2s with a defuse fanfare, then transitions to between-rounds.

**Given** a 3rd strike or the timer expiring
**When** it occurs
**Then** the round ends "DETONATED." / "TIME EXPIRED.", the time at the moment of failure is recorded, the explosion plays (red tint, 3s hold), then transitions to between-rounds.

**Given** the round is active
**When** it resolves
**Then** the scoreboard never appears mid-round.

### Story 8.6: Between-Round Flow & Scoreboard Preview

As a Facilitator and players,
I want a scoreboard preview between rounds with a manual advance,
So that everyone sees standing before the next round and I control pacing.

**Acceptance Criteria:**

**Given** a round has resolved
**When** the between-rounds phase begins
**Then** a scoreboard preview is shown to all players and the next round does not begin automatically.

**Given** the between-rounds phase
**When** the Facilitator advances
**Then** the next round's Preparation phase begins for the next Defuser in rotation.

### Story 8.7: Pause — Facilitator & Disconnect

As a Facilitator,
I want to pause between rounds and have mid-round disconnects auto-pause,
So that interruptions never unfairly burn the clock.

**Acceptance Criteria:**

**Given** the session is between rounds
**When** the Facilitator pauses
**Then** "Holding the clock" is shown, the countdown and bomb state freeze, and voice stays live; resume is manual.

**Given** a player disconnects mid-round
**When** the drop is detected
**Then** the round auto-pauses (amber top strip naming who dropped, scene dims, timer freezes) and resume requires the Facilitator plus all players ready.

### Story 8.8: Retry a Failed Round

As a Facilitator,
I want to offer a retry of a failed round with the same bomb,
So that a learnable round can be re-attempted fairly.

**Acceptance Criteria:**

**Given** a failed round
**When** I click "Retry round" (a single action with a single confirm)
**Then** the same `templateSeed`/`teamSeed` regenerates the identical bomb and values, and the team re-enters Preparation.

**Given** a retried round
**When** its time is recorded
**Then** the better of the two times is kept for scoring.

### Story 8.9: Relay Orchestration & Odd-Team Equalisation

As a Facilitator,
I want the relay to rotate Defuser across all players and equalise odd team sizes,
So that every player defuses at least once and the competition is fair.

**Acceptance Criteria:**

**Given** the relay
**When** rounds progress
**Then** the Defuser role rotates so every player on a team defuses at least once before session end.

**Given** teams of unequal size
**When** the shorter team has fewer natural rounds
**Then** it plays one extra round with a Facilitator-assigned volunteer Defuser to equalise round count.

**Given** both teams
**When** rounds run
**Then** they play the same rounds sequentially (not in parallel), with the resting team able to spectate.

### Story 8.10: Scoring, Final Scoreboard & Session-End Persistence

As a team,
I want cumulative times totalled into a final scoreboard and archived,
So that we learn who won and the session is recorded.

**Acceptance Criteria:**

**Given** completed rounds
**When** scores are computed
**Then** the team with the lowest cumulative defuse time wins, failed rounds contribute their failure-moment time, and there are no per-module points.

**Given** the session ends
**When** the final scoreboard renders
**Then** it shows a round-by-round breakdown per team and the winner (display headline font).

**Given** the session ends
**When** persistence runs
**Then** session metadata, per-round per-team times, and the final scoreboard are written to Postgres in a single transaction (no writes occurred during play).

---

## Epic 9: Advanced Features

The two Facilitator-toggleable modifiers: Asymmetric Expert Roles (round-robin chapter allocation) and Spectator Lifelines (token economy + hint toasts). (FR37, FR42; UX-DR6)

### Story 9.1: Asymmetric Expert Roles

As an Expert on a team with the modifier enabled,
I want only my assigned manual chapters,
So that Experts must coordinate with each other as well as the Defuser.

**Acceptance Criteria:**

**Given** Asymmetric Expert Roles is enabled and a team has ≥2 Experts
**When** a round starts
**Then** the 11 chapters are auto-assigned round-robin across the Experts (as evenly as possible, randomly allocated) and stored in the role assignment state.

**Given** a chapter-restricted Expert
**When** they navigate the manual
**Then** they can only access their assigned chapters; chapter assignments are delivered via the role-gated room, not broadcast to all.

**Given** the modifier is enabled but a team has a single Expert
**When** the round starts
**Then** that Expert retains full manual access (the modifier does not activate).

### Story 9.2: Spectator Lifeline Token Economy

As a Spectator,
I want to earn and hold lifeline tokens,
So that I can meaningfully contribute when I have one to spend.

**Acceptance Criteria:**

**Given** Spectator Lifelines is enabled
**When** a spectator finishes spectating a round
**Then** they earn 1 token, capped at 3 held.

**Given** the modifier is disabled by the Facilitator
**When** a round runs
**Then** no tokens are earned and the lifeline affordance is hidden.

**Given** per-spectator token counts
**When** stored
**Then** they live under `session:{id}:lifelines` and update accurately as tokens are earned and spent.

### Story 9.3: Send a Lifeline Hint

As a Spectator with a token,
I want to send a pre-defined hint to the Bomb Room,
So that I can help without coaching via free text.

**Acceptance Criteria:**

**Given** a spectator holding ≥1 token
**When** they open the lifeline affordance
**Then** they see the pre-defined prompt list (≤8 scannable options, no free text) and a confirm step ("Send this tip? You have N tokens after.").

**Given** a confirmed `LIFELINE_SEND`
**When** the server validates the spectator actually holds a token
**Then** a token is deducted and a `LIFELINE_TOAST` is delivered to the Defuser and Experts as an 8-second non-blocking toast ("Spectator [name] sent a tip: …") that neither can dismiss early and that never animates the bomb scene layout.

**Given** a spectator with 0 tokens
**When** they attempt to send
**Then** the action is refused with no state change.

### Story 9.4: Spectator Lounge View

As a Spectator,
I want a composed lounge screen showing the active team's bomb and the Expert's current manual page,
So that I can follow exactly what the team is working on and decide when to spend a lifeline.

**Acceptance Criteria:**

**Given** I am a Spectator during an active round
**When** the Spectator Lounge renders
**Then** it shows a split-pane layout — the active team's read-only bomb scene (reusing the Epic 4 renderer with no module interaction and no Defuser camera-focus controls) on one side and a read-only manual pane on the other.

**Given** the manual pane (GDD A3 resolved: **locked to the Expert**, not free-navigate)
**When** the active Expert changes chapter/page
**Then** my manual pane mirrors the Expert's current chapter/page and I cannot navigate it myself (read-only, follow-only).

**Given** a team with multiple Experts (e.g. Asymmetric Expert Roles enabled)
**When** more than one Expert is navigating
**Then** my pane mirrors the most-recently-navigated Expert's page, so I follow whichever Expert last turned a page.

**Given** the manual mirroring
**When** it is implemented
**Then** the Expert manual viewer (Story 5.2) broadcasts the Expert's current page position to the Spectator Lounge via a typed event, and the spectator pane is driven by that broadcast (the spectator never controls navigation).

**Given** the active team's bomb state changes
**When** a `ModuleUpdate` broadcasts
**Then** my read-only bomb view updates from the team-scoped snapshot (`session:{id}:team:{teamId}`) without granting any interaction rights.

**Given** I hold a lifeline token (and lifelines are enabled)
**When** I view the lounge HUD
**Then** the lifeline affordance from Story 9.3 is present; if lifelines are disabled or I hold no token, the affordance is hidden.

**Given** voice
**When** I am in the lounge
**Then** I hear the Bomb Room as listen-only (Story 3.3) and cannot publish.

_Covers the GDD Spectator controls (read-only manual viewing) + EXPERIENCE.md IA item 4 (Spectator Lounge split-pane); relates to FR39, FR42. Resolves readiness GAP-1. **Note:** locked-mirror mode (A3) adds a requirement on Story 5.2 to expose/broadcast the Expert's current page position._

---

## Epic 10: Polish & Hardening

SFX wiring, 60fps profiling, WebRTC reliability behind symmetric NAT, accessibility gate sign-off, and playtest instrumentation. (FR47; NFR1, NFR3/A4, NFR5, NFR11, NFR12, UX-DR14, UX-DR15)

### Story 10.1: Game-State SFX

As a player,
I want purposeful sound for every game state,
So that I feel the pressure and hear progress without staring at the screen.

**Acceptance Criteria:**

**Given** an active round
**When** the game runs
**Then** a ticking countdown plays (tempo rising with strike escalation; quiet, louder under 30s, louder still under 10s) and no music plays during rounds.

**Given** game events
**When** they fire
**Then** the matching SFX plays — module-typed solve chime (distinct pitch per module type), a short declarative-absurd strike sound, a generous explosion (full-screen flash + bass drop + 1.5s silence), a three-note brass defuse fanfare, and lobby ambient.

**Given** `prefers-reduced-motion`
**When** a module solves
**Then** the solve chime still plays even though motion is reduced.

### Story 10.2: 60fps Profiling & Frame-Budget Hardening

As a player,
I want sustained 60fps on reference hardware,
So that the bomb view stays smooth under pressure.

**Acceptance Criteria:**

**Given** a full 11-module bomb
**When** profiled on a mid-range laptop over a 10-minute session
**Then** it sustains 60fps and any frame-budget violation is filed as a bug.

**Given** the render loop
**When** audited
**Then** there are no React re-renders from the game loop, no per-frame allocations in `useFrame`, and Three.js objects are disposed on unmount.

### Story 10.3: WebRTC Reliability Behind Symmetric NAT

As a Facilitator running a real event,
I want voice to connect reliably behind corporate firewalls,
So that the primary delivery mechanism does not fail at the first team-building session.

**Acceptance Criteria:**

**Given** a simulated symmetric-NAT corporate firewall
**When** participants join voice
**Then** voice connects within 10 seconds via the TURN relay path, with a ≥95% connection success rate.

**Given** the deployment
**When** the TURN configuration is verified
**Then** coturn credentials are time-limited HMAC-SHA1 (TTL ≤ 86400s) and the required ports are confirmed and documented; the Facilitator PTT bridge is explicitly tested.

### Story 10.4: Accessibility Gate Sign-Off

As a colorblind or reduced-motion player,
I want the accessibility floor met before release,
So that I can play fairly.

**Acceptance Criteria:**

**Given** Wires, The Button, Simon Says, and Complicated Wires
**When** audited before release
**Then** each carries pattern/label redundancy so colour is never the sole state descriptor (tracked as a release gate).

**Given** all non-bomb UI
**When** navigated by keyboard
**Then** focus order is logical and the LED-green focus ring (2px outline, 2px offset) is visible.

**Given** `prefers-reduced-motion`
**When** set
**Then** timer glow pulse, speaker pulse, and strike flash are disabled in favour of instant state changes, and screen-reader scope is documented as out of scope for V1.

### Story 10.5: Playtest Instrumentation & Desync Hardening

As a developer,
I want session-reconstructable logging and desync resilience,
So that we can validate balance assumptions and keep crash/desync rare.

**Acceptance Criteria:**

**Given** a session
**When** it runs
**Then** structured JSON logs keyed by `sessionId`/`teamId`/`roundNumber` capture state transitions (debug) and strikes/solves/round-results (info), never logging join codes, tokens, or bomb solutions.

**Given** a Redis write failure on a game action
**When** it occurs
**Then** the server persists-then-emits such that no half-applied broadcast is sent, surfacing a recoverable error instead.

**Given** a full session under test
**When** crash/desync is measured
**Then** the rate is ≤ 1%.
