---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - package.json
---

# Story TD-4: Build & Test Tooling Upgrade — Vite 8, TypeScript 6, Jest 30

Status: ready-for-dev

<!-- Tech-debt story (not from an epic). The build/test-tooling slice of the dependency
     refresh batch (TD-2 safe / TD-3 React+R3F / TD-4 tooling). Major-version dev-tooling
     bumps that don't ship runtime code: Vite 6→8 (+plugin-react), TypeScript 5→6, Jest 29→30. -->

## Story

As a developer on this repo,
I want the build and test tooling upgraded to current majors — Vite 8 (+ `@vitejs/plugin-react` 6), TypeScript 6, and Jest 30 — across the workspaces that use them,
so that our dev/build/test toolchain stays supported and we get the newer compiler/bundler/test-runner fixes, done as a tooling-only change that ships no runtime behavior.

## Context — verified 2026-06-14 (`pnpm outdated -r`)

| Package | Current | Latest | Workspace(s) | Notes |
|---|---|---|---|---|
| `vite` | 6.4.3 | 8.0.x | client (dev) | client bundler/dev server |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.x | client (dev) | pairs with Vite major |
| `typescript` | 5.9.3 | 6.0.x | **all 3** workspaces (dev) | new compiler major — may surface stricter checks |
| `jest` | 29.7.0 | 30.4.x | server + shared (dev) | server/shared test runner |
| `@jest/globals` | 29.7.0 | 30.4.x | server (dev) | must match `jest` major |
| `@types/jest` | 29.5.x | 30.0.x | server + shared (dev) | must match `jest` major |

Three independent sub-upgrades, all **dev-tooling only** (no runtime dependency ships): (a) **Vite 8** + plugin (client only — `apps/client` uses Vite/Vitest), (b) **TypeScript 6** (all three workspaces — separate `tsconfig.json` per workspace), (c) **Jest 30** (server + shared only — `apps/client` uses Vitest, not Jest, so it is untouched by the Jest bump). They can land in one story or be split into sub-tasks; each must independently keep its suite green.

## Acceptance Criteria

1. **Given** the Vite upgrade, **When** applied, **Then** `vite` is on **8.x** and `@vitejs/plugin-react` on **6.x** in `apps/client` (matched majors), the client **builds** (`pnpm --filter @bomb-squad/client build`), the **dev server** starts, and the **Vitest** client suite stays green (Vitest 4 must remain compatible with Vite 8 — confirm/bump if needed). Vite-config breaking changes (`apps/client/vite.config.ts`, incl. the `allowedHosts`/`preview` settings and — if TD-1 merged — the `test` block) are migrated.
2. **Given** the TypeScript upgrade, **When** applied to all three workspaces, **Then** `typescript` is on **6.x**, and any new TS 6 stricter-check or removed-flag breakages are resolved **in source** (not silenced) with **no `@ts-ignore`** and **no new `as any`**; `pnpm -r typecheck` is clean across client, server, and shared.
3. **Given** the Jest upgrade, **When** applied to server + shared, **Then** `jest`, `@jest/globals`, and `@types/jest` are on **30.x** (matched majors), the Jest config/ESM-VM setup migrates to Jest 30 (the suites use `--experimental-vm-modules`), and `pnpm --filter @bomb-squad/server test` (`319`) and the shared suite (`136`) stay green. `apps/client` (Vitest) is **not** touched by this sub-upgrade.
4. **Given** the whole batch, **When** `pnpm -r test` + `pnpm -r typecheck` run, **Then** every workspace is green at or above baseline (client `221`, server `319`, shared `136`) and `tsc --noEmit` is clean everywhere with no `@ts-ignore`.
5. **Given** these are tooling bumps, **When** the change lands, **Then** **no runtime/source behavior changes** beyond what's strictly required to satisfy the new compiler/bundler/runner (the diff is config + type-fixups, not feature code). If a sub-upgrade (Vite / TS / Jest) can't go green without invasive source rewrites, it is **split out and re-filed** rather than forced.

## Tasks / Subtasks

- [ ] **Task 1 — Vite 8 + plugin-react 6 (client) (AC: #1)**
  - [ ] Bump `vite` → `^8` and `@vitejs/plugin-react` → `^6` in `apps/client/package.json`; root `pnpm install`.
  - [ ] Confirm **Vitest** (currently 4) is compatible with Vite 8; bump Vitest if its peer range requires it (note it in Completion Notes — Vitest rides on Vite).
  - [ ] Migrate `apps/client/vite.config.ts` for any Vite 8 breaking config change (preserve `allowedHosts: true` + the `preview` behind-Caddy comment; preserve the TD-1 `test`/jsdom block if merged).
  - [ ] Verify: `build` succeeds, `dev` starts, client Vitest suite green.

- [ ] **Task 2 — TypeScript 6 (all workspaces) (AC: #2)**
  - [ ] Bump `typescript` → `^6` everywhere it's declared; root `pnpm install`.
  - [ ] Run `pnpm -r typecheck`; resolve TS 6 breakages in source (stricter inference, removed flags, lib changes). No `@ts-ignore`, no new `as any`. Each workspace's `tsconfig.json` stays per-workspace.

- [ ] **Task 3 — Jest 30 (server + shared) (AC: #3)**
  - [ ] Bump `jest` + `@jest/globals` + `@types/jest` → `^30` in `apps/server` and `apps/shared` as applicable; root `pnpm install`.
  - [ ] Migrate the Jest config (ESM/VM-modules setup — suites run under `--experimental-vm-modules`; Jest 30 changed some defaults). Do **not** touch `apps/client` (Vitest).
  - [ ] Verify server `319` + shared `136` green.

- [ ] **Task 4 — Full-suite green (AC: #4, #5)**
  - [ ] `pnpm -r test` + `pnpm -r typecheck` green across all workspaces. Confirm the diff is config + type-fixups only (no feature behavior change). Record final counts in Completion Notes.

## Dev Notes

- **Three orthogonal bumps, one risk profile:** none ships runtime code — they're the compiler, the bundler, and the test runner. That makes this lower-blast-radius than [[td-3-react-19-and-r3f-upgrade]] (which rewrites the render layer), but TS 6's stricter checks can still surface real latent type bugs across all three workspaces — budget time for type-fixups, and fix them properly (no silencing).
- **Vitest ↔ Vite coupling:** the client uses **Vitest** (built on Vite), so a Vite 8 bump may require a Vitest bump in lockstep — check the peer range. The **server/shared use Jest**, which is independent of Vite entirely; that's why the Jest bump is server/shared-only and the Vite bump is client-only.
- **Sequencing vs TD-3:** orthogonal to React 19. If both are planned, keep them on **separate branches** so a green/red signal is unambiguous; don't interleave a renderer migration with a compiler migration.
- **Split-if-stuck:** the three sub-upgrades are independent enough that any one can be dropped to its own follow-up if it won't go green cleanly (AC #5) — prefer that over a forced workaround.
- **No human-verify gate for TS/Jest** (pure dev tooling — green suite is the proof). **Vite 8** does change the client build/dev path; a quick `dev`-server smoke (page loads, HMR works) is worth a manual glance, but the automated `build` + Vitest green is the gate. ([[human-verification-ac-rule]] interactive gate is reserved for user-visible feature stories.)

### Files to touch
- **UPDATE** `apps/client/package.json` — `vite` ^8, `@vitejs/plugin-react` ^6 (+ Vitest if needed).
- **UPDATE** `apps/client/vite.config.ts` — Vite 8 config migration.
- **UPDATE** `apps/server/package.json`, `apps/shared`(or `packages/shared`)`/package.json` — `jest`/`@jest/globals`/`@types/jest` ^30.
- **UPDATE** root + all workspace `package.json` — `typescript` ^6.
- **UPDATE** Jest config (server/shared) for Jest 30; possibly `tsconfig.json` per workspace for TS 6.
- **UPDATE** `pnpm-lock.yaml`.

## References
- [Source: `pnpm outdated -r` @ 2026-06-14] — Vite/plugin-react, TypeScript, Jest/@jest/globals/@types/jest rows.
- [Source: _agent_docs/project-context.md#Build] — `tsc --noEmit` clean, no `@ts-ignore`, per-workspace tsconfig.
- [Source: apps/client/vite.config.ts] — `allowedHosts`/`preview`-behind-Caddy config to preserve through the Vite 8 migration.
- [Ref] Vite 6→8 migration; @vitejs/plugin-react v6; TypeScript 6 release notes; Jest 30 migration (ESM/VM-modules defaults). Confirm latest at implementation time.
- Related: [[td-1-client-component-test-framework]] (preserve its jsdom `test` block under Vite 8), [[td-2-safe-dependency-bumps-and-node-engine]], [[td-3-react-19-and-r3f-upgrade]] (keep on a separate branch).

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-4 created (ready-for-dev): build/test-tooling majors — Vite 6→8 (+plugin-react 4→6, client; Vitest checked/bumped), TypeScript 5→6 (all workspaces), Jest 29→30 (server+shared; client on Vitest untouched). Tooling-only, no runtime behavior change; split-if-stuck per sub-upgrade. |
