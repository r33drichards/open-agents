# open-agents web (Next.js) for Railway.
#
# Build context is the REPO ROOT (pnpm workspace). Reference from railway.json
# with "dockerfilePath": "deploy/web/Dockerfile" and the service root set to the
# repo root.
#
# Runs against a remote mcp-js sandbox (MCP_JS_BASE_URL) instead of spawning
# local subprocess workers, and against a Railway Postgres. Migrations run at
# container start (not build time, when the DB isn't reachable).

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ── deps: install the whole workspace from the lockfile ─────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
RUN pnpm install --frozen-lockfile

# ── build: compile the Next app (skip the package.json build's db:migrate) ──
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --dir apps/web exec next build

# ── run ─────────────────────────────────────────────────────────────────────
FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
# Apply DB migrations, then start. Railway injects PORT; Next honours it.
CMD ["sh", "-c", "node apps/web/lib/db/migrate.ts && pnpm --dir apps/web start -- -p ${PORT:-3000}"]
