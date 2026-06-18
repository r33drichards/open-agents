# Railway deploy

The default topology runs the web service **self-contained**: it bundles the
`mcp-v8` binary and the toolbox languages and spawns its own per-session
sandbox workers (subprocess mode), with filesystem snapshots in a shared MinIO
bucket. A separate standalone mcp-js service is still available as an
alternative (shared mode) and is described at the end.

## Default topology (self-contained web + MinIO)

```
                 ┌────────────────────── web service ──────────────────────┐
                 │ Next.js app                                              │
  user ──HTTPS──▶│  └─ SubprocessWorkerProvider                            │
   (public)      │       ├─ coordinator  mcp-v8 (local, 127.0.0.1:47600/1) │
                 │       └─ per session:  mcp-v8 child (SSE, ephemeral port)│──┐
                 │  /data volume: session DBs + s3 cache                    │  │ fs
                 └──────────────────────────────────────────────────────────┘  │ snapshots
                          │ Postgres (DATABASE_URL)        MinIO ◀──────────────┘ (S3)
                          ▼                                (minio.railway.internal:9000)
                     Railway Postgres
```

Three services on one Railway project (plus a Postgres plugin):

- **web** — the Next.js app **and** the mcp-js runtime. Build context = repo
  root, `dockerfilePath = deploy/web/Dockerfile`. The only service with a public
  domain. In subprocess mode it runs a local coordinator (`mcp-v8` voter on
  fixed ports 47600/47601) plus one `mcp-v8` child process per session (a
  non-voting learner serving SSE on an ephemeral port). The image bundles the
  binary, the language wasm + `bootstrap.js`, and the fetch/filesystem Rego
  policies under `/opt/languages`.
- **minio** — S3-compatible blob store for the per-session filesystem snapshots
  (internal only). See [`deploy/minio/README.md`](minio/README.md).
- **Postgres** — Railway Postgres plugin.

### web service variables

Set on the **web** service. The image already defaults the subprocess/language
vars (see the Dockerfile `ENV`), so the required set is small.

| Variable | Value |
|---|---|
| `POSTGRES_URL` | `${{Postgres.DATABASE_URL}}` |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/web/Dockerfile` (monorepo: build context = repo root) |
| `BOTID_DISABLED` | `true` (no Vercel BotId off-Vercel) |
| `RATE_LIMIT_DISABLED` | `true` (no Redis) |
| `BETTER_AUTH_URL` | the web service's public URL |
| `BETTER_AUTH_SECRET` | session signing secret |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_RESOURCE_NAME` / `AZURE_OPENAI_DEPLOYMENT` / `AZURE_OPENAI_API_VERSION` | the model backend |

Baked into the image (override only to change behavior):

| Variable | Default | Purpose |
|---|---|---|
| `MCP_JS_WORKER_MODE` | `subprocess` | spawn a local `mcp-v8` per session |
| `MCP_JS_BUNDLED_LANGUAGES` | `true` | launch workers with the toolbox languages |
| `MCP_JS_LANGUAGES_DIR` | `/opt/languages` | where the bundled assets live |
| `MCP_JS_STORAGE_DIR` | `/data` | session DBs + s3 cache (mount a volume here) |
| `MCP_JS_FS_SNAPSHOTS` | `true` | persist per-session `/work` across runs |

MinIO/S3 vars (set these to use the shared bucket; otherwise fs snapshots fall
back to a node-local dir store on the `/data` volume):

| Variable | Value |
|---|---|
| `MCP_JS_S3_BUCKET` | `mcpjs-fs` |
| `AWS_ENDPOINT_URL` | `http://minio.railway.internal:9000` |
| `AWS_S3_FORCE_PATH_STYLE` | `true` |
| `AWS_ACCESS_KEY_ID` | `${{minio.MINIO_ROOT_USER}}` |
| `AWS_SECRET_ACCESS_KEY` | `${{minio.MINIO_ROOT_PASSWORD}}` |
| `AWS_REGION` | `us-east-1` |

Optional: set `MCP_JS_ALLOW_COMMAND_OVERRIDE=true` to let a session's edited
launch command (from the new-session UI) actually be spawned. It is **off by
default** because the override runs an arbitrary process inside the web
container — only enable it on a trusted, single-tenant deployment.

### Requirements & notes

- **Mount a Railway volume on web at `/data`.** It holds per-session DBs and the
  S3 write-through cache; without it, session state resets on every redeploy.
- The web container hosts N child `mcp-v8` processes, so size its CPU/RAM for
  concurrent sessions (each language wasm module reserves up to its cap).
- The coordinator wipes only its own Raft membership on restart; per-session
  DBs under `/data/sessions/<sessionId>` and blobs in MinIO persist.
- Migrations run at container start (`migrate.ts`), so attach Postgres first.
- Heap snapshots stay OFF (they disable WebAssembly); cross-call state lives in
  the `/work` filesystem, not JS globals.

### CLI sketch

```bash
railway init -n open-agents

# postgres
railway add -d postgres

# minio — internal only; bitnami image auto-creates the bucket
railway add -s minio -i bitnami/minio:latest
railway service minio && railway volume add -m /bitnami/minio/data
railway variables -s minio \
  --set MINIO_ROOT_USER=mcpjs \
  --set MINIO_ROOT_PASSWORD=<secret> \
  --set MINIO_DEFAULT_BUCKETS=mcpjs-fs

# web — the only public service; mount a volume for /data
railway add -s web
railway service web && railway volume add -m /data
railway domain -s web   # note the URL for BETTER_AUTH_URL
railway variables -s web \
  --set RAILWAY_DOCKERFILE_PATH=deploy/web/Dockerfile \
  --set 'POSTGRES_URL=${{Postgres.DATABASE_URL}}' \
  --set BOTID_DISABLED=true --set RATE_LIMIT_DISABLED=true \
  --set MCP_JS_S3_BUCKET=mcpjs-fs \
  --set AWS_ENDPOINT_URL=http://minio.railway.internal:9000 \
  --set AWS_S3_FORCE_PATH_STYLE=true --set AWS_REGION=us-east-1 \
  --set 'AWS_ACCESS_KEY_ID=${{minio.MINIO_ROOT_USER}}' \
  --set 'AWS_SECRET_ACCESS_KEY=${{minio.MINIO_ROOT_PASSWORD}}' \
  --set BETTER_AUTH_URL=https://<web-domain> --set BETTER_AUTH_SECRET=... # + AZURE_OPENAI_*
railway up -s web -d   # build context = repo root
```

## Layout

```
deploy/
  web/      Dockerfile (Next.js + bundled mcp-v8 + languages) + railway.json
  minio/    README (image service config; no build)
  mcp-js/   Dockerfile + language build assets — the standalone shared-mode runtime
```

## Alternative: standalone mcp-js service (shared mode)

Instead of the self-contained web image you can run a separate **mcp-js**
service (`deploy/mcp-js/`) and point web at it. This was the original topology.

- mcp-js: toolbox-style `mcp-v8` image (single node, `--fs-store dir` on a
  `/data` volume), internal only, SSE at `/sse` + REST at `/api/exec` on port
  3000, reachable at `http://mcp-js.railway.internal:3000`.
- web: set `MCP_JS_WORKER_MODE=shared` (overriding the image default) and
  `MCP_JS_BASE_URL=http://mcp-js.railway.internal:3000`. No local subprocess
  workers, no MinIO, no `/data` volume on web. Per-session heap + filesystem
  live on the mcp-js service (keyed by `X-MCP-Session-Id`).

Session **fork** works in both modes (it reads the source's snapshots and seeds
the new session).
