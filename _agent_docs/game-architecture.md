---
title: 'Game Architecture'
project: 'Bomb Squad'
date: '2026-06-10'
author: 'Jay'
version: '1.0'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9]
status: 'complete'

# Source Documents
gdd: '_agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md'
brief: '_agent_docs/planning-artifacts/briefs/brief-Ktane-2026-06-09/brief.md'
ux: '_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/'
project_context: '_agent_docs/project-context.md'
epics: null
---

# Bomb Squad — Game Architecture

## Executive Summary

Bomb Squad is a real-time, voice-driven, cooperative/competitive bomb-defusal party game running entirely in the desktop browser (2–16 players, sequential relay format). The architecture is **server-authoritative** with a **pure-reducer game core**, a **plugin-based module system**, and **deterministic seeded generation** — three properties that together make the game correct, testable, and additively extensible.

This document does **not** re-decide the technology stack. Those decisions were settled in `project-context.md` (React 18 + React Three Fiber + Zustand on the client; Fastify + Socket.IO + Redis + PostgreSQL on the server; LiveKit for WebRTC voice; pnpm monorepo; Docker Compose deployment) and are treated here as accepted constraints. This document **formalizes the runtime architecture** the stack docs leave open: the session-to-server model, the networking topology and state-sync protocol, the timer authority model, the bomb/round/session state lifecycle, the `IModule` plugin contract, the LiveKit voice topology and token strategy, and the server-side validation boundaries.

**Four load-bearing decisions made in this document:**

1. **Multi-session, single process** — one server process serves many concurrent sessions, keyed by `sessionId` in Redis. A team lead runs one container.
2. **Timer = authoritative timestamp + client extrapolation** — the server broadcasts `{startedAt, durationMs, speedMultiplier, pausedAt}` only on change; the client extrapolates the countdown locally each frame for smooth 60 fps; the server remains the sole authority on expiry.
3. **Per-module snapshot broadcasts** — on a state change the server broadcasts the affected module's full new state plus bomb-level deltas. Pairs with UX optimistic pre-flash + rollback.
4. **All 11 modules, tiered & additive** — architect for all 11 GDD modules (Easy/Medium/Hard epics 5/6/7); the plugin system makes each one an additive change. The walking skeleton ships **Wires** first to validate the core hypothesis.

---

## Decision Summary

| Category | Decision | Version | Affects Epics | Rationale |
| -------- | -------- | ------- | ------------- | --------- |
| Client framework | React + React Three Fiber + Three.js | React 19 (R3F 9) | 4–10 | Settled in project-context ("React 18+"); upgraded 18→19 + R3F 8→9 in TD-3 (R3F 9 requires React 19); 3D bomb in-browser, no native build |
| Client state | Zustand (`getState()` in render loop) | latest | 4–10 | Avoids React re-render storms in `useFrame` |
| Server runtime | Node.js + Fastify (`@fastify/type-provider-typebox`) | Node 20 LTS | 1–10 | Settled; typed HTTP + WS host process |
| Realtime transport | Socket.IO | latest | 1–10 | Settled; rooms model maps cleanly to sessions/teams |
| In-flight state store | Redis | 7.x | 1–10 | All live session/bomb state; O(1) hot-path access |
| Persistence | PostgreSQL (session-end only) | 16 | 8 | Archive of completed sessions; never on tick path |
| Voice | LiveKit (self-hosted SFU) + coturn | latest | 3 | WebRTC SFU; Bomb Room + listen-only Spectator Lounge |
| Shared contracts | `packages/shared` pure TS | — | 1–10 | Single source for events, state, module types |
| **Session model** | **Multi-session, single process** | — | 1, 2, 8 | One container per deployment; sessions keyed in Redis |
| **Game core** | **Pure reducers `(state, event) => state`** | — | 5–8 | Zero I/O imports; unit-testable; deterministic |
| **Module system** | **`IModule` plugin registry (open/closed)** | — | 5–7, 9 | Bomb reducer never changes when modules are added |
| **Generation** | **Deterministic seeded chain** | — | 4–7 | Per-team fairness + reproducibility for retry |
| **Timer sync** | **Authoritative timestamp + client extrapolation** | — | 4, 8 | Smooth 60 fps display, no per-tick network spam |
| **State sync** | **Per-module snapshot broadcast** | — | 4–8 | Small payloads; trivially correct; optimistic-render friendly |
| **Build** | **Vite (client) + tsc per-workspace** | — | 1 | Settled; fast HMR, native ESM |
| **Deploy** | **Docker Compose, self-hosted** | — | 1, 10 | Settled; client, server, redis, postgres, livekit, coturn, proxy |

---

## Project Structure

This formalizes the layout established in `project-context.md`, adding the server-side reducer/handler organization the context file implies but does not lay out.

```
bomb-squad/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml
├── docker-compose.prod.yml
├── Caddyfile                       # reverse proxy + TLS termination
├── .env.example                    # never commit real secrets
├── scripts/
│   └── smoke-test.sh               # validates all services reachable
├── packages/
│   └── shared/                     # PURE TypeScript — zero react/socket.io/server deps
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── types/              # BombState, ModuleState, BombContext, IModule, SessionState
│           ├── events/             # ServerToClientEvents, ClientToServerEvents
│           ├── modules/            # per-module State + Action types (re-exported by client)
│           ├── seeding/            # deterministic hash/seed chain helpers
│           └── __tests__/
└── apps/
    ├── client/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── e2e/                     # Playwright visual + flow tests
    │   └── src/
    │       ├── main.tsx
    │       ├── store/               # Zustand stores (game, voice, ui)
    │       ├── net/                 # typed Socket.IO client wrapper
    │       ├── voice/               # LiveKit client integration
    │       ├── scenes/              # R3F bomb scene, camera rig
    │       ├── ui/                  # Tailwind non-diegetic HUD, lobby, dashboard
    │       ├── manual/              # Expert manual viewer
    │       └── modules/             # per-module client code (rendering only)
    │           ├── registry.ts      # client-side module renderer registry
    │           ├── wires/
    │           │   ├── index.ts         # IModule client binding
    │           │   ├── DefuserView.tsx  # R3F rendering only — zero game logic
    │           │   ├── ManualPages.tsx  # structured data → React
    │           │   └── generate.ts      # pure, seeded (or re-export from shared)
    │           ├── the-button/
    │           ├── ...               # one dir per module
    │           └── custom/           # V2 community modules land here — never modify core
    └── server/
        └── src/
            ├── index.ts             # Fastify bootstrap, health checks, Socket.IO attach
            ├── config/              # env loading, validated at boot
            ├── session/             # session lifecycle, lobby, relay orchestration
            ├── handlers/            # Socket.IO event handlers (own ALL I/O)
            │   └── __tests__/       # integration tests via TestSocketServer
            ├── reducers/            # PURE game logic — zero infra imports
            │   ├── bombReducer.ts   # open/closed; delegates to MODULE_REDUCERS
            │   ├── sessionReducer.ts
            │   ├── timerReducer.ts
            │   ├── MODULE_REDUCERS.ts  # registry: moduleId → reducer
            │   └── __tests__/       # unit tested in Node, zero infra
            ├── state/               # Redis read/write adapters (keyspace owners)
            ├── persistence/         # Postgres writers — session-end only
            ├── voice/               # LiveKit server SDK: token mint, room mgmt
            └── generation/          # bomb assembly from seed + template
```

---

## Epic to Architecture Mapping

| Epic | Architectural Components | Key Patterns |
| ---- | ------------------------ | ------------ |
| 1 — Foundation | Monorepo, `packages/shared`, Fastify+Socket.IO bootstrap, Redis/Postgres adapters, Docker Compose, health checks | Typed event contracts; per-workspace tsconfig |
| 2 — Lobby & Session | `session/` lifecycle, join-code mint, team assignment, Facilitator dashboard handlers | Session state machine in Redis; cryptographic join codes |
| 3 — Voice | `voice/` LiveKit server SDK, token strategy, Bomb Room + Spectator Lounge rooms | Role→room mapping; token regeneration on role change |
| 4 — Bomb Renderer | R3F bomb scene, `modules/registry`, timer extrapolation, strike HUD | `useFrame` + Zustand `getState()`; diegetic vs non-diegetic split |
| 5 — Core Modules (Easy) | Wires, Button, Passwords: `generate`/`solve`/`reducer` + `MODULE_REDUCERS` entries | `IModule` contract; pure reducers; **walking skeleton starts here (Wires)** |
| 6 — Core Modules (Medium) | Keypads, Who's on First, Wire Sequences, Mazes | Additive registry entries; no bomb-reducer change |
| 7 — Core Modules (Hard) | Complicated Wires, Simon Says, Memory, Morse Code | Multi-stage/strike-dependent reducers; full rule tables |
| 8 — Game Loop | `sessionReducer`, relay orchestration, scoring, scoreboard, timer authority, retry/pause | Round state machine; Postgres write at session end |
| 9 — Advanced Features | Asymmetric Expert Roles (chapter allocation), Spectator Lifelines (token economy) | Role-gated manual access; toast (non-blocking) overlays |
| 10 — Polish & Hardening | SFX wiring, 60 fps profiling, WebRTC reliability (symmetric NAT), playtest instrumentation | Frame-budget gate; TURN port verification |

---

## Technology Stack Details

### Core Technologies

Authoritative versions and rules live in `project-context.md`. Summary:

- **Client:** React 19 (React Three Fiber 9 + Three.js, 3D bomb), Zustand (client state — `getState()` in render loop, never `useState` for tick-rate data), LiveKit Client SDK (voice), Tailwind CSS, TypeScript throughout, Vite bundler.
- **Server:** Node.js + Fastify (`@fastify/type-provider-typebox`), Socket.IO (game state sync), LiveKit Server SDK (SFU routing), Redis (in-flight session state), PostgreSQL (session-end archive), TypeScript throughout.
- **Shared:** pnpm-workspace monorepo with `packages/shared` for all event types, game-state types, and module interfaces. **Zero runtime dependency on react/socket.io/any framework.**
- **Infra:** Docker Compose; LiveKit Server container; coturn (TURN fallback, own HMAC-SHA1 credential generation); Caddy (reverse proxy + TLS).

### Integration Points

| Boundary | Mechanism | Authority / Direction |
| -------- | --------- | --------------------- |
| Client ↔ Server (game) | Socket.IO typed events | Server-authoritative; client sends intents, receives state |
| Client ↔ LiveKit (voice) | WebRTC via LiveKit Client SDK | Independent of game socket; voice failure must not block game |
| Server ↔ Redis | `ioredis`, O(1) keyed access | All in-flight state; sole hot-path store |
| Server ↔ Postgres | `pg-pool`, single tx at session end | Archive only; never on tick path |
| Server ↔ LiveKit Server | LiveKit Server SDK | Token mint + room management |
| LiveKit ↔ Redis | LiveKit's own internal usage | **Isolated** — never build app logic on it |
| coturn | TURN relay | NAT traversal fallback for WebRTC |

**Critical isolation rule:** the game socket and the voice layer are independent subsystems. The game must remain fully playable if voice drops (UX Accessibility Floor + GDD A4). Never gate a game-state transition on voice connectivity.

---

## Novel Pattern Designs

These are the patterns the upstream docs name but do not specify. They are the heart of this architecture.

### Pattern 1 — Multi-Session, Single-Process Model

One server process owns many concurrent sessions. There is no per-session process or container.

- **Identity:** every session has a `sessionId` (server-generated UUID) and a human-facing `joinCode` (≥6 chars, `crypto.randomBytes`-derived, unguessable — never sequential).
- **Socket.IO rooms:** each session uses rooms namespaced by id:
  - `session:{sessionId}` — all participants (broadcast scoreboard, session events)
  - `session:{sessionId}:team:{teamId}` — team-scoped bomb state (the other team must not receive a team's bomb state mid-round; sequential relay means only the active team's bomb is live, but team-scoping prevents leakage and supports spectators-of-other-team). **Implementing story: 8.11 (Sequential Round Orchestration)** — this "only the active team's bomb is live" property is load-bearing; do not implement concurrent ("parallel") arming (parallel defuse is deferred per `gdd.md:758`).
  - `session:{sessionId}:role:{role}` — role-gated payloads (e.g. manual chapter assignments to Experts)
- **State residence:** all session/bomb/round state lives in Redis keyed by `sessionId`. The process holds **no authoritative in-memory game state** — only transient socket bookkeeping. This keeps the process restart-tolerant and makes a future Socket.IO Redis-adapter scale-out a non-breaking change.
- **Concurrency:** sessions are fully independent; there is no global lock. Per-session mutations are serialized through that session's handler path (see Pattern 4).

> Scale-out is explicitly *not* built in V1 (internal tool, a few concurrent sessions). The architecture leaves the door open (stateless process + Redis) without paying for it now.

### Pattern 2 — Pure Reducer Game Core

All game logic is expressed as pure functions: `(state, event) => newState`.

```ts
// packages/shared/src/types/reducer.ts
export type Reducer<S, A> = (state: S, action: A) => S;
```

**Hard rules (enforced from day one):**
- Reducers import **nothing** from `socket.io`, `ioredis`, `pg`, `fastify`, or `react`.
- State is never mutated in place — always return new objects (spread/map).
- Unknown actions fall through returning state **unchanged** (no throws).
- No `Date.now()`, no `Math.random()`, no `setTimeout` inside a reducer — time and randomness are inputs passed in via state/action.
- Reducers never emit sockets, never read Redis. I/O belongs to handlers.

**Handler responsibility (the only place I/O lives):**

```
parse & validate input
  → load state from Redis
    → call pure reducer
      → persist new state to Redis
        → broadcast resulting snapshot to the right room(s)
```

This is the canonical flow for every game action. It is what makes the core unit-testable in Node with zero infrastructure.

### Pattern 3 — `IModule` Plugin Contract (Open/Closed)

The bomb reducer **never changes** when a module is added. New modules register into `MODULE_REDUCERS`; the bomb reducer delegates by `moduleId`. This is the single most important extensibility property in the codebase (V2 needy modules + custom modules must be purely additive — GDD Architecture Constraints).

```ts
// packages/shared/src/types/module.ts
export interface IModule<S = unknown, A = unknown> {
  readonly id: string;                       // kebab-case, e.g. "wires"

  /** Pure, seeded. The ONLY place randomness is allowed in a module. */
  generate(seed: number, ctx: BombContext): S;

  /** Pure reducer for this module's actions. */
  reduce: Reducer<ModuleState<S>, A>;

  /** Pure: structured manual content (NOT raw HTML / untyped JSX). */
  getManualPages(): ManualPage[];

  /** Optional: needy-module lifecycle hook (V2). Default no-op. */
  onTick?(state: ModuleState<S>, now: number): ModuleState<S>;
}
```

```ts
// apps/server/src/reducers/bombReducer.ts (open/closed — never edited per-module)
export const bombReducer: Reducer<BombState, BombAction> = (state, action) => {
  if (action.type === 'MODULE_ACTION') {
    const mod = state.modules[action.moduleIndex];
    if (!mod) return state;                       // guard: unknown index → no-op
    const reduce = MODULE_REDUCERS[mod.moduleId]; // registry lookup
    if (!reduce) return state;                     // guard: unknown module → no-op
    const next = reduce(mod, action.payload);
    return applyModuleResult(state, action.moduleIndex, next); // handles strike/solve roll-up
  }
  // ... bomb-level actions (timer, pause) handled here
  return state;
};
```

**Module state envelope** (shared across all modules so the bomb reducer can roll up strikes/solves uniformly):

```ts
export interface ModuleState<S> {
  moduleId: string;
  status: 'armed' | 'solved' | 'struck';   // 'struck' is transient; rolls into a team strike
  data: S;                                  // module-specific state
}
```

**Per-module file contract** (`apps/client/src/modules/<id>/` + shared types):
`generate.ts` (pure, seeded) · `solve.ts` (pure validation) · `reducer.ts` (pure) · `DefuserView.tsx` (R3F, rendering only) · `ManualPages.tsx` (structured data) · `types.ts` (re-exported from `packages/shared`) · `__tests__/`.

### Pattern 4 — Deterministic Seeded Generation

Fairness (both teams get identical layouts, independent values) and retry-reproducibility both depend on a deterministic seed chain. No `Math.random()` ever participates in generation.

```
templateSeed = hash(sessionId + roundNumber)          // both teams share this → identical layout
teamSeed     = hash(templateSeed + teamId)            // per-team divergence → independent values
moduleSeed   = hash(teamSeed + moduleIndex)           // per-module value seed
```

- `generate(seed, ctx)` is **synchronous and CPU-cheap** — all modules generated at round start in one pass.
- Bomb metadata (serial number, batteries, indicators, ports) is generated from `teamSeed` before modules, then frozen into a read-only `BombContext` passed to every module's `generate` and `reduce`.
- **Retry** (GDD): reuse the *same* `templateSeed` and `teamSeed` → identical bomb, identical values. "Better of two times" is a scoring decision, not a generation one.
- `hash` is a fixed, well-defined function (e.g. xmur3/mulberry32 or a SHA-derived integer) living in `packages/shared/src/seeding/` — identical on client and server.

### Pattern 5 — Timer Authority via Timestamp + Extrapolation

The server is the sole authority on the clock; the client renders smoothly without per-tick traffic.

**Server broadcasts a timer descriptor only when it changes** (round start, strike, pause, resume):

```ts
interface TimerState {
  startedAt: number;        // server epoch ms when this segment began
  remainingAtStart: number; // ms remaining when this segment began
  speedMultiplier: number;  // 1.0, 1.25, 1.56 ... (strike escalation, compounding)
  pausedAt: number | null;  // if set, clock is frozen at this point
}
```

- **Client render (60 fps):** inside `useFrame`, compute displayed remaining time from `TimerState` + the server-time offset (estimated once at connect, refreshed on each timer broadcast). No `setInterval`.
- **Strike escalation** changes `speedMultiplier` and rebases `startedAt`/`remainingAtStart` so the new rate applies from that moment (compounding per GDD: ×1.00 → ×1.25 → ×1.56).
- **Expiry authority:** the server schedules its own authoritative expiry check; the client's extrapolated `0:00` is display-only. A bomb explodes when the **server** says so, never when a client's local clock hits zero.
- **Pause** (Facilitator manual, or automatic on disconnect): set `pausedAt`; resume rebases the segment. Voice stays live during pause (UX).

### Pattern 6 — Per-Module Snapshot State Sync + Optimistic Render

On a validated state change the server broadcasts the affected module's **new full state**, plus any bomb-level delta (strike count, timer rebased, bomb solved):

```ts
// ServerToClient
interface ModuleUpdate {
  moduleIndex: number;
  state: ModuleState<unknown>;     // full new state for this module
  bombDelta?: { strikes?: number; timer?: TimerState; solved?: boolean };
}
```

- Payloads are tiny (one module), so per-module broadcast is both simple and cheap at ≤16 clients.
- **Optimistic render (UX Game Feel, ≤100 ms):** on a Defuser click the client may *pre-flash* the affordance (e.g. wire visually severing) but **never** pre-commits to `solved` — only the server's `ModuleUpdate` flips the solve LED. On server rejection the client rolls the pre-flash back. The authoritative truth is always the server snapshot.
- Broadcasts target `session:{id}:team:{teamId}` so the resting team / spectators-of-other-team don't receive the active bomb's stream unless they're spectating it.

### Pattern 7 — LiveKit Voice Topology

Two logical voice rooms per session, mapped from game roles:

| LiveKit room | Members | Audio rights |
| ------------ | ------- | ------------ |
| `bomb-room:{sessionId}:{teamId}` | Defuser, Experts, Facilitator | Full bidirectional |
| `spectator-lounge:{sessionId}` | Spectators | **Listen-only** — receive Bomb Room track, cannot publish |

- **Token strategy:** the server mints a LiveKit access token per participant scoped to exactly one room with exactly the grants their role allows. Spectator tokens have `canPublish: false`.
- **Role change (defuser ↔ spectator on relay rotation):** mint a **new** token with the new room + grants. **Never reuse a token across a role change** (project-context security rule) — stale grants would let a spectator publish into the Bomb Room.
- **Spectator Lounge one-way bridge:** the Bomb Room audio is forwarded to the lounge as a listen-only track. Spectators must never be able to inject audio into the Bomb Room — verify this explicitly; it is a confidentiality boundary, not a feature toggle.
- **Facilitator PTT bridge** (if used to address the room): test explicitly — project-context flags it as the most likely voice-topology failure point.
- **Independence:** voice connection state is tracked in a separate Zustand store and surfaced with separate microcopy ("Voice unavailable — game continues without it"). Voice never blocks game UI.

---

## Implementation Patterns

These patterns ensure all AI agents implement consistently. They restate and operationalize `project-context.md`; that file remains authoritative on conflict.

1. **Server-authoritative, always.** Client sends intents; server validates, reduces, persists, broadcasts. The client never simulates authoritative state.
2. **Handler = I/O; reducer = logic.** Never leak Redis/socket/pg into a reducer. Never put game logic in a handler beyond the parse→load→reduce→persist→emit flow.
3. **R3F components are dumb renderers.** Zero game logic inside `DefuserView.tsx`. If a component "needs a logic test," the logic has leaked — move it to a reducer.
4. **Tick-rate state via Zustand `getState()` inside `useFrame`** — never reactive `useStore()` for per-frame reads; never `useEffect`+`setInterval` for the timer.
5. **Modules are plugins.** Add a module by adding a directory + a `MODULE_REDUCERS` entry. Never edit `bombReducer.ts` to support a new module.
6. **Randomness only in `generate(seed, ctx)`.** Everywhere else is deterministic. `solve.ts` and `reduce` are pure.
7. **Typed events both sides.** All Socket.IO events defined in `packages/shared/src/events/` and imported via `ServerToClientEvents` / `ClientToServerEvents`. No untyped `socket.emit(string, any)`.
8. **`BombContext` is read-only.** Never mutate it inside a module.
9. **Optimistic UI never pre-commits success.** Pre-flash affordances may roll back; only the server declares `solved`.

---

## Consistency Rules

### Naming Conventions

(From `project-context.md` — authoritative.)

- Module IDs: `kebab-case` (`"wires"`, `"simon-says"`, `"morse-code"`).
- Module state types: `PascalCaseState` (`WiresState`). Action types: `PascalCaseAction` (`ButtonAction`).
- Socket event names: `SCREAMING_SNAKE_CASE` (`"MODULE_INTERACT"`, `"BOMB_DEFUSED"`).
- React components: `PascalCase`; hooks: `camelCase` with `use` prefix.
- Reducer files: `camelCaseReducer.ts` (`wiresReducer.ts`).
- Redis keys: `session:{id}:...` colon-delimited namespaces (see Data Architecture).

### Code Organization

- `packages/shared` is pure TypeScript — zero runtime deps on react/socket.io/server/client frameworks.
- All module types live in `packages/shared/src/modules/` and are re-exported from `apps/client` — never duplicated.
- Custom modules go under `apps/client/src/modules/custom/` — never modify core module files.
- A module sandbox at `/dev/sandbox` allows isolated module development.

### Error Handling

- **Reducers never throw on bad input** — guard clauses return state unchanged. Invalid `moduleIndex`, out-of-bounds `wireIndex`, unknown action → no-op. This is both a correctness rule and a security rule (client input is untrusted).
- **Handlers validate at the boundary** — every inbound payload is schema-checked (TypeBox) and bounds-checked before reaching a reducer. Reject malformed payloads with a typed error event; do not crash the session.
- **Server I/O failures** (Redis/Postgres) are caught at the handler; a failed Redis write must not leave a half-applied broadcast — persist *then* emit, and on persist failure emit nothing and surface a recoverable error.
- **Connection loss** triggers the pause path (mid-round) or a blocking retry modal (UX error states). **Voice loss** is a dismissible banner, never blocking.
- **Never fire-and-forget** async I/O inside a handler — await cleanly.

### Logging Strategy

- Structured logs (JSON) keyed by `sessionId` and, where relevant, `teamId` and `roundNumber` — so a session can be reconstructed from logs during playtesting.
- Log every state-transition at the handler boundary (action received, reduced, persisted, broadcast) at debug; log strikes/solves/round-results at info.
- **Never log** join codes, LiveKit tokens, or any secret. Never log full bomb solutions at info level (would leak answers in shared playtest logs).
- Voice subsystem logs separately (connection lifecycle, NAT/TURN path) — this is where the highest-probability failures live (GDD A4).

---

## Data Architecture

### State Residence Model

| Store | Holds | Lifetime | Hot path? |
| ----- | ----- | -------- | --------- |
| Redis | All in-flight session/bomb/round/timer state | Session duration | **Yes** — O(1) keyed access only |
| Postgres | Completed session archive, scoreboards | Permanent | **No** — single tx at session end |
| Client (Zustand) | Last-received snapshot for rendering | Connection | Render only; non-authoritative |

### Redis Keyspace

```
session:{sessionId}                  → SessionState (status, joinCode, config, roster, relay order, cumulative scores)
session:{sessionId}:round:{n}        → RoundState (status, active defuser per team, retry flag)
session:{sessionId}:team:{teamId}:bomb   → BombState (modules[], strikes, BombContext, solved)
session:{sessionId}:team:{teamId}:timer  → TimerState
session:{sessionId}:roles            → role/chapter assignments (Asymmetric Expert Roles)
session:{sessionId}:lifelines        → per-spectator token counts
```

- All bomb-action reads/writes are O(1) on a single team's bomb key — no full-session scans on the hot path.
- `BombContext` is stored once per team-round and treated read-only thereafter.

### Core Type Model (in `packages/shared`)

```ts
interface SessionState {
  sessionId: string;
  joinCode: string;
  status: 'lobby' | 'preparation' | 'active' | 'between-rounds' | 'ended';
  config: RoundConfig;                 // difficulty, moduleCount, timer, modifiers
  teams: Record<TeamId, TeamState>;    // roster, relay order, cumulative time
  roundNumber: number;
  modifiers: { asymmetricExpertRoles: boolean; spectatorLifelines: boolean };
}

interface BombState {
  context: BombContext;                // serial, batteries, indicators, ports — read-only
  modules: ModuleState<unknown>[];
  strikes: number;                     // 0..3; 3 → explosion
  solved: boolean;
}

interface BombContext {
  serialNumber: string;                // last char ALWAYS a digit
  batteryCount: number;
  indicators: { label: IndicatorLabel; lit: boolean }[];
  ports: PortType[];
}
```

### Persistence (Postgres) — session end only

A completed session is written as a **single transaction** at session end: session metadata, per-round per-team times, final scoreboard. No writes during play. No mid-round queries. Connection pooling via `pg-pool`. (No persistent leaderboards or user identity in V1 — archive only.)

---

## API Contracts

All contracts are typed in `packages/shared/src/events/` and shared verbatim between client and server.

### Socket.IO Event Surface (representative)

**Client → Server (`ClientToServerEvents`):**

| Event | Payload | Authority check |
| ----- | ------- | --------------- |
| `SESSION_CREATE` | `RoundConfig` (Facilitator) | Facilitator only |
| `SESSION_JOIN` | `{ joinCode, displayName, role }` | Valid code; capacity |
| `TEAM_ASSIGN` | `{ playerId, teamId, role }` | Facilitator only |
| `ROUND_CONFIGURE` | `RoundConfig` | Facilitator only |
| `ROUND_START` | `{}` | Facilitator only |
| `MODULE_INTERACT` | `{ teamId, moduleIndex, action }` | Active defuser of that team; bounds-checked |
| `FACILITATOR_PAUSE` / `RESUME` | `{}` | Facilitator only |
| `ROUND_RETRY` | `{ teamId }` | Facilitator only |
| `LIFELINE_SEND` | `{ promptId }` (Spectator) | Has token; lifelines enabled |

**Server → Client (`ServerToClientEvents`):**

| Event | Payload |
| ----- | ------- |
| `SESSION_STATE` | `SessionState` (lobby/roster/config changes) |
| `BOMB_INIT` | full `BombState` + `BombContext` at round start |
| `MODULE_UPDATE` | `ModuleUpdate` (per-module snapshot + bombDelta) |
| `TIMER_UPDATE` | `TimerState` (on change only) |
| `STRIKE` | `{ teamId, strikes, timer }` |
| `BOMB_DEFUSED` / `BOMB_EXPLODED` | `{ teamId, elapsedMs }` |
| `SCOREBOARD` | round/session scoreboard payload |
| `LIFELINE_TOAST` | `{ promptId, fromName }` (8 s, non-blocking) |
| `PAUSED` / `RESUMED` | `{ reason }` |
| `ERROR` | `{ code, message, recoverable }` |

### Server-Side Validation Boundaries (security)

Client input is **untrusted**. Every action handler validates:
- **Identity & role:** is this socket the active defuser for the team it claims? Is this a Facilitator-only action from a Facilitator?
- **Phase:** is a `MODULE_INTERACT` arriving during an `active` round (not lobby/paused/between-rounds)?
- **Bounds:** `moduleIndex` in range; `wireIndex` / `buttonAction` / payload values within the module's legal space.
- **Resource:** does the spectator actually hold a lifeline token?

Anything failing → typed `ERROR` event, no state change. Never trust a payload value to index or mutate without bounds-checking.

---

## Security Architecture

- **Server-authoritative validation** of all game actions (above). No client-trusted state.
- **Unguessable join codes:** ≥6 chars, `crypto.randomBytes`-derived. Never sequential IDs for private sessions.
- **LiveKit tokens:** room-scoped, role-scoped, regenerated on role change; never reused across roles. Spectator tokens `canPublish: false`.
- **coturn credentials:** time-limited HMAC-SHA1, TTL ≤ 86400 s, generated server-side.
- **HTTPS everywhere** non-localhost (WebRTC requirement) — TLS terminated at Caddy.
- **Secrets via `.env`** only — LiveKit API keys, Redis URL, DB creds never hardcoded, never committed.
- **Spectator confidentiality boundary:** listen-only enforced at the LiveKit token grant level, not just UI.
- **No answer leakage:** bomb solutions never sent to the client (solve validation is server-side); never logged at shareable levels.

---

## Performance Considerations

Performance is a **development gate at every stage**, not a polish task (GDD constraint; 60 fps from day one).

- **60 fps on the bomb view** is a budget; any frame violation is a bug. Validate on a mid-range laptop in a conference room over a 10-minute session (GDD A5).
- **Never trigger React re-renders from the game loop.** Per-frame Three.js updates go through `useFrame` + Zustand `getState()` only.
- **Reuse refs in `useFrame`** — no new arrays/objects allocated per frame.
- **Dispose Three.js `Mesh`/`Geometry`/`Material` on unmount** — R3F does not GC them automatically.
- **Memoize module components** (`React.memo` + stable Zustand selectors) — they re-render on every state broadcast otherwise.
- **Sync latency ≤ 100 ms** across clients — small per-module payloads + the timestamp timer model keep traffic minimal; optimistic pre-flash hides round-trip on the Defuser's own clicks.
- **Redis O(1)** per game action; no full-session scans on the hot path.
- **`generate()` synchronous and CPU-cheap** — all modules generated in one round-start pass.
- **No Postgres on the tick path** — single tx at session end.

---

## Deployment Architecture

Self-hosted Docker Compose (settled). A team lead runs one stack.

**Services:** `client` (static build served via proxy or Vite preview), `server` (Fastify + Socket.IO), `redis`, `postgres`, `livekit`, `coturn`, `caddy` (reverse proxy + TLS).

- **All services have health checks**; the game server waits on Redis + Postgres health before accepting connections.
- **`scripts/smoke-test.sh`** validates every service is reachable before a session runs.
- **Ports:** 443 (HTTPS), 7880 (LiveKit HTTP/WS), 7881 (LiveKit TCP), 3478 (TURN), **7882/udp (LiveKit RTP/ICE — single UDP mux port)**, **40000–40031/udp (coturn TURN relay)**. The LiveKit mux port and coturn relay range MUST stay disjoint — they cannot share a host UDP port without colliding, and coturn's relay range must be published to the host or TURN relaying silently fails. LiveKit is an SFU and muxes all participants over one UDP port (`rtc.udp_port`), so one port serves a full session regardless of player count; coturn allocates ~1 relay port per relayed peer, so 32 ports cover a 16-player session with headroom. Keeping the published-port footprint small (~33 forwards total) also stays under Docker Desktop's WSL2 forwarded-port cap and clear of the Windows-reserved 50000–50059 band. Document in the deployment README.
- **Minimum host:** 2 vCPU, 4 GB RAM, 100 Mbps symmetric, 10 GB storage.
- **WebRTC reliability gate (GDD A4 / highest technical risk):** test behind a simulated symmetric-NAT corporate firewall before the first internal event; verify TURN relay path and document port requirements.
- **Multi-session note:** one `server` process handles all concurrent sessions; sessions are keyed in Redis, so a process restart does not lose session state. No orchestrator, no per-session containers.

---

## Development Environment

### Prerequisites

- Node.js 20 LTS, pnpm, Docker + Docker Compose.
- A local `.env` from `.env.example` (LiveKit dev keys, Redis/Postgres URLs).

### AI Tooling (MCP Servers)

None required by the architecture. (Optional, developer-discretionary: a Playwright MCP could assist with the e2e/visual-regression suite. Not a dependency.)

### Setup Commands

```bash
pnpm install                      # install workspace
cp .env.example .env              # fill in dev secrets (never commit)
docker compose up -d redis postgres livekit coturn caddy
pnpm --filter @bomb-squad/shared build
pnpm --filter @bomb-squad/server dev   # Fastify + Socket.IO
pnpm --filter @bomb-squad/client dev   # Vite dev server
bash scripts/smoke-test.sh        # verify all services reachable
pnpm -r test                      # run all workspace unit/integration tests
pnpm -r exec tsc --noEmit         # zero TS errors required before commit
```

---

## Testing Architecture

Test boundaries are enforced from day one (`project-context.md`).

| Layer | What | Tooling | Location |
| ----- | ---- | ------- | -------- |
| Pure logic | reducers, `generate.ts`, `solve.ts` | Jest, Node, zero infra | `apps/server/src/reducers/__tests__/`, `packages/shared/src/__tests__/` |
| Socket handlers | parse→reduce→persist→emit flow | `TestSocketServer` wrapper | `apps/server/src/handlers/__tests__/` |
| R3F components | visual regression only | Playwright | `apps/client/e2e/` |
| Voice | LiveKit integration | real LiveKit container in CI | CI |

**Every module reducer must test:** happy path (solves), wrong interaction (strike, not solved), idempotency (repeat action = no-op), immutability (frozen-state input must not throw), guard clauses (invalid input → unchanged), reset (`MODULE_RESET` → initial). **Never** use `setTimeout`/`Date.now()` in a reducer test (pass time as input); **never** mock the pure reducer in a handler test (call it directly); **never** skip the immutability test.

---

## Architecture Decision Records (ADRs)

### ADR-001 — Multi-session, single process
**Decision:** One server process serves many sessions, keyed in Redis. **Status:** Accepted.
**Context:** Internal self-hosted tool; "spin up in 3 min"; a few concurrent sessions of 2–16 players. **Alternatives:** per-session containers (needs an orchestrator — too heavy). **Consequences:** trivial deployment; restart-tolerant (state in Redis); scale-out deferred but unblocked (stateless process + Socket.IO Redis adapter later).

### ADR-002 — Pure-reducer game core with handler-owned I/O
**Decision:** All game logic is pure `(state, event) => state`; handlers own all I/O. **Status:** Accepted.
**Context:** Need deterministic, unit-testable, server-authoritative logic. **Consequences:** zero-infra unit tests; clean optimistic-render rollback; strict discipline required (no I/O imports in reducers).

### ADR-003 — `IModule` plugin registry (open/closed)
**Decision:** Bomb reducer delegates by `moduleId` to `MODULE_REDUCERS`; adding a module is additive. **Status:** Accepted.
**Context:** 11 V1 modules + V2 needy/custom modules must not force core rewrites (GDD constraint). **Consequences:** modules ship one-by-one; core stable; walking skeleton can ship Wires alone.

### ADR-004 — Deterministic seeded generation chain
**Decision:** `template→team→module` seed chain; no `Math.random()` in generation. **Status:** Accepted.
**Context:** Per-team fairness (identical layout, independent values) + retry reproducibility. **Consequences:** retry replays the exact bomb; fairness is structural; all generation reproducible from `(sessionId, roundNumber, teamId)`.

### ADR-005 — Timer = authoritative timestamp + client extrapolation
**Decision:** Server broadcasts a `TimerState` descriptor on change; client extrapolates per frame; server owns expiry. **Status:** Accepted.
**Context:** 60 fps smooth display + server authority + no per-tick spam + compounding strike escalation. **Alternatives:** server tick broadcast (network chatter, coarse granularity). **Consequences:** smooth display; clock authority never leaves the server; pause/resume = rebasing a segment.

### ADR-006 — Per-module snapshot state sync
**Decision:** Broadcast the affected module's full new state + bomb-level deltas on each change. **Status:** Accepted.
**Context:** ≤16 clients; want simplest correct model; optimistic UI. **Alternatives:** full-bomb broadcast (larger payloads at 11 modules); event-sourced deltas (needs identical client reducer + desync handling — over-built for scope). **Consequences:** tiny payloads; trivial correctness; optimistic pre-flash rolls back against the next authoritative snapshot.

### ADR-007 — Voice as an independent, non-blocking subsystem
**Decision:** LiveKit voice runs independently of the game socket; the game stays playable if voice drops. **Status:** Accepted.
**Context:** WebRTC behind corporate NAT is the highest technical risk (GDD A4); voice must degrade gracefully. **Consequences:** separate connection state + microcopy; listen-only spectator enforced at token grant; role-change always re-mints tokens.

---

_Generated by GDS Game Architecture Workflow v1.0_
_Date: 2026-06-10_
_For: Jay_
