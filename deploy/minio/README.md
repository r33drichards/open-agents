# MinIO (shared S3 blob store)

MinIO is the S3-compatible store the mcp-js per-session **filesystem snapshots**
are written to when the web service runs in self-contained subprocess mode with
a shared blob store. It is **internal only** (no public domain) and reachable
over Railway's private network at `minio.railway.internal:9000`.

There is no Dockerfile here on purpose — deploy MinIO from a prebuilt image so
there is nothing to build. The Bitnami image is used because it auto-creates the
bucket from `MINIO_DEFAULT_BUCKETS` (the upstream `minio/minio` server image does
not bundle `mc`, so bucket creation would need a separate init step).

## Service config

- **Image:** `bitnami/minio:latest`
- **Volume:** mount at `/bitnami/minio/data`
- **No public domain** (private network only).
- **Variables:**

| Variable | Value |
|---|---|
| `MINIO_ROOT_USER` | an access key (e.g. `mcpjs`) |
| `MINIO_ROOT_PASSWORD` | a strong secret |
| `MINIO_DEFAULT_BUCKETS` | `mcpjs-fs` (the bucket web/mcp-v8 uses) |

## Wire it into the web service

Set these on the **web** service so the spawned `mcp-v8` workers use MinIO for
fs snapshots (they read AWS_* from the environment):

| Variable | Value |
|---|---|
| `MCP_JS_S3_BUCKET` | `mcpjs-fs` (must match `MINIO_DEFAULT_BUCKETS`) |
| `AWS_ENDPOINT_URL` | `http://minio.railway.internal:9000` |
| `AWS_S3_FORCE_PATH_STYLE` | `true` (MinIO requires path-style addressing) |
| `AWS_ACCESS_KEY_ID` | `${{minio.MINIO_ROOT_USER}}` |
| `AWS_SECRET_ACCESS_KEY` | `${{minio.MINIO_ROOT_PASSWORD}}` |
| `AWS_REGION` | `us-east-1` (any value; MinIO ignores it) |

Without these vars the web service still works — fs snapshots fall back to a
node-local directory store on the `/data` volume instead of the shared bucket.
