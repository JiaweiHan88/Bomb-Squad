# syntax=docker/dockerfile:1
# Multi-stage build for @bomb-squad/client.
# Choice: vite preview runtime (not Caddy-served static) so the client
# service has its own health check independent of Caddy.
# Build stage compiles Vite → static dist/; runtime stage serves it via
# vite preview --host --port 5173 (no hot-reload, serves compiled assets).

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# ── deps: install from lockfile (cached layer) ────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/client/package.json apps/client/
RUN pnpm install --frozen-lockfile

# ── build: Vite → dist/ ───────────────────────────────────────────────────────
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY apps/client/ apps/client/
RUN pnpm --filter @bomb-squad/client build

# ── runtime: serve compiled dist via vite preview ────────────────────────────
FROM base AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/client ./apps/client
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
EXPOSE 5173
# pnpm workspaces install each package's binaries under that package's own
# node_modules/.bin (NOT the root .bin), so invoke vite through pnpm's package
# filter — it resolves the binary and runs from apps/client. Default preview
# host is localhost / port 4173; override to bind 0.0.0.0:5173 for the container.
CMD ["pnpm", "--filter", "@bomb-squad/client", "exec", "vite", "preview", "--host", "--port", "5173"]
