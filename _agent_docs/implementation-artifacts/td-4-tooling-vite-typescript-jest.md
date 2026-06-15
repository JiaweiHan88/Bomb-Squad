---
baseline_commit: f4e76c7
context:
  - _agent_docs/project-context.md
  - package.json
---

# Story TD-4: Build & Test Tooling Upgrade — Vite 8, TypeScript 6, Jest 30

Status: done

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

- [x] **Task 1 — Vite 8 + plugin-react 6 (client) (AC: #1)**
  - [x] Bumped `vite` → `^8.0.16` and `@vitejs/plugin-react` → `^6.0.2` in `apps/client/package.json`; root `pnpm install` clean. (plugin-react 6 peers `vite: ^8`.)
  - [x] **Vitest** bumped 4.1.8 → `^4.1.9` (latest 4.x) — vitest 4.1.9 peers `vite: ^6 || ^7 || ^8`, so Vitest 4 stays compatible with Vite 8 (no major Vitest bump needed; it rides on Vite).
  - [x] `apps/client/vite.config.ts` needed **no migration** — `allowedHosts: true`, the `preview` behind-Caddy block, and the TD-1 `test`/jsdom block (now incl. `restoreMocks`/`unstubGlobals` from the TD-1 review) all valid under Vite 8.
  - [x] Verify: `build` succeeds (693 modules, `built in 411ms`), `dev` starts (`VITE v8.0.16 ready in 231ms`, HTTP 200, serves `<title>Bomb Squad</title>`), client Vitest suite **271** green.

- [x] **Task 2 — TypeScript 6 (all workspaces) (AC: #2)**
  - [x] Bumped `typescript` → `^6.0.3` in all 3 workspaces (client/server/shared); root `pnpm install`. Per-workspace `tsconfig.json` unchanged.
  - [x] `pnpm -r typecheck` clean across all 3. **TS 6 surfaced no genuine new type errors in source** — the only breakage was that `@types/jest` 30 + TS 6 no longer auto-injects the **bare** Jest globals (`describe`/`it`/`expect`/…). Resolved in source by adding explicit `import { … } from '@jest/globals'` to the test files that relied on ambient globals — **matching the project's existing dominant convention** (most server tests already imported from `@jest/globals`). **No `@ts-ignore`, no new `as any`** (verified via `git diff`). The transient TS7006 implicit-any noise (sessionHandlers callback params) was a cascade from the unresolved globals and cleared once the typed imports resolved.

- [x] **Task 3 — Jest 30 (server + shared) (AC: #3)**
  - [x] Bumped `jest`/`@jest/globals`/`@types/jest` → `^30` in `apps/server`; `jest`/`@types/jest` → `^30` + **added `@jest/globals` ^30.4.1** to `packages/shared` (it had none — needed for the explicit-import convention above). Bumped `ts-jest` `^29.2.0` → `^29.4.11` in both (latest 29.x; peers `jest: ^29||^30` and `typescript: >=4.3 <7`, so it spans both Jest 30 and TS 6 — there is no ts-jest 30).
  - [x] Jest config (`jest.config.cjs` ESM/VM-modules `ts-jest/presets/default-esm`) needed **no migration** — green under Jest 30 with `--experimental-vm-modules`. `apps/client` (Vitest) untouched by the Jest bump.
  - [x] Verify server **375** + shared **136** green under Jest 30.

- [x] **Task 4 — Full-suite green (AC: #4, #5)**
  - [x] `pnpm -r test` → client **271** / server **375** / shared **136**, all green; `pnpm -r typecheck` clean across all 3. The diff is **config + test-file import fixups only** — zero production/feature source changed, no behavior change (AC #5 held). Final counts recorded in Completion Notes. (Baselines 221/319 are pre-2.5/2.6/2.7-merge, superseded — as in TD-1/2/3.)

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

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow)

### Debug Log References

- `npm view` (2026-06-16) confirmed stable `latest`: vite 8.0.16, @vitejs/plugin-react 6.0.2, typescript 6.0.3, jest 30.4.2, @jest/globals 30.4.1, @types/jest 30.0.0, vitest 4.1.9, ts-jest 29.4.11.
- Peer-compat pre-check: vitest 4.1.9 peers `vite ^6||^7||^8` ✓; plugin-react 6 peers `vite ^8` ✓; ts-jest 29.4.11 peers `jest ^29||^30` + `typescript >=4.3 <7` ✓ (spans Jest 30 + TS 6).
- Root `pnpm install` clean (`+101 -96`); no peer warnings.
- First `pnpm -r typecheck`: shared failed — `Cannot find name 'expect'/'it'/'describe'` (bare globals). Root cause: `@types/jest` 30 + TS 6 no longer ambient-injects Jest globals. Fix: explicit `@jest/globals` imports (project's existing server convention). Iterated server (21 no-import files) + 4 partial-import files (`jest`-only) + 6 shared → all globals resolved.
- `pnpm -r typecheck` clean; client `build` (693 modules, 411ms); `vite` dev `ready in 231ms` HTTP 200; `pnpm -r test` → client 271 / server 375 / shared 136.

### Completion Notes List

- **AC #1 (Vite 8)** — `vite ^8.0.16` + `@vitejs/plugin-react ^6.0.2` (client); Vitest bumped to `^4.1.9` (rides Vite, peer `^8` OK). `vite.config.ts` unchanged — `allowedHosts`/`preview`/TD-1 `test` block all valid on Vite 8. Build + dev-server + Vitest 271 all green.
- **AC #2 (TS 6)** — `typescript ^6.0.3` in all 3 workspaces; `pnpm -r typecheck` clean, no `@ts-ignore`/`as any`. TS 6 itself raised **no genuine source type errors**; the only breakage was the `@types/jest` 30 + TS 6 ambient-globals regression, fixed with explicit `@jest/globals` imports (see below).
- **AC #3 (Jest 30)** — `jest`/`@jest/globals`/`@types/jest ^30` (server), `jest`/`@types/jest ^30` + new `@jest/globals ^30.4.1` (shared); `ts-jest ^29.4.11` (spans Jest 30 + TS 6). `jest.config.cjs` ESM/VM-modules setup unchanged. server 375 + shared 136 green; client (Vitest) untouched.
- **AC #4/#5** — full suite green (271/375/136), typecheck clean. Diff is **config + test-import fixups only**: zero production/feature code changed, no runtime behavior change. Nothing had to be split-out/re-filed — all three sub-upgrades went green.
- **The one real migration cost** — `@types/jest` 30 dropped the auto-injected ambient test globals under TS 6, so 31 test files (25 server + 6 shared) that used bare `describe`/`it`/`expect` needed explicit `import { … } from '@jest/globals'`. This is the modern ESM-recommended pattern and **matches the convention the project already used** in most server tests — a consistency win, not a workaround. Done via a deterministic, idempotent normalizer (computes the used-globals set per file). `@jest/globals` was added to `packages/shared` (it previously had none).
- **No human-verify gate** (per story Dev Notes — pure dev tooling; the automated `build` + Vitest/Jest green is the proof). The Vite 8 dev-server smoke (boots, HTTP 200, serves the app) was done automatically as the optional extra glance.

### File List

- **UPDATE** `apps/client/package.json` — `vite ^8.0.16`, `@vitejs/plugin-react ^6.0.2`, `vitest ^4.1.9`, `typescript ^6.0.3`.
- **UPDATE** `apps/server/package.json` — `jest ^30.4.2`, `@jest/globals ^30.4.1`, `@types/jest ^30.0.0`, `ts-jest ^29.4.11`, `typescript ^6.0.3`.
- **UPDATE** `packages/shared/package.json` — `jest ^30.4.2`, `@types/jest ^30.0.0`, **add `@jest/globals ^30.4.1`**, `ts-jest ^29.4.11`, `typescript ^6.0.3`.
- **UPDATE** `pnpm-lock.yaml` — root install (Vite 8 / TS 6 / Jest 30; no runtime-dep drift).
- **UPDATE** 25 server test files + 6 shared test files (`apps/server/src/**/__tests__/*.test.ts`, `packages/shared/src/**/__tests__/*.test.ts`) — added explicit `import { … } from '@jest/globals'` (the @types/jest-30 ambient-globals fix; one import line each, no logic change).
- _No `vite.config.ts` / `jest.config.cjs` / `tsconfig.json` changes needed; no production source changed._

## Change Log

| Date | Change |
|---|---|
| 2026-06-14 | Story TD-4 created (ready-for-dev): build/test-tooling majors — Vite 6→8 (+plugin-react 4→6, client; Vitest checked/bumped), TypeScript 5→6 (all workspaces), Jest 29→30 (server+shared; client on Vitest untouched). Tooling-only, no runtime behavior change; split-if-stuck per sub-upgrade. |
| 2026-06-16 | Implemented all 4 tasks (AC #1–#5): Vite 8.0.16 + plugin-react 6.0.2 + Vitest 4.1.9 (client), TypeScript 6.0.3 (all 3), Jest 30 + ts-jest 29.4.11 (server+shared, +@jest/globals in shared). No config/production-source changes; the only fixup was explicit `@jest/globals` imports in 31 test files (@types/jest-30 dropped ambient globals under TS 6) — matches the existing convention, no `@ts-ignore`/`as any`. Build + dev-server + full suite green (client 271 / server 375 / shared 136); typecheck clean. Status → review. |
