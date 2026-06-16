# mcp-js (r33drichards/mcp-js) sandbox backend for open-agents — Railway.
#
# Based on the toolbox image (scratch + prebuilt mcp-v8 release binary + the
# eight bundled languages and the craftos upstream), but on mcp-v8 v0.15.0 and
# switched from --stateless to a STATEFUL, fs-snapshot configuration so each
# agent session gets a persistent V8 heap and content-addressed filesystem.
#
# Storage is node-local on a Railway volume mounted at /data (single instance;
# fs snapshots only need shared S3 in a multi-node cluster). The container runs
# as root so it can write that volume — the V8 isolate, not the OS user, is the
# sandbox boundary here.
#
# Endpoint: SSE MCP at /sse (+ POST /message), REST at /api/exec, on :3000.

# ── Stage 1: vendor + generate bootstrap.js (the bundled languages) ─────────
FROM node:22-bookworm-slim AS gen
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Build context is the repo root (Railway monorepo: RAILWAY_DOCKERFILE_PATH=
# deploy/mcp-js/Dockerfile), so these paths are repo-root-relative.
COPY deploy/mcp-js/fetch-vendor.sh deploy/mcp-js/build-bootstrap.mjs ./
COPY deploy/mcp-js/src ./src
COPY deploy/mcp-js/engines ./engines
RUN ./fetch-vendor.sh
RUN node build-bootstrap.mjs /build/bootstrap.js

# ── Stage 2: assemble a minimal rootfs for the scratch image ───────────────
FROM debian:bookworm-slim AS rootfs

ARG MCP_V8_VERSION=v0.15.1
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Prebuilt mcp-v8 release binary (linux x86_64 / arm64).
RUN case "${TARGETARCH}" in \
        arm64) suffix="-arm64" ;; \
        *) suffix="" ;; \
    esac \
    && curl -fsSL "https://github.com/r33drichards/mcp-js/releases/download/${MCP_V8_VERSION}/mcp-v8-linux${suffix}.gz" \
       | gunzip > /mcp-v8 \
    && chmod +x /mcp-v8

# Collect everything the binary needs at its expected paths: the ELF
# interpreter + linked glibc libs (from ldd), NSS libs + nsswitch.conf (so
# fetch() can resolve DNS in a scratch image), CA certs, and writable
# /tmp, /work, and /data (the persistent volume for heaps + fs snapshots).
RUN set -eux; \
    mkdir -p /rootfs/usr/local/bin /rootfs/etc/ssl/certs /rootfs/opt/languages \
             /rootfs/tmp /rootfs/work /rootfs/data; \
    cp /mcp-v8 /rootfs/usr/local/bin/mcp-v8; \
    ldd /mcp-v8 | awk '$2 == "=>" {print $3} $1 ~ /^\// {print $1}' | sort -u | while read -r lib; do \
        mkdir -p "/rootfs$(dirname "$lib")"; cp "$lib" "/rootfs$lib"; \
    done; \
    for nss in libnss_files libnss_dns libresolv; do \
        for f in /lib/*-linux-gnu*/${nss}.so* /lib/*-linux-gnu*/${nss}-*.so; do \
            [ -e "$f" ] || continue; \
            mkdir -p "/rootfs$(dirname "$f")"; cp "$f" "/rootfs$f"; \
        done; \
    done; \
    echo 'hosts: files dns' > /rootfs/etc/nsswitch.conf; \
    cp /etc/ssl/certs/ca-certificates.crt /rootfs/etc/ssl/certs/ca-certificates.crt

# Language assets + policies.
COPY --from=gen /build/bootstrap.js /rootfs/opt/languages/bootstrap.js
COPY --from=gen /build/vendor/picat.wasm /build/vendor/tla_checker.wasm \
                /build/vendor/minizinc.wasm /build/vendor/acadlisp.wasm \
                /build/vendor/lua.wasm /rootfs/opt/languages/
COPY deploy/mcp-js/fetch.rego deploy/mcp-js/filesystem.rego /rootfs/opt/languages/

# ── Stage 3: scratch ───────────────────────────────────────────────────────
FROM scratch

COPY --from=rootfs /rootfs /

# Bind a dual-stack IPv6 listener ("::" accepts IPv4 too on Linux) so the
# service is reachable over Railway's private network (mcp-js.railway.internal
# resolves to IPv6); this service has no public domain.
ENV MCP_V8_BIND_HOST=::

# Run as root so the Railway volume mounted at /data is writable (a scratch
# image can't chown a runtime-mounted volume; the V8 isolate is the sandbox).
EXPOSE 3000

# Stateful + per-session content-addressed filesystem, all on the /data volume:
#   --directory-path   heap snapshots (file-backed, node-local)
#   --session-db-path  session log + execution registry (+ fs-labels db)
#   --enable-fs-snapshots / --fs-store-dir  the CAS filesystem blobs
# (no --stateless: that conflicts with persistence). --enable-fs-snapshots with
# no fs policy defaults to an allow-all fs surface, which the bundled
# filesystem.rego then narrows.
ENTRYPOINT ["/usr/local/bin/mcp-v8", \
  "--sse-port", "3000", \
  "--directory-path", "/data/heaps", \
  "--session-db-path", "/data/sessions", \
  "--enable-fs-snapshots", \
  "--fs-store-dir", "/data/fs-blobs", \
  "--heap-memory-max", "1024", \
  "--execution-timeout", "300", \
  "--max-concurrent-executions", "100", \
  "--allow-external-modules", \
  "--instructions", "Sandboxed V8 JavaScript runtime (run_js) with fetch enabled and a persistent, per-session content-addressed filesystem at /work (await fs.writeFile('/work/x'), fs.readFile, fs.readdir, etc.) that survives across runs in the same session. Load language helpers once per run with (0,eval)(await fs.readFile('/opt/languages/bootstrap.js')) -> picat, tlaplus, minizinc, autolisp, lua, jsx, markdown, mermaid.", \
  "--mcp-server", "craftos=sse:https://craftos-mcp-production.up.railway.app/sse", \
  "--policies-json", "{\"fetch\":{\"policies\":[{\"url\":\"file:///opt/languages/fetch.rego\"}]},\"filesystem\":{\"policies\":[{\"url\":\"file:///opt/languages/filesystem.rego\"}]}}", \
  "--wasm-module", "picat=/opt/languages/picat.wasm:512m", \
  "--wasm-module", "tla=/opt/languages/tla_checker.wasm:512m", \
  "--wasm-module", "minizinc=/opt/languages/minizinc.wasm:1g", \
  "--wasm-module", "autolisp=/opt/languages/acadlisp.wasm:512m", \
  "--wasm-module", "lua=/opt/languages/lua.wasm:512m"]
