# Bomb Squad — Deployment Guide

## Quick Start

```bash
cp .env.example .env          # copy template
# Edit .env: fill in LIVEKIT_API_KEY, LIVEKIT_API_SECRET, TURN_SECRET with real values
docker compose up -d --wait   # start all services; --wait blocks until every
                              # health check passes (target: < 3 minutes).
                              # Without --wait the smoke test races startup
                              # (server alone has a 30 s health start_period).
bash scripts/smoke-test.sh    # verify all services are reachable
```

The stack targets a **spin-up time under 3 minutes** from `docker compose up` to all
health checks passing.

---

## Minimum Host Requirements

| Resource | Minimum |
|----------|---------|
| CPU      | 2 vCPU  |
| RAM      | 4 GB    |
| Network  | 100 Mbps symmetric |
| Storage  | 10 GB   |

---

## Required Open Ports

| Port | Protocol | Service | Purpose |
|------|----------|---------|---------|
| 443  | TCP | Caddy (HTTPS) | Main game entrypoint — all browser traffic |
| 80   | TCP | Caddy (HTTP) | Redirect to HTTPS + ACME challenges |
| 7880 | TCP | LiveKit | Signaling HTTP/WebSocket |
| 7881 | TCP | LiveKit | RTP over TCP (firewall fallback) |
| 3478 | TCP + UDP | coturn | STUN/TURN NAT traversal |
| 40000–40031 | UDP | coturn | TURN relay allocations (32 = 16 peers + headroom) |
| 7882 | UDP | LiveKit | RTP/ICE media (single UDP mux port) |

> **Right-sized for 16 players.** LiveKit is an SFU and muxes *all* participants
> over a **single** UDP port (`rtc.udp_port: 7882`) — port count is constant
> regardless of player count, so one port covers a full session. coturn allocates
> one relay port per peer that needs TURN fallback, so 32 ports cover all 16
> players (2× headroom). LiveKit's mux port and coturn's relay range stay
> **disjoint** so they never collide on a host UDP port.
>
> This also keeps total published UDP forwards small (~33), which matters on
> **Docker Desktop (Windows/macOS)**: its WSL2/HyperKit userland proxy caps total
> forwarded ports (~256) and reserves some host UDP bands (e.g. Windows reserves
> `50000–50059`). A large published range (the old `50000–50199` × two services)
> exceeds that cap and the second service fails to bind. On a Linux host you may
> alternatively give `livekit`/`coturn` `network_mode: host` and drop `ports:`
> entirely — no proxy, no cap — but that is **not supported on Docker Desktop**.

**Internal ports** (not publicly exposed): `redis:6379`, `postgres:5432`.
The game server's HTTP port (`${PORT}`, default `3001`) is published to the host
for debugging but all browser traffic flows through Caddy on port 443.

---

## Host-vs-Compose Environment Variables

`.env.example` uses `localhost` hostnames for host-run development (running the
server directly with `pnpm dev`). **Inside the Docker Compose network, services
address each other by service name, not `localhost`.**

| Variable | Host-run dev (`.env`) | In-compose override |
|----------|----------------------|---------------------|
| `REDIS_URL` | `redis://localhost:6379` | `redis://redis:6379` |
| `DATABASE_URL` | `postgresql://...@localhost:5432/bombsquad` | `postgresql://...@postgres:5432/bombsquad` |
| `LIVEKIT_URL` | `ws://localhost:7880` | `ws://livekit:7880` |

The `docker-compose.yml` already overrides these three in the `server.environment`
block. **Do not copy `.env` localhost URLs unchanged into a production environment**
— the server will fail to reach the data stores and `/health` will return 503
indefinitely.

---

## WebRTC / NAT Note

WebRTC requires HTTPS for browser microphone access in all non-localhost environments.
Caddy handles TLS termination; no extra configuration is required.

The highest technical risk for voice reliability is **symmetric-NAT corporate
firewalls**. coturn acts as the TURN relay fallback for clients behind such firewalls.
Before any team demo verify that:

- Port `3478` (TCP + UDP) is reachable from participant machines.
- The coturn TURN relay range `40000–40031/udp` is reachable from participant
  machines (relayed media flows over these ports — if they're blocked, the relay
  fallback silently fails).
- The LiveKit RTP mux port `7882/udp` is open outbound from the server.

---

## LiveKit API Keys

Dev defaults (`devkey` / `devsecret`) are acceptable for local smoke tests.
For production, generate strong random values and set them in `.env`:

```
LIVEKIT_API_KEY=<random-32-char-string>
LIVEKIT_API_SECRET=<random-64-char-string>
```

---

## TURN Secret

The `TURN_SECRET` drives time-limited HMAC-SHA1 credentials (TTL ≤ 86400 s).
Use a random secret of at least 32 characters in production.

---

## TLS in Production

Replace the `:443` block header in `Caddyfile` with your domain name and remove
the `tls internal` directive. Caddy will obtain and renew a Let's Encrypt cert
automatically, provided port 80 is open for the ACME HTTP-01 challenge.

---

## Deferred

`docker-compose.prod.yml` (production overlay with resource limits and
read-only filesystems) is out of scope for the current milestone and is noted
in `_agent_docs/implementation-artifacts/deferred-work.md`.
