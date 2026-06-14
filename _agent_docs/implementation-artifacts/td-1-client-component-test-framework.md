---
baseline_commit: d4fcb50
context:
  - _agent_docs/project-context.md
  - apps/client/vite.config.ts
  - apps/client/package.json
---

# Story TD-1: Client Component Test Framework + Test-Debt Catch-Up

Status: ready-for-dev

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

- [ ] **Task 1 — Add the component-testing devDeps to the client (AC: #1)**
  - [ ] Add `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` to `apps/client/package.json` **devDependencies**, then `pnpm install` from the **repo root** (pnpm workspaces — never install into a sub-package cwd; see [[worktree-fullstack-testing-gap]]).
  - [ ] Confirm none of the four land in `apps/server` or `packages/shared` package.json. Run `pnpm -r typecheck` — clean, no `@ts-ignore`.

- [ ] **Task 2 — Wire the jsdom environment + setup file (AC: #2)**
  - [ ] Add a `test` block to `apps/client/vite.config.ts`: `environment: 'jsdom'`, `globals: true` (optional — decide and document), `setupFiles: ['./src/test/setup.ts']`. Reference the Vitest config types (`import { defineConfig } from 'vitest/config'` or the triple-slash reference) so `test` is type-checked.
  - [ ] Create `apps/client/src/test/setup.ts` → `import '@testing-library/jest-dom'` + `afterEach(() => cleanup())` from `@testing-library/react`.

- [ ] **Task 3 — Regression-guard the existing 221 tests under jsdom (AC: #3)**
  - [ ] Run `pnpm --filter @bomb-squad/client test`; confirm **221/221** still pass. jsdom is a superset, so node-only logic tests should be unaffected.
  - [ ] **Specifically re-check `connectVoice.ts`** — it has a `typeof document !== 'undefined'` guard around attaching `<audio>` to `document.body`. Under jsdom that branch now executes in tests. Confirm `connectVoice.test.ts` / `requestVoiceToken.test.ts` still pass and don't leak audio elements between tests (the `afterEach(cleanup)` + the existing teardown should cover it; add a guard if not). Note any test that asserted DOM-absent behaviour and fix it in place.

- [ ] **Task 4 — Establish + document the mocking convention (AC: #4)**
  - [ ] **Socket:** add a small helper (e.g. `src/test/mockSocket.ts`) that `vi.mock('../net/socket')`s `getSocket()` to return a fake with `emit`/`on`/`timeout().emit` spies, mirroring the real typed surface used by the UI (`Landing.tsx` uses `.timeout(ms).emit(EVENT, payload, ack)` — the fake must support that ack shape). Keep it typed against `ClientToServerEvents` so `socket.emit(string, any)` stays forbidden even in tests.
  - [ ] **R3F:** document (and provide a reusable `vi.mock('@react-three/fiber', …)` snippet) the convention for any component that transitively imports the bomb scene — stub `Canvas`/hooks so the tree renders in jsdom without WebGL. (Not exercised by Task 5's pure-DOM components, but the convention must exist before anyone mounts a 3D surface — design it once here.)
  - [ ] Write the convention down: a short `apps/client/src/test/README.md` (or top-of-file JSDoc on the helpers) so future UI stories follow one pattern, not N.

- [ ] **Task 5 — Catch-up component tests: Landing, Lobby, Preparation (AC: #5)**
  - [ ] `Landing.test.tsx` — renders; user types a name and clicks Join/Host; assert the correct typed socket emit (`SESSION_JOIN` / `SESSION_CREATE`) fires with the expected payload (mirror the `Landing.tsx:~150` `.timeout().emit` path). Cover the obvious validation/disabled-button state.
  - [ ] `Lobby.test.tsx` — renders the roster from a seeded `gameStore`; assert a primary facilitator/player interaction surfaces the right emit or UI state (pick the load-bearing one — e.g. ready toggle / role pick / start gating) via accessible queries.
  - [ ] `Preparation.test.tsx` — renders the preparation view from store state; assert the primary control's behaviour through the DOM.
  - [ ] All three: query by **role/label/text**, drive interactions with `@testing-library/user-event`, mock the socket via the Task 4 helper, seed `gameStore` via its existing API (do not reach into internals). Assert user-visible behaviour, not props/state.

- [ ] **Task 6 — Green the full suite (AC: #6)**
  - [ ] `pnpm -r test` green (client 221 + new; server 319; shared 136). `tsc --noEmit` clean across workspaces. New tests run inside the existing `vitest run` — no new command, no separate CI step.

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

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-14 | Story TD-1 created (ready-for-dev): add client component-test framework (jsdom + React Testing Library + jest-dom + user-event), establish the socket + `@react-three/fiber` mocking convention once, and pay down the most valuable test-debt slice (Landing / Lobby / Preparation component tests). Confirmed at baseline: 221 client tests, all pure-logic, zero component renders; 11 `src/ui/` components untested; no DOM-testing deps installed. |
