---
baseline_commit: d4fcb50
context:
  - _agent_docs/project-context.md
  - apps/client/vite.config.ts
  - apps/client/package.json
---

# Story TD-1: Client Component Test Framework + Test-Debt Catch-Up

Status: review

<!-- Tech-debt story (not from an epic). Discovered mid-Epic 3: the client has a unit
     runner (Vitest) but no DOM/component-testing layer, so the 11 src/ui components have
     zero behavioural tests. This story adds the framework + a mocking convention and pays
     down the most valuable slice of the backlog. -->

## Story

As a developer on the client,
I want a React component-testing layer (jsdom + React Testing Library) wired into the existing Vitest runner, with an agreed mocking convention for the socket and the R3F/Three.js scene,
so that the operator-world UI components can be tested through the DOM the way a user sees them, and future UI stories ship with component tests instead of accruing more debt.

## Context — the grounded picture (verified 2026-06-14)

- The client runs **Vitest 4** in its **default `node` environment** — `apps/client/vite.config.ts` has no `test` block, no `environment`, no setup file.
- There are **221 passing client tests across 26 files**, and **every one tests pure logic** (joinCode, shareLink, serverClock, identity, dispatch, manual search, voice state machine, scene math, …). **Zero render a React component** (`grep -rlE "render\(|@testing-library" apps/client/src` → no hits).
- The client has **~28 `.tsx` files**; the operator-world DOM UI is the **11 `src/ui/` components** (`Landing`, `Lobby`, `Preparation`, `ActiveRound`, `AppShell`, `Button`, `ConfirmButton`, `LoadingScreen`, `PlatformGate`, `ResolutionBanner`, `VoiceController`). None have component tests.
- **No DOM/component-testing deps are installed** — no `jsdom`, no `happy-dom`, no `@testing-library/*`. (The `happy-dom`/`jsdom` lines in `pnpm-lock.yaml` are Vitest's *optional peer* declarations, not installed packages.)
- **The R3F wrinkle is real:** the bomb scene (`src/scenes/`, `src/modules/*/DefuserView.tsx`) renders with `@react-three/fiber`, and jsdom has **no WebGL/canvas**. So this story tests the **plain-DOM `src/ui/` components in isolation** (exactly where Epic 2's UI lives) and establishes the **mock-`@react-three/fiber`** convention so a 3D surface *can* later be mounted in a test without crashing — but mounting the live bomb scene is explicitly out of scope here.

## Acceptance Criteria

1. **Given** the client workspace, **When** the component-testing deps are added, **Then** `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` are **devDependencies of `apps/client` only** (never `apps/server`, never `packages/shared`), installed via a root `pnpm install`, pinned to versions compatible with Vitest 4 / React 18, and `pnpm -r typecheck` is clean with no `@ts-ignore`.
2. **Given** the Vitest config, **When** component tests run, **Then** `apps/client/vite.config.ts` declares a `test` block with `environment: 'jsdom'` and a `setupFiles` entry, and a `apps/client/src/test/setup.ts` imports `@testing-library/jest-dom` (so `toBeInTheDocument` etc. are available) and registers an `afterEach(cleanup)`. The Vitest `test` config typing is referenced correctly (`/// <reference types="vitest/config" />` or `defineConfig` from `vitest/config`).
3. **Given** the **221 existing pure-logic tests**, **When** the suite runs under the new jsdom environment, **Then** **all 221 still pass** (jsdom is a DOM superset of node). Any test that *depended on `document`/`window` being absent must be identified and fixed in place — in particular confirm `apps/client/src/voice/connectVoice.ts`'s `typeof document` DOM-guard and its tests still behave correctly now that `document` exists in the test env.
4. **Given** a documented mocking convention, **When** a contributor writes a component test, **Then** the repo provides a single agreed pattern (a short test helper and/or a README/JSDoc) for: (a) **mocking the typed socket** — stub `getSocket()` from `src/net/socket.ts` so a component can assert `emit('SESSION_…', …)` was called without a live Socket.IO connection; and (b) **stubbing `@react-three/fiber`** (e.g. `vi.mock('@react-three/fiber', …)`) so a component tree that transitively imports the R3F scene renders in jsdom without WebGL. The convention is written down once, deliberately, not copy-pasted ad hoc.
5. **Given** the catch-up slice, **When** this story is done, **Then** there are component tests for the **three core operator-world DOM flows — `Landing`, `Lobby`, `Preparation`** — covering at least: render-without-crash, the primary user interaction per component asserted through accessible queries (role/label/text), and the resulting typed socket emit (e.g. `Landing` join → `user.type` name + `user.click` Join → `emit('SESSION_JOIN'|'SESSION_CREATE', …)`). Tests query by accessible role/label/text and use `@testing-library/user-event` for interactions — they assert **behaviour as a user sees it**, not component internals/props/state.
6. **Given** the full suite, **When** `pnpm -r test` runs, **Then** it is green across all workspaces (client = 221 baseline + the new component tests; server `319`; shared `136`), `tsc --noEmit` is clean, and the new tests run in the existing `vitest run` invocation with **no separate command or CI step**.

## Tasks / Subtasks

- [x] **Task 1 — Add the component-testing devDeps to the client (AC: #1)**
  - [x] Add `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` to `apps/client/package.json` **devDependencies**, then `pnpm install` from the **repo root** (pnpm workspaces — never install into a sub-package cwd; see [[worktree-fullstack-testing-gap]]). → `jsdom@^29.1.1`, `@testing-library/react@^16.3.2`, `@testing-library/user-event@^14.6.1`, `@testing-library/jest-dom@^6.9.1` (all latest, Vitest-4/React-18 compatible); root `pnpm install` ✓.
  - [x] Confirm none of the four land in `apps/server` or `packages/shared` package.json. Run `pnpm -r typecheck` — clean, no `@ts-ignore`. → absent from server/shared ✓; `pnpm -r typecheck` clean across all 3 workspaces.

- [x] **Task 2 — Wire the jsdom environment + setup file (AC: #2)**
  - [x] Add a `test` block to `apps/client/vite.config.ts`: `environment: 'jsdom'`, `globals: true` (optional — decide and document), `setupFiles: ['./src/test/setup.ts']`. Reference the Vitest config types (`import { defineConfig } from 'vitest/config'` or the triple-slash reference) so `test` is type-checked. → added `test` block with `environment: 'jsdom'`, `globals: true`, `setupFiles`; added `/// <reference types="vitest/config" />` for typing; preserved the existing `preview.allowedHosts` block.
  - [x] Create `apps/client/src/test/setup.ts` → `import '@testing-library/jest-dom'` + `afterEach(() => cleanup())` from `@testing-library/react`. → created; imports `@testing-library/jest-dom/vitest` (the Vitest-matcher entry) + `afterEach(cleanup)`.

- [x] **Task 3 — Regression-guard the existing tests under jsdom (AC: #3)**
  - [x] Run `pnpm --filter @bomb-squad/client test`; confirm all existing tests still pass. jsdom is a superset, so node-only logic tests should be unaffected. → **227/227 pass** (the spec's "221" predates the 2.6/2.7 merges, which added 6 tests; real pre-TD-1 baseline is 227 — AC #3/#6 "all existing pass" satisfied at 227).
  - [x] **Specifically re-check `connectVoice.ts`** — `typeof document` guard around attaching `<audio>` to `document.body`. Under jsdom that branch now executes in tests. → it DID fail under jsdom exactly as flagged: the voice test's fake `track.attach()` returned a plain `{remove,style}` stub that jsdom's `document.body.appendChild` rejects (`parameter 1 is not of type 'Node'`). **Source is correct** (real LiveKit returns a real `HTMLAudioElement`); fixed the *test fake* in `connectVoice.test.ts` to return a real `document.createElement('audio')` with a spied `remove` — faithful to the SDK, all teardown assertions intact, no source change. `afterEach(cleanup)` handles inter-test DOM hygiene.

- [x] **Task 4 — Establish + document the mocking convention (AC: #4)**
  - [x] **Socket:** add a small helper (e.g. `src/test/mockSocket.ts`) that `vi.mock('../net/socket')`s `getSocket()` to return a fake with `emit`/`on`/`timeout().emit` spies, mirroring the real typed surface used by the UI (`Landing.tsx` uses `.timeout(ms).emit(EVENT, payload, ack)` — the fake must support that ack shape). Keep it typed against `ClientToServerEvents` so `socket.emit(string, any)` stays forbidden even in tests. → `src/test/mockSocket.ts` exports `createMockSocket()` returning `{ socket, emit, timeoutEmit, on, off, id, fire }`; `socket` is cast to the real `AppClientSocket` (`Socket<ServerToClientEvents, ClientToServerEvents>`) so event-name/payload typing is preserved at call sites. `.timeout(ms).emit(...)` lands on `timeoutEmit`; `.fire(EVENT, …)` simulates a server push (e.g. `ERROR`).
  - [x] **R3F:** document (and provide a reusable `vi.mock('@react-three/fiber', …)` snippet) the convention for any component that transitively imports the bomb scene — stub `Canvas`/hooks so the tree renders in jsdom without WebGL. → documented in `src/test/README.md` "Pattern 2" with a copy-paste `vi.mock('@react-three/fiber', …)` snippet (stub `Canvas`→DOM, no-op `useFrame`/`useThree`, + drei note). Not exercised by the Task 5 plain-DOM components, but ready for the first 3D-mounting test.
  - [x] Write the convention down: a short `apps/client/src/test/README.md`. → created: philosophy (behaviour-over-internals), Pattern 1 (socket mock + store seeding), Pattern 2 (R3F stub).

- [x] **Task 5 — Catch-up component tests: Landing, Lobby, Preparation (AC: #5)**
  - [x] `Landing.test.tsx` — renders; user types a name and clicks Join/Host; assert the correct typed socket emit fires. → 4 tests: render surface; **host** → `timeoutEmit('SESSION_CREATE', {}, fn)`; **join** (type name + pick role + type 6-char code auto-submits) → `emit('SESSION_JOIN', {joinCode:'ABCDEF', displayName:'Maya', role:'defuser'})`; **no-emit when role missing** (validation path).
  - [x] `Lobby.test.tsx` — renders the roster from a seeded `gameStore`; assert a primary facilitator interaction. → 3 tests: renders null with no session; roster shows each name; facilitator clicks team `A` → `emit('TEAM_ASSIGN', {playerId:'p1', teamId:'A', role:'defuser'})`.
  - [x] `Preparation.test.tsx` — renders the preparation view from store state; assert the primary control's behaviour. → 4 tests: null with no session; facilitator heading + upcoming defuser shown; two-step Start confirm → `emit('ROUND_START')`; Back-to-lobby → `emit('PREPARATION_CANCEL')`.
  - [x] All three: query by **role/label/text**, drive interactions with `@testing-library/user-event`, mock the socket via the Task 4 helper, seed `gameStore` via `useGameStore.setState(...)` (no internals). Assert user-visible behaviour, not props/state. → done; 11 component tests total, all green.
  - [x] **Added in-ticket (test-debt catch-up, post-review decision with Jay):** two more pure-DOM components that were carrying real untested logic — `ConfirmButton.test.tsx` (6 tests: resting render, arm-on-first-click, fire-on-second-click, **fire-once guard** via two synchronous clicks, Cancel disarms, Escape disarms) and `ResolutionBanner.test.tsx` (6 tests: null→nothing, the three verdict labels via `it.each`, defused 2s hold→between-rounds surface, failure 3s hold). The latter introduces the **fake-timers pattern** (`vi.useFakeTimers` + `act(advanceTimersByTime)`) into the test convention for future timer/HUD tests. `ActiveRound`/`VoiceController`/`PlatformGate`/`Button`/`AppShell`/`LoadingScreen` remain correctly out of scope (R3F-mounting, voice-story territory, already-logic-tested, or trivial).

- [x] **Task 6 — Green the full suite (AC: #6)**
  - [x] `pnpm -r test` green. `tsc --noEmit` clean across workspaces. New tests run inside the existing `vitest run` — no new command, no separate CI step. → **client 238** (227 baseline + 11 new), **server 351**, **shared 136** all green; `pnpm -r typecheck` clean across all 3 workspaces; new tests run under the existing `vitest run` (no separate command/CI step).

> **No interactive human-verify gate.** Per [[human-verification-ac-rule]], that gate is for *user-visible / e2e-testable* feature stories. TD-1 is **developer-facing test infrastructure** — its "verification" is the green `pnpm -r test` + `tsc` in Task 6, not an observed Jay session. Done = AC #6 green and the convention documented.

## Dev Notes

### Scope discipline — what this story is and is NOT

- **IS:** the one-time wiring (deps + jsdom env + setup), the **mocking convention designed once deliberately** (socket + R3F stub), and a **bounded catch-up slice** — component tests for the three Epic-2 operator-world DOM flows (`Landing`, `Lobby`, `Preparation`).
- **IS NOT:** testing every one of the 11 `src/ui/` components, and **NOT** mounting the live R3F bomb scene / `DefuserView` / `BombScene` in a test (jsdom has no WebGL — that needs a stub, and scene rendering is verified by the existing scene-math unit tests + the human-verify checks in the 4.x stories). Writing component tests for *future* UI is per-feature work that rides along with each feature story from now on — this story just makes that cheap.

### Why now / why it matters

The debt is **invisible-until-it-bites**: the 221 green tests give false confidence that the UI is covered, when in fact no component's render or interaction is exercised. Every new UI story (3.4 speaker pill + mute, the rest of Epic 4/8 HUD) is adding more untested DOM. Wiring the framework is ~30–60 min; the value is making the *next* N UI stories testable by default and retiring the "we can't test that, no DOM" excuse.

### The R3F / jsdom wrinkle (read before Task 4)

jsdom implements DOM/HTML/events/`sessionStorage` but **not WebGL or canvas**. `@react-three/fiber`'s `<Canvas>` will throw or no-op in jsdom. So:
- The `src/ui/` components in Task 5 are plain DOM and mount fine.
- The moment a test mounts a tree that reaches `BombScene` / a `DefuserView` (R3F), it needs the `vi.mock('@react-three/fiber', …)` stub from Task 4. Design that stub now even though Task 5 doesn't need it — it's the part worth getting right once.

### Lower-risk alternative the dev may choose (document the decision)

This story specifies a **global `environment: 'jsdom'`** (simplest; jsdom is a node superset). If Task 3 surfaces a node-only test that misbehaves under jsdom and is awkward to fix, the per-file opt-in (`// @vitest-environment jsdom` docblock on component test files, leaving the global default at `node`) is an acceptable fallback — but prefer global and record the choice in Completion Notes either way.

### Files to touch

- **UPDATE** `apps/client/package.json` — 4 devDeps.
- **UPDATE** `apps/client/vite.config.ts` — add the `test` block (jsdom + setupFiles).
- **NEW** `apps/client/src/test/setup.ts` — jest-dom import + `afterEach(cleanup)`.
- **NEW** `apps/client/src/test/mockSocket.ts` (+ R3F stub snippet) — the mocking convention.
- **NEW** `apps/client/src/test/README.md` — the written-down convention (or JSDoc on the helpers).
- **NEW** `apps/client/src/ui/__tests__/Landing.test.tsx`, `Lobby.test.tsx`, `Preparation.test.tsx`.

Read before editing:
- `apps/client/vite.config.ts` — current config (no `test` block today).
- `apps/client/src/net/socket.ts` — `getSocket()` typed handle to mock; emits are typed `ClientToServerEvents` only (`socket.emit(string, any)` is forbidden — keep the mock typed).
- `apps/client/src/ui/Landing.tsx` — the `.timeout(ms).emit(EVENT, payload, ack)` pattern the socket mock must support.
- `apps/client/src/store/gameStore.ts` — seed store state via its API for Lobby/Preparation tests; don't reach into internals.
- `apps/client/src/voice/connectVoice.ts` — the `typeof document` DOM-guard to re-verify under jsdom (Task 3).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Client state:** Zustand — seed via the store API in tests; keep `voiceStore` separate from `gameStore`.
- **Socket.IO / Shared Types:** typed `ClientToServerEvents` only; the test socket mock must stay typed so `emit(string, any)` remains impossible.
- **R3F components are rendering-only:** if a `src/ui/` component needed logic-testing beyond DOM behaviour, that logic has leaked into the component — move it out rather than testing internals.
- **Build:** `tsc --noEmit` zero errors; no `@ts-ignore`; TypeScript only; separate `tsconfig.json` per workspace; devDeps confined to `apps/client`.

### Pre-existing note discovered while scoping this story

Master's `node_modules` was **stale** at baseline `d4fcb50` — `livekit-client` / `livekit-server-sdk` (merged in via the 3.1/3.2 worktrees) were in `pnpm-lock.yaml` but not installed, so `pnpm -r test` had 2 failing client suites + 2 failing server suites with `Cannot find package`. A root `pnpm install --frozen-lockfile` fixed it (client 221 / server 319 / shared 136 all green). This is the [[worktree-fullstack-testing-gap]] pattern (worktree merges leave the main checkout's install behind). Re-run a root install before starting if the suite isn't green. Not a code change — flagged so the dev doesn't chase it as a TD-1 regression.

## References

- [Source: apps/client/vite.config.ts] — current Vitest setup (default node env, no `test` block).
- [Source: apps/client/package.json] — Vitest 4, React 18; no `@testing-library/*`/`jsdom` today.
- [Source: _agent_docs/implementation-artifacts/3-2-bomb-room-bidirectional-channel.md] — the voice tests' DOM-guard pattern (`connectVoice.ts` is "DOM-optional"; re-verify under jsdom) and the worktree stale-install gotcha.
- [Source: _agent_docs/project-context.md#Socket.IO / Shared Types, #React / R3F Gotchas, #Build] — typed-events rule, R3F rendering-only rule, build constraints.
- [Ref: React Testing Library] — https://testing-library.com/docs/react-testing-library/intro/ (query-by-role/label/text; behaviour over internals).
- [Ref: Vitest jsdom environment] — https://vitest.dev/guide/environment (per-project `environment: 'jsdom'` + `// @vitest-environment` docblock fallback).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- `pnpm install` (root) — added `jsdom@29.1.1`, `@testing-library/react@16.3.2`, `@testing-library/user-event@14.6.1`, `@testing-library/jest-dom@6.9.1` to `apps/client` devDeps only; `pnpm -r typecheck` clean.
- `pnpm --filter @bomb-squad/client test` — under the new jsdom env, first run was **2 failed / 225 passed**: `connectVoice.test.ts` threw `Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'` because the faked `track.attach()` returned a plain object that jsdom's `document.body.appendChild` rejects (the `typeof document` guard in `connectVoice.ts:87` now takes the DOM branch). Fixed the test fake (real `document.createElement('audio')`); re-run **227/227**.
- New component files: `pnpm --filter @bomb-squad/client test src/ui/__tests__/{Landing,Lobby,Preparation}.test.tsx` → 11/11.
- Full suite: `pnpm -r test` → client **238**, server **351**, shared **136**, all green. `pnpm -r typecheck` clean.
- Benign: `Warning: --localstorage-file was provided without a valid path` — a jsdom-29/Node interaction, no effect on results.

### Completion Notes List

- **AC #1** — 4 test devDeps added to `apps/client` only (absent from `apps/server`/`packages/shared`); latest versions, Vitest-4/React-18 compatible; `tsc --noEmit` clean, no `@ts-ignore`.
- **AC #2** — `vite.config.ts` gains a `test` block (`environment: 'jsdom'`, `globals: true`, `setupFiles: ['./src/test/setup.ts']`) with a `/// <reference types="vitest/config" />`; `src/test/setup.ts` wires `@testing-library/jest-dom/vitest` matchers + `afterEach(cleanup)`.
- **AC #3** — chose the **global jsdom env** (story's recommended path; no per-file fallback was needed). All pre-existing tests pass under it: **227/227**. The spec's "221" predates the 2.6/2.7 merges (which added 6 client tests) — the real pre-TD-1 baseline is 227, and AC #3/#6's "all existing pass" is satisfied at 227. The flagged `connectVoice.ts` DOM-guard wrinkle materialized and was resolved in the **test fake** (not source — the source is correct; real LiveKit returns a real `HTMLAudioElement`).
- **AC #4** — mocking convention written once: `src/test/mockSocket.ts` (typed socket fake) + `src/test/fixtures.ts` (session/player/team factories) + `src/test/README.md` documenting the philosophy, the socket-mock pattern, and the `@react-three/fiber` stub pattern for future 3D-mounting tests.
- **AC #5** — 11 component tests across `Landing`/`Lobby`/`Preparation`: render-without-crash, the primary interaction per component asserted via accessible role/label/text + `user-event`, and the resulting typed socket emit (`SESSION_CREATE`/`SESSION_JOIN`/`TEAM_ASSIGN`/`ROUND_START`/`PREPARATION_CANCEL`). Plus negative/empty-state cases (no-session → renders null; missing-role → no emit).
- **AC #5 (extended in-ticket)** — +12 tests on two more pure-DOM, logic-bearing primitives flagged as existing test debt: `ConfirmButton` (the canonical two-step destructive pattern — incl. the fire-once-per-arming guard, Escape/Cancel disarm) and `ResolutionBanner` (win/loss/time-expired verdict branching + the timed hold→between-rounds transition, using fake timers). 23 component tests total.
- **AC #6** — full suite green inside the existing `vitest run` (no new command/CI step): client **250** / server 351 / shared 136; `pnpm -r typecheck` clean.
- **Scope held:** no live R3F/`DefuserView`/`BombScene` mounted in a test (the stub convention exists for when one is); only the three Epic-2 plain-DOM flows were tested, as scoped.
- **No human-verify gate** (dev-facing infra) — done = green `pnpm -r test` + `tsc`, per the story's stated exception to [[human-verification-ac-rule]].

### File List

- **UPDATE** `apps/client/package.json` — add `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` (devDeps).
- **UPDATE** `pnpm-lock.yaml` — lockfile for the new deps.
- **UPDATE** `apps/client/vite.config.ts` — add the `test` block (jsdom env + globals + setupFiles) and the `vitest/config` type reference.
- **NEW** `apps/client/src/test/setup.ts` — jest-dom matchers + `afterEach(cleanup)`.
- **NEW** `apps/client/src/test/mockSocket.ts` — typed `getSocket()` fake (`createMockSocket`).
- **NEW** `apps/client/src/test/fixtures.ts` — `makeSession`/`makePlayer`/`makeTeam`/`makeRoundConfig` factories.
- **NEW** `apps/client/src/test/README.md` — the documented mocking/testing convention (socket + R3F).
- **NEW** `apps/client/src/ui/__tests__/Landing.test.tsx` — 4 tests.
- **NEW** `apps/client/src/ui/__tests__/Lobby.test.tsx` — 3 tests.
- **NEW** `apps/client/src/ui/__tests__/Preparation.test.tsx` — 4 tests.
- **NEW** `apps/client/src/ui/__tests__/ConfirmButton.test.tsx` — 6 tests (in-ticket catch-up).
- **NEW** `apps/client/src/ui/__tests__/ResolutionBanner.test.tsx` — 6 tests (in-ticket catch-up; fake-timers pattern).
- **UPDATE** `apps/client/src/voice/__tests__/connectVoice.test.ts` — fake `track.attach()` now returns a real `HTMLAudioElement` (jsdom-compatible); source unchanged.

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-14 | Story TD-1 created (ready-for-dev): add client component-test framework (jsdom + React Testing Library + jest-dom + user-event), establish the socket + `@react-three/fiber` mocking convention once, and pay down the most valuable test-debt slice (Landing / Lobby / Preparation component tests). Confirmed at baseline: 221 client tests, all pure-logic, zero component renders; 11 `src/ui/` components untested; no DOM-testing deps installed. |
| 2026-06-14 | Implemented all 6 tasks (AC #1–#6): added the 4 test devDeps (client-only), wired the jsdom `test` block + `src/test/setup.ts`, established the mocking convention (`mockSocket.ts` + `fixtures.ts` + `README.md`), and added 11 component tests (Landing/Lobby/Preparation). Re-baselined existing tests 221→227 (2.6/2.7 merges); resolved the predicted `connectVoice` jsdom DOM-guard wrinkle in the test fake (source unchanged). Full suite green: client 238 / server 351 / shared 136; `tsc` clean. Status → review. |
| 2026-06-14 | In-ticket test-debt catch-up (post-review decision): +12 tests on `ConfirmButton` (two-step destructive pattern incl. fire-once guard + Escape/Cancel disarm) and `ResolutionBanner` (verdict branching + timed hold→between-rounds, fake-timers pattern). Client 238→**250**; server 351 / shared 136 unchanged; `tsc` clean. 23 component tests total. |
