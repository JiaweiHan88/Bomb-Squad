---
baseline_commit: 0fece04
---

# Story 1.5: Data-Store Adapters — Redis Keyspace & Postgres Pool

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want Redis and PostgreSQL adapters with documented keyspace conventions and pooling,
so that in-flight state and the session-end archive have clean, O(1) access boundaries and the
server reports unhealthy (and refuses game connections) whenever a store is unreachable.

## Acceptance Criteria

1. **Redis adapter — namespaced, O(1) keyspace (AC: Redis).** Given the Redis adapter, when a key is written or read, it follows the colon-delimited namespace convention (`session:{sessionId}:...` exactly as documented in the Redis Keyspace section) and every documented read/write is O(1) on a single key — no `KEYS`, no `SCAN`, no wildcard/multi-key scan on any path. The adapter is the sole owner of the keyspace: callers never hand-build key strings; they go through the typed key-builders.

2. **Postgres adapter — pooled, health-reporting, zero game-path writes (AC: Postgres).** Given the Postgres adapter, when the server boots, it connects via a `pg` connection **pool** (`pg.Pool`) and exposes a readiness probe, but performs **no writes** on any game-action path — the adapter ships **no write methods at all** in this story (archive writes are Story 8.10, session end). A single pool is created once at boot and reused; never one connection per request.

3. **Either store unreachable ⇒ unhealthy + no game connections (AC: Health gate).** Given either store is unreachable, when `/health` is checked, then the server reports **unhealthy** (`503`, with a per-store probe entry naming which store failed), **and** the server does **not** accept new Socket.IO (game) connections while a store is down. The process stays up and keeps serving `/health` so orchestration can observe readiness — it does **not** hard-exit on a store outage (that is the difference from the config fail-fast in Story 1.4: bad config exits; a down store reports unhealthy and waits).

## Tasks / Subtasks

- [x] **Task 1 — Add data-store runtime dependencies (AC: 1, 2)**
  - [x] In `apps/server/package.json`, add to `dependencies`: `ioredis@^5.11.1` and `pg@^8.21.0`. Add to `devDependencies`: `@types/pg@^8.20.0` (the `pg` package ships no bundled types). Keep all existing deps.
  - [x] Run `pnpm install` from the **repo root** to update `pnpm-lock.yaml`. Do **NOT** add anything to `pnpm.onlyBuiltDependencies` — both `ioredis` and `pg` are pure JS (no native build; we do not use the optional `pg-native` addon). See Dev Notes "Dependency choices".
  - [x] Do not touch `apps/client` or `packages/shared` package manifests.

- [x] **Task 2 — Redis adapter + keyspace owner (AC: 1, 3)**
  - [x] Create `apps/server/src/state/keys.ts` — pure, dependency-free key-builder functions that are the **single source of truth** for the Redis keyspace. One function per documented key (exact strings — see Dev Notes "Redis keyspace — exact key shapes"): `sessionKey(sessionId)`, `roundKey(sessionId, roundNumber)`, `bombKey(sessionId, teamId)`, `timerKey(sessionId, teamId)`, `rolesKey(sessionId)`, `lifelinesKey(sessionId)`. Each joins segments with `:`. These are pure functions — unit-testable with zero infra.
  - [x] Create `apps/server/src/state/redis.ts`. Define a minimal `RedisLike` interface (only the commands this story needs: `get`, `set`, `del`, `ping`, `quit`, plus a readable `status`) and a `RedisStore` wrapper built over it via a `createRedisStore(client: RedisLike): RedisStore` factory. `RedisStore` exposes **O(1)-only** helpers: `getJSON<T>(key): Promise<T | null>`, `setJSON<T>(key, value): Promise<void>` (JSON-serialise; `SET key value`), `del(key): Promise<void>`, a `ping(): Promise<boolean>` (true iff reply is `'PONG'`), and `isReady(): boolean` (derived from the client `status === 'ready'`). **Forbidden in this file:** `KEYS`, `SCAN`, `HGETALL`/`SMEMBERS` over wildcards, `MGET` across sessions, or any command that touches more than the one key passed in.
  - [x] Create `apps/server/src/state/index.ts` — a thin factory `connectRedis(url): { client: Redis; store: RedisStore }` that constructs a real `ioredis` client (`new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 })`), wraps it with `createRedisStore`, and a barrel re-export of `keys.ts` and the `RedisStore`/`RedisLike` types. Wire `client.on('error', …)` to log (never throw out of the event handler — an unhandled `ioredis` `error` event crashes the process). See Dev Notes "ioredis connection semantics".
  - [x] The readiness probe for Redis is `async () => { const ok = await store.ping(); return { ok, detail: ok ? undefined : 'redis PING failed' }; }`. Registered in Task 4, not here.

- [x] **Task 3 — Postgres pool adapter (AC: 2, 3)**
  - [x] Create `apps/server/src/persistence/postgres.ts`. Define a minimal `PoolLike` interface (`query(text, params?)`, `end()`) and a `PostgresArchive` wrapper via `createPostgresArchive(pool: PoolLike): PostgresArchive`. In **this** story `PostgresArchive` exposes **only** a readiness probe `ping(): Promise<boolean>` (runs `SELECT 1`, true iff it resolves) and `close(): Promise<void>` (`pool.end()`). **No write/insert/archive methods** — adding any here violates AC2. Add a JSDoc note: "Session-archive writes land in Story 8.10 as a single transaction at session end; this story is pool + health only."
  - [x] Create `apps/server/src/persistence/index.ts` — a thin factory `connectPostgres(url): { pool: Pool; archive: PostgresArchive }` that constructs `new Pool({ connectionString: url })` and wraps it. Attach `pool.on('error', …)` to log idle-client errors (a `pg` pool emits `error` on a broken idle connection; an unhandled one crashes the process). Barrel re-export the `PostgresArchive`/`PoolLike` types.
  - [x] The readiness probe for Postgres is `async () => { const ok = await archive.ping(); return { ok, detail: ok ? undefined : 'postgres SELECT 1 failed' }; }`. Registered in Task 4.

- [x] **Task 4 — Register probes + harden the health registry (AC: 1, 2, 3)**
  - [x] Wire both probes into the existing singleton `healthRegistry` (`apps/server/src/health/registry.ts`, built in Story 1.4) — `register('redis', redisProbe)` and `register('postgres', postgresProbe)`. Do this in the boot path (Task 5), NOT at module-load of the adapter files (keep adapters import-safe for unit tests, mirroring Story 1.4's `parseEnv` split — see Dev Notes "Why registration happens in boot, not module-load").
  - [x] Resolve the two Story 1.4 review deferrals that this story was told to revisit (`deferred-work.md` → "Deferred from: code review of story-1.4"):
    - **Normalize malformed probe results.** In `runAll()`, a probe that resolves `undefined`, `null`, or a non-`{ok:boolean}` shape must be coerced to `{ ok: false, detail: 'malformed readiness result' }` — today only thrown/rejected probes are normalized, so a real store probe returning a bad shape would silently read as healthy. Add a unit test.
    - **Duplicate-name policy.** `register(name, …)` currently silently replaces an existing probe. Make the policy explicit: throw on a duplicate `name` (fail-loud — registering `redis` twice is a boot bug), and document it in the JSDoc. (Keep `unregister` as-is — tests rely on it.)
  - [x] Confirm `register`/`runAll` ordering is unaffected and that the empty-registry behavior from Story 1.4 (`healthy: true` with zero checks) is unchanged for any test that builds a fresh `HealthRegistry`.

- [x] **Task 5 — Boot wiring: connect, gate connections, graceful close (AC: 3)**
  - [x] In `apps/server/src/index.ts` `start()` (NOT `buildServer()` — keep `buildServer` infra-free so `fastify.inject()` tests stay store-free): after `buildServer()`, call `connectRedis(config.REDIS_URL)` and `connectPostgres(config.DATABASE_URL)`, `await client.connect()` for Redis (it is `lazyConnect`), register both readiness probes (Task 4). A store that is **down at boot** must **not** crash `start()` — catch/log the initial connect failure and continue to `listen()` so `/health` is reachable and reports `503` (AC3: report unhealthy, do not hard-exit). Document this explicitly with a comment contrasting it against the config fail-fast.
  - [x] **Connection gate (AC3 "does not accept game connections").** Add a Socket.IO middleware `io.use(async (socket, next) => { const { healthy } = await healthRegistry.runAll(); if (healthy) return next(); next(new Error('SERVER_NOT_READY')); })` so new game connections are rejected while any store is down. There are no game handlers yet (Story 1.6+) — this gate is the mechanism they build on. See Dev Notes "Connection gate — scope & trade-off" for why a per-connection probe is acceptable in V1 and the caching option if it ever matters.
  - [x] Extend graceful shutdown: after the existing `io.close()` / `fastify.close()` sequence, `await store`/`archive` close — `redis.quit()` then `pool.end()` — each wrapped so a close error is logged, not fatal (mirror the existing `ERR_SERVER_NOT_RUNNING` tolerance). Closing stores **after** the HTTP/socket layer is down is correct (no new work can arrive).
  - [x] Do **not** add any Socket.IO game event handlers, reducers, session logic, or Postgres writes. This story is adapters + health gate only.

- [x] **Task 6 — Tests (AC: 1, 2, 3)**
  - [x] `apps/server/src/state/__tests__/keys.test.ts` — assert every key-builder emits the **exact** documented string (e.g. `bombKey('S1','red') === 'session:S1:team:red:bomb'`), is colon-delimited, and contains no wildcard/glob char. Zero infra.
  - [x] `apps/server/src/state/__tests__/redis.test.ts` — drive `createRedisStore` with a **fake `RedisLike`** (in-memory `Map`): `setJSON`/`getJSON` round-trip a typed object, `getJSON` of a missing key returns `null`, `del` removes, `ping` maps `'PONG'`→`true` and anything else→`false`, `isReady` reflects the fake's `status`. Assert the fake's recorded command log contains **no** `keys`/`scan` calls. Zero infra — no real Redis.
  - [x] `apps/server/src/persistence/__tests__/postgres.test.ts` — drive `createPostgresArchive` with a **fake `PoolLike`**: `ping` resolves `true` when the fake `query('SELECT 1')` resolves and `false` when it rejects; `close` calls the fake's `end`. Assert the adapter exposes **no** write method (compile-time via the type + a runtime `expect((archive as any).insert).toBeUndefined()` guard). Zero infra — no real Postgres.
  - [x] `apps/server/src/__tests__/health.test.ts` (extend the existing file or add a sibling) — using a fresh `HealthRegistry`: a probe returning `{ok:false}` ⇒ `runAll().healthy === false`; a probe resolving `undefined`/malformed ⇒ normalized to `{ok:false}`; registering a duplicate name ⇒ throws. Keep infra-free.
  - [x] **Prove the gate is real** (Story 1.1 false-green lesson): a deliberately broken assertion in one new test must make `pnpm --filter @bomb-squad/server test` exit non-zero before you finalize. Revert it after confirming.
  - [x] **Integration coverage is deferred, and that deferral must be explicit.** A live Redis/Postgres round-trip is covered by the Docker Compose smoke test in **Story 1.8**, not here (this story keeps the Jest suite infra-free, consistent with Stories 1.3/1.4). State this in Completion Notes — do not claim integration coverage you did not run.

- [x] **Task 7 — Verify (AC: 1–3)**
  - [x] `pnpm --filter @bomb-squad/server test` exits 0. (38 tests, 5 suites — all pass)
  - [x] `pnpm -r exec tsc --noEmit` exits 0 across all three workspaces (the pre-commit gate). No `// @ts-ignore`.
  - [ ] Manual boot check **with stores up** — SKIPPED: no local Redis/Postgres without Docker. Will be covered by the Story 1.8 Docker Compose smoke test.
  - [ ] Manual boot check **with a store down** — SKIPPED: same reason as above. The unit tests + gate middleware code cover this path at the unit level; Story 1.8 provides live integration coverage.
  - [x] `packages/shared` and `apps/client` untouched. `apps/server` adds only `ioredis`, `pg`, `@types/pg`.
  - [x] Update `deferred-work.md`: mark the two Story 1.4 health-registry deferrals (malformed-result normalization, duplicate-name policy) **RESOLVED in Story 1.5**.

## Dev Notes

### What this story IS (and is NOT)

**IS:** the two data-store adapters the rest of the server plugs into — a Redis adapter that **owns the keyspace** (typed key-builders + O(1) single-key get/set/del + a readiness probe), and a Postgres adapter that owns the **connection pool + a readiness probe** (no writes). Plus the wiring that registers both probes into the Story 1.4 health registry and a Socket.IO connection gate that refuses game connections while a store is down.

**IS NOT:**
- **No session/bomb/round state logic.** The adapter provides generic typed `getJSON`/`setJSON`/`del` over the documented keys; it does **not** know `SessionState`/`BombState` semantics. Session lifecycle is Epic 2 (`session/`); bomb state is Epics 4–8. Do not write any reducer or state machine here.
- **No Postgres writes / schema / migrations.** Archive writes (the single session-end transaction, table schema) are **Story 8.10**. This story ships pool + `SELECT 1` health only. Creating tables or an `INSERT` path here violates AC2 and the "no Postgres on the tick path / archive only" architecture rule.
- **No Socket.IO game handlers, no reducers, no LiveKit/coturn.** Game handlers are Story 1.6+. The only Socket.IO code you add is the readiness `io.use` gate.
- **No Docker Compose / smoke test.** That is Story 1.8 (it provides the live integration coverage this story's unit tests intentionally skip).

### Redis keyspace — exact key shapes (authoritative)

From the architecture Data Architecture → Redis Keyspace. Reproduce these **exactly** in `keys.ts` — adjacent code (Epics 2–8) will read/write these keys and any drift silently breaks state lookup:

```
session:{sessionId}                       → SessionState
session:{sessionId}:round:{n}             → RoundState
session:{sessionId}:team:{teamId}:bomb    → BombState
session:{sessionId}:team:{teamId}:timer   → TimerState
session:{sessionId}:roles                 → role/chapter assignments
session:{sessionId}:lifelines             → per-spectator token counts
```

So: `sessionKey('S1') → 'session:S1'`, `roundKey('S1', 2) → 'session:S1:round:2'`, `bombKey('S1','red') → 'session:S1:team:red:bomb'`, `timerKey('S1','red') → 'session:S1:team:red:timer'`, `rolesKey('S1') → 'session:S1:roles'`, `lifelinesKey('S1') → 'session:S1:lifelines'`.

- **Colon delimiter is load-bearing.** The same `:`-join discipline used by the seed chain (Story 1.3 / project-context "Bomb Generation") prevents segment-collision; keep IDs from containing `:` is a later-story concern (join codes are alphanumeric), but the builders must never interpolate without the delimiter.
- **O(1) only.** All bomb-action reads/writes hit exactly one of these keys. There is **never** a reason to enumerate keys by pattern on the hot path — `KEYS`/`SCAN` are O(N) and forbidden (architecture Performance: "Redis O(1) per game action; no full-session scans"). If a future story needs "all teams in a session," it reads the team list off `SessionState`, not via a key scan.

### ioredis connection semantics (the parts that bite)

- `ioredis@5` **auto-connects** on construction unless you pass `lazyConnect: true`. Use `lazyConnect: true` so construction is side-effect-free (keeps the factory import-safe and lets `start()` own the `await client.connect()`), and so a unit test never accidentally opens a socket.
- **Unhandled `error` events crash the process.** `new Redis(...)` emits `error` (not a rejected promise) when the server is unreachable and on every reconnect attempt. You **must** attach `client.on('error', (e) => log)` or Node will throw `Unhandled 'error' event`. Log at `warn`/`error`; never rethrow.
- `maxRetriesPerRequest: 1` keeps a `ping()` against a dead Redis from hanging on an infinite retry queue — the probe should resolve `false` quickly so `/health` returns `503` promptly. Without it, a command can buffer indefinitely.
- `status === 'ready'` is the synchronous "connected" signal for `isReady()`. Other states: `connecting`, `connect`, `reconnecting`, `close`, `end`.
- Graceful close: `quit()` (sends `QUIT`, drains) is preferred over `disconnect()` (abrupt). Wrap in try/catch in shutdown.

### pg Pool semantics (the parts that bite)

- Use `pg.Pool`, **not** `pg.Client` — AC2 requires pooling, and the architecture/project-context both say "use connection pooling (`pg-pool`) — never open a new connection per request." (`pg.Pool` is the modern home of what used to be the standalone `pg-pool` package; do not add a separate `pg-pool` dependency.)
- `new Pool({ connectionString })` is **lazy** — it does not connect until the first `query()`/`connect()`. So the boot-time `SELECT 1` probe is what actually proves reachability; a successful `new Pool(...)` proves nothing.
- **Attach `pool.on('error', …)`.** A pooled idle client whose backend connection drops emits an `error` on the pool; unhandled, it crashes the process (same failure mode as ioredis). Log, don't rethrow.
- `SELECT 1` is the canonical zero-cost liveness query; it needs **no schema** (good — this story creates no tables).
- Shutdown: `await pool.end()` drains and closes all idle clients. Call it after the HTTP/socket layer is closed.

### Why registration happens in boot, not module-load

Story 1.4 hit exactly this: putting impure side-effects at module top-level (`export const config = loadConfig()` calling `process.exit`) broke unit tests that imported the module. Same discipline here — `state/redis.ts` and `persistence/postgres.ts` export **pure factories** (`createRedisStore(fake)` / `createPostgresArchive(fake)`) that take an injected client, so tests construct them with an in-memory fake and never open a socket. The **impure** construction (`new Redis(url)`, `new Pool(...)`) and the `healthRegistry.register(...)` calls live in `start()` (or the thin `connect*` factories called only from `start()`), never at import time. This is the established pattern (mirror `parseEnv` pure / `config/index.ts` impure).

### Connection gate — scope & trade-off

AC3 says "does not accept game connections" while a store is down. The mechanism is a Socket.IO middleware (`io.use`) that rejects the handshake when `healthRegistry.runAll()` is unhealthy. Notes:
- **Why not hard-exit?** AC3 also says "the server reports unhealthy" — that requires the process to stay up and keep serving `/health` (a Fastify HTTP route, independent of the socket layer). So a down store ⇒ stay up, `/health` 503, reject sockets. Contrast Story 1.4: **bad config** ⇒ `process.exit(1)` (unrecoverable); a **down store** ⇒ recoverable, wait for it.
- **Per-connection probe cost.** `runAll()` issues a Redis `PING` and a PG `SELECT 1` per connection attempt. In V1 (a few concurrent sessions, infrequent handshakes) this is fine and keeps the gate truthful with zero extra state. If connection volume ever makes this hot, cache the last readiness result with a short TTL (e.g. 1 s) updated by a background interval — note it as a future optimization, do not build it now.
- This gate is **forward infrastructure** for Story 1.6+ handlers; it does not itself implement any game event. Reject with a stable error string (`SERVER_NOT_READY`) the client can branch on later.

### File locations (authoritative — from architecture project structure)

```
apps/server/
  package.json                      UPDATE — add ioredis, pg deps; @types/pg devDep
  src/
    index.ts                        UPDATE — connect adapters in start(); register probes;
                                              io.use readiness gate; close stores on shutdown
    state/                          NEW DIR — Redis adapters (keyspace owners)
      keys.ts                       NEW — pure key-builders (the keyspace SSOT)
      redis.ts                      NEW — RedisLike + createRedisStore (O(1) get/set/del/ping/isReady)
      index.ts                      NEW — connectRedis(url) factory + barrel
      __tests__/keys.test.ts        NEW — exact key-string assertions
      __tests__/redis.test.ts       NEW — fake-client round-trip + no-scan assertion
    persistence/                    NEW DIR — Postgres adapter (pool owner)
      postgres.ts                   NEW — PoolLike + createPostgresArchive (ping/close, NO writes)
      index.ts                      NEW — connectPostgres(url) factory + barrel
      __tests__/postgres.test.ts    NEW — fake-pool ping/close + no-write-method assertion
    health/
      registry.ts                   UPDATE — normalize malformed results; throw on duplicate name
    __tests__/health.test.ts        UPDATE — malformed-result + duplicate-name tests
```

Do **not** create `handlers/`, `reducers/`, `session/`, `voice/`, `generation/` — later stories.

### Existing code state (what you're integrating with — READ before editing)

- **`apps/server/src/index.ts`** (Story 1.4, read in full): `buildServer()` builds Fastify + the `/health` route (calls `healthRegistry.runAll()`) + attaches typed Socket.IO with `cors:{origin:true}` + a debug connection log. `start()` builds it, wires `SIGINT`/`SIGTERM` graceful shutdown (`io.close()` then `fastify.close()` tolerating `ERR_SERVER_NOT_RUNNING`), then `await fastify.ready()` + `fastify.listen({port: config.PORT, host:'0.0.0.0'})`. A run-as-main guard (`process.argv[1] === fileURLToPath(import.meta.url)`) prevents boot on import. **Preserve all of this** — you are *adding* store connect/register/gate/close, not rewriting. Put new connect/register/gate code in `start()` (after `buildServer`, before `listen`), and the store-close in the existing `shutdown` sequence.
- **`apps/server/src/health/registry.ts`** (Story 1.4, read in full): `HealthRegistry` already has `register`, `unregister`, `runAll` (concurrent via `Promise.all`, normalizes **thrown** probes to `{ok:false}`). Zero registered checks ⇒ `healthy:true`. Singleton `healthRegistry` exported. Your changes: normalize **malformed-but-resolved** results too, and make `register` throw on a duplicate name. The existing `unregister` and the `Story 1.5 registers Redis and Postgres probes here` JSDoc note already anticipate this story — update that note to past tense once done.
- **`apps/server/src/config/index.ts` + `env.ts`** (Story 1.4): `config` is a frozen typed object with validated `REDIS_URL` and `DATABASE_URL` (both `Type.String({minLength:1})`). Read `config.REDIS_URL` / `config.DATABASE_URL` — never `process.env` directly. `.env.example` already documents both (`REDIS_URL=redis://localhost:6379`, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bombsquad`).
- **Jest setup** (`apps/server/jest.config.cjs`, Story 1.4): ESM + `ts-jest/presets/default-esm`, `testEnvironment:'node'`, `moduleNameMapper` stripping `.js`. New test files just work under it. `isolatedModules:true` is set in `tsconfig.json` (transpile-only for ts-jest across the `@bomb-squad/shared` boundary). The `test` script is `NODE_OPTIONS='--experimental-vm-modules' node_modules/.bin/jest`.

### NodeNext `.js` import extensions (non-negotiable)

Every relative import inside `apps/server/src` uses a `.js` extension on the `.ts` file (e.g. `import { createRedisStore } from './redis.js'`, `import { healthRegistry } from '../health/index.js'`). Established Stories 1.1–1.4; violating it breaks `tsc --noEmit`. Cross-workspace imports from `@bomb-squad/shared` use the bare specifier (no extension). No source `.js` files exist — TypeScript only.

### Dependency choices (verified 2026-06-11)

- `ioredis@5.11.1` — the standard typed Redis client; ships its own TypeScript types (no `@types/ioredis` needed — that package is deprecated/stale). Pure JS.
- `pg@8.21.0` — node-postgres; `pg.Pool` is the pooling primitive AC2 wants. Pure JS (the optional native `pg-native` binding is **not** used — do not add it).
- `@types/pg@8.20.0` — `pg` ships no bundled types, so this devDep is required for `tsc`.
- None require a native build ⇒ **do not** extend `pnpm.onlyBuiltDependencies` (currently `["esbuild"]`).

### Previous-story learnings (Stories 1.1–1.4) that apply here

- **Pure/impure split for testability** — factories take injected clients; impure construction + side-effecting registration live only in `start()`. (Story 1.4's `process.exit`-on-import bug.)
- **Prove the test gate is real** — a deliberately broken assertion must turn the suite red before you declare done (Story 1.1 false-green).
- **`pnpm install` from repo root** after adding deps, before tests/build (updates lockfile).
- **No `// @ts-ignore`** — `pnpm -r exec tsc --noEmit` and CI enforce it. Type the fakes properly (implement `RedisLike`/`PoolLike`).
- **Node engine warning is expected** (local v25 vs pinned `>=20 <21`) — non-blocking, do not chase it.
- **No shared root tsconfig** — each workspace owns its own.

### Project Context Rules (binding — from project-context.md)

- **State boundaries (the heart of this story):** Redis holds all in-flight session state with **O(1)** keyed access — no full-session scans on the hot path. Postgres receives writes **only at session end or defined checkpoints, never at tick rate** — so this story's PG adapter has no write path at all. LiveKit's own Redis usage is **isolated** — do not build application logic on it, and do not share this adapter's client with any LiveKit concern.
- **Handler = I/O, reducer = logic:** these adapters are the I/O layer handlers will call (`parse → load state → call reducer → persist → emit`). Keep zero game logic in `state/`/`persistence/`. Reducers must never import `ioredis`/`pg` — these adapters are imported by *handlers* (Story 1.6+), never by reducers.
- **Secrets via `.env` only:** read `config.REDIS_URL` / `config.DATABASE_URL`; never hardcode a URL or read `process.env` directly. `.env` stays git-ignored; `.env.example` already documents both keys.
- **Typed everything / no untyped escapes:** `getJSON<T>`/`setJSON<T>` are generic; the fakes implement the typed `RedisLike`/`PoolLike` interfaces. `tsc --noEmit` clean, no `@ts-ignore`.
- **Async I/O awaited cleanly, never fire-and-forget:** every store call is awaited; the readiness gate `await`s `runAll()` before calling `next()`.
- **Separate `tsconfig.json` per workspace** — already satisfied; don't merge.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.5: Data-Store Adapters — Redis Keyspace & Postgres Pool] (the three Given/When/Then ACs)
- [Source: _agent_docs/game-architecture.md#Data Architecture → Redis Keyspace] (exact `session:{id}:...` key shapes; "O(1) keyed access only", "BombContext stored once per team-round, read-only")
- [Source: _agent_docs/game-architecture.md#Data Architecture → Persistence (Postgres)] ("single transaction at session end; no writes during play; no mid-round queries; connection pooling via pg-pool; archive only")
- [Source: _agent_docs/game-architecture.md#Project Structure → apps/server] (`state/` = "Redis read/write adapters (keyspace owners)"; `persistence/` = "Postgres writers — session-end only")
- [Source: _agent_docs/game-architecture.md#Integration boundaries] (`Server ↔ Redis` via `ioredis` O(1) keyed; `Server ↔ Postgres` via `pg-pool` single tx at session end; `LiveKit ↔ Redis` isolated)
- [Source: _agent_docs/game-architecture.md#Deployment Architecture] ("All services have health checks; the game server waits on Redis + Postgres health before accepting connections" — the readiness behavior AC3 completes)
- [Source: _agent_docs/game-architecture.md#Performance] ("Redis O(1) per game action; no full-session scans"; "No Postgres on the tick path — single tx at session end")
- [Source: _agent_docs/project-context.md#State Boundaries / Performance Rules / Critical Don't-Miss Rules] (Redis in-flight + O(1); Postgres archive-only via pg-pool, never per-request connection; LiveKit Redis isolated)
- [Source: _agent_docs/implementation-artifacts/1-4-server-bootstrap-fastify-socketio-health.md] (health registry mechanism; "Story 1.5 registers Redis/Postgres probes"; pure/impure split; `buildServer`/`start`/shutdown shape; `.js` extension + Jest ESM recipe)
- [Source: apps/server/src/health/registry.ts] (existing `HealthRegistry.register/unregister/runAll`; the two behaviors to harden)
- [Source: apps/server/src/index.ts] (existing `buildServer`/`start`/graceful-shutdown to extend, not rewrite)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md#Deferred from: code review of story-1.4] (malformed-probe-result + duplicate-name register deferrals, explicitly tagged "revisit in Story 1.5")
- Verified versions (2026-06-11): `ioredis@5.11.1`, `pg@8.21.0`, `@types/pg@8.20.0`. `pg.Pool` supersedes the standalone `pg-pool` package — do not add `pg-pool` separately.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- ioredis NodeNext import: `import { Redis } from 'ioredis'` + `InstanceType<typeof Redis>` required — `import Redis from 'ioredis'` fails TypeScript under `NodeNext` module resolution because the namespace export isn't constructable as a default. Named export works correctly.

### Completion Notes List

- **Redis keyspace (AC1):** `state/keys.ts` implements 6 pure key-builder functions as the single source of truth. `state/redis.ts` wraps `RedisLike` via `createRedisStore` with O(1)-only `getJSON`/`setJSON`/`del`/`ping`/`isReady`. No `KEYS`/`SCAN` calls anywhere. `state/index.ts` provides `connectRedis(url)` factory with `lazyConnect:true`, `maxRetriesPerRequest:1`, and error-event logging.
- **Postgres adapter (AC2):** `persistence/postgres.ts` wraps `PoolLike` via `createPostgresArchive` exposing only `ping()`/`close()`. Zero write methods — this is intentional; archive writes are Story 8.10. `persistence/index.ts` provides `connectPostgres(url)` factory using `pg.Pool` with error-event logging.
- **Health gate (AC3):** `health/registry.ts` hardened: `runAll()` normalizes `undefined`/`null`/non-`{ok:boolean}` probe results to `{ok:false, detail:'malformed readiness result'}`; `register()` now throws on duplicate names (fail-loud). Both probes registered in `start()` (not module-load — keeps adapters import-safe for tests). Socket.IO `io.use` middleware gates new connections on `healthRegistry.runAll().healthy`. Boot-time Redis connect failure is caught/logged, not fatal — server stays up and serves `/health` as 503.
- **Graceful shutdown extended:** `redis.quit()` then `pool.end()` after HTTP/socket layer closes; each wrapped so errors are logged, not fatal.
- **Two Story 1.4 health-registry deferrals resolved** and marked in `deferred-work.md`.
- **Test gate proven real:** a deliberate broken assertion turned the suite red; reverted before finalizing.
- **Integration coverage explicitly deferred:** live Redis/Postgres round-trips are covered by the Story 1.8 Docker Compose smoke test. Manual boot checks skipped (no local stores without Docker).

### File List

- `apps/server/package.json` — added `ioredis@^5.11.1`, `pg@^8.21.0` (deps); `@types/pg@^8.20.0` (devDep)
- `pnpm-lock.yaml` — updated by `pnpm install`
- `apps/server/src/state/keys.ts` — NEW: pure Redis key-builder functions (keyspace SSOT)
- `apps/server/src/state/redis.ts` — NEW: `RedisLike` interface + `createRedisStore` factory
- `apps/server/src/state/index.ts` — NEW: `connectRedis(url)` factory + barrel re-exports
- `apps/server/src/state/__tests__/keys.test.ts` — NEW: exact key-string assertions
- `apps/server/src/state/__tests__/redis.test.ts` — NEW: fake-client round-trip + no-scan assertion
- `apps/server/src/persistence/postgres.ts` — NEW: `PoolLike` interface + `createPostgresArchive` factory
- `apps/server/src/persistence/index.ts` — NEW: `connectPostgres(url)` factory + barrel re-exports
- `apps/server/src/persistence/__tests__/postgres.test.ts` — NEW: fake-pool ping/close + no-write-method assertion
- `apps/server/src/health/registry.ts` — UPDATED: malformed-result normalization + duplicate-name throw
- `apps/server/src/__tests__/health.test.ts` — UPDATED: added hardening tests (malformed + duplicate)
- `apps/server/src/index.ts` — UPDATED: store connect, probe registration, io.use gate, shutdown close
- `_agent_docs/implementation-artifacts/deferred-work.md` — UPDATED: Story 1.4 deferrals marked RESOLVED
- `_agent_docs/implementation-artifacts/sprint-status.yaml` — UPDATED: 1-5 status → review

## Change Log

- 2026-06-12: Story 1.5 implemented — Redis keyspace adapter (O(1) key-builders + typed get/set/del/ping/isReady), Postgres pool adapter (pool + SELECT 1 health probe, no writes), health-registry hardening (malformed-result normalization, duplicate-name throw), Socket.IO readiness gate, boot wiring + graceful shutdown. 38 tests pass, `tsc --noEmit` clean. Status: review.

- 2026-06-11: Story 1.5 drafted — Redis keyspace adapter (O(1) key-builders + get/set/del/ping) + Postgres pool adapter (pool + SELECT 1 health, no writes) + health-registry hardening (malformed-result normalization, duplicate-name throw, resolving two Story 1.4 deferrals) + Socket.IO readiness connection gate. Status: ready-for-dev.

## Review Findings (Code Review 2026-06-12)

Three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 3 ACs **SATISFIED**; no AC violations. 3 patch items, 3 deferred, 9 dismissed as noise/handled.

- [x] [Review][Patch] `getJSON` throws on malformed/empty-string value instead of returning `null` [apps/server/src/state/redis.ts:getJSON] — **FIXED.** `JSON.parse` is now wrapped; a non-null, non-JSON value (incl. empty string) throws a descriptive `RedisStore.getJSON: malformed JSON at key "<key>": <reason>` instead of a raw `SyntaxError`, and never silently `null` (which would mask data loss). Two regression tests added.
- [x] [Review][Patch] No timeout on readiness probes — a black-holed store hangs `/health` and every handshake [apps/server/src/state/redis.ts:ping, apps/server/src/persistence/postgres.ts:ping] — **FIXED.** Bounded the client waits: ioredis `connectTimeout`/`commandTimeout: 2000` (`state/index.ts`), pg `connectionTimeoutMillis`/`query_timeout: 2000` (`persistence/index.ts`). A half-open endpoint now makes the probe reject fast rather than wedge `runAll()`.
- [x] [Review][Patch] `io.use` readiness gate has no try/catch — a rejecting `runAll()` hangs the handshake [apps/server/src/index.ts:79-89] — **FIXED.** Gate body wrapped in try/catch; any throw out of `runAll()` now logs and rejects the handshake with `SERVER_NOT_READY` (defense-in-depth, `next()` is always called).
- [x] [Review][Defer] Signal during the blocking `await redisClient.connect()` is unguarded [apps/server/src/index.ts:59-63,119-120] — deferred, extends the pre-existing "signal before listen" shutdown-robustness item in deferred-work.md (Story 1.5 widened the window by inserting a blocking connect before handler registration).
- [x] [Review][Defer] Adapter error events log via `console.error`, bypassing the pino logger; unbounded reconnect-storm spam [apps/server/src/state/index.ts:790-792, apps/server/src/persistence/index.ts:558-560] — deferred, operational polish (non-fatal; crash already prevented by the attached handlers). Inject `fastify.log` into the factories and/or cap reconnect logging.
- [x] [Review][Defer] Key-builders don't guard `sessionId`/`teamId` containing `:` or empty string [apps/server/src/state/keys.ts] — deferred, spec-sanctioned ("keep IDs from containing `:` is a later-story concern; join codes are alphanumeric").
