---
baseline_commit: d1d8abe
---

# Story 1.3: Deterministic Seed-Chain Utility

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a deterministic hash + seed-chain utility in `packages/shared/src/seeding`,
so that bomb generation is reproducible and fair across teams without `Math.random()`.

## Acceptance Criteria

1. **Seed chain derives deterministically.** `templateSeed = hash(sessionId + ":" + roundNumber)`, `teamSeed = hash(templateSeed + ":" + teamId)`, `moduleSeed = hash(teamSeed + ":" + moduleIndex)` — fields are joined with a `:` delimiter so adjacent operands cannot collide (without it, `(12, 34)` and `(1, 234)` both hash `"1234"`). Identical inputs always produce identical outputs on both Node (server) and browser (client). The function must not rely on any environment-specific API. _(Delimiter added 2026-06-11 code review.)_

2. **Cross-team independence.** Given the same `(sessionId, roundNumber)`, two different `teamId`s produce an identical `templateSeed` but distinct `teamSeed`s.

3. **Unit tests exercise determinism, distribution sanity, and cross-environment equality.** Tests run in Node with zero infrastructure (no Redis, no sockets, no Fastify). The test suite in `packages/shared/src/__tests__/seeding.test.ts` covers: identical inputs → identical output, different teamIds → different teamSeeds, full chain derivation (`templateSeed → teamSeed → moduleSeed`), and distribution sanity (N distinct moduleSeed values for N distinct moduleIndex inputs).

4. **Jest is set up in `packages/shared`.** The `test` script in `packages/shared/package.json` runs Jest with zero failures. `pnpm -r exec tsc --noEmit` still passes with zero errors after this story.

5. **Seeding exports re-exported from `packages/shared/src/index.ts`.** `hash`, `deriveTemplateSeed`, `deriveTeamSeed`, `deriveModuleSeed`, and `makeSeededRng` are all importable from `'@bomb-squad/shared'`.

## Tasks / Subtasks

- [x] **Task 1 — Set up Jest with ESM + TypeScript in `packages/shared` (AC: 3, 4)**
  - [x] Add devDependencies to `packages/shared/package.json`: `jest`, `@types/jest`, `ts-jest`. Keep zero runtime deps.
  - [x] Create `packages/shared/jest.config.cjs` (CJS format to avoid ts-node requirement) using `ts-jest/presets/default-esm` preset, `testEnvironment: 'node'`, and `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` to strip `.js` extensions at test resolution time.
  - [x] Update `packages/shared/package.json` `test` script to `NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest`. This is required because the package is `"type": "module"` (pure ESM). Note: `.bin/jest` is a shell script wrapper — must use `NODE_OPTIONS` env var rather than prefixing `node` directly.
  - [x] Verify `pnpm --filter @bomb-squad/shared test` exits 0 (17 tests pass).

- [x] **Task 2 — Implement the `hash` function (AC: 1)**
  - [x] Create `packages/shared/src/seeding/hash.ts`. Implement `xmur3` as the string-to-seed function — it maps a `string` input to a 32-bit unsigned integer. Use the standard xmur3 algorithm (see Dev Notes). Export `hash(input: string): number`.
  - [x] The function must have zero imports other than TypeScript built-ins. No `crypto`, no `Buffer`, no Node globals. This keeps it identical in browser and Node.

- [x] **Task 3 — Implement the seed-chain derivation functions (AC: 1, 2)**
  - [x] Create `packages/shared/src/seeding/seedChain.ts`. Export:
    - `deriveTemplateSeed(sessionId: string, roundNumber: number): number` — `hash(\`${sessionId}:${roundNumber}\`)`
    - `deriveTeamSeed(templateSeed: number, teamId: string): number` — `hash(\`${templateSeed}:${teamId}\`)`
    - `deriveModuleSeed(teamSeed: number, moduleIndex: number): number` — `hash(\`${teamSeed}:${moduleIndex}\`)`
  - [x] Uses `import { hash } from './hash.js'` (`.js` extension required for NodeNext/ESM resolution).

- [x] **Task 4 — Implement `makeSeededRng` (AC: 1, 5)**
  - [x] Added to `packages/shared/src/seeding/seedChain.ts`. `makeSeededRng(seed: number): () => number` returns a closure that generates pseudorandom floats in `[0, 1)` using mulberry32 from the given seed. Each call advances internal state. JSDoc documents it as the only approved RNG for `generate(seed, ctx)`.

- [x] **Task 5 — Barrel export and index update (AC: 5)**
  - [x] Created `packages/shared/src/seeding/index.ts`. Re-exports `hash`, `deriveTemplateSeed`, `deriveTeamSeed`, `deriveModuleSeed`, `makeSeededRng`. Removed `.gitkeep`.
  - [x] Updated `packages/shared/src/index.ts`: added `export * from './seeding/index.js'` after existing re-exports.

- [x] **Task 6 — Write unit tests (AC: 1, 2, 3)**
  - [x] Created `packages/shared/src/__tests__/seeding.test.ts`. Removed `.gitkeep` from `__tests__/`. 17 tests covering all required cases:
    - `hash` stable (same in → same out), distinct (10 distinct inputs → 10 distinct outputs), non-negative 32-bit integer output.
    - `deriveTemplateSeed` stable, differs by roundNumber, differs by sessionId.
    - `deriveTeamSeed` diverges for 'A' vs 'B', stable for same inputs.
    - `deriveModuleSeed` stable, distribution (10 distinct moduleIndex → 10 distinct seeds).
    - Full chain determinism end-to-end, templateSeed shared across teams, teamSeeds diverge.
    - `makeSeededRng` values in [0,1), same seed → same sequence, different seeds → different sequences, independent closures from same seed.

- [x] **Task 7 — Verify (AC: 1–5)**
  - [x] `pnpm --filter @bomb-squad/shared test` exits 0 — 17 tests pass, 0 failures.
  - [x] `pnpm -r exec tsc --noEmit` exits 0, zero errors across all three workspaces.
  - [x] `packages/shared` still has zero runtime framework dependencies — only devDeps added.
  - [x] No `// @ts-ignore` added anywhere.

## Dev Notes

### Scope of this story

This story covers only the hash + seed-chain utility and Jest setup. It does NOT:
- Implement `generate(seed, ctx)` for any module (Epic 5).
- Wire the seed chain into the server's bomb assembly path (Story 8.2).
- Touch `packages/shared/src/modules/` — the `.gitkeep` stays.
- Add any runtime dependency to `packages/shared` — Jest, ts-jest, and @types/jest are devDependencies only.

### Hash algorithm — xmur3

Use the xmur3 algorithm. This is a well-known string-hashing function for seeding PRNGs, produces a 32-bit unsigned integer, runs identically in Node and browser:

```ts
export function hash(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0; // unsigned 32-bit integer
}
```

`Math.imul` is available in all target browsers (Chrome 90+, Firefox 88+, Edge 90+) and in Node. The `>>> 0` at the end ensures the result is a non-negative 32-bit integer.

### PRNG — mulberry32

`makeSeededRng` should use mulberry32 — simple, fast, high-quality 32-bit PRNG:

```ts
export function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) | 0;                          // mask state to int32 each step
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;    // canonical ^ t fold
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

This returns floats in `[0, 1)`. _(Corrected 2026-06-11 code review to match canonical mulberry32 — the earlier snippet dropped the `^ t` fold and left state unmasked, drifting after ~5M calls.)_ It is the only approved way to introduce randomness in module `generate(seed, ctx)` functions — modules call `const rng = makeSeededRng(seed)` at the start of generation, then `rng()` for each random value.

### ESM + Jest setup (critical — do not deviate)

`packages/shared` has `"type": "module"` in `package.json`. Jest's default CommonJS transform does not work here. Use this exact config in `packages/shared/jest.config.ts`:

```ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
};

export default config;
```

And the test script:
```json
"test": "node --experimental-vm-modules node_modules/.bin/jest"
```

The `moduleNameMapper` pattern strips `.js` from relative imports at test resolution time. This is needed because all source files use `.js` extensions on imports (NodeNext resolution rule established in Story 1.1/1.2 — do not change them).

### `.js` extensions on imports (non-negotiable)

All relative imports inside `packages/shared` use `.js` extensions regardless of the actual file extension. Established in Story 1.2 for NodeNext compatibility. Example:

```ts
// packages/shared/src/seeding/seedChain.ts
import { hash } from './hash.js';   // ← always .js, even though the file is hash.ts
```

Violating this will break `tsc --noEmit` in `apps/server` (NodeNext resolution).

### File locations (authoritative)

```
packages/shared/
  package.json                  UPDATE — add jest/ts-jest devDeps, update test script
  jest.config.ts                NEW — ESM + ts-jest config
  src/
    index.ts                    UPDATE — add export * from './seeding/index.js'
    seeding/
      .gitkeep                  DELETE
      hash.ts                   NEW — xmur3 hash function
      seedChain.ts              NEW — deriveTemplateSeed, deriveTeamSeed, deriveModuleSeed, makeSeededRng
      index.ts                  NEW — barrel re-export
    __tests__/
      seeding.test.ts           NEW — determinism/distribution/rng tests
```

### Seed chain design (exact API)

```ts
// seeding/hash.ts
export function hash(input: string): number;

// seeding/seedChain.ts
export function deriveTemplateSeed(sessionId: string, roundNumber: number): number;
export function deriveTeamSeed(templateSeed: number, teamId: string): number;
export function deriveModuleSeed(teamSeed: number, moduleIndex: number): number;
export function makeSeededRng(seed: number): () => number;
```

The `teamId` parameter on `deriveTeamSeed` is typed `string` (not `TeamId`) so that the seeding module stays a pure utility with no dependency on the types module. Consumer code can pass a `TeamId` value directly since `TeamId = 'A' | 'B'` is a subtype of `string`.

### How bomb generation uses this chain (context for future stories)

At round start (Story 8.2):
1. `templateSeed = deriveTemplateSeed(sessionId, roundNumber)` — shared across both teams; determines module layout template.
2. For each team: `teamSeed = deriveTeamSeed(templateSeed, teamId)` — produces a per-team seed for bomb metadata.
3. Bomb metadata (serial number, batteries, indicators, ports) generated from `makeSeededRng(teamSeed)`.
4. For each module slot `i`: `moduleSeed = deriveModuleSeed(teamSeed, i)` → passed to `module.generate(moduleSeed, ctx)`.
5. **Retry** reuses the same `templateSeed` and `teamSeed` → identical bomb, identical module values.

This story only delivers the seed chain. The bomb assembly wiring comes in Story 8.2.

### Previous story learnings (Stories 1.1 & 1.2)

- **No shared root tsconfig** — each workspace has its own complete `tsconfig.json`. Do not create a root tsconfig for the test setup.
- **Node engine mismatch warning is expected** — local Node v25.6.1 vs pinned `>=20 <21`. Tests will still pass. Do not block on it.
- **No `// @ts-ignore`** — pre-commit hook and CI enforce this. Fix type errors properly.
- **`pnpm.onlyBuiltDependencies: ["esbuild"]`** already in root `package.json`. ts-jest does not need a native build step — no action needed.
- **After adding devDependencies**, run `pnpm install` from the repo root to update the lockfile before running tests.

### Testing standards

Per `project-context.md`: pure utility functions go in `packages/shared/src/__tests__/`. Tests run in Node with zero infrastructure. Never use `Date.now()` or `Math.random()` in these tests — the entire point of this utility is to replace them. Pass all inputs explicitly.

### Project Context Rules

From `project-context.md` — binding for this story:

- **`packages/shared` ZERO runtime deps** — `jest`, `ts-jest`, `@types/jest` are devDependencies only. Do not add anything to `"dependencies"`.
- **TypeScript everywhere** — `jest.config.ts` is `.ts`, not `.js`.
- **`tsc --noEmit` must pass with zero errors** before any commit. Run `pnpm -r exec tsc --noEmit` to verify.
- **NEVER call `Math.random()`** outside `generate(seed, ctx)`. The seeding utility itself must not call `Math.random()` — it replaces it.
- **`generate(seed, ctx)` is the ONLY place randomness is allowed in a module** — the `makeSeededRng` function exported by this story is what module authors call from inside `generate`.
- **Bomb generation rule (from project-context.md):**
  ```
  templateSeed = hash(sessionId + ":" + roundNumber)
  teamSeed     = hash(templateSeed + ":" + teamId)
  moduleSeed   = hash(teamSeed + ":" + moduleIndex)
  ```
  Fields are joined with a `:` delimiter so adjacent operands cannot collide. This story implements exactly this contract.

### References

- [Source: _agent_docs/game-architecture.md#Pattern 4 — Deterministic Seeded Generation]
- [Source: _agent_docs/game-architecture.md#ADR-004 — Deterministic seeded generation chain]
- [Source: _agent_docs/game-architecture.md#Project Structure → packages/shared/seeding]
- [Source: _agent_docs/game-architecture.md#Testing Architecture]
- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.3: Deterministic Seed-Chain Utility]
- [Source: _agent_docs/planning-artifacts/epics.md#AR6]
- [Source: _agent_docs/project-context.md#Critical Implementation Rules → Bomb Generation]
- [Source: _agent_docs/project-context.md#Critical Don't-Miss Rules → Game Logic Anti-Patterns]
- [Source: _agent_docs/project-context.md#Testing Rules]
- [Source: _agent_docs/implementation-artifacts/1-2-shared-contracts-core-types-and-typed-events.md#Dev Notes]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `jest.config.ts` initially failed — `ts-node` is required for Jest to parse a TypeScript config file. Fixed by switching to `jest.config.cjs` (CommonJS, no ts-node needed). `.cjs` extension is unambiguous CJS even with `"type": "module"` in package.json.
- `node --experimental-vm-modules node_modules/.bin/jest` failed — `.bin/jest` is a `/bin/sh` wrapper script, not a JS file; passing it to `node` directly causes a syntax error. Fixed by using `NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest` instead, which injects the flag into the node process that the shell script ultimately spawns.

### Completion Notes List

- Implemented xmur3 hash function (`hash.ts`) — pure JS, zero Node/browser-specific APIs, identical environment behavior. Returns unsigned 32-bit integer via `>>> 0`.
- Implemented seed chain (`seedChain.ts`): `deriveTemplateSeed`, `deriveTeamSeed`, `deriveModuleSeed` exactly per architecture pattern 4 formula. `makeSeededRng` uses mulberry32 algorithm with closure-local state — each call to `makeSeededRng(seed)` returns an independent generator.
- Jest set up with ESM support via `ts-jest/presets/default-esm` + `NODE_OPTIONS='--experimental-vm-modules'`. Config in `jest.config.cjs` (avoids ts-node). `moduleNameMapper` strips `.js` extensions at resolution time so tests resolve `.ts` source files correctly while preserving NodeNext-compatible imports in source.
- 17 tests covering: hash stability, hash distinctness, integer bounds, all three seed chain functions (stable + divergence), full end-to-end chain, rng sequence reproducibility, rng range [0,1), independent closure state.
- `packages/shared` devDeps only: added `jest@^29.7.0`, `@types/jest@^29.5.0`, `ts-jest@^29.2.0`. Zero runtime deps added.
- `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces.

### File List

- packages/shared/package.json (updated — jest/ts-jest/\@types/jest devDeps, test script)
- packages/shared/jest.config.cjs (new — ESM + ts-jest Jest config)
- packages/shared/src/seeding/.gitkeep (deleted)
- packages/shared/src/seeding/hash.ts (new — xmur3 hash)
- packages/shared/src/seeding/seedChain.ts (new — deriveTemplateSeed, deriveTeamSeed, deriveModuleSeed, makeSeededRng)
- packages/shared/src/seeding/index.ts (new — barrel re-export, replaces .gitkeep)
- packages/shared/src/index.ts (updated — added export * from './seeding/index.js')
- packages/shared/src/__tests__/.gitkeep (deleted)
- packages/shared/src/__tests__/seeding.test.ts (new — 17 unit tests)
- pnpm-lock.yaml (updated — new workspace devDeps)

## Change Log

- 2026-06-11: Story 1.3 implemented — deterministic seed-chain utility (xmur3 hash + mulberry32 RNG) in packages/shared/src/seeding; Jest set up with ESM + ts-jest; 17 tests all pass; zero tsc errors.

### Review Findings

_Code review 2026-06-11 (review of stories 1.1–1.3; Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 5 ACs verified SATISFIED with runtime evidence (17 tests pass, `tsc --noEmit` clean, zero runtime deps). 9 findings dismissed as noise/false-positive. Findings below._

- [x] [Review][Patch] Seed-chain derivation has no field delimiter — concatenation collisions (DECISION 2026-06-11: patch now — add delimiter + amend documented contract — APPLIED: `:` delimiter in all three derive functions; project-context.md + AC1 + Project Context Rules updated; collision-boundary tests added) [packages/shared/src/seeding/seedChain.ts:4,8,12] — All three derive functions concatenate operands with no separator, so the field boundary is ambiguous. Confirmed colliding inputs: `deriveTemplateSeed('sid1', 2)` === `deriveTemplateSeed('sid', 12)` (both `2953336349`); `deriveModuleSeed(12, 34)` === `deriveModuleSeed(1, 234)` (both `1867513652`). `deriveModuleSeed` (numeric‖numeric) is the genuinely live risk → two distinct (teamSeed, moduleIndex) pairs yield the same module seed → duplicate puzzles where independence is intended. `deriveTemplateSeed`/`deriveTeamSeed` are mitigated today (fixed-length sessionId boundary, non-digit teamId 'A'/'B') but fragile if those assumptions change. **This faithfully implements the documented contract** (project-context.md:221-227, story AC1, ADR-004 / Pattern 4), so fixing it (add a delimiter that cannot appear in any field, e.g. `:`) requires amending that documented seed contract — hence a decision, not a silent patch. No test currently probes adjacent-boundary collisions, so all three pass green.

- [x] [Review][Patch] makeSeededRng is a non-canonical mulberry32 variant (APPLIED: state masked with `| 0` each step, restored canonical `^ t` fold; spec snippet updated) [packages/shared/src/seeding/seedChain.ts:21-27] — Two deviations from canonical mulberry32: (a) state `s` is never masked to int32 each step (`s += C` with no `| 0`), so after ~5M `rng()` calls `s` exceeds 2^53 and loses integer precision; (b) the middle mixing step drops the canonical trailing `^ t` fold (`(t + imul(...)) >>> 0` instead of `t + imul(...) ^ t`), changing the output distribution vs textbook mulberry32. Deterministic and in-range today (tests pass), hence Low — but the JSDoc/spec claim "mulberry32" while the output is a variant of unvetted distribution quality. The implementation matches the spec snippet (story lines 104-112), so the fix must update that snippet in lockstep. Restore canonical mulberry32.

- [x] [Review][Patch] Seed/RNG functions accept invalid numeric inputs without guards + missing boundary tests (APPLIED: `assertNonNegativeInteger` guards on roundNumber/moduleIndex/templateSeed/teamSeed/seed; boundary tests added for empty/long/unicode/NaN/float/negative inputs) [packages/shared/src/seeding/seedChain.ts:3,11,20] — `roundNumber`/`moduleIndex` are stringified blindly: `NaN` → `"...NaN"`, `1.5` → `"...1.5"`, `-1` → `"...-1"`, all silently producing valid-looking seeds; `makeSeededRng` truncates via `>>> 0` so `1.9`≡`1` and `-1`≡`2^32-1` alias silently. `payloads.ts:35` already mandates the server bounds-check `0 <= moduleIndex < modules.length`, so this is defense-in-depth at the seeding boundary (assert non-negative integers; document/guard the RNG truncation). Also add the absent boundary tests: empty-string correctness (not just stability), negative/float/NaN inputs, long/unicode inputs, and the collision-boundary cases tied to the Decision item above.

- [x] [Review][Patch] jest test gate breaks after a build (no dist/ exclusion) (APPLIED during review verification: scoped jest discovery to `roots: ['<rootDir>/src']` so compiled `dist/__tests__/*.d.ts` is never picked up — `pnpm build && pnpm test` previously failed with a no-test suite) [packages/shared/jest.config.cjs] — surfaced while running the test gate to verify the other patches; clean checkout hid it because dist/ is gitignored.

- [x] [Review][Defer] @bomb-squad/shared package exports point at .ts source, not built dist [packages/shared/package.json:5-11] — deferred. `main`/`exports` resolve to `./src/index.ts`. Works today (client bundles via Vite; server uses only `import type`, erased at compile). Will break the moment the tsc-compiled server imports a *runtime value* (e.g. `hash`, `makeSeededRng`) — Node cannot execute the `.ts`. This was a deliberate, documented decision in Story 1.2 (deferred-work.md story-1.1 entry), validated only for `import type`. Settle the runtime-value consumption strategy (built dist + conditional exports, TS project references, or bundler) in Story 1.4 (server bootstrap), which is when the server first imports shared runtime values.

- [x] [Review][Defer] StrikeCount type admits 3 as a steady-state value [packages/shared/src/types/bomb.ts] — deferred. `StrikeCount = 0 | 1 | 2 | 3` and `BombState.strikes` can hold `3`, but the third strike triggers explosion / round-end. Whether a persisted BombState should ever rest at `3`, or the explosion transition forbids it, is a reducer-modeling question. Resolve when the strike/timer reducer lands (Story 8.4 — server-authoritative timer and strike escalation).
