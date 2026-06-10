---
baseline_commit: 8359ac5dd4a73338883cce994ae5d903575d2253
---

# Story 1.1: Monorepo & Build Scaffold

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a pnpm-workspace monorepo with `packages/shared`, `apps/client`, and `apps/server` and a strict TypeScript build,
so that all later work has a consistent, type-safe foundation with clean dependency boundaries.

## Acceptance Criteria

1. **Workspace resolves with per-workspace tsconfig + pure shared package.** Running `pnpm install` from the repo root resolves the three workspaces (`packages/shared`, `apps/client`, `apps/server`), each with its own `tsconfig.json`. `packages/shared` has **zero runtime dependencies** on `react`, `socket.io`/`socket.io-client`, `fastify`, `ioredis`, `pg`, or any client/server framework (verified by inspecting `packages/shared/package.json`).
2. **Strict type-check passes and is a pre-commit gate.** `pnpm -r exec tsc --noEmit` completes with **zero errors** across all workspaces, the same command is wired as a **pre-commit hook**, and the codebase contains **no `// @ts-ignore`**.
3. **Client dev server runs a placeholder shell.** Running the client workspace's dev script starts the **Vite** dev server with HMR and native ESM and renders a minimal placeholder app shell in the browser.

## Tasks / Subtasks

- [x] **Task 1 — Workspace root & topology (AC: 1)**
  - [x] Create root `package.json` with `"private": true`, `"packageManager": "pnpm@10.30.1"`, an `"engines": { "node": ">=20 <21" }` field (Architecture pins **Node 20 LTS** — see guardrail), and root scripts (`typecheck`, `build`, `dev`, `test`).
  - [x] Create `pnpm-workspace.yaml` listing `packages/*` and `apps/*`.
  - [x] Create the directory skeleton exactly per the Architecture project structure: `packages/shared/src/{types,events,modules,seeding,__tests__}`, `apps/client/src/`, `apps/server/src/`. Use `.gitkeep` for otherwise-empty dirs that later stories fill — **do not** pre-implement their contents (those belong to Stories 1.2–1.8).
  - [x] Add `.env.example` at root (placeholder keys only — never real secrets; `.env` must stay git-ignored).
- [x] **Task 2 — `packages/shared` as pure TypeScript (AC: 1)**
  - [x] Create `packages/shared/package.json` named `@bomb-squad/shared`, `"type": "module"`, with a `build` (`tsc`) and `test` script. **Dependencies must be empty** of react/socket.io/fastify/ioredis/pg/any framework — pure TS only (dev-only `typescript` is fine).
  - [x] Add a minimal `packages/shared/src/index.ts` (e.g. `export const SHARED_PACKAGE = '@bomb-squad/shared';`) so the package builds; real types/events/seeding land in Stories 1.2/1.3.
- [x] **Task 3 — Per-workspace strict tsconfig + typecheck gate (AC: 2)**
  - [x] Give **each** workspace its own complete `tsconfig.json` with `strict: true` — **do NOT create a single shared root tsconfig that packages extend** (project-context rule). Client config targets DOM + React JSX; server + shared target Node ESM.
  - [x] Ensure `pnpm -r exec tsc --noEmit` passes with zero errors.
  - [x] Install and configure **Husky** (`pnpm dlx husky init`) with a `.husky/pre-commit` hook that runs `pnpm -r exec tsc --noEmit`. Add `husky` as a root dev dependency and a `"prepare": "husky"` script.
- [x] **Task 4 — `apps/client` Vite + placeholder shell (AC: 3)**
  - [x] Create `apps/client/package.json` named `@bomb-squad/client`, `"type": "module"`, with `dev` (`vite`), `build` (`tsc && vite build`), scripts; deps: `react@^18.3`, `react-dom@^18.3`; devDeps: `vite@^6`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`.
  - [x] Create `apps/client/vite.config.ts` (TypeScript, React plugin) and `apps/client/index.html` (ESM entry to `/src/main.tsx`).
  - [x] Create `apps/client/src/main.tsx` + `App.tsx` rendering a minimal placeholder shell (e.g. "Bomb Squad — booting…"). No game logic, no Three.js, no socket — those are later stories.
- [x] **Task 5 — `apps/server` build target placeholder (AC: 1, 2)**
  - [x] Create `apps/server/package.json` named `@bomb-squad/server`, `"type": "module"`, with a `dev` script (e.g. `tsx watch src/index.ts` or `node --watch`) and `build` (`tsc`). **No Fastify/Socket.IO bootstrap yet** — that is Story 1.4. Provide a placeholder `src/index.ts` (e.g. a `console.log('server placeholder')`) that type-checks.
- [x] **Task 6 — Verify end-to-end (AC: 1, 2, 3)**
  - [x] `pnpm install` from a clean clone resolves all three workspaces.
  - [x] `pnpm -r exec tsc --noEmit` → zero errors; staged commit triggers the hook.
  - [x] Client `dev` script serves the placeholder shell with HMR; editing `App.tsx` hot-reloads.

## Dev Notes

### Scope discipline (read first)
This story scaffolds **structure and the build/type-check gate only**. It deliberately does **not** implement: shared types/events (Story 1.2), the seed utility (1.3), the Fastify+Socket.IO server (1.4), Redis/Postgres adapters (1.5), the reducer core (1.6), the client socket/Zustand wiring (1.7), or Docker Compose (1.8). Create directory placeholders, not implementations. Avoid scope creep — ESLint/Prettier are not required by the ACs (a later concern).

### Target project structure (authoritative — build exactly this)
From the Architecture "Project Structure" section. The relevant subset for this story:
```
bomb-squad/                 (= repo root, current /home/jiawei/Ktane)
├── package.json            # pnpm workspace root (private)
├── pnpm-workspace.yaml
├── .env.example            # never commit real secrets
├── .husky/pre-commit       # runs: pnpm -r exec tsc --noEmit
├── packages/
│   └── shared/             # PURE TypeScript — zero react/socket.io/server deps
│       ├── package.json    # @bomb-squad/shared
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── types/      # (placeholder — filled in 1.2)
│           ├── events/     # (placeholder — filled in 1.2)
│           ├── modules/    # (placeholder)
│           ├── seeding/    # (placeholder — filled in 1.3)
│           └── __tests__/
└── apps/
    ├── client/
    │   ├── package.json    # @bomb-squad/client
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── index.html
    │   └── src/{main.tsx, App.tsx}
    └── server/
        ├── package.json    # @bomb-squad/server
        ├── tsconfig.json
        └── src/index.ts    # placeholder (Fastify bootstrap is Story 1.4)
```
[Source: game-architecture.md#Project Structure]

### Critical guardrails (project-context + architecture rules)
- **Node 20 LTS is the pinned target** [Source: game-architecture.md#Decision Summary]. The local machine reports Node **v25.6.1**, which does **not** match. Set `engines.node` to `>=20 <21`, and the dev should use Node 20 (e.g. `nvm use 20`) for parity with CI/deploy. Do not silently build on Node 25.
- **`packages/shared` is pure TypeScript — zero runtime deps on react/socket.io/any framework.** This is a hard architectural boundary; it exists so shared types can be imported by both client and server without pulling frameworks across the boundary. [Source: project-context.md#Code Organization Rules; game-architecture.md#Consistency Rules]
- **Per-workspace tsconfig — do NOT share a single root tsconfig.** [Source: project-context.md#Build Configuration] Each of the three workspaces owns a complete `tsconfig.json`.
- **TypeScript throughout — no JavaScript files.** `vite.config.ts`, not `.js`. [Source: project-context.md#Technology Stack]
- **`tsc --noEmit` must pass with zero errors before any commit; no `// @ts-ignore`.** This is why AC2 wires it as a pre-commit hook. [Source: project-context.md#Build Configuration]
- **Secrets only via `.env` (never committed).** This story adds `.env.example` with placeholders; real `.env` stays git-ignored. [Source: game-architecture.md#Security Architecture] Note: current `.gitignore` ignores `.claude/` and `_bmad/` and OS/editor cruft but **does not yet ignore `.env` or `node_modules/`** — add both in this story.
- **Naming:** workspace package names use the `@bomb-squad/*` scope (matches `pnpm --filter @bomb-squad/shared` usage in the Architecture setup commands). [Source: game-architecture.md#Development Environment]

### Version guidance (pin these)
- **pnpm 10.30.1** (already installed; set as `packageManager`).
- **React 18.3.x** — project-context pins React 18; do **not** use React 19 even though it exists. [Source: project-context.md#Technology Stack]
- **Vite 6.x** + `@vitejs/plugin-react` — settled client bundler (fast HMR, native ESM, good R3F support later). [Source: game-architecture.md#Decision Summary]
- **TypeScript 5.x** (latest stable 5.7+), `strict: true`.
- **Husky 9.x** for the pre-commit hook (`pnpm dlx husky init` then edit `.husky/pre-commit`).
- Server `dev` runner: `tsx` (devDep) is the simplest watch runner for a TS entry; final server runtime decisions belong to Story 1.4 — keep this minimal.

### Testing standards summary
- No feature tests required for this scaffold story. The gate is `pnpm -r exec tsc --noEmit` (zero errors) plus a successful `pnpm install` and a running client dev server.
- Establish the test *locations* implicitly via the directory skeleton (`packages/shared/src/__tests__/`), but writing tests is deferred — the seed utility (1.3) is the first story with real unit tests (Jest, Node, zero infra). [Source: game-architecture.md#Testing Architecture]
- Do **not** add a test runner config beyond what later stories need; Jest setup can land with Story 1.3 or 1.6 where the first pure-logic tests appear.

### Project Structure Notes
- Repo root `/home/jiawei/Ktane` **is** the `bomb-squad/` root in the Architecture diagram — scaffold directly here; do not nest a `bomb-squad/` subfolder.
- `.claude/` and `_bmad/` are tooling and already git-ignored; `_agent_docs/` holds planning/implementation artifacts and is not part of the app build — keep workspaces under `packages/` and `apps/` only.
- No conflicts with existing code (greenfield: only `README.md`, `.gitignore`, tooling dirs present).

### Project Context Rules
Extracted from `project-context.md` as binding constraints for this story:
- Monorepo via **pnpm workspaces**; `packages/shared` for shared types/events/module interfaces, pure TS.
- TypeScript everywhere; **separate `tsconfig.json` per workspace** (no single shared root tsconfig).
- **Vite** for client bundling; `tsc --noEmit` zero-error gate before commit; no `// @ts-ignore`.
- Environment variables via `.env` files, never committed; never hardcode secrets.
- (Forward-looking, not implemented here but shaping the structure): server uses pure reducers with zero infra imports (1.6); all Socket.IO events typed in `packages/shared/src/events/` (1.2); client uses Zustand + R3F (1.7+). Keep the scaffold clean so these drop in additively.
- No MCP servers required by the architecture for this story.

### References
- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.1: Monorepo & Build Scaffold]
- [Source: _agent_docs/game-architecture.md#Project Structure]
- [Source: _agent_docs/game-architecture.md#Decision Summary] (Node 20 LTS, Vite, React 18, pnpm)
- [Source: _agent_docs/game-architecture.md#Development Environment] (`pnpm --filter @bomb-squad/*` setup commands)
- [Source: _agent_docs/game-architecture.md#Consistency Rules → Code Organization]
- [Source: _agent_docs/project-context.md#Technology Stack & Versions]
- [Source: _agent_docs/project-context.md#Code Organization Rules]
- [Source: _agent_docs/project-context.md#Platform & Build Rules → Build Configuration]

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
- esbuild build scripts blocked by pnpm security by default → resolved by adding `pnpm.onlyBuiltDependencies: ["esbuild"]` to root package.json; required for Vite to function.
- `pnpm -r exec tsc --noEmit` triggers Node engine warning (v25.6.1 vs required >=20 <21) but exits 0 — expected per story guardrail note; no fix needed here.

### Completion Notes List
- Scaffolded full pnpm workspace monorepo: root + `packages/shared` + `apps/client` + `apps/server`.
- `packages/shared/package.json` has zero runtime framework dependencies (verified: only `typescript` devDep).
- All three workspaces have independent `tsconfig.json` with `strict: true`; no shared root tsconfig.
- Husky 9.1.7 installed; `.husky/pre-commit` runs `pnpm -r exec tsc --noEmit` — verified exit 0.
- Vite v6.4.3 dev server starts in ~140ms, serves placeholder shell with HMR and native ESM.
- `apps/server/src/index.ts` is a console.log placeholder; Fastify/Socket.IO is Story 1.4.
- Directory skeleton (`.gitkeep` placeholders) created for: `packages/shared/src/{types,events,modules,seeding,__tests__}`.
- Node 20 LTS is the pinned `engines.node` target; local machine runs v25.6.1 — use `nvm use 20` for CI parity.

### File List
- package.json
- pnpm-workspace.yaml
- pnpm-lock.yaml
- .env.example
- .husky/pre-commit
- packages/shared/package.json
- packages/shared/tsconfig.json
- packages/shared/src/index.ts
- packages/shared/src/types/.gitkeep
- packages/shared/src/events/.gitkeep
- packages/shared/src/modules/.gitkeep
- packages/shared/src/seeding/.gitkeep
- packages/shared/src/__tests__/.gitkeep
- apps/client/package.json
- apps/client/tsconfig.json
- apps/client/vite.config.ts
- apps/client/index.html
- apps/client/src/main.tsx
- apps/client/src/App.tsx
- apps/server/package.json
- apps/server/tsconfig.json
- apps/server/src/index.ts

## Change Log
- 2026-06-10: Story 1.1 implemented — pnpm monorepo scaffold with packages/shared, apps/client (Vite+React), apps/server (placeholder); per-workspace strict tsconfigs; Husky pre-commit typecheck gate; all ACs verified.

## Review Findings

_Code review 2026-06-10 (commit 87c6e78). 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 3 ACs PASS with runtime evidence: clean `pnpm install`, `tsc --noEmit` exit 0, live Vite dev server with HMR + native ESM, husky pre-commit gate fires and passes. No scope creep into 1.2–1.8._

- [x] [Review][Patch] `pnpm -r test` is a false-green gate — client & server have no `test` script [apps/client/package.json, apps/server/package.json] — FIXED: added explicit placeholder `test` scripts to client and server; `pnpm -r test` now runs all 3 of 3 workspaces (was 1 of 3).
- [x] [Review][Defer] `@bomb-squad/shared` exposes raw `./src/index.ts` as `main`/`exports` rather than built `dist` [packages/shared/package.json] — deferred. No consumers yet (verified unexercised); works for tsx/Vite/Bundler but the server's `tsc`+NodeNext build will need a real entrypoint strategy. Decide raw-TS-source vs built-`dist`+conditional-`exports` when Story 1.2 wires the first consumer.
- [x] [Review][Defer] `vite.config.ts` is in the client typecheck graph without `@types/node` [apps/client/tsconfig.json, apps/client/package.json] — deferred. Passes today (config uses no Node globals); fragile the moment it references `path`/`process`. Add `@types/node` + a `tsconfig.node.json` split when the Vite config grows.

_Dismissed as noise (7), all empirically refuted by running the toolchain: husky shebang (hook verified wired + passing via `.husky/_` wrapper), tsc-per-workspace resolution (exit 0), client `build` `tsc` against `noEmit:true` (intended typecheck gate; `vite build` emits correctly), `.env.example` formatting (review-prompt compression artifact — real file is newline-separated), `main.tsx` `import './App.js'` (verified works + idiomatic under Bundler resolution), `engines.node ">=20 <21"` (intentional Node 20 LTS pin per spec), `onlyBuiltDependencies:["esbuild"]` (verified complete for current dep set)._
