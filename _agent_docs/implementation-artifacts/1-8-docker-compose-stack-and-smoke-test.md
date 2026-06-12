---
baseline_commit: a29daef
---

# Story 1.8: Docker Compose Stack & Smoke Test

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator (operator),
I want a Docker Compose stack with all services health-checked and a smoke-test script,
so that I can spin up the whole game in under 3 minutes and verify it before a session.

## Acceptance Criteria

1. **Full stack starts with health checks; server gates on data stores.** Given `docker compose up`, when the stack starts, then `client`, `server`, `redis`, `postgres`, `livekit`, `coturn`, and `caddy` all start with health checks, and the game server waits on Redis + Postgres health before accepting connections.

2. **Smoke test validates reachability and fails loudly.** Given the running stack, when I run `scripts/smoke-test.sh`, then it validates every service is reachable and exits non-zero if any is not.

3. **Deployment docs state ports + minimum host spec.** Given the deployment docs, when I read them, then the required ports (443, 7880, 7881, 3478, 50000–60000/udp) and minimum host spec (2 vCPU / 4 GB / 100 Mbps / 10 GB) are documented.

## Tasks / Subtasks

- [ ] **Task 1 — Dockerfiles for `server` and `client` (AC: 1)**
  - [ ] Create `apps/server/Dockerfile`. Multi-stage, pnpm-workspace aware: copy root `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml` and the `packages/shared` + `apps/server` manifests, run `pnpm install --frozen-lockfile`, build `@bomb-squad/shared` then `@bomb-squad/server`. Node base image must satisfy the root `engines` constraint **`>=20 <21`** → use `node:20-alpine` (or `-slim`). Final stage runs the server; it reads config from env (the `config` import validates at boot and exits on bad/missing vars — see `apps/server/src/config/env.ts`).
  - [ ] Create `apps/client/Dockerfile`. Build stage runs `pnpm --filter @bomb-squad/client build` (Vite → static `dist/`). For V1, serving the static build can be done by Caddy (preferred) or a `vite preview`. If Caddy serves the static files, the `client` service can be a build-only stage whose `dist/` is mounted/copied into Caddy — **OR** keep a lightweight `client` runtime (`vite preview --host --port 5173`) so it has its own health check. Pick ONE and be consistent with the compose `client` service definition + its healthcheck (see Task 2). Document the choice in a comment.
  - [ ] Add a `.dockerignore` at repo root (ignore `node_modules`, `dist`, `.env`, `.git`, `_agent_docs`, `_bmad`) so build context stays small and secrets never enter an image.
  - [ ] Pin base image major versions; do not use `:latest`.

- [ ] **Task 2 — `docker-compose.yml` with all seven services health-checked (AC: 1)**
  - [ ] Define services: `client`, `server`, `redis`, `postgres`, `livekit`, `coturn`, `caddy`. (Architecture lists these exact seven.)
  - [ ] **Health checks (all services):**
    - `redis`: `redis-cli ping` expecting `PONG`.
    - `postgres`: `pg_isready -U $POSTGRES_USER`.
    - `server`: HTTP probe of `GET /health` (the route returns 200 only when Redis+Postgres probes pass — 503 otherwise; see `apps/server/src/index.ts`). Use `wget`/`curl` against `http://localhost:${PORT}/health`.
    - `livekit`: probe its HTTP port (`7880`).
    - `coturn`: process/port liveness on `3478`.
    - `caddy`: probe its admin or a known route.
    - `client`: probe the served port if it has a runtime; if Caddy serves it, the client healthcheck is covered by Caddy.
  - [ ] **Startup gating (AC1):** `server` must `depends_on` `redis` and `postgres` with `condition: service_healthy`. Note the app **also** self-gates — the Socket.IO `io.use` readiness middleware in `apps/server/src/index.ts` rejects handshakes with `SERVER_NOT_READY` until both stores' health probes pass, and `/health` returns 503 until then. Compose `depends_on` orders boot; the app gate is the authoritative runtime guarantee. Wire both; don't rely on `depends_on` alone (it only waits for the healthcheck, the app still must verify).
  - [ ] **Env:** services read from `.env` via compose `env_file`/`environment`. Map the existing keys from `.env.example` (`REDIS_URL`, `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_SECRET`, `TURN_TTL`, `PORT`). **Inside compose the hostnames are service names, not `localhost`** — e.g. `REDIS_URL=redis://redis:6379`, `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/bombsquad`, `LIVEKIT_URL=ws://livekit:7880`. The `.env.example` localhost values are for host-run dev; document this host-vs-compose distinction (see Task 4) so an operator doesn't copy localhost URLs into the container env.
  - [ ] `redis` and `postgres` get named volumes for data; expose only the ports an operator needs (see ports in AC3). Postgres needs `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` consistent with `DATABASE_URL`.
  - [ ] `livekit` uses the official LiveKit server image with a `livekit.yaml` (or env) configured with `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` (dev values `devkey`/`devsecret` from `.env.example`). Expose `7880` (HTTP/WS), `7881` (TCP), and the RTP UDP range `50000-60000`.
  - [ ] `coturn` uses the coturn image; configure the shared-secret (`TURN_SECRET`) HMAC mechanism with TTL ≤ 86400 (`TURN_TTL`). Expose `3478`.
  - [ ] `caddy` is the reverse proxy + TLS terminator; expose `443` (and `80` for redirect/ACME). Routes `/` → client static/preview, `/socket.io` + `/health` → `server`. Use a `Caddyfile` (Task 3).

- [ ] **Task 3 — `Caddyfile` reverse proxy + TLS (AC: 1, 3)**
  - [ ] Create `Caddyfile` at repo root (architecture `Project Structure` places it there). Reverse-proxy the game socket + health to `server:${PORT}` and serve the client. WebRTC/WS requires HTTPS off-localhost (project-context) — Caddy auto-TLS for a real domain; for local dev use `tls internal` or `localhost`.
  - [ ] Ensure WebSocket upgrade headers pass through for Socket.IO (`/socket.io/*`).

- [ ] **Task 4 — Deployment docs: ports + host spec (AC: 3)**
  - [ ] Create `docs/deployment.md` (the repo already has a `docs/` dir). Document, exactly:
    - **Ports:** `443` (HTTPS), `7880` (LiveKit HTTP/WS), `7881` (LiveKit TCP), `3478` (TURN), `50000–60000/udp` (RTP).
    - **Minimum host:** 2 vCPU, 4 GB RAM, 100 Mbps symmetric, 10 GB storage.
    - **Quick start:** `cp .env.example .env` → fill secrets → `docker compose up -d` → `bash scripts/smoke-test.sh`. State the "spin up in under 3 minutes" target.
    - **Host-vs-compose env caveat:** inside compose, service URLs use service-name hostnames (`redis`, `postgres`, `livekit`), not `localhost`.
    - **WebRTC/NAT note:** symmetric-NAT corporate firewalls are the highest technical risk; TURN (coturn) is the relay fallback — verify the `50000–60000/udp` range and `3478` are open (architecture Deployment / GDD A4).
  - [ ] Update root `README.md` with a short "Run the stack" pointer to `docs/deployment.md` (don't duplicate the full content).

- [ ] **Task 5 — `scripts/smoke-test.sh` (AC: 2)**
  - [ ] Create `scripts/smoke-test.sh`, executable (`chmod +x`), `#!/usr/bin/env bash` + `set -euo pipefail`.
  - [ ] Check each service reachable: `server` `GET /health` returns 200 (and JSON `status: "ok"`); `redis` `PING`→`PONG`; `postgres` `pg_isready`; `livekit` `7880` reachable; `coturn` `3478` reachable; `caddy` responds; `client` served. Prefer probing **through the running compose stack** (e.g. `docker compose exec` or curling published ports) so the script reflects the real deployment, not host-local processes.
  - [ ] Print a per-service PASS/FAIL line; **exit non-zero if ANY check fails** (AC2). Aggregate failures (don't bail on the first) so the operator sees the full picture, then exit 1 if any failed.
  - [ ] No secrets echoed. Keep it POSIX-bash portable (it runs on an operator's host).

- [ ] **Task 6 — Verify the stack (AC: 1, 2)**
  - [ ] `docker compose config` must parse with zero errors (validates the compose file).
  - [ ] `docker compose up -d`, wait for health, then `bash scripts/smoke-test.sh` → exits 0 with all services PASS. Capture the output in Completion Notes.
  - [ ] Negative check (proves AC2 is real): stop one service (e.g. `docker compose stop redis`), re-run the smoke test → it must exit non-zero and name the failing service. Restart and confirm green again.
  - [ ] Confirm the server's startup gate: with Redis/Postgres healthy, `GET /health` → 200; the server accepts Socket.IO connections. (No app code changes in this story — the gate already exists in `apps/server/src/index.ts`.)
  - [ ] `pnpm -r exec tsc --noEmit` still exits 0 (this story adds infra, not TS — but run the gate to be safe).

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

`443` HTTPS · `7880` LiveKit HTTP/WS · `7881` LiveKit TCP · `3478` TURN · `50000–60000/udp` RTP. Minimum host: **2 vCPU / 4 GB RAM / 100 Mbps symmetric / 10 GB storage**. (Internal `redis:6379`, `postgres:5432`, `server:${PORT}` need not be publicly exposed — only mapped as the operator needs for debugging.)

### Project Structure Notes

- All new infra files live where the architecture `Project Structure` places them: `docker-compose.yml`, `Caddyfile`, `.env.example` at root; `scripts/smoke-test.sh` under `scripts/`. Aligned — no variance.
- `.env` is already git-ignored; **never** bake secrets into an image or commit a real `.env`/`livekit.yaml` with real keys (dev `devkey`/`devsecret` are acceptable placeholders only).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Docker Compose:** services `client`, `server`, `redis`, `postgres`, `livekit`, `coturn` (+ `caddy` per architecture); **all must have health checks**; the game server waits on Redis + Postgres health before accepting connections; ship a `scripts/smoke-test.sh` that validates all services reachable before the app runs.
- **WebRTC/Voice:** HTTPS required off-localhost (enforce via Caddy/Nginx TLS); coturn TURN creds time-limited HMAC-SHA1 TTL ≤ 86400s; LiveKit needs `7880`/`7881`/`50000–60000 udp` — document in compose + deployment README; test voice behind a simulated symmetric-NAT firewall before any team demo.
- **Deployment:** min host 2 vCPU / 4 GB / 100 Mbps / 10 GB; ports 443, 7880, 3478, 50000–60000 udp (architecture adds 7881).
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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
