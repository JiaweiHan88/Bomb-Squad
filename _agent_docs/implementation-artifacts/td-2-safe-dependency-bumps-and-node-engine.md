---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - package.json
---

# Story TD-2: Safe Dependency Bumps + Node Engine Alignment

Status: ready-for-dev

<!-- Tech-debt story (not from an epic). The low-risk slice of the dependency-refresh
     batch (TD-2 safe / TD-3 React+R3F / TD-4 tooling). Patch/minor bumps only + fixing
     the Node engine mismatch that nags on every pnpm command. No major versions here. -->

## Story

As a developer on this repo,
I want the safe (patch/minor) dependency updates applied and the Node engine declaration reconciled with reality,
so that we stay current on low-risk fixes and stop the `Unsupported engine` warning on every pnpm command — without touching any major version that needs a coordinated migration.

## Context — verified 2026-06-14 (`pnpm outdated -r`)

Only the **non-breaking** updates belong here. The major-version jumps are split into [[td-3-react-19-and-r3f-upgrade]] (React 19 + R3F) and [[td-4-tooling-vite-typescript-jest]] (Vite / TypeScript / Jest) — **do not** touch those in this story.

Safe bumps in scope:

| Package | Current | Latest | Workspace | Kind |
|---|---|---|---|---|
| `tailwindcss` | 4.3.0 | 4.3.1 | client (dev) | patch |
| `@tailwindcss/vite` | 4.3.0 | 4.3.1 | client (dev) | patch |
| `typebox` | 1.2.8 | 1.2.10 | server | patch |

Separately, an **environment mismatch**: root `package.json` declares `"engines": { "node": ">=20 <21" }` but the dev host runs **Node v25**, so every `pnpm` invocation prints `WARN Unsupported engine`. The codebase has been developed and tested green on v25 (client 221 / server 319 / shared 136), so the declared range is stale, not the host.

## Acceptance Criteria

1. **Given** the safe-bump set, **When** the updates are applied, **Then** `tailwindcss` and `@tailwindcss/vite` are at `4.3.1` (client devDeps) and `typebox` is at `1.2.10` (server), the bumps are reflected in the relevant `package.json` files and `pnpm-lock.yaml` via a root `pnpm install`, and **no major version** (`react*`, `@react-three/*`, `camera-controls`, `vite`, `@vitejs/plugin-react`, `typescript`, `jest*`, `@jest/*`, `@types/jest`) is changed.
2. **Given** the Node engine mismatch, **When** it is reconciled, **Then** the root `package.json` `engines.node` range is updated to include the version the project actually builds and tests on (Node 25), the decision (and the supported floor) is recorded in the story, and `pnpm install` no longer prints `WARN Unsupported engine` on the dev host. Any per-workspace `engines` fields are aligned the same way.
3. **Given** the full suite, **When** `pnpm -r test` and `pnpm -r typecheck` run after the bumps, **Then** all workspaces stay green (client `221`, server `319`, shared `136`) and `tsc --noEmit` is clean across all three with no `@ts-ignore`.
4. **Given** the bumps are patch/minor, **When** the changelogs are skimmed, **Then** there is a one-line confirmation per package that the update carries no breaking change relevant to our usage (TypeBox is on the server's validation path; Tailwind 4.3.x is a patch). If any bump unexpectedly breaks the build or tests, it is **dropped from this story** and re-filed, rather than worked around.

## Tasks / Subtasks

- [ ] **Task 1 — Apply the safe bumps (AC: #1, #4)**
  - [ ] Update `apps/client/package.json` devDeps: `tailwindcss` and `@tailwindcss/vite` → `^4.3.1`.
  - [ ] Update `apps/server/package.json`: `typebox` → `^1.2.10`.
  - [ ] `pnpm install` from the **repo root** (pnpm workspaces — never install in a sub-package cwd; see [[worktree-fullstack-testing-gap]]). Confirm `pnpm-lock.yaml` updated and **no major-version package moved** (`git diff pnpm-lock.yaml` sanity check).
  - [ ] Skim each package's changelog for the bumped range; record the one-line "no breaking change for us" note in Completion Notes (AC #4).

- [ ] **Task 2 — Reconcile the Node engine range (AC: #2)**
  - [ ] Decide the supported range. The project builds/tests green on Node 25; pick a forward range (e.g. `>=20`) rather than pinning a single major, unless there is a known reason to cap. Record the decision + rationale in Completion Notes.
  - [ ] Update root `package.json` `engines.node` and any per-workspace `engines` to match. Re-run `pnpm install` and confirm the `WARN Unsupported engine` line is gone on the dev host.
  - [ ] Note: this only changes the *declared* support range; it does not pin/install a Node version. If the project later wants a hard floor, that's a separate `.nvmrc`/CI decision (out of scope).

- [ ] **Task 3 — Verify green (AC: #3)**
  - [ ] `pnpm -r typecheck` clean (no `@ts-ignore`); `pnpm -r test` green (client 221 / server 319 / shared 136). Record counts in Completion Notes.

## Dev Notes

- **Scope discipline:** patch/minor + the engine field **only**. If you find yourself editing a `react`, `vite`, `typescript`, or `jest` version, you're in the wrong story (TD-3 / TD-4). The whole point of splitting these out is that this one is a near-zero-risk "keep green, stop the nag" change.
- **TypeBox** is on the server's runtime validation path (env/payload schemas) — the only safe bump here that touches runtime rather than build tooling, hence the explicit "skim changelog" check. A patch bump (1.2.8 → 1.2.10) should be transparent.
- **Tailwind 4.3.0 → 4.3.1** is a patch on the v4 engine; both the plugin and the core must move together (they're a pair).
- **Engine range:** the host is Node v25 and everything is green there, so the `<21` cap is simply stale. Widening it is the fix; do not downgrade the host. ([[timer-verification-tsx-watch-gotcha]] and other infra memories assume the current host.)
- **No human-verify gate** — developer-facing dependency hygiene; done = AC #3 green (`pnpm -r test` + `tsc`). ([[human-verification-ac-rule]] gate is for user-visible/e2e feature stories, not dep bumps.)

### Files to touch
- **UPDATE** `apps/client/package.json` — `tailwindcss`, `@tailwindcss/vite` → `^4.3.1`.
- **UPDATE** `apps/server/package.json` — `typebox` → `^1.2.10`.
- **UPDATE** root `package.json` — `engines.node` range; check per-workspace `engines` too.
- **UPDATE** `pnpm-lock.yaml` — root install.

## References
- [Source: `pnpm outdated -r` @ 2026-06-14] — the outdated set; this story = the patch/minor rows only.
- [Source: package.json] — root `engines.node: ">=20 <21"` vs host Node v25.
- [Source: _agent_docs/project-context.md#Build] — `tsc --noEmit` clean, no `@ts-ignore`, TS-only, per-workspace tsconfig.
- Related: [[td-3-react-19-and-r3f-upgrade]], [[td-4-tooling-vite-typescript-jest]] — the major-version slices, explicitly out of scope here.

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-2 created (ready-for-dev): safe patch/minor bumps (tailwindcss + @tailwindcss/vite 4.3.0→4.3.1, typebox 1.2.8→1.2.10) and Node engine range reconciliation (declared `<21` vs green-on-v25 host). Major versions explicitly excluded → TD-3 / TD-4. |
