# Plan: per-session isolated mcp-js workers over shared content-addressed storage

Status: **in progress** — subprocess provider first.

## Decisions (2026-06-14)

1. **Ship the subprocess provider first.** Get isolated per-session compute
   working with local child-process workers before any cluster work; the Vercel
   ↔ cluster reachability question is punted until then.
2. **Production k8s via [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox).**
   The `k8s` provider will create an agent-sandbox `Sandbox` resource per
   session rather than hand-rolling Deployments/Services.
3. **Per-session declarative runtime config.** Session creation accepts a
   declarative config that configures *that session's* mcp-js worker runtime
   (capabilities / OPA policies, heap caps, working dir). The config is persisted
   in the sandbox state and re-applied on resume. Storage stays shared — **all
   sessions share one S3 bucket** — so isolation is per-session *policy* over a
   common content-addressed store.

## Goal

Move the mcp-js (mcp-v8) integration from **one shared compute server** to
**isolated compute per open-agents session**, while keeping **state stored in a
shared, content-addressed way**. Each session spawns its own mcp-v8 *worker*
(isolated V8 process), but all workers read and write snapshots — V8 heaps and
the new content-addressed **filesystem** — to a shared store. The worker is
ephemeral; the durable state lives in the shared store, keyed by the session id.

The worker spawn mechanism must be **abstract**: a local dev provider that
spawns a child process, and a production provider that creates a Kubernetes
resource, behind one interface.

## How it works today (baseline)

- `MCP_JS_BASE_URL` (`apps/web/lib/sandbox/config.ts`) points **every** session
  at a **single shared** mcp-v8 server. `isMcpJsRuntimeEnabled()` flips the whole
  app onto the mcp-js runtime when it is set.
- `buildMcpJsSandboxState()` (`apps/web/lib/sandbox/mcp-js-provisioning.ts`)
  persists only `{ type: "mcp-js", baseUrl, session: session.id,
  workingDirectory }`. There is no VM to clone or snapshot.
- `McpJsSandbox.exec()` (`packages/sandbox/mcp-js/sandbox.ts`) calls
  `client.runJs(code, { session: session.id })` with **no heap key**. The server
  restores that session label's latest heap and re-snapshots automatically.
- Net effect: **heap state is already per-session isolated** (content-addressed
  under the session label), but **compute is shared** — one V8 server process and
  isolate pool serves all sessions. There is **no filesystem snapshot**
  integration: the client (`packages/sandbox/mcp-js/client/index.ts`) sends only
  `heap` / `session` / `tags`.

## Dependency: mcp-js PR #169 (content-addressed fs snapshots)

Branch `claude/dreamy-lovelace-hqfbt4` ("Add content-addressed filesystem
snapshots with labels and reflog") is the content-addressable storage work this
plan builds on. Confirmed API surface (from that branch's `openapi.json`):

- `ExecRequest.fs` — *"Filesystem snapshot handle to mount: a label name or
  64-hex CA id. Independent of `heap`."*
- `ExecutionInfo.fs` — the CA id produced after execution (the new fs head).
- Label / reflog endpoints (git-like):
  - `GET /api/fs/labels`, `POST /api/fs/labels` (`FsLabelRequest { name, ca_id, message? }`)
  - `GET /api/fs/labels/{label}` (resolve to head CA id), `GET /api/fs/labels/{label}/log` (reflog)
  - `POST /api/fs/push` (`FsPushRequest { label?, ca_id, expected?, force?, detach?, message? }`) — advance a label, **reject-and-rebase** when `expected` no longer matches the head (HTTP 409)
  - `POST /api/fs/merge` (`FsMergeRequest { ours, theirs, base?, prefer? }`) — three-way merge
  - `POST /api/fs/reset` (`FsResetRequest { label, ca_id, allow_unlogged?, message? }`)

The `push` / reject-and-rebase semantics are exactly the coordination primitive
for "shared storage, many writers": a session's fs label = `session.id`, mounted
on every exec, advanced after every exec.

**Phase 0 of this plan is to land #169** (rebase onto `main`, green CI, merge)
since everything downstream depends on its `fs` field and label API.

## Target architecture

```
                    ┌─────────────────────────────────────────┐
                    │  Shared content-addressed store           │
                    │  • V8 heap snapshots (CA)                  │
                    │  • Filesystem snapshots (CA) + labels      │
                    │  • session metadata                        │
                    │  Backend: S3 (prod) or shared dir (dev)    │
                    └───────────────▲───────────────────────────┘
                                    │ read/write CA blobs;
                                    │ fs label = session.id
        ┌───────────────┬───────────┴───────────┬───────────────┐
   ┌────┴────┐     ┌────┴────┐             ┌────┴────┐      ┌────┴────┐
   │ worker  │     │ worker  │     ...     │ worker  │      │ worker  │
   │ sess A  │     │ sess B  │             │ sess C  │      │ sess D  │
   │ (V8)    │     │ (V8)    │             │ (V8)    │      │ (V8)    │
   └────▲────┘     └────▲────┘             └────▲────┘      └────▲────┘
        │ baseUrl per session (from WorkerProvider)
   ┌────┴──────────────────────────────────────────────────────────┐
   │ open-agents web  →  McpJsWorkerProvider.ensureWorker(sessionId) │
   └────────────────────────────────────────────────────────────────┘
```

- **Shared store** = the "leader"/durable layer. In prod it is an S3 bucket (the
  mcp-v8 stateful S3 backend); in dev it is a shared local directory
  (`--directory-path` / `--session-db-path`) that every worker mounts. Content
  addressing means concurrent workers writing identical blobs deduplicate
  cleanly; the per-session fs **label** is the only mutable pointer and is
  namespaced by `session.id`, so sessions never collide.
- **Worker** = an isolated, ephemeral mcp-v8 process configured to point at the
  shared store. It provides compute isolation (separate heap, separate isolate
  pool, separate crash domain) without owning durable state.
- **WorkerProvider** = the abstraction the web app uses to get a worker for a
  session. `ensureWorker(sessionId)` is idempotent (reconnect to an existing
  worker for that session); `stopWorker(sessionId)` tears it down.

### Why a label per session (not just the heap session)

The heap already persists per-session via the `session` label. PR #169 adds an
independent filesystem layer; to keep per-session isolation *and* shared storage
we mount fs label = `session.id` on every exec and advance it afterward. Two
sessions never share a label; merges/reset/reflog become available per session
for free (e.g. forking a chat could branch the fs label).

## Component design

### 0. Per-session runtime config (`McpJsRuntimeConfig`)

A declarative description of a session's worker runtime, persisted in the
sandbox state and re-applied on resume. Defined as a plain interface in the
sandbox package (`packages/sandbox/mcp-js/runtime-config.ts`, no extra deps) and
validated with a Zod schema in the web app at session-creation time:

```ts
export interface McpJsRuntimeConfig {
  heapMemoryMaxMb?: number;          // per-exec V8 heap cap
  workingDirectory?: string;         // nominal cwd reported to the agent
  capabilities?: {                   // OFF by default (secure-by-default)
    fetch?: McpJsCapabilityPolicy;
    filesystem?: McpJsCapabilityPolicy;
    subprocess?: McpJsCapabilityPolicy;
  };
}
export interface McpJsCapabilityPolicy {
  enabled?: boolean;                 // allow at all
  opaUrls?: string[];                // OPA/Rego policy servers, per-call
}
```

The worker provider translates this into mcp-v8 launch flags (e.g.
`--policies-json` for capabilities) via a pure `worker-args.ts` helper.

### 1. `McpJsWorkerProvider` abstraction (`apps/web`)

New module `apps/web/lib/sandbox/mcp-js/worker-provider.ts`:

```ts
export interface EnsureWorkerParams {
  sessionId: string;
  runtimeConfig?: McpJsRuntimeConfig;
}
export interface McpJsWorker {
  /** Base URL the sandbox client should hit for this session's worker. */
  baseUrl: string;
}

export interface McpJsWorkerProvider {
  /** Idempotently ensure a worker exists for the session; return its URL. */
  ensureWorker(params: EnsureWorkerParams): Promise<McpJsWorker>;
  /** Tear down the session's worker (idempotent / no-op if absent). */
  stopWorker(sessionId: string): Promise<void>;
}
```

Factory `getMcpJsWorkerProvider()` selects an implementation from env
(`MCP_JS_WORKER_MODE`):

- `shared` — current behavior: every session resolves to the single
  `MCP_JS_BASE_URL`. `stopWorker` is a no-op. Keeps the existing path working and
  is the migration fallback.
- `subprocess` — local dev. Spawns `mcp-v8` child processes.
- `k8s` — production. Creates a Kubernetes resource per session.

Each provider keyed by `sessionId` so `ensureWorker` reconnects rather than
duplicating.

#### 1a. `SubprocessWorkerProvider` (`subprocess-worker-provider.ts`)

- Spawns `mcp-v8 --http-port <allocated> --directory-path <SHARED_DIR>/heaps
  --session-db-path <SHARED_DIR>/sessions` (shared dir ⇒ shared CA store across
  all dev workers).
- Allocates a free port; tracks `sessionId → { pid, port, baseUrl }` in an
  in-process registry plus an on-disk file (`<SHARED_DIR>/workers.json`) so a web
  server restart can re-attach / clean up. Polls `/api/version` for readiness.
- `stopWorker` sends SIGTERM and removes the registry entry.
- Mainly for `pnpm web` local development.

#### 1b. `K8sWorkerProvider` (`k8s-worker-provider.ts`) — later

- Creates a **[kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)
  `Sandbox` custom resource** per session (not hand-rolled Deployments), named
  deterministically from `sessionId` (e.g. `mcp-js-<short-hash>`), running the
  mcp-v8 image configured for the **shared S3 backend** plus that session's
  declarative runtime config. `ensureWorker` returns the in-cluster Service URL;
  if the resource already exists it just returns the URL.
- `stopWorker` deletes the `Sandbox` resource.
- Config via env: `MCP_JS_K8S_NAMESPACE`, `MCP_JS_K8S_IMAGE`,
  `MCP_JS_S3_BUCKET`, `MCP_JS_S3_PREFIX`, and cluster credentials (in-cluster
  service-account or a kubeconfig secret so the web app can reach the API).
- Punted until the subprocess path is working end-to-end (Decision 1).

### 2. Sandbox package wiring (`packages/sandbox/mcp-js`)

- **`client/schema.ts`** — regenerate from #169's `openapi.json`
  (`npx openapi-typescript openapi.json --output schema.ts`). Adds `fs` to
  `ExecRequest` / `ExecutionInfo` and the fs label endpoints.
- **`client/index.ts`** — add `fs?: string` to `RunJsOptions`; pass
  `fs: options.fs ?? null` in the `/api/exec` body; surface `fs` on
  `RunJsResult` (from `ExecutionInfo.fs`).
- **`client/fs.ts`** (new, colocated per the repo's file-org rule) — thin
  helpers over the label API: `setLabel`, `resolveLabel`, `pushLabel`
  (with `expected` for reject-and-rebase), `mergeLabels`, `resetLabel`.
- **`state.ts`** — add `fs?: string` (the session's fs label) to `McpJsState`.
- **`config.ts`** — add `fs?: string` to `McpJsSandboxConfig`.
- **`connect.ts`** — thread `state.fs` into the sandbox.
- **`sandbox.ts`** — pass `fs: this.fs` (the session label) to `runJs`; after a
  successful run, advance the label to `run.fs` via `pushLabel({ label: this.fs,
  ca_id: run.fs, expected })`. With one worker per session there is no
  contention, but `expected` keeps it correct if `shared` mode is used.

### 3. Provisioning + lifecycle (`apps/web`)

- **`mcp-js-provisioning.ts`** — `buildMcpJsSandboxState` becomes async: call
  `getMcpJsWorkerProvider().ensureWorker(session.id)` to get the per-session
  `baseUrl`, and set `fs: session.id` (the fs label). The rest (persist state,
  bump lifecycle version) is unchanged.
- **Teardown** — on session archive / idle hibernation, call
  `stopWorker(session.id)`. Hook into `apps/web/lib/sandbox/archive-session.ts`
  and the lifecycle stop path (`apps/web/lib/sandbox/lifecycle*.ts`). Durable
  state survives in the shared store under the heap session + fs label, so a
  later resume re-spawns a fresh worker and restores both.
- **`config.ts`** — add `MCP_JS_WORKER_MODE` and the storage/k8s env documented
  above; keep `MCP_JS_BASE_URL` as the `shared`-mode value. Update
  `apps/web/.env.example`.

### 4. Local dev ergonomics

- Default `MCP_JS_WORKER_MODE=subprocess` for `pnpm web`, with a shared local
  dir — no S3 or compose needed for the simplest loop.
- Optional `docker-compose.dev.yml` in open-agents bringing up MinIO (an S3
  store) so the subprocess workers can exercise the S3 backend, mirroring prod.
  (mcp-js already ships `docker-compose.single-node-stateful.yml` for the store
  itself if a separate leader process is wanted.)

## Phasing

- **Phase 0 — mcp-js:** rebase PR #169 onto `main`, green CI, merge. Confirm the
  S3 backend persists fs CA blobs + labels (the shared-store requirement).
- **Phase 1 — sandbox package:** regenerate `schema.ts`; add `fs` to the client
  + `client/fs.ts`; extend `state.ts` / `config.ts` / `connect.ts` /
  `sandbox.ts`. Ship behind existing `shared` behavior (fs label defaults to the
  session). Unit-testable without orchestration.
- **Phase 2 — worker provider:** `worker-provider.ts` interface + factory +
  `SubprocessWorkerProvider`. Wire `mcp-js-provisioning.ts` and teardown. Default
  mode `subprocess` locally, `shared` falls back to today's behavior.
- **Phase 3 — k8s + storage:** `K8sWorkerProvider`, S3 backend config,
  `docker-compose.dev.yml` + MinIO, `.env.example`, docs in
  `docs/agents/architecture.md`.

## Files touched (summary)

mcp-js:
- Land branch `claude/dreamy-lovelace-hqfbt4` (PR #169).

open-agents `packages/sandbox/mcp-js/`:
- `client/schema.ts` (regenerated), `client/index.ts`, `client/fs.ts` (new),
  `state.ts`, `config.ts`, `connect.ts`, `sandbox.ts`.

open-agents `apps/web/lib/sandbox/`:
- `mcp-js/worker-provider.ts` (new), `mcp-js/subprocess-worker-provider.ts`
  (new), `mcp-js/k8s-worker-provider.ts` (new),
  `mcp-js-provisioning.ts`, `config.ts`, `archive-session.ts`, `lifecycle*.ts`.
- `apps/web/.env.example`, `docs/agents/architecture.md`.

Tests: client `fs` round-trip, `SubprocessWorkerProvider` (spawn → ready →
stop), provisioning sets per-session `baseUrl` + `fs` label, teardown calls
`stopWorker`.

## Open questions / risks

1. **Cluster reachability from Vercel.** The prod web app runs on Vercel; the
   `K8sWorkerProvider` needs network + credentials to the cluster API (VPC peering
   or a hosted control-plane endpoint + service-account token). Confirm the
   target cluster and auth.
2. **Worker warm-up latency.** Spawning a process/pod per session adds cold-start
   to the first exec. Options: a small warm pool, or keep `ensureWorker` fast and
   accept first-run latency. Decide acceptable budget.
3. **Worker GC.** Need a reaper for workers whose sessions ended without a clean
   teardown (idle TTL on the pod, or a sweep keyed by the sessions table).
4. **Isolation strength.** Compute is isolated per worker, but storage is one
   bucket; cross-session protection relies on label/prefix namespacing, not hard
   tenancy. If stronger isolation is needed, add per-session S3 prefixes + scoped
   credentials, or OPA filesystem policies (mcp-js already supports these).
5. **`fs` label advance.** Single-worker-per-session means no contention, so a
   plain `push` suffices; `expected`/rebase only matters if `shared` mode or
   multi-worker fan-out per session is ever used.
