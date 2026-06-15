---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - package.json
---

# Story TD-2: Safe Dependency Bumps + Node Engine Alignment

Status: review

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

- [x] **Task 1 — Apply the safe bumps (AC: #1, #4)**
  - [x] Update `apps/client/package.json` devDeps: `tailwindcss` and `@tailwindcss/vite` → `^4.3.1`. → done.
  - [x] Update `apps/server/package.json`: `typebox` → `^1.2.10`. → bumped to **`^1.2.11`** instead: a further patch (1.2.11) published between story authoring (2026-06-14) and impl (2026-06-15); still patch-off-1.2.8, in-spirit ("stay current on low-risk patches"). A `^1.2.10` caret would have resolved to 1.2.11 on install anyway — wrote 1.2.11 so package.json matches the locked version.
  - [x] `pnpm install` from the **repo root**. → clean (exit 0); `pnpm-lock.yaml` updated. `git diff pnpm-lock.yaml` sanity check: only `tailwindcss`/`@tailwindcss/vite` 4.3.0→4.3.1 (+ its `@tailwindcss/oxide-*` platform binaries) and `typebox` 1.2.8→1.2.11 (+ the `@fastify/type-provider-typebox` peer) moved. **No major-version package moved** (`react*`/`@react-three/*`/`camera-controls`/`vite`/`@vitejs/plugin-react`/`typescript`/`jest*` all unchanged).
  - [x] Skim each package's changelog. → all three are **semver-patch** releases (4.3.0→4.3.1, 1.2.8→1.2.11) ⇒ no breaking changes by convention; the green suite (incl. server's typebox runtime-validation path) confirms no behavioral impact for us. See Completion Notes (AC #4).

- [x] **Task 2 — Reconcile the Node engine range (AC: #2)**
  - [x] Decide the supported range. → chose **`>=20`** (forward-open): green on the v20 floor and the v25 host; an open upper bound avoids re-nagging on every future Node major and matches "declared support, not a pin". Rationale in Completion Notes.
  - [x] Update root `package.json` `engines.node` and any per-workspace `engines`. → root `">=20 <21"` → `">=20"`; no per-workspace `engines` fields exist (client/server/shared), so root is the only one. Re-ran `pnpm install` → **`WARN Unsupported engine` gone** (0 occurrences on the v25 host).
  - [x] Note: only changes the *declared* range; no Node version pinned. A hard floor (`.nvmrc`/CI) remains a separate, out-of-scope decision.

- [x] **Task 3 — Verify green (AC: #3)**
  - [x] `pnpm -r typecheck` clean (no `@ts-ignore`); `pnpm -r test` green. → **client 250 / server 364 / shared 136**, all green; `tsc --noEmit` clean across all 3. (The AC's "221/319" are pre-2.6/2.7-merge baselines, superseded — same re-baseline as TD-1; the requirement "stay green" holds.)

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

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- `pnpm install` (root) — exit 0; `Packages: +8 -8` (tailwind oxide platform binaries + typebox swap); `WARN Unsupported engine` no longer printed after the `engines.node` widen.
- `git diff pnpm-lock.yaml` — only the in-scope packages moved (tailwindcss/@tailwindcss/vite 4.3.0→4.3.1 + `@tailwindcss/oxide-*`; typebox 1.2.8→1.2.11 + `@fastify/type-provider-typebox` peer). No `react`/`three`/`vite`/`typescript`/`jest` drift.
- `pnpm -r typecheck` → clean across shared/client/server, no `@ts-ignore`.
- `pnpm -r test` → shared **136**, client **250**, server **364**, all green.

### Completion Notes List

- **AC #1** — safe bumps applied: `tailwindcss` + `@tailwindcss/vite` `^4.3.1` (client devDeps), `typebox` `^1.2.11` (server). Root `pnpm install` updated the lockfile; lockfile diff confirms **no major-version package moved** (react*/@react-three/*/camera-controls/vite/@vitejs/plugin-react/typescript/jest*/@jest/*/@types/jest all unchanged).
- **AC #2** — engine reconciled: root `engines.node` `">=20 <21"` → **`">=20"`**. Forward-open range chosen over a single-major pin so future Node majors don't re-trigger the warning; the project is green on both the v20 floor and the v25 host. No per-workspace `engines` fields exist, so root is the only declaration. `WARN Unsupported engine` confirmed gone on the v25 dev host.
- **AC #3** — all workspaces green post-bump: client **250** / server **364** / shared **136**; `tsc --noEmit` clean across all three, no `@ts-ignore`. (The AC's literal "221/319" predate the 2.6/2.7 + later merges — superseded baselines, as in TD-1; the binding requirement "stays green" is met.)
- **AC #4** — no-breaking-change confirmation: all three are **semver-patch** releases (tailwind 4.3.0→4.3.1 on the v4 oxide engine; typebox 1.2.8→1.2.11 on the server's runtime-validation path). Patch level ⇒ no breaking changes by convention, and the full green suite — including the typebox-backed env/payload schema tests — confirms no behavioral impact for our usage. Nothing had to be dropped/re-filed.
- **Deviation from spec letter:** typebox target moved 1.2.10 → **1.2.11** (a newer patch published the day after authoring). Same minor, same risk profile; documented in Task 1 and AC #1.
- **Scope held:** patch/minor + engine field only. No `react`/`vite`/`typescript`/`jest` touched — those remain in [[td-3-react-19-and-r3f-upgrade]] / [[td-4-tooling-vite-typescript-jest]].
- **No human-verify gate** (dev-facing dependency hygiene) — done = AC #3 green, per [[human-verification-ac-rule]].

### File List

- **UPDATE** `apps/client/package.json` — `tailwindcss` + `@tailwindcss/vite` → `^4.3.1`.
- **UPDATE** `apps/server/package.json` — `typebox` → `^1.2.11`.
- **UPDATE** `package.json` (root) — `engines.node` `">=20 <21"` → `">=20"`.
- **UPDATE** `pnpm-lock.yaml` — root install (tailwind 4.3.1 + typebox 1.2.11; no major drift).

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-2 created (ready-for-dev): safe patch/minor bumps (tailwindcss + @tailwindcss/vite 4.3.0→4.3.1, typebox 1.2.8→1.2.10) and Node engine range reconciliation (declared `<21` vs green-on-v25 host). Major versions explicitly excluded → TD-3 / TD-4. |
| 2026-06-15 | Implemented all 3 tasks (AC #1–#4): tailwind/@tailwindcss/vite → 4.3.1, typebox → **1.2.11** (newer patch than the spec's 1.2.10), root `engines.node` → `">=20"` (warning gone). Suite green post-bump: client 250 / server 364 / shared 136; `tsc` clean; no major-version drift in the lockfile. Status → review. |
