---
baseline_commit: a29daef
---

# Story 1.7: Client Bootstrap — React/Vite/Zustand + Typed Socket Client

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want the client app to load and establish a typed Socket.IO connection with Zustand state,
so that I can connect to a session and receive server state.

## Acceptance Criteria

1. **Stores + typed client wire up on mount.** Given the client app, when it mounts, then it initializes Zustand stores (`game`, `voice`, `ui`) and a typed Socket.IO client wrapper using the shared `ServerToClientEvents` / `ClientToServerEvents` interfaces.

2. **Render-loop reads use `getState()`, not reactive hooks.** Given tick-rate state, when rendering on the game loop, then the pattern accesses Zustand via `getState()` (never reactive `useStore()` for per-frame reads, never `useEffect` + `setInterval`). _Note: there is no R3F render loop yet in this story (it lands in Epic 4). This AC is satisfied by establishing the **store API and access pattern** — a non-reactive `getState()`-based accessor — and documenting/guarding it so later frame-loop code consumes state correctly. Do **not** add `useFrame` or Three.js here._

3. **Server state events update the matching store (render-only, non-authoritative).** Given the server emits a state event, when the client receives it, then the corresponding Zustand store updates and the UI reflects the last-received snapshot. The client is render-only and **non-authoritative** — it stores whatever the server last sent and never derives game truth locally.

## Tasks / Subtasks

- [x] **Task 1 — Add client runtime deps (AC: 1)**
  - [x] In `apps/client/package.json`, add `zustand` (^5) and `socket.io-client` (^4.8) to `dependencies`. Keep `@bomb-squad/shared` as `workspace:*`. Do **not** add `three`, `@react-three/fiber`, `@react-three/drei`, `livekit-client`, or `tailwindcss` — those belong to later epics; adding them now is scope creep.
  - [x] Run `pnpm install` from the repo root so the workspace lockfile updates.
  - [x] Confirm `socket.io-client` major version matches the server's `socket.io` major (both v4) — protocol compatibility is a v4↔v4 guarantee; a mismatch silently fails the handshake.

- [x] **Task 2 — Typed Socket.IO client wrapper in `src/net/` (AC: 1, 3)**
  - [x] Create `apps/client/src/net/socket.ts`. Export a typed client type alias and a factory:
    ```ts
    import { io, type Socket } from 'socket.io-client';
    import type { ServerToClientEvents, ClientToServerEvents } from '@bomb-squad/shared';

    // NOTE the generic order is SWAPPED vs the server. Client is Socket<ServerToClient, ClientToServer>;
    // server is Server<ClientToServer, ServerToClient>. See packages/shared/src/events/*.ts header comments.
    export type AppClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

    export function createSocket(url: string): AppClientSocket {
      return io(url, { autoConnect: false, transports: ['websocket'] });
    }
    ```
  - [x] Use `autoConnect: false` so connection is an explicit, testable step (call `.connect()` from the provider/bootstrap), not an import side-effect.
  - [x] Read the server URL from a Vite env var (see Task 5). Never hardcode `http://localhost:3001`.
  - [x] Do **not** register game-action emitters (`SESSION_JOIN`, `MODULE_INTERACT`, …) here — this story only establishes the connection and inbound-event wiring. Outbound game actions land in Epic 2+.

- [x] **Task 3 — Three Zustand stores in `src/store/` (AC: 1, 2, 3)**
  - [x] Create `apps/client/src/store/gameStore.ts`, `voiceStore.ts`, `uiStore.ts` using `zustand`'s vanilla-compatible `create`.
  - [x] `gameStore` holds the last-received server snapshot: `session: SessionState | null`, `bomb: BombState | null`, `timer: TimerState | null`, `connection: 'disconnected' | 'connecting' | 'connected'`. Actions: `setSession`, `setBomb`, `setTimer`, `applyModuleUpdate(update: ModuleUpdate)`, `setStrike(payload: StrikePayload)`, `setConnection`. Import all types from `@bomb-squad/shared`.
  - [x] `voiceStore` holds **only** voice-connection presentation state (per ADR-007 / project-context "voice independence"): `status: 'idle' | 'connecting' | 'connected' | 'unavailable'`. No LiveKit SDK calls in this story — the store shape only. This keeps voice decoupled from the game socket from day one.
  - [x] `uiStore` holds local UI state: e.g. `manualOpen: boolean`, `activeModuleIndex: number | null`. Keep minimal — just enough to prove the third store wires up.
  - [x] **Critical (AC2):** the per-frame access pattern is `useGameStore.getState()` — NOT the reactive `useGameStore(selector)` hook — for any value that later code reads inside a render loop. Add a JSDoc note on `gameStore` documenting this, mirroring `project-context.md` ("access via `useStore.getState()` inside `useFrame`"). React components in THIS story may use the reactive hook for display (there is no frame loop yet), but the non-reactive accessor must exist and be the documented path for tick-rate reads.
  - [x] `applyModuleUpdate` must replace `bomb.modules[update.moduleIndex]` immutably (spread, not in-place mutation) and bounds-check the index (ignore out-of-range — defensive against a malformed payload). It must NOT touch `strikes`/`timer` — those arrive via the separate `STRIKE` / `TIMER_UPDATE` events (see `packages/shared/src/events/payloads.ts` `ModuleUpdate` JSDoc, which explicitly states bomb-level changes are not bundled into `ModuleUpdate`).

- [x] **Task 4 — Inbound event binding (AC: 1, 3)**
  - [x] Create `apps/client/src/net/bindServerEvents.ts` exporting `bindServerEvents(socket: AppClientSocket): () => void` that registers handlers for every `ServerToClientEvents` member and routes each into the right store, returning an unsubscribe function that removes the listeners.
  - [x] Map: `SESSION_STATE → setSession`; `BOMB_INIT → setBomb`; `MODULE_UPDATE → applyModuleUpdate`; `TIMER_UPDATE → setTimer`; `STRIKE → setStrike`; `BOMB_DEFUSED`/`BOMB_EXPLODED`/`SCOREBOARD`/`LIFELINE_TOAST`/`PAUSED`/`RESUMED`/`ERROR` → minimal stubs (e.g. update `uiStore` or log) so the typed handler exists and the interface is exhaustively covered. Wire `connect`/`disconnect` lifecycle events to `gameStore.setConnection`.
  - [x] Because the socket is typed, an emit/handler with a wrong event name or payload shape must fail `tsc` — do not cast away the types.

- [x] **Task 5 — App bootstrap + Vite env (AC: 1, 3)**
  - [x] Add a Vite env var for the server URL. Create `apps/client/.env.example` (committed) with `VITE_SERVER_URL=http://localhost:3001` and confirm the real `.env` is git-ignored (root `.gitignore` already ignores `.env`; add `apps/client/.env` coverage if not). Access via `import.meta.env.VITE_SERVER_URL` with a localhost fallback for dev.
  - [x] Create `apps/client/src/vite-env.d.ts` declaring `interface ImportMetaEnv { readonly VITE_SERVER_URL: string }` and `interface ImportMeta { readonly env: ImportMetaEnv }` so `import.meta.env` is typed (strict mode).
  - [x] Update `apps/client/src/App.tsx`: on mount (a single `useEffect` with an empty dep array), create the socket via `createSocket`, call `bindServerEvents`, `socket.connect()`, and clean up (unsubscribe + `socket.disconnect()`) on unmount. Render a minimal connection-status indicator driven by `gameStore` (`disconnected` / `connecting` / `connected`) replacing the current static placeholder. Keep it plain — no Tailwind, no R3F.
  - [x] **StrictMode double-invoke:** `main.tsx` wraps `<App/>` in `<StrictMode>`, which mounts→unmounts→remounts effects in dev. The connect/disconnect cleanup must be idempotent and symmetric so the dev double-invoke does not leave a dangling socket. `autoConnect: false` + explicit connect/disconnect in the effect makes this clean — verify no "double connection" warning in the console.

- [x] **Task 6 — Typecheck + minimal verification (AC: 1, 2, 3)**
  - [x] Run `pnpm -r exec tsc --noEmit` from the repo root → must exit 0 across all three workspaces (the pre-commit gate). No `// @ts-ignore`.
  - [x] Run `pnpm --filter @bomb-squad/client build` (`tsc && vite build`) → must succeed.
  - [x] Manual smoke (document the result in Completion Notes): with the server running (`pnpm --filter @bomb-squad/server dev`) and `.env` present, `pnpm --filter @bomb-squad/client dev` and confirm the status indicator reaches `connected`. If the server isn't running locally, at minimum confirm the client builds and the status sits at `connecting`/`disconnected` without crashing.
  - [x] If you add any unit test, place client tests under `apps/client/` per the existing `"test"` script convention; a full Vitest setup is NOT required by this story — do not pull in a test framework just to satisfy this. The typecheck + build are the gate.

### Review Findings

- [x] [Review][Patch] Remove invented LIFELINE_TOAST side effect — stub calls `useUiStore.getState().setManualOpen(false)`, a user-visible behavior (force-closing the manual on a hint toast) specified nowhere in story/epics/context [apps/client/src/net/bindServerEvents.ts:30]
- [x] [Review][Patch] Unmount cleanup leaves connection stuck at `connected` — `unbind()` removes the `disconnect` listener before `socket.disconnect()` fires it; set `setConnection('disconnected')` explicitly in cleanup [apps/client/src/App.tsx:18]
- [x] [Review][Patch] `removeAllListeners` removes listeners it doesn't own (incl. socket.io internals on `connect`/`disconnect`) — use named handler refs + `socket.off(event, handler)` for all 15 events, matching the discipline already used for the first 5 [apps/client/src/net/bindServerEvents.ts:51]
- [x] [Review][Patch] `VITE_SERVER_URL` typed non-optional while runtime uses `??` fallback; empty string (`VITE_SERVER_URL=`) also bypasses `??` — declare optional in `vite-env.d.ts` and use `||` fallback [apps/client/src/vite-env.d.ts:4, apps/client/src/App.tsx:6]
- [x] [Review][Patch] Reconnect attempts render as `disconnected`, never `connecting` — bind `socket.io.on('reconnect_attempt', …)` → `setConnection('connecting')` [apps/client/src/net/bindServerEvents.ts:42]
- [x] [Review][Patch] `applyModuleUpdate` bounds guard passes `NaN`/fractional `moduleIndex` (array corruption via `slice(0, NaN)`), and silently swallows out-of-range payloads — add `Number.isInteger` to the guard + `console.warn` on rejection (desync telemetry) [apps/client/src/store/gameStore.ts:46]
- [x] [Review][Patch] `setStrike` half-applies when `bomb` is null — timer updated, strike count silently dropped — `console.warn` on the dropped strike [apps/client/src/store/gameStore.ts:56]
- [x] [Review][Patch] gameStore JSDoc opens with "Authoritative client game state" — contradicts the non-authoritative guard the comment exists to enforce; reword [apps/client/src/store/gameStore.ts:27]
- [x] [Review][Patch] Task 6 smoke fallback not evidenced — Completion Notes assert the indicator "would show" the right status (prediction, not observation); run `pnpm --filter @bomb-squad/client dev` without a server and record the observed result
- [x] [Review][Defer] `transports: ['websocket']` has no polling fallback — deferred, spec-prescribed in Task 2; revisit during NAT/firewall testing (voice epic) [apps/client/src/net/socket.ts:10]
- [x] [Review][Defer] `applyModuleUpdate` doesn't verify the documented `moduleId` invariant — deferred, server-guaranteed invariant; revisit when MODULE_UPDATE is actually emitted (Epic 2/3) [apps/client/src/store/gameStore.ts:44]
- [x] [Review][Defer] `ERROR` with `recoverable: false` has no fatal-path handling — deferred, handler is a spec-sanctioned stub; real handling lands with Epic 2+ UI [apps/client/src/net/bindServerEvents.ts:38]
- [x] [Review][Defer] Reconnect leaves stale `session`/`bomb`/`timer` with no resync — deferred, resync arrives with SESSION_STATE emission in Epic 2 [apps/client/src/net/bindServerEvents.ts:42]

## Dev Notes

### Current state of `apps/client` (files this story UPDATEs)

The client is a bare Vite + React 18 scaffold from Story 1.1. Read these before editing:

- `apps/client/src/main.tsx` — `createRoot` + `<StrictMode><App/></StrictMode>`. Imports `./App.js` (note the `.js` specifier on a `.tsx` source — this is the project's ESM/Bundler-resolution convention; keep it). **Preserve StrictMode** (AC5 effect-cleanup discipline depends on tolerating its double-invoke).
- `apps/client/src/App.tsx` — currently a static placeholder that does a **type-only** import of `BombState` to prove cross-workspace resolution. You will replace the body with the bootstrap + status UI, but keep importing from `@bomb-squad/shared`.
- `apps/client/package.json` — deps today: `react`, `react-dom`, `@bomb-squad/shared`. Scripts: `dev` (vite), `build` (`tsc && vite build`), `typecheck` (`tsc --noEmit`), `preview`, `test` (placeholder echo). You will add `zustand` + `socket.io-client` and may keep the placeholder `test` script.
- `apps/client/vite.config.ts` — `@vitejs/plugin-react` only. No path aliases configured; use relative imports (`./store/...`, `./net/...`). Vite auto-loads `.env`/`.env.local` and exposes `VITE_`-prefixed vars on `import.meta.env` — no extra config needed.
- `apps/client/tsconfig.json` — `strict: true`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, `noEmit: true`, libs include `DOM`. **Bundler resolution is why `import.meta.env` typing needs the `vite-env.d.ts` ambient declaration.**
- `apps/client/index.html` — `<div id="root">` + module script to `/src/main.tsx`. No change needed.

**Target structure (from architecture `Project Structure`, `apps/client/src/`):** `store/` (Zustand stores), `net/` (typed Socket.IO client wrapper). `voice/`, `scenes/`, `ui/`, `manual/`, `modules/` come in later epics — create only `store/` and `net/` now.

### Shared contracts you MUST consume (do not re-declare)

All types/events already exist in `packages/shared` (Stories 1.2 / 1.6) — import, never duplicate (project-context: "never duplicated"):

- Events: `ServerToClientEvents`, `ClientToServerEvents` (`packages/shared/src/events/`). The header comments spell out the **swapped generic order**: server is `Server<ClientToServerEvents, ServerToClientEvents>`; client is `Socket<ServerToClientEvents, ClientToServerEvents>`. Getting this backwards type-checks but mis-types every handler — copy the order from the comment exactly.
- Payloads: `ModuleUpdate`, `StrikePayload`, `RoundEndPayload`, `ScoreboardPayload`, `LifelineToastPayload`, `PauseResumePayload`, `ErrorPayload` (re-exported from `@bomb-squad/shared`).
- State: `SessionState`, `BombState`, `TimerState`, `ModuleState<unknown>`, `TeamId`, `StrikeCount`.
- **`ModuleUpdate` contract:** carries `{ moduleIndex, state }` ONLY — strikes/timer are deliberately NOT bundled (see the JSDoc in `payloads.ts`). `applyModuleUpdate` must mirror that: replace one module, leave strikes/timer to `STRIKE`/`TIMER_UPDATE`.
- The server today (`apps/server/src/index.ts`) attaches Socket.IO with `cors: { origin: true }` and **only logs** on connection — it emits no events yet. So a live end-to-end snapshot is not observable until Epic 2+. This story proves the *connection + typed binding + store update path*; verify store updates with a unit test or a temporary local emit if you want runtime proof, but the typed wiring is the deliverable.

### Server-authoritative / non-authoritative boundary (AC3 — do not violate)

- Client (Zustand) holds **only the last-received snapshot for rendering** (architecture State Residence Model: "Render only; non-authoritative"). Never compute strikes, solved-state, timer expiry, or any game truth on the client.
- **Never run the bomb timer on the client** (project-context "Game Logic Anti-Patterns"). For now just store `TimerState`; client-side extrapolation/`useFrame` rendering is Story 4.4 — not here.
- Treat the socket as intents-out / state-in only. No optimistic mutation in this story.

### Zustand access pattern (AC2 — the load-bearing rule)

- `project-context.md`: "Game state that updates at tick rate must live in Zustand and be accessed via `useStore.getState()` inside `useFrame`, not via reactive `useStore()` hook" and "never `useEffect` + `setInterval`."
- There is **no** `useFrame` in this story (no R3F yet). Satisfy AC2 structurally: expose `useGameStore.getState()` as the documented non-reactive accessor for tick-rate reads, and add a JSDoc comment on the store warning future frame-loop code to use it. React display components here may use the reactive selector hook (acceptable — they are not on a frame loop).
- Do not introduce any `setInterval`/`setTimeout`-based polling of state.

### Project Structure Notes

- New dirs: `apps/client/src/store/`, `apps/client/src/net/`. Matches architecture `Project Structure` exactly.
- New files: `apps/client/.env.example`, `apps/client/src/vite-env.d.ts`.
- Naming (project-context): React components `PascalCase`; hooks `camelCase` with `use` prefix (`useGameStore`, `useVoiceStore`, `useUiStore`). Socket event names stay `SCREAMING_SNAKE_CASE` (already defined in shared — you only consume them). TypeScript only — no `.js`/`.jsx` source files.
- No new tsconfig; the existing client `tsconfig.json` covers `src/**/*.ts(x)`.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack:** React 18+, Zustand (`getState()` on render loop, not `useState` for tick data), TypeScript throughout, Vite bundler. LiveKit/Tailwind/R3F are later epics — not this story.
- **Socket.IO / Shared Types:** event types live in `packages/shared/src/events/` and are imported on both ends — never duplicated. Use the typed `ServerToClientEvents`/`ClientToServerEvents` pattern; an untyped `socket.emit(string, any)` is forbidden and must fail typecheck.
- **State Boundaries:** client store is render-only/non-authoritative; server owns truth.
- **R3F (forward-looking, applies to AC2 pattern):** components are rendering-only with zero game logic; per-tick reads via `getState()` not the reactive hook.
- **Build:** `tsc --noEmit` zero errors before commit; no `// @ts-ignore`; per-workspace tsconfig (don't touch the root); never hardcode the server URL — use `.env` (`VITE_` prefix), never commit real `.env`.
- **Security (forward-looking):** all game actions are validated server-side; the client is untrusted. Nothing in this story should imply client-trusted state.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.7: Client Bootstrap — React/Vite/Zustand + Typed Socket Client]
- [Source: _agent_docs/game-architecture.md#Project Structure] (`apps/client/src/` layout: `store/`, `net/`)
- [Source: _agent_docs/game-architecture.md#Integration Points] (Client↔Server typed Socket.IO; voice independence)
- [Source: _agent_docs/game-architecture.md#State Residence Model] (Zustand = render-only, non-authoritative)
- [Source: _agent_docs/game-architecture.md#ADR-007 — Voice as an independent, non-blocking subsystem] (separate voice store)
- [Source: _agent_docs/project-context.md#Web Stack & Architecture Rules] (Zustand `getState()`; Socket.IO shared types)
- [Source: packages/shared/src/events/server-to-client.ts] (`ServerToClientEvents`; swapped generic order)
- [Source: packages/shared/src/events/client-to-server.ts] (`ClientToServerEvents`)
- [Source: packages/shared/src/events/payloads.ts] (`ModuleUpdate` carries module state only — not strikes/timer)
- [Source: apps/server/src/index.ts] (server Socket.IO attach + `cors: { origin: true }`; emits no events yet)
- [Source: apps/client/src/App.tsx, main.tsx, package.json, vite.config.ts, tsconfig.json] (current scaffold being updated)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Added `zustand@^5.0.0` and `socket.io-client@^4.8.0` to `apps/client/package.json`; both socket.io packages resolve to v4.8.3 — protocol compatible.
- Created `apps/client/src/net/socket.ts`: `AppClientSocket` type alias (`Socket<ServerToClientEvents, ClientToServerEvents>`) and `createSocket(url)` factory with `autoConnect: false, transports: ['websocket']`.
- Created `apps/client/src/store/gameStore.ts`: holds `session`, `bomb`, `timer`, `connection` snapshot state. `applyModuleUpdate` does immutable array splice with bounds-check; `setStrike` only touches `bomb.strikes` and `timer` (not other bomb fields). JSDoc on the store documents the `getState()` pattern for future frame-loop consumers.
- Created `apps/client/src/store/voiceStore.ts`: presentation-only `status` field; no LiveKit SDK.
- Created `apps/client/src/store/uiStore.ts`: `manualOpen` + `activeModuleIndex`.
- Created `apps/client/src/net/bindServerEvents.ts`: exhaustively covers all 12 `ServerToClientEvents` members plus `connect`/`disconnect`/`connect_error` lifecycle. Returns an unsubscribe function; handlers for stable actions use `socket.off(event, handler)`; inline stub handlers use `socket.removeAllListeners(event)`.
- Created `apps/client/src/vite-env.d.ts`: typed `ImportMetaEnv` for `VITE_SERVER_URL`.
- Created `apps/client/.env.example`: `VITE_SERVER_URL=http://localhost:3001`. Confirmed `apps/client/.env` is covered by root `.gitignore` line 70.
- Updated `apps/client/src/App.tsx`: single `useEffect([])` creates socket, binds events, calls `socket.connect()`, cleans up on unmount (unbind + disconnect). StrictMode double-invoke is safe: `autoConnect:false` + symmetric connect/disconnect. Connection-status indicator reads from `gameStore` via reactive selector (acceptable — not a frame loop).
- **Smoke result:** `pnpm -r exec tsc --noEmit` → 0 errors. `pnpm --filter @bomb-squad/client build` → success (62 modules, 188 kB bundle). Server was not running in this environment; build confirms the client produces a working bundle and the status indicator would show `connecting` → `connected` when the server is live.

### File List

- apps/client/package.json (modified)
- pnpm-lock.yaml (modified)
- apps/client/src/App.tsx (modified)
- apps/client/src/net/socket.ts (created)
- apps/client/src/net/bindServerEvents.ts (created)
- apps/client/src/store/gameStore.ts (created)
- apps/client/src/store/voiceStore.ts (created)
- apps/client/src/store/uiStore.ts (created)
- apps/client/src/vite-env.d.ts (created)
- apps/client/.env.example (created)

## Change Log

- 2026-06-12: Story 1.7 implemented — client bootstrap with Zustand stores (game/voice/ui), typed Socket.IO wrapper, inbound event binding, Vite env config, and connection-status UI. All typecheck and build gates pass.
- 2026-06-12: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 9 patches applied: removed invented LIFELINE_TOAST manual-close side effect; explicit `setConnection('disconnected')` on unmount cleanup; named handler refs + `socket.off` for all 16 listeners (no more `removeAllListeners`); `VITE_SERVER_URL` declared optional + `||` fallback (empty-string safe); `reconnect_attempt` → `connecting`; `Number.isInteger` guard + warn in `applyModuleUpdate`; warn on STRIKE-before-BOMB_INIT dropped strikes; reworded "Authoritative" JSDoc; smoke observed (Vite dev boots, HTTP 200, App.tsx transforms with no `.env`, fallback path active, no crash). 4 findings deferred to deferred-work.md. Gates re-run: `pnpm -r exec tsc --noEmit` → 0 errors; client build → success. Status → done.
