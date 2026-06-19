# Railway deploy

The **web** service runs the mcp-v8 sandbox in **subprocess mode**: it embeds
the `mcp-v8` binary and the bundled toolbox languages, and spawns one worker
process per session itself (a single-host Raft cluster — a long-lived "main"
coordinator + per-session learner nodes). There is no separate sandbox service
to run in the default topology.

- **web** — the Next.js app (`deploy/web/Dockerfile`, build context = repo
  root), the only service with a public domain. Talks to a Railway Postgres and
  spawns per-session `mcp-v8` workers in-container (subprocess dispatch). The
  image bakes `MCP_JS_WORKER_MODE=subprocess`, the `mcp-v8` binary at
  `/usr/local/bin/mcp-v8`, and the bundled languages + rego policies at
  `/opt/languages` (mirroring the standalone mcp-js image), so workers reach
  feature parity (picat, tla, minizinc, autolisp, lua, craftos + fetch/fs
  policies). Mount a Railway **volume at `/data`** so the per-session
  content-addressed store (`MCP_JS_STORAGE_DIR=/data/.mcp-js`) persists across
  redeploys.
- **mcp-js** *(optional / legacy)* — the standalone mcp-v8 sandbox service
  (`deploy/mcp-js/`). Only needed for the old **shared** topology, where web
  pointed at it over `MCP_JS_BASE_URL=http://mcp-js.railway.internal:3000`
  instead of spawning subprocess workers. Not used by the default image; keep it
  only if you set `MCP_JS_WORKER_MODE=shared` on web.

## Layout

```
deploy/
  mcp-js/   Dockerfile + railway.json + language build assets (shared by the web image's bundled-languages stage)
  web/      Dockerfile + railway.json
```

## web service

Service root = repo root, `dockerfilePath = deploy/web/Dockerfile`.

The Dockerfile already bakes the subprocess-dispatch configuration; the only
infra you must provide is a volume and the usual app variables.

**Volume:** mount a Railway volume at **`/data`** on the web service (persists
the per-session sandbox store). Without it the store is ephemeral and every
redeploy wipes session sandbox state.

Required variables:

| Variable | Value |
|---|---|
| `POSTGRES_URL` | Railway Postgres connection string (`${{Postgres.DATABASE_URL}}`) |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/web/Dockerfile` (monorepo: build context = repo root) |
| `BOTID_DISABLED` | `true` (no Vercel BotId off-Vercel) |
| `RATE_LIMIT_DISABLED` | `true` (no Redis) |
| `BETTER_AUTH_URL` | the web service's public URL (e.g. `https://web-…up.railway.app`) |
| `BETTER_AUTH_SECRET` | session signing secret |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_RESOURCE_NAME` / `AZURE_OPENAI_DEPLOYMENT` / `AZURE_OPENAI_API_VERSION` | the model backend |
| `AI_GATEWAY_API_KEY` | (optional) if using the gateway instead of Azure-only |

Optional sandbox overrides (sensible defaults are baked into the image):

| Variable | Default (image) | Notes |
|---|---|---|
| `MCP_JS_WORKER_MODE` | `subprocess` | set `shared` to fall back to a remote mcp-js service (then also set `MCP_JS_BASE_URL`) |
| `MCP_JS_STORAGE_DIR` | `/data/.mcp-js` | per-session content-addressed store (put it on the volume) |
| `MCP_JS_BUNDLED_LANGUAGES` | `true` | picat/tla/minizinc/autolisp/lua/craftos |
| `MCP_JS_FS_SNAPSHOTS` | *(unset)* | enable to persist each session's `/work` filesystem across runs; uses a node-local dir under `MCP_JS_STORAGE_DIR` unless `MCP_JS_S3_BUCKET` is set |
| `MCP_JS_ALLOW_COMMAND_OVERRIDE` | *(unset)* | honor a session's edited launch command (trusted/single-tenant only) |

Notes:
- Session **fork** works in subprocess mode by seeding the new session's store
  from the source's snapshots.
- Migrations run at container start (`migrate.ts`), so the DB must be attached
  before first boot.
- The web container now also runs the `mcp-v8` coordinator + per-session worker
  processes, so size the service's memory for the expected concurrent sessions.

## CLI sketch

```bash
railway init -n open-agents
# postgres
railway add -d postgres
# web — the only public service; spawns mcp-v8 workers in-container
railway add -s web
railway service web && railway volume add -m /data   # persists the sandbox store
railway domain -s web   # note the URL for BETTER_AUTH_URL
railway variables -s web \
  --set RAILWAY_DOCKERFILE_PATH=deploy/web/Dockerfile \
  --set 'POSTGRES_URL=${{Postgres.DATABASE_URL}}' \
  --set BOTID_DISABLED=true --set RATE_LIMIT_DISABLED=true \
  --set BETTER_AUTH_URL=https://<web-domain> --set BETTER_AUTH_SECRET=... # + AZURE_OPENAI_*, etc.
railway up -s web -d   # build context = repo root
```

## Reverting to the shared topology

Set `MCP_JS_WORKER_MODE=shared` and `MCP_JS_BASE_URL=http://mcp-js.railway.internal:3000`
on web, and deploy the standalone **mcp-js** service from `deploy/mcp-js/`
(internal-only, with its own `/data` volume). See that Dockerfile for details.
