# open-agents web (Next.js) for Railway.
#
# Build context is the REPO ROOT (pnpm workspace). Reference from railway.json
# with "dockerfilePath": "deploy/web/Dockerfile" and the service root set to the
# repo root.
#
# Sandbox dispatch: this image runs in SUBPROCESS mode (MCP_JS_WORKER_MODE=
# subprocess) — the web container spawns one `mcp-v8` worker process per session
# itself (a single-host Raft cluster: a long-lived "main" coordinator + per-
# session learner nodes), instead of talking to a separate shared mcp-js service
# over MCP_JS_BASE_URL. To do that it embeds the `mcp-v8` binary and the same
# bundled toolbox languages + rego policies the standalone mcp-js image ships
# (see deploy/mcp-js/Dockerfile), so subprocess workers reach feature parity.
#
# Persistence: subprocess workers keep their content-addressed store under
# MCP_JS_STORAGE_DIR (/data/.mcp-js). Mount a Railway volume at /data on the web
# service to persist session state across redeploys; without it the store is
# ephemeral (lost on every deploy). See deploy/README.md.
#
# Migrations run at container start (not build time, when the DB isn't reachable).

# ── gen: vendor + generate bootstrap.js (bundled languages), mirrors mcp-js ──
FROM node:22-bookworm-slim AS gen
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY deploy/mcp-js/fetch-vendor.sh deploy/mcp-js/build-bootstrap.mjs ./
COPY deploy/mcp-js/src ./src
COPY deploy/mcp-js/engines ./engines
RUN ./fetch-vendor.sh
RUN node build-bootstrap.mjs /build/bootstrap.js

# ── mcpv8: fetch the prebuilt mcp-v8 release binary (matches the mcp-js image) ─
FROM debian:bookworm-slim AS mcpv8
ARG MCP_V8_VERSION=v0.18.0-rc.1
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in \
        arm64) suffix="-arm64" ;; \
        *) suffix="" ;; \
    esac \
    && curl -fsSL "https://github.com/r33drichards/mcp-js/releases/download/${MCP_V8_VERSION}/mcp-v8-linux${suffix}.gz" \
       | gunzip > /mcp-v8 \
    && chmod +x /mcp-v8

# ── base ──────────────────────────────────────────────────────────────────
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

# mcp-v8 needs CA certs for fetch() TLS; the slim base omits them.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

# Subprocess sandbox runtime: the mcp-v8 binary + bundled languages/policies,
# at the paths apps/web/lib/sandbox/config.ts expects.
COPY --from=mcpv8 /mcp-v8 /usr/local/bin/mcp-v8
COPY --from=gen /build/bootstrap.js /opt/languages/bootstrap.js
COPY --from=gen /build/vendor/picat.wasm /build/vendor/tla_checker.wasm \
                /build/vendor/minizinc.wasm /build/vendor/acadlisp.wasm \
                /build/vendor/lua.wasm /build/vendor/craftos.wasm /opt/languages/
COPY deploy/mcp-js/fetch.rego deploy/mcp-js/filesystem.rego /opt/languages/

# Per-session subprocess dispatch (see apps/web/lib/sandbox/config.ts). Heap
# snapshots stay OFF (incompatible with the bundled WASM languages); cross-run
# state lives in the per-session filesystem. Persistent fs snapshots are left to
# the deploy env (MCP_JS_FS_SNAPSHOTS) so the /data volume / store backend is an
# explicit choice — see deploy/README.md.
ENV MCP_JS_WORKER_MODE=subprocess \
    MCP_JS_BIN=/usr/local/bin/mcp-v8 \
    MCP_JS_STORAGE_DIR=/data/.mcp-js \
    MCP_JS_BUNDLED_LANGUAGES=true \
    MCP_JS_LANGUAGES_DIR=/opt/languages

# Apply DB migrations, then start. Run from apps/web so migrate.ts resolves its
# relative "./lib/db/migrations" folder. Railway injects PORT; Next honours it.
WORKDIR /app/apps/web
CMD ["sh", "-c", "node lib/db/migrate.ts && pnpm exec next start -p ${PORT:-3000}"]
