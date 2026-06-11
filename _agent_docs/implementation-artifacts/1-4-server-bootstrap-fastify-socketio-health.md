---
baseline_commit: 0fece04
---

# Story 1.4: Server Bootstrap — Fastify + Socket.IO + Health

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator (operator),
I want the server process to boot, validate its config, attach Socket.IO, and expose health checks,
so that the stack is runnable and orchestration can wait on readiness.

## Acceptance Criteria

1. **Boots with the right stack.** Given a valid `.env`, when the server starts, Fastify boots configured with `@fastify/type-provider-typebox` as its type provider, a typed Socket.IO server is attached to Fastify's underlying HTTP server, and a `GET /health` endpoint responds. `/health` returns `200 {status:"ok"}` only when every registered readiness check passes, and `503` otherwise. (In this story the readiness registry is delivered with **zero registered store checks** — Redis/Postgres probes are registered in Story 1.5 — so `/health` returns `200` once config is valid and the process is serving. See "Health / readiness scope" in Dev Notes.)

2. **Fails fast on bad config.** Given a missing or invalid required environment variable, when the server starts, it exits non-zero at boot with a clear, human-readable error naming every offending variable, and Fastify never begins listening (never serves traffic with bad config).

3. **No hardcoded secrets.** Given secrets (LiveKit keys, Redis URL, DB creds), when the code is inspected, none are hardcoded — all are read from `.env` via the validated config module, `.env.example` documents every key, and `.env` stays git-ignored (already enforced — do not regress).

## Tasks / Subtasks

- [x] **Task 1 — Add server runtime dependencies (AC: 1)**
  - [x] In `apps/server/package.json`, add to `dependencies`: `fastify@^5.8.5`, `@fastify/type-provider-typebox@^6.1.0`, `typebox@^1.2.8`, `socket.io@^4.8.3`. Keep `@bomb-squad/shared: workspace:*`.
  - [x] Optionally add `pino-pretty@^13.1.3` to `devDependencies` for readable dev logs (Fastify's built-in pino logger uses it only when present; production stays JSON). Skip if you don't wire it.
  - [x] Run `pnpm install` from the repo root to update `pnpm-lock.yaml`. Do NOT add anything to `pnpm.onlyBuiltDependencies` — none of these need a native build.

- [x] **Task 2 — Typed, validated config module (AC: 2, 3)**
  - [x] Create `apps/server/src/config/env.ts`. Define a TypeBox schema for required env using `Type` re-exported from `@fastify/type-provider-typebox` (see Dev Notes for the exact import). Required keys (from `.env.example`): `PORT`, `REDIS_URL`, `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_SECRET`, `TURN_TTL`.
  - [x] Validate `process.env` against the schema at module load using `Parse`/`Errors` from `typebox/value`. On failure, print each offending var (`path` + message) to `console.error` and call `process.exit(1)` — this must happen **before** any `fastify.listen()` call.
  - [x] Export a frozen, typed `config` object (use `Static<typeof EnvSchema>` for its type). Coerce `PORT` and `TURN_TTL` to numbers (env values are strings) — validate the string is numeric and reject otherwise.
  - [x] Create `apps/server/src/config/index.ts` barrel re-exporting `config` (and the `Config` type). Use `.js` extensions on all relative imports (NodeNext — non-negotiable; see Dev Notes).

- [x] **Task 3 — Readiness/health registry (AC: 1)**
  - [x] Create `apps/server/src/health/registry.ts`. Define `type ReadinessCheck = () => Promise<{ ok: boolean; detail?: string }>` and a `HealthRegistry` with `register(name: string, check: ReadinessCheck): void` and `runAll(): Promise<{ healthy: boolean; checks: Record<string, {ok:boolean; detail?:string}> }>`. `runAll` awaits all checks; a check that throws counts as `{ok:false, detail:<error message>}` (never let a probe crash the endpoint).
  - [x] Export a singleton `healthRegistry`. Add a JSDoc note: "Story 1.5 registers Redis and Postgres readiness probes here; this story ships the registry with zero store checks."
  - [x] Create `apps/server/src/health/index.ts` barrel.

- [x] **Task 4 — Fastify + Socket.IO bootstrap (AC: 1, 2, 3)**
  - [x] Rewrite `apps/server/src/index.ts` (delete the placeholder). Build an `async function buildServer()` that:
    - imports `config` (Task 2) — importing it first guarantees fail-fast config validation runs before anything binds a port;
    - creates Fastify with `.withTypeProvider<TypeBoxTypeProvider>()` and `logger: true` (structured JSON; see Logging in Dev Notes);
    - registers `GET /health` whose handler calls `healthRegistry.runAll()` and replies `200 {status:'ok', checks}` when `healthy`, else `reply.code(503).send({status:'unhealthy', checks})`;
    - attaches Socket.IO: `new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(fastify.server, { cors: { origin: true } })` — note the generic order is `<ClientToServer, ServerToClient>` for the server (the client swaps them; documented in the shared events file).
  - [x] In a `start()` function: `await fastify.ready()` then `await fastify.listen({ port: config.PORT, host: '0.0.0.0' })`. Attach Socket.IO to `fastify.server` **before** `listen()` (see Socket.IO gotcha in Dev Notes). Wire `SIGINT`/`SIGTERM` to close Socket.IO then `fastify.close()` for graceful shutdown.
  - [x] Add one trivial connection log: on `io.on('connection', ...)` log the socket id at debug. No event handlers — those land in Story 1.6+. Do not invent game events here.

- [x] **Task 5 — Test harness + tests (AC: 1, 2)**
  - [x] Set up Jest in `apps/server` mirroring `packages/shared` exactly: copy the `jest.config.cjs` (ESM + `ts-jest/presets/default-esm`, `testEnvironment:'node'`, `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }`), add devDeps `jest@^29.7.0`, `@types/jest@^29.5.0`, `ts-jest@^29.2.0`, and set `"test": "NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest"`. (See Dev Notes — these exact choices were hard-won in Story 1.3; do not deviate.)
  - [x] `apps/server/src/config/__tests__/env.test.ts`: valid env object parses to a typed config; missing a required key surfaces that key in the error set; non-numeric `PORT` is rejected. Test the validation/parse function directly with an injected env object — do NOT mutate the real `process.env`, do NOT call `process.exit` in tests (factor the pure validation into a testable `parseEnv(source)` function that `env.ts` calls and exits on).
  - [x] `apps/server/src/__tests__/health.test.ts`: build the Fastify app and use `await app.inject({ method:'GET', url:'/health' })` to assert `200`/`{status:'ok'}` with the empty registry, and `503` after registering a failing check. `inject()` needs no listening port or sockets — keep the test infra-free.
  - [x] Verify the gate is real (Story 1.1 caught a false-green here): a deliberately broken assertion must make `pnpm --filter @bomb-squad/server test` exit non-zero before you finalize.

- [x] **Task 6 — Verify (AC: 1–3)**
  - [x] `pnpm --filter @bomb-squad/server test` exits 0.
  - [x] `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces (the pre-commit gate). No `// @ts-ignore`.
  - [x] Manual boot check: `cp .env.example .env` (it has working dev defaults) then `pnpm --filter @bomb-squad/server dev` → server listens on `PORT`, `curl localhost:3001/health` → `200`. Then temporarily blank `REDIS_URL` in `.env` → boot exits non-zero naming `REDIS_URL`, never listens. Restore `.env`.
  - [x] `packages/shared` untouched. `apps/server` adds only the dependencies listed above.

## Dev Notes

### What this story is (and is NOT)

**IS:** the server's first real process — Fastify host, config validation, typed Socket.IO attachment, and the `/health` + readiness-registry mechanism. This is the boot skeleton the rest of Epic 1 plugs into.

**IS NOT:**
- **No Redis/Postgres clients.** Data-store adapters are **Story 1.5**. Do not add `ioredis` or `pg`, do not open store connections. You build the *readiness registry*; 1.5 *registers* the store probes into it. Adding store clients here duplicates 1.5 and violates the "never open a connection per request" rule.
- **No Socket.IO event handlers.** Game handlers (parse→load→reduce→persist→emit) are **Story 1.6+**. Wire the typed server and a connection log only. Do not implement any `SESSION_*` / `MODULE_*` handlers.
- **No reducers, no session logic, no LiveKit/coturn code.** Those are later epics.

### Health / readiness scope (read AC1 carefully)

AC1's "returns OK only after dependencies are reachable" is delivered as a **mechanism** here and **wired to real stores in 1.5**. The `HealthRegistry.runAll()` already returns `503` when any registered check fails — so the moment Story 1.5 registers Redis/Postgres probes, the "OK only after deps reachable" behavior is satisfied with zero changes to `/health`. In *this* story the registry has no store checks, so `/health` is effectively a liveness+config-valid signal returning `200`. This is the correct split: the architecture assigns store health to Story 1.5 ("the game server waits on Redis + Postgres health before accepting connections"). Do not try to satisfy the literal "deps reachable" by adding store clients now.

### Exact imports & verified API (typebox v1 — this is NOT the old `@sinclair/typebox` 0.x API)

`@fastify/type-provider-typebox@6` depends on the **new** `typebox@1.x` package (the v1 rename of `@sinclair/typebox`). The builder/value API differs from every 0.x example online. Verified-working pattern:

```ts
// apps/server/src/config/env.ts
import { Type, type Static } from '@fastify/type-provider-typebox';
import { Parse, Errors } from 'typebox/value';

const EnvSchema = Type.Object({
  PORT: Type.String(),
  REDIS_URL: Type.String(),
  DATABASE_URL: Type.String(),
  LIVEKIT_URL: Type.String(),
  LIVEKIT_API_KEY: Type.String(),
  LIVEKIT_API_SECRET: Type.String(),
  TURN_SECRET: Type.String(),
  TURN_TTL: Type.String(),
});
type RawEnv = Static<typeof EnvSchema>;

export function parseEnv(source: Record<string, unknown>): { PORT: number; REDIS_URL: string; /* ... */ TURN_TTL: number; /* full Config */ } {
  const errors = [...Errors(EnvSchema, source)];        // enumerate BEFORE Parse for full list
  if (errors.length > 0) {
    throw new EnvValidationError(errors.map((e) => `${e.path || '(root)'}: ${e.message}`));
  }
  const raw = Parse(EnvSchema, source) as RawEnv;        // throws on invalid; we already checked
  // coerce + validate numerics
  const PORT = Number(raw.PORT);
  const TURN_TTL = Number(raw.TURN_TTL);
  if (!Number.isInteger(PORT) || PORT <= 0) throw new EnvValidationError(['PORT: must be a positive integer']);
  if (!Number.isInteger(TURN_TTL) || TURN_TTL <= 0) throw new EnvValidationError(['TURN_TTL: must be a positive integer']);
  return { ...raw, PORT, TURN_TTL };
}
```

- `Type` and `Static` come from `@fastify/type-provider-typebox` (it re-exports them) — import them from there, not from a separate package, so the route type provider and the env schema stay on the same TypeBox version.
- `Errors`/`Parse` come from the `typebox/value` subpath (note: `typebox`, not `@sinclair/typebox`). `Errors(schema, value)` returns an **iterable** — spread it with `[...Errors(...)]`. Each error has `.path` and `.message`.
- `Parse(schema, value)` returns the validated value and throws on invalid input.
- Verified: missing `REDIS_URL` yields an error `(root): must have required properties REDIS_URL` (path is empty for a missing top-level key — that's why the fallback `'(root)'` and listing the value is useful; consider iterating expected keys to name the missing one explicitly if the path is empty).

The `env.ts` module-level code calls `parseEnv(process.env)`, catches `EnvValidationError`, prints each message via `console.error`, and `process.exit(1)`. Keep `parseEnv` pure (no `process.exit`, no `process.env` read inside it) so tests call it with a plain object.

### Socket.IO attachment gotcha

Attach Socket.IO to Fastify's **underlying Node HTTP server** (`fastify.server`), and do it **before** `fastify.listen()`:

```ts
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bomb-squad/shared';

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
  cors: { origin: true },
});
io.on('connection', (socket) => {
  fastify.log.debug({ socketId: socket.id }, 'socket connected');
});
```

- **Generic order:** server is `Server<ClientToServerEvents, ServerToClientEvents>` (incoming first). The shared events file documents this and warns the client swaps the order. Using the wrong order silently mistypes every emit/handler.
- Do **not** use the `fastify-socket.io` plugin — the architecture says "Socket.IO attached" directly; keep the dependency surface minimal.
- Use the typed `io` — never `socket.emit(string, any)` (project-context rule; it will fail typecheck once generics are applied, which is the point).

### NodeNext `.js` import extensions (non-negotiable)

Every relative import inside `apps/server/src` uses a `.js` extension even though the file is `.ts` (e.g. `import { config } from './config/index.js'`). This was established in Stories 1.1–1.3 and is required for NodeNext resolution; violating it breaks `tsc --noEmit`. Cross-workspace imports from `@bomb-squad/shared` use the bare specifier (no extension) — resolved via the workspace `exports` map (Story 1.2).

### Jest setup — reuse Story 1.3's exact recipe (do not re-derive)

`apps/server` is `"type": "module"` (pure ESM), same as `packages/shared`. Story 1.3 paid the cost of getting Jest+ESM+ts-jest working; copy it verbatim:
- Config file is `jest.config.cjs` (CommonJS — a `.ts`/`.js` ESM config needs `ts-node` and fails). Contents: `preset: 'ts-jest/presets/default-esm'`, `testEnvironment: 'node'`, `extensionsToTreatAsEsm: ['.ts']`, `transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] }`, `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` (strips `.js` so tests resolve `.ts` sources).
- Test script: `"test": "NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest"` — the env-var form is required because `.bin/jest` is a shell wrapper, not a JS file (passing it to `node` directly errors).
- `jest`, `ts-jest`, `@types/jest` are **devDependencies** only.
- Replace the current placeholder `test` script (`echo "No tests yet..."`).

### Logging

Use Fastify's built-in pino logger (`logger: true`). Architecture wants structured JSON logs keyed by `sessionId`/`teamId`/`roundNumber` where relevant — none of those exist yet (no sessions), so just enable the default logger now. **Never log secrets** (LiveKit tokens/keys, join codes) — not applicable yet but bake the habit. In dev, `pino-pretty` (if added) makes logs readable; production stays JSON.

### File locations (authoritative — from architecture project structure)

```
apps/server/
  package.json                 UPDATE — add fastify/@fastify/type-provider-typebox/typebox/socket.io deps;
                                         jest/ts-jest/@types/jest devDeps; replace test script
  jest.config.cjs              NEW — copy from packages/shared
  src/
    index.ts                   REWRITE — Fastify bootstrap, /health, Socket.IO attach, graceful shutdown
    config/
      env.ts                   NEW — TypeBox env schema + parseEnv + fail-fast config
      index.ts                 NEW — barrel re-export (config, Config type)
    health/
      registry.ts              NEW — HealthRegistry + ReadinessCheck + singleton
      index.ts                 NEW — barrel
    config/__tests__/
      env.test.ts              NEW — parseEnv valid/invalid/numeric tests
    __tests__/
      health.test.ts           NEW — /health via fastify.inject()
```

(The architecture's full server tree also lists `handlers/`, `reducers/`, `state/`, `persistence/`, `voice/`, `session/`, `generation/` — do **not** create those here; they belong to later stories.)

### Existing code state (what you're replacing)

`apps/server/src/index.ts` currently is a placeholder that type-imports `SessionState` and `console.log`s "Fastify + Socket.IO bootstrap is Story 1.4". Delete it entirely. `apps/server/package.json` already has the `dev` (`tsx watch src/index.ts`), `build` (`tsc`), and `typecheck` scripts and `@bomb-squad/shared: workspace:*` — keep those; only add deps and fix the `test` script. `apps/server/tsconfig.json` is complete (NodeNext, strict) — do not change it. There is a stale `apps/server/dist/` from a prior build; ignore it (gitignored).

### Shared contracts available to you (Story 1.2)

Import from `@bomb-squad/shared`: `ClientToServerEvents`, `ServerToClientEvents` (the typed Socket.IO interfaces), plus `SessionState`, `BombState`, `TimerState`, and all payload types. You only need the two event interfaces for this story. The events file explicitly documents the `Server<C,S>` / `Socket<S,C>` generic-order rule.

### Previous-story learnings (Stories 1.1–1.3)

- **No shared root tsconfig** — each workspace owns its complete `tsconfig.json`. Don't add a root one for tests.
- **Node engine warning is expected** — local Node v25.x vs pinned `>=20 <21`. Tests/boot still work; do not block on it.
- **No `// @ts-ignore`** — pre-commit (`pnpm -r exec tsc --noEmit`) and CI enforce it. Fix types properly.
- **After adding deps, run `pnpm install` from repo root** before running tests/build (updates the lockfile).
- **False-green test gate (Story 1.1 review):** prove your test suite actually fails on a broken assertion before declaring done. A test script that exits 0 without running real assertions is a defect.
- **`pnpm.onlyBuiltDependencies: ["esbuild"]`** is already set; none of this story's deps need a native build step.

### Deferred-work item this story may touch

`deferred-work.md` notes (from 1.2 review): "`PAUSED`/`RESUMED` payloads carry no `TimerState` — decide when the timer/pause story (1.4+) implements the clock." **This story does not implement the timer or pause/resume** — that's Story 8.4. No action; leave the deferral open.

### Project Context Rules (binding — from project-context.md)

- **Secrets via `.env` only** — never hardcode LiveKit keys, Redis URL, or DB creds; `.env` is git-ignored (already), `.env.example` documents keys (already). The config module is the single read point.
- **`tsc --noEmit` must pass with zero errors before any commit** — `pnpm -r exec tsc --noEmit`.
- **TypeScript everywhere** — no `.js` source files (the `.js` in imports is the NodeNext extension convention, not actual JS files).
- **Typed Socket.IO only** — untyped `socket.emit(string, any)` is forbidden; the `ServerToClientEvents`/`ClientToServerEvents` generics enforce it.
- **Handler = I/O, reducer = logic** — not exercised yet (no handlers), but do not put any game logic in `index.ts` or the connection callback.
- **Separate `tsconfig.json` per workspace** — already satisfied; don't merge them.
- **Socket.IO handlers must await I/O cleanly, never fire-and-forget** — no async I/O yet, but the readiness checks in `runAll()` must be awaited (use `Promise.all`), never fired-and-forgotten.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.4: Server Bootstrap — Fastify + Socket.IO + Health]
- [Source: _agent_docs/game-architecture.md#Project Structure → apps/server] (index.ts = "Fastify bootstrap, health checks, Socket.IO attach"; config/ = "env loading, validated at boot")
- [Source: _agent_docs/game-architecture.md#Epic to Architecture Mapping → Epic 1] (Fastify+Socket.IO bootstrap, health checks)
- [Source: _agent_docs/game-architecture.md#Deployment Architecture] ("game server waits on Redis + Postgres health before accepting connections" — the readiness behavior 1.5 completes)
- [Source: _agent_docs/game-architecture.md#Security Architecture] (secrets via `.env` only; never hardcoded/committed)
- [Source: _agent_docs/game-architecture.md#Implementation Patterns #7] (typed events both sides)
- [Source: _agent_docs/game-architecture.md#Tech Stack table] (Fastify + `@fastify/type-provider-typebox`, Node 20 LTS; Socket.IO)
- [Source: _agent_docs/project-context.md#Technology Stack & Versions → Backend]
- [Source: _agent_docs/project-context.md#Platform & Build Rules] (`tsc --noEmit` gate; env vars via `.env`, never committed)
- [Source: packages/shared/src/events/client-to-server.ts, server-to-client.ts] (typed event interfaces + `Server<C,S>`/`Socket<S,C>` generic-order note)
- [Source: _agent_docs/implementation-artifacts/1-3-deterministic-seed-chain-utility.md#Dev Notes] (Jest ESM + ts-jest recipe; `.js` import convention; previous learnings)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (PAUSED/RESUMED TimerState deferral — left open)
- Verified versions (2026-06-11): `fastify@5.8.5`, `@fastify/type-provider-typebox@6.1.0` (peer `typebox@^1.0.13`), `typebox@1.2.8`, `socket.io@4.8.3`. The `@fastify/type-provider-typebox@5.x` line pairs with the legacy `@sinclair/typebox@<=0.34` — do NOT mix it with the v6/typebox-v1 API shown above.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story workflow). Implemented in an isolated git worktree on branch `story/1-4-server-bootstrap`.

### Debug Log References

Verified the typebox@1 value API against the installed package before coding (`Errors`/`Parse` from the `typebox/value` subpath; versions resolved exactly: fastify 5.8.5, @fastify/type-provider-typebox 6.1.0, typebox 1.2.8, socket.io 4.8.3).

Issues found and resolved during implementation:

1. **ts-jest TS6059 across the workspace boundary.** Server tests import `@bomb-squad/shared`'s `.ts` source, which sits outside the server tsconfig's `rootDir`; ts-jest's default type-checking transform raised TS6059 and failed both suites. Fixed with transpile-only via `isolatedModules: true` in `apps/server/tsconfig.json` (type-checking remains owned by the `tsc --noEmit` pre-commit gate). This also silenced the pre-existing TS151002 ts-jest warning.
2. **Module-load `process.exit` killed the Jest worker.** Putting `export const config = loadConfig()` in `env.ts` meant importing it for the *pure* `parseEnv` test triggered config validation → `process.exit(1)`. Split the impure singleton (`loadConfig`/`config`, plus the `.env` hydration) into the `config/index.ts` barrel; `env.ts` is now pure (schema + `parseEnv`) and unit-testable with an injected object, exactly as Task 5 requires.
3. **`.env` was never loaded.** The story's manual AC (`cp .env.example .env` → boot) requires hydrating `process.env`. Added a zero-dependency upward search for the nearest `.env` (pnpm runs the `dev` script with cwd = `apps/server`, but the single `.env` lives at the repo root) + Node's built-in `process.loadEnvFile`. Best-effort: in containers no `.env` exists and env comes from the environment.
4. **Blank var did not fail fast.** `Type.String()` accepts `""`, so `REDIS_URL=` booted instead of failing. Switched required fields to `Type.String({ minLength: 1 })`.
5. **Error shape correction.** The Dev Notes claimed errors expose `.path`; typebox@1 actually emits ajv-style errors — the offending var is in `instancePath` (e.g. `/REDIS_URL`). Without this, a blank/invalid value produced `(root): must not have fewer than 1 characters` (no var named), violating AC2. Extractor now reads `instancePath`; missing-key messages already list the absent names.

### Completion Notes List

- All 3 ACs satisfied. `/health` → `200 {status:"ok",checks:{}}` with the empty registry; `503 {status:"unhealthy"}` once a failing check is registered (verified by `fastify.inject()` and a live `curl`).
- Fail-fast verified live: blanking `REDIS_URL` → process exits non-zero, never listens, prints `REDIS_URL: must not have fewer than 1 characters`. `.env` restored afterward.
- No store clients (Redis/Postgres) and no Socket.IO event handlers added — those are Stories 1.5 and 1.6+ respectively. Registry ships with zero store checks per the health/readiness scope split.
- Tests: `apps/server` 9/9 pass; full monorepo `pnpm -r test` green (shared 24/24, no regressions). `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces. No `// @ts-ignore`.
- Test gate proven real: a deliberately broken assertion made the suite exit 1 before finalizing.
- **Deviations from the story spec (justified):**
  - `apps/server/tsconfig.json` gained `isolatedModules: true` (story said "do not change it") — necessary for ts-jest across the workspace boundary and a TS-recommended setting for the project's single-file transpilers (tsx/ts-jest). Server code already complies; `tsc` still passes.
  - The fail-fast `config` singleton lives in `config/index.ts` (the barrel), not in `env.ts`, so the pure validator stays import-safe for tests. The barrel still re-exports `config` and the `Config` type as specified.
  - `baseline_commit` updated `9e365d9 → 0fece04`: master advanced (Story 1.3 review commit) between story creation and dev start; the worktree branched from `0fece04`, which is the correct diff base for code review.

### File List

- `apps/server/package.json` (M) — added fastify/@fastify/type-provider-typebox/typebox/socket.io deps; jest/ts-jest/@types/jest/pino-pretty devDeps; real `test` script
- `apps/server/tsconfig.json` (M) — added `isolatedModules: true`
- `apps/server/jest.config.cjs` (A) — Jest ESM + ts-jest config
- `apps/server/src/index.ts` (M, rewrite) — Fastify bootstrap, `/health`, typed Socket.IO attach, graceful shutdown, run-as-main guard
- `apps/server/src/config/env.ts` (A) — TypeBox env schema + pure `parseEnv` + `EnvValidationError` + `Config`
- `apps/server/src/config/index.ts` (A) — `.env` hydration + fail-fast `config` singleton barrel
- `apps/server/src/health/registry.ts` (A) — `HealthRegistry` + `ReadinessCheck` + singleton
- `apps/server/src/health/index.ts` (A) — health barrel
- `apps/server/src/config/__tests__/env.test.ts` (A) — `parseEnv` valid/missing/blank/numeric tests
- `apps/server/src/__tests__/health.test.ts` (A) — `/health` 200/503 via `fastify.inject()`
- `pnpm-lock.yaml` (M) — lockfile updated by `pnpm install`

## Change Log

- 2026-06-11: Story 1.4 drafted — Fastify + typed Socket.IO + config validation + health/readiness registry. Status: ready-for-dev.
- 2026-06-11: Story 1.4 implemented on worktree branch `story/1-4-server-bootstrap`. Fastify host + typed Socket.IO + fail-fast config + `/health` readiness registry; 9 server tests; monorepo typecheck + tests green. Status: review.
