---
project_name: 'Bomb Squad'
user_name: 'Jay'
date: '2026-06-09'
sections_completed: ['technology_stack', 'web_stack_architecture', 'performance', 'code_organization', 'testing', 'platform_build', 'critical_rules']
status: 'complete'
rule_count: 47
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing game code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

**Frontend:**
- React 18+
- Three.js + React Three Fiber (3D bomb rendering)
- Zustand (client state management — use `getState()` on render loop, not `useState`)
- LiveKit Client SDK (WebRTC voice)
- Tailwind CSS
- TypeScript throughout

**Backend:**
- Node.js + Fastify with `@fastify/type-provider-typebox`
- Socket.IO (real-time game state sync)
- LiveKit Server SDK (SFU voice routing)
- Redis (game session state + LiveKit internal use — keep concerns separated)
- PostgreSQL (session history, leaderboards — archive only, never on game tick path)
- TypeScript throughout

**Shared:**
- Monorepo (pnpm workspaces) with `packages/shared` for all event types,
  game state types, and module interfaces shared between frontend and backend

**Infrastructure:**
- Docker Compose (local dev + deployment)
- LiveKit Server container
- coturn (TURN server — NAT traversal fallback, write own HMAC-SHA1 credential generation)
- Caddy or Nginx (reverse proxy + TLS)

**Language:** TypeScript throughout — no JavaScript files

## Critical Implementation Rules

### Web Stack & Architecture Rules

**React Three Fiber:**
- All puzzle module geometry and layout must be data-driven from `generate(seed, bombCtx)` output — never hardcode positions or visual state in JSX
- Game state that updates at tick rate must live in Zustand and be accessed via `useStore.getState()` inside `useFrame`, not via reactive `useStore()` hook
- Use `useFrame` for per-tick animation/timer updates, never `useEffect` + `setInterval`
- R3F components are rendering-only — zero game logic inside them; treat as dumb renderers

**Server-Authoritative State (Pure Reducer Pattern):**
- All game logic lives in pure reducer functions: `(state, event) => newState`
- Reducers must have zero imports from `socket.io`, `ioredis`, `pg`, or `fastify`
- Socket handlers own all I/O: parse input → load state → call reducer → persist → emit
- State is never mutated in-place — always return new objects via spread/map
- Unknown actions must fall through returning state unchanged (no throws)

**Module System:**
- `generate(seed, bombCtx)` is the only place randomness is allowed in a module
- `render(state)` and `handleInteraction(action)` must be pure/deterministic
- Module reducers are registered in `MODULE_REDUCERS` — bomb reducer never changes when new modules are added (open/closed principle)
- `getManualPages()` returns structured data, not raw HTML or untyped JSX

**Socket.IO / Shared Types:**
- All Socket.IO event types must be defined in `packages/shared/src/events/` and imported on both client and server — never duplicated
- Server and client must use the typed `ServerToClientEvents` / `ClientToServerEvents` interface pattern — untyped `socket.emit(string, any)` is forbidden

**State Boundaries:**
- Redis holds all in-flight game session state
- PostgreSQL receives writes only at session end or defined checkpoints — never at tick rate
- LiveKit's Redis usage is isolated — do not build application logic on top of it

### Performance Rules

**Rendering:**
- Target 60fps on the bomb view — treat any frame budget violation as a bug
- Never trigger React re-renders from the game loop; use R3F's `useFrame` exclusively for per-frame updates to Three.js objects
- Module visual state updates must go through Zustand → R3F subscription, not prop drilling through React component tree
- Avoid creating new objects (arrays, plain objects) inside `useFrame` — reuse refs

**Server / Real-time:**
- Socket.IO event handlers must be synchronous where possible; async I/O must be awaited cleanly — never fire-and-forget inside a handler
- Bomb timer ticks are server-authoritative — clients display the server timestamp, never run their own authoritative countdown
- Redis reads/writes per game action must be O(1) — no full-session scans on hot path

**Bomb Generation:**
- Seed derivation is deterministic. Fields are joined with a `:` delimiter so adjacent
  operands cannot collide (without it `(12, 34)` and `(1, 234)` both hash `"1234"`):
  `templateSeed = hash(sessionId + ":" + roundNumber)`
  `teamSeed     = hash(templateSeed + ":" + teamId)`
  `moduleSeed   = hash(teamSeed + ":" + moduleIndex)`
- `generate(seed, bombCtx)` must be synchronous and CPU-cheap — called at round start for all modules simultaneously
- Never call `Math.random()` in generation — use the seeded value exclusively

**PostgreSQL:**
- No queries on the game action hot path
- Session history written as a single transaction at session end
- Use connection pooling (`pg-pool`) — never open a new connection per request

### Code Organization Rules

**Monorepo Structure:**
```
packages/
  shared/          # Shared types, interfaces, event definitions
    src/
      types/       # BombState, ModuleState, BombContext, IModule, etc.
      events/      # ServerToClientEvents, ClientToServerEvents
      modules/     # Per-module state types and action types
      utils/       # Seeding functions, shared pure helpers
apps/
  client/          # React frontend
  server/          # Fastify + Socket.IO backend
```

**Module File Structure (per module, under `apps/client/src/modules/`):**
```
your-module-name/
  index.ts           # IModule implementation
  DefuserView.tsx    # R3F/React defuser-facing component (rendering only)
  ManualPages.tsx    # Expert manual pages (structured data → React)
  types.ts           # State and action types (re-exported from packages/shared)
  generate.ts        # Randomized instance generator (pure, seeded)
  solve.ts           # Solution validation logic (pure)
  reducer.ts         # Pure reducer: (state, action) => state
  __tests__/         # Unit tests for generate.ts, solve.ts, reducer.ts
```

**Naming Conventions:**
- Module IDs: `kebab-case` strings (e.g., `"wires"`, `"simon-says"`, `"morse-code"`)
- Module state types: `PascalCaseState` (e.g., `WiresState`, `SimonSaysState`)
- Module action types: `PascalCaseAction` (e.g., `WiresAction`, `ButtonAction`)
- Socket event names: `SCREAMING_SNAKE_CASE` (e.g., `"MODULE_INTERACT"`, `"BOMB_DEFUSED"`)
- React components: `PascalCase`; hooks: `camelCase` prefixed with `use`
- Reducer files: `camelCaseReducer.ts` (e.g., `wiresReducer.ts`)

**Key Rules:**
- `packages/shared` must have zero runtime dependencies on `react`, `socket.io`, or any server/client framework — it is pure TypeScript
- All module types defined in `packages/shared/src/modules/` and re-exported from `apps/client` — never duplicated
- Custom modules go under `apps/client/src/modules/custom/` — never modify core module files to add a new module
- Module sandbox available at `/dev/sandbox` for isolated development

### Testing Rules

**Boundaries (enforce from day one):**
- Pure game logic (reducers, `generate.ts`, `solve.ts`) — unit tested in Node with Jest, zero infrastructure required
- Socket handlers — integration tested with a `TestSocketServer` wrapper; budget this before writing game logic, not after
- R3F components — rendering-only, covered by visual regression only (Playwright); if a component requires a logic test, the logic has leaked — move it to a reducer
- LiveKit voice logic — integration tested against a real LiveKit container in CI; accept the Docker cold-start cost rather than mocking the SDK surface

**Pure Reducer Tests (what every module must have):**
- Happy path: correct interaction solves the module
- Wrong interaction: strike added, module not solved
- Idempotency: repeating the same action is a no-op
- Immutability: reducer called on a frozen state object must not throw
- Guard clauses: out-of-bounds / invalid input returns state unchanged
- Reset: `MODULE_RESET` action restores initial state

**Test File Locations:**
- Reducer tests: `apps/server/src/reducers/__tests__/`
- Shared type/util tests: `packages/shared/src/__tests__/`
- Socket handler integration tests: `apps/server/src/handlers/__tests__/`
- E2E / visual: `apps/client/e2e/`

**Forbidden Patterns:**
- Never use `setTimeout` or `Date.now()` in reducer tests — pass time as state input
- Never mock the pure reducer itself in a socket handler test — call it directly
- Never skip the immutability test — mutation bugs are silent in TypeScript

### Platform & Build Rules

**Target Platform:**
- Primary: modern desktop browsers (Chrome 90+, Firefox 88+, Edge 90+)
- Safari: supported but treat as a second-class citizen — test WebRTC and WebGL separately; Safari's WebRTC implementation has known quirks
- Mobile: responsive layout acceptable, but no dedicated mobile optimization in v1
- No Electron, no native app — browser-only

**WebRTC / Voice Requirements:**
- HTTPS required for WebRTC in all non-localhost environments — enforce in Docker Compose via Caddy/Nginx TLS termination
- coturn TURN credentials must be time-limited (HMAC-SHA1, TTL ≤ 86400s)
- LiveKit requires ports 7880 (HTTP/WS), 7881 (TCP), and a single UDP RTP/ICE mux port 7882 (`rtc.udp_port` — an SFU muxes all participants over one port) — document in Docker Compose and deployment README
- Test voice behind a simulated corporate firewall (symmetric NAT) before any team building demo — this is where it will break first

**Build Configuration:**
- Vite for client bundling (fast HMR, native ESM, good R3F support)
- `tsc --noEmit` must pass with zero errors before any commit — no `// @ts-ignore`
- Separate `tsconfig.json` per workspace package — do not share a single root tsconfig
- Environment variables: never hardcode LiveKit API keys, Redis URLs, or DB credentials — always via `.env` files, never committed

**Docker Compose:**
- Services: `client` (Vite dev server or static), `server` (Fastify), `redis`, `postgres`, `livekit`, `coturn`
- All services must have health checks — game server waits on Redis and Postgres health before accepting connections
- Write a smoke-test script (`scripts/smoke-test.sh`) that validates all services are reachable before running the app

**Deployment:**
- Minimum server: 2 vCPUs, 4 GB RAM, 100 Mbps symmetric, 10 GB storage
- Ports required: 443 (HTTPS), 7880/7881 (LiveKit), 7882/udp (LiveKit RTP/ICE mux), 3478 (TURN), 40000-40031/udp (coturn TURN relay)

### Critical Don't-Miss Rules

**Game Logic Anti-Patterns:**
- NEVER call `Math.random()` outside of `generate(seed, bombCtx)` — all randomness must derive from the deterministic seed chain; silent correctness bugs otherwise
- NEVER run the bomb timer on the client — server owns the clock; client renders it
- NEVER write to PostgreSQL inside a Socket.IO event handler — queue it for session end
- NEVER mutate `BombContext` inside a module — it is read-only shared metadata
- NEVER emit a socket event from inside a reducer — reducers have no socket reference

**Module System Gotchas:**
- `BombContext.serialNumber` last character is always a digit — rules that check "last digit of serial" must use `serialNumber[serialNumber.length - 1]`, not `parseInt` on the whole string
- Simon Says color mappings change at 1 strike AND 2 strikes — agents commonly implement only the 0-strike table; all three tables are required
- Memory module resets to stage 1 on incorrect press — agents commonly implement it as a single stage; it is a 5-stage sequential state machine
- Wire rule tables are per wire-count (3/4/5/6 wires each have distinct rules) — never apply the same decision tree across counts
- Morse Code lookup is word → frequency, not character-by-character decode → frequency; agents must decode the full word first

**Voice / LiveKit Gotchas:**
- The Spectator Lounge receives Bomb Room audio as a one-way listen-only track — spectators must never be able to send audio into the Bomb Room channel
- Participant tokens must be regenerated on role change (defuser ↔ spectator) — do not reuse the same token with different room permissions
- Test the facilitator PTT bridge explicitly — it is the most likely failure point in the voice topology

**React / R3F Gotchas:**
- `useFrame` callback runs every frame — never do async work or state reads from React context inside it; use Zustand `getState()` only
- Three.js `Mesh`, `Geometry`, and `Material` objects must be disposed on unmount — R3F does not garbage-collect Three.js objects automatically
- Module components re-render on every state broadcast — memoize with `React.memo` and stable selector functions in Zustand to prevent cascade re-renders

**Security:**
- All game actions validated server-side — client input is untrusted; never trust `wireIndex`, `buttonAction`, or any payload value without bounds-checking
- Lobby join codes must be unguessable (min 6 chars, cryptographic random) — sequential IDs are not acceptable for private sessions

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any game code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge during implementation

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack decisions change
- Review after each major feature milestone for outdated rules
- Remove rules that become obvious conventions over time

_Last Updated: 2026-06-09_
