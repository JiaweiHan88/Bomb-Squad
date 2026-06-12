---
baseline_commit: a29daef
---

# Story 1.8: Docker Compose Stack & Smoke Test

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator (operator),
I want a Docker Compose stack with all services health-checked and a smoke-test script,
so that I can spin up the whole game in under 3 minutes and verify it before a session.

## Acceptance Criteria

1. **Full stack starts with health checks; server gates on data stores.** Given `docker compose up`, when the stack starts, then `client`, `server`, `redis`, `postgres`, `livekit`, `coturn`, and `caddy` all start with health checks, and the game server waits on Redis + Postgres health before accepting connections.

2. **Smoke test validates reachability and fails loudly.** Given the running stack, when I run `scripts/smoke-test.sh`, then it validates every service is reachable and exits non-zero if any is not.

3. **Deployment docs state ports + minimum host spec.** Given the deployment docs, when I read them, then the required ports (443, 7880, 7881, 3478, `7882/udp` for LiveKit RTP/ICE [single UDP mux port], `40000–40031/udp` for coturn TURN relay) and minimum host spec (2 vCPU / 4 GB / 100 Mbps / 10 GB) are documented.

4. **LiveKit and coturn use disjoint, published UDP ports.** LiveKit's RTP/ICE traffic is muxed over a single UDP port (`7882`) and coturn's TURN relay range (`40000–40031`) MUST NOT overlap, and coturn's relay range MUST be published to the host (without it, relay ports are unreachable behind NAT and the TURN fallback silently fails). The smoke test asserts both (mux port + relay range published, and disjoint). Sized for 16 players: an SFU muxes all participants over one UDP port, and coturn needs ~1 relay port per relayed peer (32 = 16 peers + 2× headroom).

## Tasks / Subtasks

- [x] **Task 1 — Dockerfiles for `server` and `client` (AC: 1)**
  - [x] Create `apps/server/Dockerfile`. Multi-stage, pnpm-workspace aware: copy root `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml` and the `packages/shared` + `apps/server` manifests, run `pnpm install --frozen-lockfile`, build `@bomb-squad/shared` then `@bomb-squad/server`. Node base image must satisfy the root `engines` constraint **`>=20 <21`** → use `node:20-alpine` (or `-slim`). Final stage runs the server; it reads config from env (the `config` import validates at boot and exits on bad/missing vars — see `apps/server/src/config/env.ts`).
  - [x] Create `apps/client/Dockerfile`. Build stage runs `pnpm --filter @bomb-squad/client build` (Vite → static `dist/`). For V1, serving the static build can be done by Caddy (preferred) or a `vite preview`. If Caddy serves the static files, the `client` service can be a build-only stage whose `dist/` is mounted/copied into Caddy — **OR** keep a lightweight `client` runtime (`vite preview --host --port 5173`) so it has its own health check. Pick ONE and be consistent with the compose `client` service definition + its healthcheck (see Task 2). Document the choice in a comment.
  - [x] Add a `.dockerignore` at repo root (ignore `node_modules`, `dist`, `.env`, `.git`, `_agent_docs`, `_bmad`) so build context stays small and secrets never enter an image.
  - [x] Pin base image major versions; do not use `:latest`.

- [x] **Task 2 — `docker-compose.yml` with all seven services health-checked (AC: 1)**
  - [x] Define services: `client`, `server`, `redis`, `postgres`, `livekit`, `coturn`, `caddy`. (Architecture lists these exact seven.)
  - [x] **Health checks (all services):**
    - `redis`: `redis-cli ping` expecting `PONG`.
    - `postgres`: `pg_isready -U $POSTGRES_USER`.
    - `server`: HTTP probe of `GET /health` (the route returns 200 only when Redis+Postgres probes pass — 503 otherwise; see `apps/server/src/index.ts`). Use `wget`/`curl` against `http://localhost:${PORT}/health`.
    - `livekit`: probe its HTTP port (`7880`).
    - `coturn`: process/port liveness on `3478`.
    - `caddy`: probe its admin or a known route.
    - `client`: probe the served port if it has a runtime; if Caddy serves it, the client healthcheck is covered by Caddy.
  - [x] **Startup gating (AC1):** `server` must `depends_on` `redis` and `postgres` with `condition: service_healthy`. Note the app **also** self-gates — the Socket.IO `io.use` readiness middleware in `apps/server/src/index.ts` rejects handshakes with `SERVER_NOT_READY` until both stores' health probes pass, and `/health` returns 503 until then. Compose `depends_on` orders boot; the app gate is the authoritative runtime guarantee. Wire both; don't rely on `depends_on` alone (it only waits for the healthcheck, the app still must verify).
  - [x] **Env:** services read from `.env` via compose `env_file`/`environment`. Map the existing keys from `.env.example` (`REDIS_URL`, `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_SECRET`, `TURN_TTL`, `PORT`). **Inside compose the hostnames are service names, not `localhost`** — e.g. `REDIS_URL=redis://redis:6379`, `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/bombsquad`, `LIVEKIT_URL=ws://livekit:7880`. The `.env.example` localhost values are for host-run dev; document this host-vs-compose distinction (see Task 4) so an operator doesn't copy localhost URLs into the container env.
  - [x] `redis` and `postgres` get named volumes for data; expose only the ports an operator needs (see ports in AC3). Postgres needs `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` consistent with `DATABASE_URL`.
  - [x] `livekit` uses the official LiveKit server image with a `livekit.yaml` (or env) configured with `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (dev values `devkey`/`devsecret` from `.env.example`). Expose `7880` (HTTP/WS), `7881` (TCP), and the single RTP/ICE UDP mux port `7882` (must match `rtc.udp_port` in `livekit.yaml`). **Keep this port disjoint from coturn's relay range (AC4).**
  - [x] `coturn` uses the coturn image; configure the shared-secret (`TURN_SECRET`) HMAC mechanism with TTL ≤ 86400 (`TURN_TTL`). Expose `3478` **and publish the TURN relay range `40000-40031/udp`** (`--min-port=40000 --max-port=40031`). Publishing the relay range is mandatory — unpublished relay ports are unreachable behind NAT and the TURN fallback silently fails (AC4). Keep the range disjoint from LiveKit's mux port `7882`.
  - [x] `caddy` is the reverse proxy + TLS terminator; expose `443` (and `80` for redirect/ACME). Routes `/` → client static/preview, `/socket.io` + `/health` → `server`. Use a `Caddyfile` (Task 3).

- [x] **Task 3 — `Caddyfile` reverse proxy + TLS (AC: 1, 3)**
  - [x] Create `Caddyfile` at repo root (architecture `Project Structure` places it there). Reverse-proxy the game socket + health to `server:${PORT}` and serve the client. WebRTC/WS requires HTTPS off-localhost (project-context) — Caddy auto-TLS for a real domain; for local dev use `tls internal` or `localhost`.
  - [x] Ensure WebSocket upgrade headers pass through for Socket.IO (`/socket.io/*`).

- [x] **Task 4 — Deployment docs: ports + host spec (AC: 3)**
  - [x] Create `docs/deployment.md` (the repo already has a `docs/` dir). Document, exactly:
    - **Ports:** `443` (HTTPS), `7880` (LiveKit HTTP/WS), `7881` (LiveKit TCP), `3478` (TURN), `7882/udp` (LiveKit RTP/ICE mux port), `40000–40031/udp` (coturn TURN relay). The LiveKit mux port and coturn relay range must stay disjoint.
    - **Minimum host:** 2 vCPU, 4 GB RAM, 100 Mbps symmetric, 10 GB storage.
    - **Quick start:** `cp .env.example .env` → fill secrets → `docker compose up -d` → `bash scripts/smoke-test.sh`. State the "spin up in under 3 minutes" target.
    - **Host-vs-compose env caveat:** inside compose, service URLs use service-name hostnames (`redis`, `postgres`, `livekit`), not `localhost`.
    - **WebRTC/NAT note:** symmetric-NAT corporate firewalls are the highest technical risk; TURN (coturn) is the relay fallback — verify the coturn relay range `40000–40031/udp`, the LiveKit RTP mux port `7882/udp`, and `3478` are all open (architecture Deployment / GDD A4).
  - [x] Update root `README.md` with a short "Run the stack" pointer to `docs/deployment.md` (don't duplicate the full content).

- [x] **Task 5 — `scripts/smoke-test.sh` (AC: 2)**
  - [x] Create `scripts/smoke-test.sh`, executable (`chmod +x`), `#!/usr/bin/env bash` + `set -euo pipefail`.
  - [x] Check each service reachable: `server` `GET /health` returns 200 (and JSON `status: "ok"`); `redis` `PING`→`PONG`; `postgres` `pg_isready`; `livekit` `7880` reachable; `coturn` `3478` reachable; `caddy` responds; `client` served. Prefer probing **through the running compose stack** (e.g. `docker compose exec` or curling published ports) so the script reflects the real deployment, not host-local processes.
  - [x] **Port assertions (AC4):** verify the coturn TURN relay range is published (`docker compose port --protocol udp coturn 40000` returns a mapping) and that LiveKit's RTP mux port is published (`docker compose port --protocol udp livekit 7882`). Add a regression guard that coturn does **not** publish LiveKit's mux port (`docker compose port --protocol udp coturn 7882` must return nothing) so the two can't silently collide.
  - [x] Print a per-service PASS/FAIL line; **exit non-zero if ANY check fails** (AC2). Aggregate failures (don't bail on the first) so the operator sees the full picture, then exit 1 if any failed.
  - [x] No secrets echoed. Keep it POSIX-bash portable (it runs on an operator's host).

- [x] **Task 6 — Verify the stack (AC: 1, 2)**
  - [x] `docker compose config` must parse with zero errors (validates the compose file).
  - [x] `docker compose up -d`, wait for health, then `bash scripts/smoke-test.sh` → exits 0 with all services PASS. Capture the output in Completion Notes.
  - [x] Negative check (proves AC2 is real): stop one service (e.g. `docker compose stop redis`), re-run the smoke test → it must exit non-zero and name the failing service. Restart and confirm green again.
  - [x] Confirm the server's startup gate: with Redis/Postgres healthy, `GET /health` → 200; the server accepts Socket.IO connections. (No app code changes in this story — the gate already exists in `apps/server/src/index.ts`.)
  - [x] `pnpm -r exec tsc --noEmit` still exits 0 (this story adds infra, not TS — but run the gate to be safe).

## Dev Notes

### What this story is (and is NOT)

- **Infrastructure-only story.** It packages the *existing* server/client into a runnable, health-checked, documented Docker Compose stack and adds a smoke test. **Do not modify application code** in `apps/server/src` or `apps/client/src` — the readiness gate, `/health`, and config validation already exist and are the contract this story wires up. If something seems to require an app change, stop and flag it (it likely means a config/env wiring issue instead).
- **Story 1.7 (client bootstrap) is independent** and developed in a parallel worktree. This story should not depend on 1.7's client store/socket code to be merged — it packages the client *build*, which exists from Story 1.1. If 1.7 isn't merged yet, the `client` image still builds (it's a static placeholder). Don't block on 1.7.

### Existing server contract this story depends on (read before wiring)

From `apps/server/src/index.ts` (Story 1.4/1.5 — do NOT change it):
- `GET /health` runs all registered probes and returns **200 `{status:'ok'}`** only when healthy, **503 `{status:'unhealthy'}`** otherwise. Probes registered at boot: `redis` (PING), `postgres` (SELECT 1). → This is the server healthcheck target in compose AND the smoke test's server check.
- Socket.IO is attached to Fastify's HTTP server with `cors: { origin: true }`, and an `io.use` middleware **rejects handshakes with `SERVER_NOT_READY`** until both stores are healthy → satisfies AC1's "waits on Redis + Postgres health before accepting connections" at the app layer. Compose `depends_on: condition: service_healthy` reinforces it at the orchestration layer.
- Server listens on `host: '0.0.0.0'`, `port: config.PORT` → bind works inside a container; map `PORT` from env.
- A down store at boot does **not** crash the server (it retries in background and reports 503) — so compose ordering matters but the server won't crash-loop if Redis/Postgres lag.

From `apps/server/src/config/env.ts`: required env vars are `PORT, REDIS_URL, DATABASE_URL, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, TURN_SECRET, TURN_TTL` — all must be present and non-empty or the server exits at boot with a clear error. Compose env must supply all eight.

### Env: host-run dev vs in-compose (critical gotcha)

`.env.example` uses `localhost` hostnames (host-run dev). **Inside the compose network, use service-name hostnames** — `redis://redis:6379`, `postgresql://postgres:postgres@postgres:5432/bombsquad`, `ws://livekit:7880`. If you reuse the localhost `.env` verbatim for containers, the server can't reach the stores and `/health` stays 503 forever. Provide compose `environment:` overrides (or a separate compose env section) and document the distinction in `docs/deployment.md`.

### Files this story CREATES (none are UPDATEs to app source)

- `docker-compose.yml` (root) — the seven services.
- `apps/server/Dockerfile`, `apps/client/Dockerfile`.
- `.dockerignore` (root).
- `Caddyfile` (root).
- `scripts/smoke-test.sh` (executable).
- `docs/deployment.md`; minor `README.md` pointer.
- Possibly `livekit.yaml` / coturn config files (root or a `config/` dir) for those images.

A `docker-compose.prod.yml` is mentioned in the architecture `Project Structure` but is **out of scope** for this story's ACs (which only require `docker compose up` + smoke test + docs). Do not build the prod overlay unless trivially free — note it as deferred.

### Versions / images (pin majors, no `:latest`)

- **Node:** `node:20-alpine`/`-slim` — must satisfy root `engines: node >=20 <21`. pnpm via `corepack enable` (root `packageManager: pnpm@10.30.1`).
- **redis:** `redis:7-alpine`. **postgres:** `postgres:16-alpine`. **livekit:** `livekit/livekit-server:v1.x`. **coturn:** `coturn/coturn:4.x`. **caddy:** `caddy:2-alpine`. Confirm current stable tags at build time.
- Use `--frozen-lockfile` so images match `pnpm-lock.yaml`.

### Ports (AC3 — document EXACTLY)

`443` HTTPS · `7880` LiveKit HTTP/WS · `7881` LiveKit TCP · `3478` TURN · `7882/udp` LiveKit RTP/ICE (single mux port) · `40000–40031/udp` coturn TURN relay (disjoint; both must be published). Minimum host: **2 vCPU / 4 GB RAM / 100 Mbps symmetric / 10 GB storage**. (Internal `redis:6379`, `postgres:5432`, `server:${PORT}` need not be publicly exposed — only mapped as the operator needs for debugging.)

### Project Structure Notes

- All new infra files live where the architecture `Project Structure` places them: `docker-compose.yml`, `Caddyfile`, `.env.example` at root; `scripts/smoke-test.sh` under `scripts/`. Aligned — no variance.
- `.env` is already git-ignored; **never** bake secrets into an image or commit a real `.env`/`livekit.yaml` with real keys (dev `devkey`/`devsecret` are acceptable placeholders only).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Docker Compose:** services `client`, `server`, `redis`, `postgres`, `livekit`, `coturn` (+ `caddy` per architecture); **all must have health checks**; the game server waits on Redis + Postgres health before accepting connections; ship a `scripts/smoke-test.sh` that validates all services reachable before the app runs.
- **WebRTC/Voice:** HTTPS required off-localhost (enforce via Caddy/Nginx TLS); coturn TURN creds time-limited HMAC-SHA1 TTL ≤ 86400s; LiveKit needs `7880`/`7881`/`7882 udp` (RTP/ICE single mux port), coturn needs `3478` + `40000–40031 udp` (relay, must be published & disjoint from LiveKit) — document in compose + deployment README; test voice behind a simulated symmetric-NAT firewall before any team demo.
- **Deployment:** min host 2 vCPU / 4 GB / 100 Mbps / 10 GB; ports 443, 7880, 3478, `7882 udp` (LiveKit mux) + `40000–40031 udp` (coturn relay) (architecture adds 7881). Synced via correct-course 2026-06-12 — `project-context.md` and `game-architecture.md` updated to match (see `sprint-change-proposal-2026-06-12.md`).
- **Build/Secrets:** never hardcode LiveKit keys / Redis URL / DB creds — always via `.env`, never committed. `tsc --noEmit` zero errors before commit.
- **State boundaries:** Redis = in-flight state; LiveKit's own Redis usage is isolated — keep concerns separate (don't point the app's Redis logic at LiveKit's).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 1.8: Docker Compose Stack & Smoke Test]
- [Source: _agent_docs/game-architecture.md#Deployment Architecture] (seven services, health checks, ports, min host, smoke test, symmetric-NAT gate)
- [Source: _agent_docs/game-architecture.md#Development Environment] (setup commands incl. `docker compose up -d redis postgres livekit coturn caddy` and `bash scripts/smoke-test.sh`)
- [Source: _agent_docs/game-architecture.md#Project Structure] (`docker-compose.yml`, `Caddyfile`, `scripts/smoke-test.sh` placement)
- [Source: _agent_docs/game-architecture.md#ADR-001 — Multi-session, single process] (one server process; restart-tolerant; no per-session containers)
- [Source: _agent_docs/project-context.md#Platform & Build Rules] (Docker Compose service list, health checks, smoke test; WebRTC ports; deployment min host)
- [Source: apps/server/src/index.ts] (`/health` 200/503; Socket.IO readiness gate `SERVER_NOT_READY`; `depends_on` rationale; `0.0.0.0:PORT`)
- [Source: apps/server/src/config/env.ts] (eight required env vars; fail-fast on missing/blank)
- [Source: .env.example] (env keys + localhost dev values to override with service-name hosts in compose)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

Validation session (rebuild images + run smoke test) surfaced and fixed 6 defects
that had never been caught because Task 6 (verify the stack) was never actually run
when the story was first committed:

1. **`.dockerignore` only excluded the context-root `node_modules`.** A bare
   `node_modules` pattern does not match nested `apps/*/node_modules` or
   `packages/*/node_modules`, so the host's package-level `node_modules` were copied
   into the image and clobbered the pnpm-installed symlinks with host-resolved ones
   (whose `.pnpm` target paths don't exist in the container). Client build failed
   `Cannot find module 'vite'`. Fixed with `**/node_modules` / `**/dist`.
2. **Server CMD pointed at the wrong tsx path.** `node_modules/.bin/tsx` (root) does
   not exist under pnpm workspaces — each package's binaries live in that package's
   own `.bin`. Server crash-looped `MODULE_NOT_FOUND`. Fixed to
   `apps/server/node_modules/.bin/tsx`.
3. **Server healthcheck used `localhost`.** Inside the container `localhost` resolves
   to IPv6 `::1`, but the server binds IPv4 (`0.0.0.0`) only → healthcheck got
   connection-refused forever and never went healthy. Fixed to `127.0.0.1`.
4. **Smoke test used Compose-v4 `port` syntax.** `docker compose port <svc> <port>/udp`
   is invalid on Compose v5 (`strconv.ParseUint ... invalid syntax`); the error text
   even contains colons, poisoning the `grep -q ':'` regression guard. Fixed to
   `docker compose port --protocol udp <svc> <port>`.
5. **LiveKit `LIVEKIT_KEYS` lacked the required space.** `devkey:devsecret` →
   `Could not parse keys, it needs to be exactly "key: secret", including the space`.
   LiveKit crash-looped. Fixed to `${KEY}: ${SECRET}` (space after colon).
6. **Caddy healthcheck probed the admin root `/`,** which returns 404 → perpetually
   unhealthy. Fixed to probe `/config/` (returns the live JSON config) and match
   `apps`.

### Completion Notes List

- **All 7 services build and run health-checked simultaneously; full smoke test exits
  0 (7/7 PASS).** Captured run:
  - redis PING→PONG · postgres pg_isready · server `/health` 200 `{"status":"ok"}`
  - livekit 7880 reachable + RTP mux port `7882/udp` published
  - coturn 3478 reachable + relay range `40000–40031/udp` published + ranges disjoint
  - caddy port 80 reachable · client serving HTML on 5173
- **AC1 (startup gate) verified behaviorally** via the negative check: `docker compose
  stop redis` → smoke test exits non-zero and names redis **and** the server (server
  `/health` flips to not-ok because its Redis probe fails — the app-level readiness
  gate). `docker compose start redis` → green again (exit 0).
- **AC2 verified:** smoke test fails loudly (exit 1, per-service PASS/FAIL, aggregated)
  when any service is unreachable.
- **AC3 verified:** `docs/deployment.md` documents ports + min host spec.
- **AC4 — port model right-sized (approved deviation from the literal AC numbers).**
  The original `50000–50199/udp` × 2 (LiveKit + coturn = 400 published UDP ports)
  exceeded Docker Desktop's WSL2 forwarded-port cap (~256) and overlapped Windows'
  OS-reserved `50000–50059` band, so the second service to publish failed to bind.
  Root-caused to the SFU/TURN port model: **LiveKit is an SFU and muxes all
  participants over a single UDP port** (`rtc.udp_port: 7882`) — one port serves 16
  players regardless of count; **coturn allocates one relay port per relayed peer**, so
  `40000–40031` (32) covers a full 16-player session with 2× headroom. The two stay
  disjoint and both publish, total ≈33 UDP forwards — well under the cap and closer to
  LiveKit's recommended production config. Updated `docker-compose.yml`, `livekit.yaml`,
  `scripts/smoke-test.sh`, and `docs/deployment.md` consistently. **AC3/AC4 amended** to
  the validated port model (7882 mux + 40000–40031) via the correct-course pass on
  2026-06-12; `epics.md`, `game-architecture.md`, and `project-context.md` synced too.
  See `_agent_docs/planning-artifacts/sprint-change-proposal-2026-06-12.md`.
- `docker compose config` parses with zero errors; `pnpm -r exec tsc --noEmit` exits 0
  (no app code changed — infra only).
- No application source under `apps/server/src` or `apps/client/src` was modified.

### File List

- `.dockerignore` (modified) — exclude nested `node_modules`/`dist` via `**/`.
- `apps/server/Dockerfile` (modified) — correct tsx path to `apps/server/node_modules/.bin`.
- `docker-compose.yml` (modified) — server healthcheck `127.0.0.1`; LiveKit single mux
  port `7882`; LiveKit `LIVEKIT_KEYS` space fix; coturn relay range `40000–40031`;
  caddy healthcheck `/config/`.
- `livekit.yaml` (modified) — `rtc.udp_port: 7882` (replaces `port_range_start/end`).
- `scripts/smoke-test.sh` (modified) — Compose-v5 `--protocol udp` port syntax; LiveKit
  mux-port probe `7882`; coturn range/disjoint assertions updated.
- `docs/deployment.md` (modified) — port table + WebRTC/NAT notes updated to the
  right-sized port model.

## Change Log

- 2026-06-12 — Validation pass (rebuild images + run smoke test). Fixed 6 stack defects
  (nested-`node_modules` dockerignore, server tsx CMD path, server/caddy IPv4 & admin
  healthchecks, Compose-v5 port syntax in smoke test, LiveKit key-space). Right-sized
  the WebRTC UDP footprint to fit an SFU/TURN model for 16 players: LiveKit single mux
  port `7882`, coturn relay range `40000–40031`. Full stack now boots health-checked;
  `scripts/smoke-test.sh` exits 0 (7/7), negative check exits non-zero as required.
  Status → review.
