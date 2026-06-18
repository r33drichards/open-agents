# open-agents web (Next.js) for Railway — SELF-CONTAINED subprocess mode.
#
# Build context is the REPO ROOT (pnpm workspace). Reference from railway.json
# with "dockerfilePath": "deploy/web/Dockerfile" and the service root set to the
# repo root.
#
# Unlike the shared-mode image, this one bundles the `mcp-v8` binary and the
# toolbox language assets so the web container runs its OWN mcp-js cluster:
# a local coordinator + one `mcp-v8` child process per session (subprocess
# mode). Per-session filesystem snapshots persist on the /data volume, or in
# MinIO/S3 when the AWS_* + MCP_JS_S3_BUCKET vars are set. Migrations run at
# container start (not build time, when the DB isn't reachable).

# ── gen: build the bundled language assets (bootstrap.js + vendored wasm) ────
# Mirrors deploy/mcp-js/Dockerfile's gen stage; sources live under deploy/mcp-js.
FROM node:22-bookworm-slim AS gen
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY deploy/mcp-js/fetch-vendor.sh deploy/mcp-js/build-bootstrap.mjs ./
COPY deploy/mcp-js/src ./src
COPY deploy/mcp-js/engines ./engines
RUN ./fetch-vendor.sh
RUN node build-bootstrap.mjs /build/bootstrap.js

# ── mcpv8: fetch the prebuilt mcp-v8 release binary (glibc linux) ────────────
FROM debian:bookworm-slim AS mcpv8
ARG MCP_V8_VERSION=v0.17.0
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in \
        arm64) suffix="-arm64" ;; \
        *) suffix="" ;; \
    esac \
    && curl -fsSL "https://github.com/r33drichards/mcp-js/releases/download/${MCP_V8_VERSION}/mcp-v8-linux${suffix}.gz" \
       | gunzip > /mcp-v8 \
    && chmod +x /mcp-v8

# ── base: pnpm workspace toolchain ───────────────────────────────────────────
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
# ca-certificates so spawned mcp-v8 workers can fetch() over TLS / resolve DNS.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app

# mcp-v8 binary on PATH (config default MCP_JS_BIN="mcp-v8").
COPY --from=mcpv8 /mcp-v8 /usr/local/bin/mcp-v8

# Bundled toolbox languages: wasm modules, the bootstrap.js loader, and the
# default fetch/filesystem Rego policies, at MCP_JS_LANGUAGES_DIR.
RUN mkdir -p /opt/languages /data /work
COPY --from=gen /build/bootstrap.js /opt/languages/bootstrap.js
COPY --from=gen /build/vendor/picat.wasm /build/vendor/tla_checker.wasm \
                /build/vendor/minizinc.wasm /build/vendor/acadlisp.wasm \
                /build/vendor/lua.wasm /build/vendor/craftos.wasm /opt/languages/
COPY deploy/mcp-js/fetch.rego deploy/mcp-js/filesystem.rego /opt/languages/

# Self-contained subprocess defaults (Railway env can override any of these).
# Filesystem snapshots default to the /data volume (node-local dir store); set
# MCP_JS_S3_BUCKET + AWS_* to upgrade the shared blob store to MinIO/S3.
ENV MCP_JS_WORKER_MODE=subprocess \
    MCP_JS_BUNDLED_LANGUAGES=true \
    MCP_JS_LANGUAGES_DIR=/opt/languages \
    MCP_JS_STORAGE_DIR=/data \
    MCP_JS_FS_SNAPSHOTS=true

# Apply DB migrations, then start. Run from apps/web so migrate.ts resolves its
# relative "./lib/db/migrations" folder. Railway injects PORT; Next honours it.
WORKDIR /app/apps/web
CMD ["sh", "-c", "node lib/db/migrate.ts && pnpm exec next start -p ${PORT:-3000}"]
