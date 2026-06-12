# syntax=docker/dockerfile:1
# Multi-stage build for @bomb-squad/server.
# Uses tsx to run TypeScript source directly so workspace imports from
# packages/shared (which exports its .ts source) resolve without a separate
# shared compile step.  Node base satisfies engines: ">=20 <21".

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# ── deps: install from lockfile (cached layer) ────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

# ── runtime: copy source on top of installed deps ────────────────────────────
FROM deps AS runtime
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
