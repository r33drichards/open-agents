# Railway deploy

Two services on one Railway project:

- **mcp-js** — the mcp-v8 sandbox backend (`deploy/mcp-js/`). Toolbox-style
  scratch image on mcp-v8 **v0.16.0**, bundling the eight languages + the
  craftos upstream, with a **per-session content-addressed filesystem**
  (`--fs-store dir`, no heap snapshots) on a persistent volume at `/data`
  (single node). Heap persistence is intentionally off: it disables WebAssembly
  and so can't coexist with the bundled WASM languages — cross-call state lives
  in the `/work` filesystem. Serves SSE MCP at `/sse` and REST at `/api/exec` on
  port 3000. **Internal-only** — no public domain; the image sets
  `MCP_V8_BIND_HOST=::` (dual-stack) so it is reachable at
  `http://mcp-js.railway.internal:3000` over Railway's private network.
  (Requires mcp-v8 ≥ v0.16.0: the heap/fs split, `--fs-store`, and the
  current-thread isolate fix that makes fs writes work over the network.)
- **web** — the Next.js app (`deploy/web/Dockerfile`, build context = repo
  root), the only service with a public domain. Talks to the mcp-js service
  over `MCP_JS_BASE_URL` (shared remote worker — no local subprocess workers)
  and to a Railway Postgres.

## Layout

```
deploy/
  mcp-js/   Dockerfile + railway.json + language build assets (from ~/toolbox)
  web/      Dockerfile + railway.json
```

## mcp-js service

- Build: `deploy/mcp-js/Dockerfile` (downloads the `mcp-v8-linux*.gz` v0.16.0
  release binary; vendors language WASM in a builder stage).
- Volume: mount a Railway volume at **`/data`** (heaps, session DB, fs blobs).
- No env vars required; everything is in the Dockerfile `ENTRYPOINT`.
- Generate a public domain; that URL (with no path) is `MCP_JS_BASE_URL` for web.

## web service

Service root = repo root, `dockerfilePath = deploy/web/Dockerfile`.

Required variables:

| Variable | Value |
|---|---|
| `POSTGRES_URL` | Railway Postgres connection string (`${{Postgres.DATABASE_URL}}`) |
| `MCP_JS_BASE_URL` | `http://mcp-js.railway.internal:3000` (mcp-js private address) |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/web/Dockerfile` (monorepo: build context = repo root) |
| `BOTID_DISABLED` | `true` (no Vercel BotId off-Vercel) |
| `RATE_LIMIT_DISABLED` | `true` (no Redis) |
| `BETTER_AUTH_URL` | the web service's public URL (e.g. `https://web-…up.railway.app`) |
| `BETTER_AUTH_SECRET` | session signing secret |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_RESOURCE_NAME` / `AZURE_OPENAI_DEPLOYMENT` / `AZURE_OPENAI_API_VERSION` | the model backend |
| `AI_GATEWAY_API_KEY` | (optional) if using the gateway instead of Azure-only |

Notes:
- Do **not** set `MCP_JS_WORKER_MODE=subprocess` here — the web service uses the
  remote mcp-js (shared mode); the per-session heap + filesystem live on the
  mcp-js service (keyed by `X-MCP-Session-Id`, which the agent client sends).
- Session **fork** works through the remote server (it reads the source's
  snapshots and seeds the new session there).
- Migrations run at container start (`migrate.ts`), so the DB must be attached
  before first boot.

## CLI sketch

```bash
railway init -n open-agents
# mcp-js — internal only (no domain); volume add attaches to the linked service
railway add -s mcp-js
railway service mcp-js && railway volume add -m /data
(cd deploy/mcp-js && railway up -s mcp-js -d)
# postgres
railway add -d postgres
# web — the only public service
railway add -s web
railway domain -s web   # note the URL for BETTER_AUTH_URL
railway variables -s web \
  --set RAILWAY_DOCKERFILE_PATH=deploy/web/Dockerfile \
  --set MCP_JS_BASE_URL=http://mcp-js.railway.internal:3000 \
  --set 'POSTGRES_URL=${{Postgres.DATABASE_URL}}' \
  --set BOTID_DISABLED=true --set RATE_LIMIT_DISABLED=true \
  --set BETTER_AUTH_URL=https://<web-domain> --set BETTER_AUTH_SECRET=... # + AZURE_OPENAI_*, etc.
railway up -s web -d   # build context = repo root
```
