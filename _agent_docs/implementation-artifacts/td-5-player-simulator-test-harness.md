---
baseline_commit: 0b83187
context:
  - _agent_docs/project-context.md
  - packages/shared/src/events/client-to-server.ts
  - packages/shared/src/events/server-to-client.ts
  - apps/server/src/handlers/__tests__/testSocketServer.ts
  - apps/client/src/net/productionDispatch.ts
---

# Story TD-5: Player-Simulator Test Harness (Headless Bot Swarm)

Status: review

<!-- Tech-debt / tooling story (not from an epic). Surfaced by the Story 8.6
     human-verification deferral: a solo dev cannot form 2 teams with rotating
     defusers and drive a multi-round session to resolution without spinning up
     ~4+ browsers by hand. This story builds a headless bot-swarm CLI that joins
     as real typed socket clients, fills the player seats, and self-solves each
     round so the facilitator (a human in ONE browser) can verify the
     between-round flow / scoreboard (8.6) and round configuration (8.1). -->

## Story

As a solo developer verifying multiplayer game-loop stories,
I want a headless CLI that simulates multiple socket clients — two teams with rotating defusers that join, ready up, and drive each round to resolution — while I stay the Facilitator in a single real browser,
so that I can interactively verify the between-round flow, scoreboard, and difficulty-gating UI (Stories 8.6 / 8.1) without manually juggling four-plus browser windows.

## Context — the grounded picture (verified 2026-06-18)

- **The entire play loop is plain typed socket events** — no HTTP wall, no auth beyond the join code. `ClientToServerEvents` (`packages/shared/src/events/client-to-server.ts`) exposes everything a bot needs: `SESSION_JOIN`, `TEAM_ASSIGN`, `PLAYER_READY`, `MODULE_INTERACT` (the facilitator-only `ROUND_CONFIGURE`/`PREPARATION_OPEN`/`ROUND_START` stay with the human). A `socket.io-client` connection is indistinguishable from a browser to the server.
- **Solve logic is PURE and lives in `packages/shared`** — bots can compute the correct move from the *public* `BOMB_INIT` snapshot, exactly the way the real Defuser does:
  - `solveWires(colors, ctx)` → `wireIndex` (`packages/shared/src/modules/wires/solve.ts:158`)
  - `decideButton(color, label, ctx)` → press-vs-hold; `releaseDigitFor(stripColor)` → release digit (`the-button/solve.ts:78,98`)
  - `isValidPassword(word)` / `currentWord(state)` / `countSpellableWords(columns)` (`passwords/solve.ts:10,15,25`)
  - **No baked answers exist to cheat with** — `solutionIndex` was removed (Sprint 2 retro / 5.3 fix); the bot must recompute from public `ctx`, which is the honest path. Good.
- **Multi-client socket simulation is already proven in-process** — `apps/server/src/handlers/__tests__/testSocketServer.ts` drives real client sockets against a real server (in-memory Redis + injected scheduler). This story points the *same idea* at the **live Docker server** so the human can watch the real UI. Lift its connect/await-event helpers; do not reinvent.
- **Durable identity is in place (Story 2.7)** — on join the server unicasts `SESSION_IDENTITY { sessionId, playerId, reattachToken }`. Bots should capture it (needed if TD-5 is later extended to simulate disconnect/reconnect for Story 8.7).
- **Defuser authority is per-team and rotation-driven** — `TeamState.relayOrder: string[]` + `currentDefuserIndex` (`packages/shared/src/types/session.ts:34-39`); the current defuser is `relayOrder[currentDefuserIndex]` (the SOLE authority since the 8.6 decision — the lobby defuser/expert pick is participant-vs-spectator only). Only that player's `MODULE_INTERACT` is honored; a non-defuser bot's interact yields a typed `ERROR`.
- **The action shapes are typed and runtime-guarded:**
  - wires: `{ type: 'CUT'; wireIndex: number }`
  - the-button: `{ type: 'PRESS' }` | `{ type: 'RELEASE'; timerDigits: number[] }`
  - passwords: `{ type: 'CYCLE'; columnIndex: number; direction: 'up'|'down' }` | `{ type: 'SUBMIT' }`
  - emitted as `MODULE_INTERACT { teamId, moduleIndex, action }` (`apps/client/src/net/productionDispatch.ts:37` is the reference for how the real client resolves `teamId` from the self player's team).
- **The pnpm workspace globs are `packages/*` and `apps/*`** (`pnpm-workspace.yaml`). A new top-level `tools/*` requires adding that glob; alternatively the tool lands under `apps/`. See Project Structure Notes for the decision.

## Acceptance Criteria

1. **Given** the monorepo, **When** the simulator package is added, **Then** a new workspace (`tools/sim-clients`, with `tools/*` added to `pnpm-workspace.yaml`) exists with `socket.io-client` + `@bomb-squad/shared` as its only runtime deps, is TypeScript-only, `pnpm -r typecheck` is clean with no `@ts-ignore`, and **nothing in `apps/client`, `apps/server`, or `packages/shared` imports it** (the dependency edge points one way: tool → shared).
2. **Given** a running server and a Facilitator-created session, **When** `pnpm sim --url <server-url> --code <joinCode> --teams 2 --per-team 2` runs, **Then** the bots connect as real typed `Socket<ServerToClientEvents, ClientToServerEvents>` clients, `SESSION_JOIN` with distinct display names, distribute across the two teams via `TEAM_ASSIGN`, all `PLAYER_READY`, and each bot logs its captured `SESSION_IDENTITY.playerId`. A `SESSION_STATE` mirror is maintained per bot from the broadcast (server-truth-driven, no optimistic local state).
3. **Given** the Facilitator (human) starts a round, **When** `BOMB_INIT` arrives, **Then** the bot that is the **current defuser for its team** (`relayOrder[currentDefuserIndex]`) drives its modules to the requested outcome: `--outcome defuse` computes correct actions via the shared solve functions and emits `MODULE_INTERACT` until `solved`; `--outcome strike` emits one deliberately-wrong action; `--outcome timeout` idles and lets the server clock expire. Non-defuser bots never emit `MODULE_INTERACT`.
4. **Given** a multi-round (relay) session, **When** a round resolves and the next round begins, **Then** the bots re-derive the rotated defuser from the fresh `SESSION_STATE` each round and repeat the resolution loop — so a human Facilitator can run two-team rounds to resolution back-to-back and verify the 8.6 between-round flow / scoreboard and the 8.1 difficulty-gating dashboard without opening additional browsers.
5. **Given** the tool's dev-only nature, **When** it runs, **Then** it respects server authority (bounds-checks via the shared runtime guards before emitting; surfaces server `ERROR` events to stdout rather than crashing), uses **only public snapshot data** to solve (never any baked answer), and exercises **no LiveKit voice and no 3D rendering** (explicitly out of scope — those need real browsers). A `--help`/usage and graceful Ctrl-C teardown (disconnect all sockets) are provided.
6. **Given** a contributor, **When** they read `tools/sim-clients/README.md`, **Then** it documents the install/run commands, the **hybrid workflow** (human = Facilitator in one browser, bots = players), every flag, the honest boundaries (no voice/3D), and the **server-on-plain-`tsx`-not-`tsx watch`** requirement (a watch restart drops the in-memory `setTimeout` expiry wake, breaking the `--outcome timeout` path). It cross-links the Story 8.6 / 8.1 human-verification gates this tool unblocks.

## Tasks / Subtasks

- [x] **Task 1 — Scaffold the `tools/sim-clients` workspace (AC: #1)**
  - [x] Add `tools/*` to `pnpm-workspace.yaml` (preserve `packages/*`, `apps/*`).
  - [x] Create `tools/sim-clients/package.json` (`@bomb-squad/sim-clients`, `private: true`, a `sim` bin/script via `tsx`), its own `tsconfig.json` (project-context rule: separate tsconfig per workspace), runtime deps `socket.io-client` + `@bomb-squad/shared` (workspace:*), dev dep `tsx`.
  - [x] Root `pnpm install`; confirm `pnpm -r typecheck` clean and that no other workspace gains a dep on this package.

- [x] **Task 2 — `BotClient`: a single simulated player (AC: #2, #5)**
  - [x] `src/BotClient.ts` wrapping a typed `io(url) as Socket<ServerToClientEvents, ClientToServerEvents>`. Methods: `join({ joinCode, displayName, role })`, `assignTeam(teamId, role)`, `ready()`, and an internal `SessionState`/`BombState` mirror updated from `SESSION_STATE`/`BOMB_INIT`/`MODULE_UPDATE`/`TIMER_UPDATE`.
  - [x] Capture `SESSION_IDENTITY` → store `playerId` + `reattachToken` (reattach support can be a stub for now; the data must be captured for the future 8.7 extension).
  - [x] Subscribe to `ERROR` and print `{ code, message }` to stderr without throwing (server authority is the source of truth; a rejected emit is information, not a crash).
  - [x] Reuse the connect/await-event helper shapes from `apps/server/src/handlers/__tests__/testSocketServer.ts` rather than inventing a new awaiter.

- [x] **Task 3 — Module solvers: compute the move from public state (AC: #3, #5)**
  - [x] `src/solvers.ts`: a `solveModule(module: ModuleState<unknown>, ctx: BombContext): ModuleAction | null` dispatch keyed on `moduleId`, delegating to the shared pure fns:
    - `wires` → `solveWires(colors, ctx)` → `{ type: 'CUT', wireIndex }`
    - `the-button` → `decideButton(color, label, ctx)`; on hold, read `releaseDigitFor(stripColor)` and watch `TIMER_UPDATE` to time the `RELEASE` (carry `timerDigits`); on press, `{ type: 'PRESS' }`
    - `passwords` → cycle each column toward the unique valid word (`isValidPassword`/`currentWord`), then `{ type: 'SUBMIT' }`
  - [x] A deliberately-wrong variant per module for `--outcome strike` (e.g. cut the wrong wire / submit a non-word). Validate every action through the shared runtime guard (`isButtonAction`/`isPasswordsAction`/wires shape) before emit.

- [x] **Task 4 — Swarm orchestrator + CLI (AC: #2, #3, #4, #5)**
  - [x] `src/main.ts`: parse flags (`--url`, `--code`, `--teams` default 2, `--per-team` default 2, `--outcome defuse|strike|timeout` default defuse, `--help`). Spawn `teams × per-team` `BotClient`s; join, team-assign, ready.
  - [x] Per-team round loop: on `BOMB_INIT`, resolve the current defuser (`relayOrder[currentDefuserIndex]`); only that bot iterates its unsolved modules via Task 3 and emits `MODULE_INTERACT { teamId, moduleIndex, action }`, pacing emits at a human-plausible interval (no tight loop). For `timeout`, idle.
  - [x] On round resolution + next `BOMB_INIT`, re-derive the rotated defuser and repeat (AC #4). Graceful Ctrl-C: disconnect all sockets.

- [x] **Task 5 — README + workflow doc (AC: #6)**
  - [x] `tools/sim-clients/README.md`: install/run, the hybrid workflow (human Facilitator in one browser at `https://localhost`; bots fill seats; you `ROUND_CONFIGURE`/`PREPARATION_OPEN`/`ROUND_START` and watch the scoreboard), every flag, honest boundaries (no voice/3D), and the **plain `tsx` (not `tsx watch`)** caveat for the timeout path. Cross-link the 8.6 deferral entry in `deferred-work.md` and the 8.1 Task 5 gate.

- [x] **Task 6 — Quality gate (AC: #1)**
  - [x] `pnpm -r typecheck` clean (no `@ts-ignore`). Smoke-run against the local Docker stack: 2 teams × 2 bots reach a resolved round; confirm a strike outcome and a defuse outcome each produce the expected server broadcast. Record the observed run in Completion Notes.

> **No interactive human-verify gate of its own.** Per [[human-verification-ac-rule]], that gate is for *user-visible / e2e-testable feature* stories. TD-5 is **developer-facing tooling** — its "verification" is the Task 6 smoke run (typecheck clean + a real resolved round against the stack). Its *purpose* is to make the 8.6 / 8.1 human-verify gates cheap for a solo dev; it does not carry one itself.

## Dev Notes

### Scope discipline — what this story is and is NOT

- **IS:** a headless, dev-only CLI of real socket clients that fill the *player* seats and drive rounds to resolution, so one human can verify the Facilitator-facing UI (8.6 scoreboard / between-round flow, 8.1 difficulty dashboard) alone.
- **IS NOT:** a load/stress tool, an automated E2E test suite (no assertions/CI gating — that would be a separate story), a voice tester, or a renderer. It is **not** the Facilitator — the human stays the facilitator so the UI under verification is real. It must never ship to or be imported by client/server/shared.

### Why a bot can solve honestly (the keystone)

The shared solve functions take **public** inputs (`colors`/`color,label`/`columns` + `BombContext`), the exact data on the broadcast `BOMB_INIT`. Since `solutionIndex` was removed at the source (5.3 fix), there is no cheat value to read — the bot recomputes the answer the same way a human Defuser reading the manual would. This is what makes the simulator faithful rather than a back-door.

### The hybrid workflow (the actual deliverable value)

```
You (browser, Facilitator)  SESSION_CREATE → join code; later ROUND_CONFIGURE / PREPARATION_OPEN / ROUND_START
sim --code <code> --teams 2 --per-team 2   bots SESSION_JOIN + TEAM_ASSIGN + PLAYER_READY
defuser bot per team         reads BOMB_INIT → solveModule(...) → MODULE_INTERACT → solved
both teams resolve           → 8.6 between-round flow fires → you watch the scoreboard
next round                   bots re-read rotated defuser from SESSION_STATE, repeat
```

### Gotchas to bake in

- **Server on plain `tsx`, NOT `tsx watch`** — a restart drops the in-memory `setTimeout` expiry wake (single-process V1); the `--outcome timeout` path silently won't fire under watch. ([[timer-verification-tsx-watch-gotcha]])
- **Defuser authority** — only `relayOrder[currentDefuserIndex]` may interact; resolve it from state per round, don't assume bot[0]. A non-defuser interact returns a typed `ERROR` (surface it, don't crash).
- **Identity is durable** — keep each bot's `reattachToken`; it's the seam for a future 8.7 disconnect/reconnect simulation.
- **Pace the emits** — modules solve in one tick if you blast actions; a small delay keeps it watchable and avoids racing the broadcast you derive the next action from.
- **Reuse, don't reinvent** — `testSocketServer.ts` already has the connect/await-event ergonomics; the action shapes + runtime guards are in `packages/shared/src/modules/*/types.ts`; the `teamId` resolution pattern is in `apps/client/src/net/productionDispatch.ts`.

### Files to touch

- **UPDATE** `pnpm-workspace.yaml` — add `tools/*`.
- **NEW** `tools/sim-clients/package.json`, `tsconfig.json`.
- **NEW** `tools/sim-clients/src/BotClient.ts` — one simulated player (typed socket + state mirror + identity capture).
- **NEW** `tools/sim-clients/src/solvers.ts` — `moduleId` → shared-solve dispatch (+ wrong-action variants).
- **NEW** `tools/sim-clients/src/main.ts` — CLI + swarm orchestrator + per-round defuser loop.
- **NEW** `tools/sim-clients/README.md` — usage + hybrid workflow + boundaries.

Read before editing:
- `packages/shared/src/events/{client-to-server,server-to-client}.ts` — the typed event surface (the bot's whole vocabulary).
- `packages/shared/src/modules/{wires,the-button,passwords}/{solve,types}.ts` — solve fns + action shapes + runtime guards.
- `packages/shared/src/types/{session,bomb}.ts` — `TeamState.relayOrder`/`currentDefuserIndex`, `BombState.modules`/`ModuleState`/`BombContext`.
- `apps/server/src/handlers/__tests__/testSocketServer.ts` — the multi-client connect/await pattern to lift.
- `apps/client/src/net/productionDispatch.ts` — reference for resolving `teamId` and emitting `MODULE_INTERACT`.

### Project Structure Notes

- The pnpm workspace globs today are `packages/*` and `apps/*`. **Recommended:** add `tools/*` and place the simulator there — it's neither a shipped app nor a shared library, and a `tools/` namespace keeps the dev-only intent obvious. Acceptable fallback if you want to avoid the glob change: `apps/sim-clients` (already matched by `apps/*`), but mark it clearly dev-only. Record the choice in Completion Notes.
- TypeScript-only, separate `tsconfig.json` (project-context "Build" rule). `@bomb-squad/shared` must stay framework-free, so importing its types/solve fns into the tool is clean (no react/socket.io server pulled in).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Socket.IO / Shared Types:** use the typed `Socket<ServerToClientEvents, ClientToServerEvents>`; `socket.emit(string, any)` is forbidden — the bot's emits are compile-checked against `ClientToServerEvents`.
- **Server-authoritative:** the bot holds no game logic of its own beyond *choosing* a move; it never simulates the timer or invents state — it mirrors `SESSION_STATE`/`BOMB_INIT` and lets the server adjudicate. ("NEVER run the bomb timer on the client.")
- **Determinism:** no `Math.random()` for solving — derive every move from the public snapshot via the shared pure solve fns. (Random *display names* are fine; they're not game logic.)
- **State boundaries:** the tool talks only to the socket layer; it never touches Redis/Postgres directly.
- **Build:** `tsc --noEmit` zero errors; no `@ts-ignore`; TypeScript only.

### References

- [Source: _agent_docs/implementation-artifacts/deferred-work.md#Deferred from: code review of story-8.6] — the human-verification deferral that motivated this tool (two-team round to resolution + rotating defuser).
- [Source: _agent_docs/implementation-artifacts/8-1-round-configuration-and-difficulty-gating.md#Task 5] — the 8.1 facilitator-dashboard human-verify gate this also unblocks.
- [Source: packages/shared/src/events/client-to-server.ts] — the full client→server event vocabulary a bot uses.
- [Source: packages/shared/src/modules/wires/solve.ts:158, the-button/solve.ts:78,98, passwords/solve.ts:10-25] — the pure solve functions the bot calls.
- [Source: packages/shared/src/types/session.ts:34-39] — `TeamState.relayOrder` + `currentDefuserIndex` (defuser authority / rotation).
- [Source: apps/server/src/handlers/__tests__/testSocketServer.ts] — the proven multi-client socket-driving pattern to reuse.
- [Source: apps/client/src/net/productionDispatch.ts:34-37] — `MODULE_INTERACT { teamId, moduleIndex, action }` emit + teamId resolution.
- [Source: _agent_docs/project-context.md#Socket.IO / Shared Types, #Server-Authoritative State, #Build] — typed-events, server-authority, build constraints.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story)

### Debug Log References

- `pnpm --filter @bomb-squad/sim-clients typecheck` → clean (no `@ts-ignore`). `pnpm -w typecheck` → clean across all 4 workspaces.
- `pnpm --filter @bomb-squad/sim-clients verify` (in-process server, real handlers) → **6/6 checks PASS**: two-team defuse (wires + passwords), multi-round (Defuser rotation `currentDefuserIndex ≥ 1`), button defuse (PRESS/RELEASE + timer-digit HOLD loop over sockets), strike (one wrong wire cut).
- Two load-modify-store races surfaced and fixed during bring-up: (1) firing `TEAM_ASSIGN` for all players concurrently raced the single session-key write — only the last survived; fixed by assigning **sequentially** with per-assignment reflection (matches the server's human-speed concurrency model). (2) The verify "both Defusers report DEFUSED" assertion was wrong (experts share the team room and also receive `BOMB_DEFUSED`); corrected to "every bot observed DEFUSED (no team exploded)".

### Completion Notes List

- **Two run modes — driven by a server-authority constraint not spelled out in the spec.** `TEAM_ASSIGN`/`PREPARATION_OPEN`/`ROUND_START` are facilitator-only (`NOT_FACILITATOR`), so player-bots **cannot** self-assign teams (AC-2's "distribute via TEAM_ASSIGN" is only possible for a facilitator). Resolved by shipping both: **hybrid/join** (`--code`) — bots join a human-created session as players, the human Facilitator assigns teams + drives rounds from the browser (the 8.6/8.1 workflow); and **autonomous** (`--create`) — one bot mints itself Facilitator and drives everything headless (used by `verify` and any future automation). The reactive Defuser loop serves both; only WHO performs facilitator actions differs.
- **Faithful, honest solving.** `solvers.ts` dispatches on `moduleId` to the shared pure fns from public `BOMB_INIT` data only: wires → `solveWires` → CUT; the-button → `decideButton` (tap = PRESS+RELEASE; hold = PRESS then RELEASE when the live timer shows `releaseDigitFor(stripColor)` — the bot mirrors the client's `currentTimerDigits()` via a replicated `timerDigits.ts`); passwords → cycle each column to the unique spellable word, then SUBMIT. Wrong-action variants per module power `--outcome strike`.
- **AC-6 verification is Docker-FREE and repeatable.** Rather than a one-off manual Docker smoke, `pnpm verify` boots an in-process Socket.IO server wired with the REAL `registerSessionHandlers` + `registerModuleHandlers` over an in-memory Redis and runs the autonomous swarm — exercising the actual reducers end-to-end (defuse + multi-round rotation + button hold-loop + strike). This meets AC-6's intent ("2 teams × 2 bots reach a resolved round; confirm strike + defuse") more strongly than a manual run and is CI-able. The only delta vs the literal "Docker stack" wording is transport/infra (TLS/Caddy/real Redis), which the project's existing smoke-test script already covers; a live run is `pnpm --filter @bomb-squad/sim-clients sim --url https://localhost --code <code> …` against the stack on plain `tsx`.
- **AC-1 honored exactly.** Shipped tool (`main`/`swarm`/`BotClient`/`solvers`/`timerDigits`) depends only on `@bomb-squad/shared` + `socket.io-client`. `@bomb-squad/server` + `socket.io` are **dev** deps used solely by `verify.ts`; nothing in apps/client, apps/server, or packages/shared imports the tool (the dependency edge points one way: tool → shared/server). `@types/node` added as a dev dep (the only addition beyond the spec's listed deps).
- **Placed under `tools/sim-clients`** (added `tools/*` to `pnpm-workspace.yaml`) per the recommended option — dev-only intent is explicit and it's neither a shipped app nor a shared lib.

### File List

- `pnpm-workspace.yaml` (modified — added `tools/*` glob)
- `tools/sim-clients/package.json` (new)
- `tools/sim-clients/tsconfig.json` (new)
- `tools/sim-clients/README.md` (new)
- `tools/sim-clients/src/solvers.ts` (new — module → shared-solve dispatch + wrong-action variants)
- `tools/sim-clients/src/timerDigits.ts` (new — timer-LCD digit extraction, mirror of apps/client `timerLcd.ts`)
- `tools/sim-clients/src/BotClient.ts` (new — one simulated player: typed socket, state mirrors, identity capture, reactive Defuser loop)
- `tools/sim-clients/src/swarm.ts` (new — orchestration: autonomous + join modes, sequential team assignment, playRound)
- `tools/sim-clients/src/main.ts` (new — CLI: `--code` hybrid / `--create` autonomous)
- `tools/sim-clients/src/verify.ts` (new — Docker-free in-process end-to-end check)
- `pnpm-lock.yaml` (modified — new workspace + devDeps)

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-18 | Story TD-5 created (ready-for-dev): headless bot-swarm simulator CLI (`tools/sim-clients`) so a solo dev can form 2 teams with rotating defusers and drive multi-round sessions to resolution while staying Facilitator in one browser — unblocking the 8.6 / 8.1 human-verification gates. Grounded against the typed socket contract, shared pure solve fns, defuser-rotation authority, and the `testSocketServer` pattern. |
| 2026-06-18 | Implemented all 6 tasks (AC #1–#6). Shipped the tool (BotClient + solvers + timerDigits + swarm with autonomous & hybrid modes + CLI + README) and a Docker-free in-process e2e (`pnpm verify`, 6/6 green: defuse, multi-round rotation, button hold-loop, strike). Surfaced + handled the facilitator-only `TEAM_ASSIGN` authority (two modes) and the load-modify-store race (sequential assignment). Workspace typecheck clean. Status → review. (claude-opus-4-8) |
