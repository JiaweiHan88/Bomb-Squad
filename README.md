# Bomb Squad

A real-time, voice-driven cooperative/competitive bomb-defusal party game that runs entirely in the desktop browser. Inspired by *Keep Talking and Nobody Explodes*, Bomb Squad supports 2–16 players in a sequential relay format where a **Defuser** must disarm puzzle modules on a ticking bomb while **Experts** consult the manual and communicate solutions over voice — but only the Defuser can see the bomb.

## Gameplay Overview

- Teams compete in relay rounds, each sending one Defuser at a time to defuse an identical bomb
- Experts read the manual (visible to everyone except the Defuser) and guide the Defuser verbally
- Three strikes and the bomb explodes; fastest defuse time wins the round
- A Facilitator manages sessions, configures rounds, and can pause/retry at any time
- Spectators watch with listen-only audio and can spend limited lifeline tokens to assist

## Puzzle Modules

Eleven modules spanning three difficulty tiers:

**Easy:** Wires, The Button, Passwords  
**Medium:** Keypads, Who's on First, Wire Sequences, Mazes  
**Hard:** Complicated Wires, Simon Says, Memory, Morse Code

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, React Three Fiber + Three.js, Zustand, Tailwind CSS, TypeScript |
| Backend | Node.js + Fastify, Socket.IO, Redis, PostgreSQL, TypeScript |
| Voice | LiveKit (self-hosted WebRTC SFU) + coturn (TURN relay) |
| Build & Deploy | pnpm workspaces (monorepo), Vite, Docker Compose, Caddy (TLS) |

## Architecture Highlights

- **Server-authoritative** — all game logic lives in pure reducers `(state, event) => state`; clients send intents and render state
- **Plugin module system** — adding a module is purely additive; the core bomb reducer never changes
- **Deterministic seeded generation** — both teams receive identical layouts with independent values; retries replay the exact same bomb
- **Timer via timestamp + extrapolation** — server broadcasts a timer descriptor on change; clients extrapolate per frame for smooth 60 fps with zero tick traffic
- **Voice as an independent subsystem** — the game stays fully playable if voice drops

## Project Structure

```
bomb-squad/
├── packages/
│   └── shared/          # Pure TypeScript — event types, game state, module interfaces
└── apps/
    ├── client/          # React + R3F frontend
    └── server/          # Fastify + Socket.IO backend
```

## Getting Started

### Prerequisites

- Node.js 20 LTS
- pnpm
- Docker + Docker Compose

### Local Development

```bash
pnpm install
cp .env.example .env              # fill in dev secrets
docker compose up -d redis postgres livekit coturn caddy
pnpm --filter @bomb-squad/shared build
pnpm --filter @bomb-squad/server dev
pnpm --filter @bomb-squad/client dev
bash scripts/smoke-test.sh        # verify all services are reachable
```

### Tests

```bash
pnpm -r test                      # all unit + integration tests
pnpm -r exec tsc --noEmit         # TypeScript must pass with zero errors
```

## Deployment

Self-hosted via Docker Compose. Minimum server: 2 vCPU, 4 GB RAM, 100 Mbps symmetric.

Required ports: `443` (HTTPS), `7880–7881` (LiveKit), `3478` (TURN), `50000–60000/udp` (RTP).

See `docker-compose.prod.yml` and `Caddyfile` for production configuration.

## Purpose

Bomb Squad is designed as a team-building and event game for groups of 2–16 players in a shared physical space or remote setting. The cooperative pressure of voice-only communication, the asymmetric information between Defuser and Experts, and the competitive relay format create high-stakes moments that are accessible to non-gamers while remaining challenging for experienced players.
