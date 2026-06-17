import type {
  McpJsCapabilities,
  McpJsRuntimeConfig,
} from "@open-agents/sandbox";
import type { McpJsFsSnapshotConfig } from "@/lib/sandbox/config";

/** Inputs for {@link buildMcpV8WorkerArgs}. */
export interface BuildWorkerArgsParams {
  /** Port the worker's MCP transport binds to. */
  httpPort: number;
  /**
   * MCP transport to serve on `httpPort`. Per-session workers use `"sse"`
   * because the agent's MCP client connects over SSE (`/sse`); the coordinator
   * defaults to `"http"` (it serves no sessions, only satisfies cluster mode).
   */
  transport?: "http" | "sse";
  /** Port the worker's Raft cluster HTTP server binds to. */
  clusterPort: number;
  /** Unique cluster node id (the coordinator uses a fixed id; workers use the session id). */
  nodeId: string;
  /**
   * Shared content-addressed store directory. Heaps live under `<dir>/heaps`
   * and are shared by every node (content-addressed, safe for concurrent
   * access). Each node gets its own session DB under `<dir>/sessions/<nodeId>`
   * — Raft keeps those consistent, so they must NOT be shared.
   */
  storageDir: string;
  /** Host other nodes use to reach this one (write forwarding / peer discovery). */
  advertiseHost: string;
  /** Seed address (`host:port`) to join an existing cluster. Omitted for the coordinator. */
  join?: string;
  /** Join as a non-voting learner (per-session workers) rather than a voter. */
  asLearner?: boolean;
  /** Declarative per-session runtime config. */
  runtimeConfig?: McpJsRuntimeConfig;
  /**
   * Per-session content-addressed filesystem snapshots. When enabled, the
   * worker mounts a per-session CAS filesystem alongside the heap. In cluster
   * mode the blob store must be shared, so an S3 bucket is required (the worker
   * inherits AWS_* credentials from the parent process environment).
   */
  fsSnapshots?: McpJsFsSnapshotConfig;
  /**
   * Persist the V8 heap (JS globals across runs). Off by default to match the
   * deployed (fs-only) config; heap snapshots disable WebAssembly so they are
   * incompatible with WASM modules. Heap and fs are independent axes.
   */
  heapSnapshots?: boolean;
}

/**
 * Build mcp-v8 launch arguments for a clustered worker.
 *
 * The coordinator ("main") node runs as a voter and owns the write quorum;
 * per-session workers join as non-voting learners so their churn never affects
 * the cluster's ability to commit (see the mcp-js learner support). Session
 * metadata is replicated through Raft.
 *
 * Heap and filesystem persistence are independent axes (mcp-v8 `--heap-store` /
 * `--fs-store`, each `none|dir|s3`). The shared `--s3-bucket` backs whichever
 * axes use `s3`. In this clustered mode the fs blob store must be shared, so fs
 * persistence requires S3. Heap is off by default (heap snapshots disable WASM).
 * Capability policies are emitted only for capabilities granted an OPA policy
 * URL — mcp-v8 is secure-by-default, so anything else stays denied.
 */
export function buildMcpV8WorkerArgs(params: BuildWorkerArgsParams): string[] {
  const portFlag = params.transport === "sse" ? "sse-port" : "http-port";
  const fs = params.fsSnapshots;
  const heapOn = params.heapSnapshots ?? false;
  const fsOn = Boolean(fs?.enabled);
  // The shared --s3-bucket backs any axis set to `s3`. fs in this clustered mode
  // must use shared storage (S3); heap reuses the same bucket when one is set,
  // else a node-local shared directory.
  const bucket = fs?.s3Bucket;
  const heapOnS3 = heapOn && Boolean(bucket);
  const fsOnS3 = fsOn && Boolean(bucket);

  const args = [
    `--${portFlag}=${params.httpPort}`,
    `--session-db-path=${params.storageDir}/sessions/${params.nodeId}`,
    `--cluster-port=${params.clusterPort}`,
    `--node-id=${params.nodeId}`,
    `--advertise-addr=${params.advertiseHost}:${params.clusterPort}`,
  ];

  // Heap axis (off by default).
  if (heapOn) {
    if (heapOnS3) {
      args.push("--heap-store=s3");
    } else {
      args.push("--heap-store=dir", `--heap-dir=${params.storageDir}/heaps`);
    }
  }

  if (params.join) {
    args.push(`--join=${params.join}`);
  }
  if (params.asLearner) {
    args.push("--join-as-learner");
  }

  // Filesystem axis. Cluster mode requires a shared (S3) blob store; the worker
  // reads AWS_* creds (and AWS_ENDPOINT_URL / AWS_S3_FORCE_PATH_STYLE for MinIO)
  // from its inherited environment.
  if (fsOn) {
    if (fsOnS3) {
      args.push("--fs-store=s3");
    } else {
      args.push("--fs-store=dir", `--fs-dir=${params.storageDir}/fs-blobs`);
    }
  }

  // Shared S3 bucket + per-node write-through cache, emitted once for whichever
  // axes use s3.
  if ((heapOnS3 || fsOnS3) && bucket) {
    args.push(`--s3-bucket=${bucket}`);
    args.push(`--cache-dir=${params.storageDir}/s3-cache/${params.nodeId}`);
  }

  const policiesJson = buildPoliciesJson(
    params.runtimeConfig?.capabilities,
    fs?.enabled ? fs.policyFilePath : undefined,
  );
  if (policiesJson) {
    args.push(`--policies-json=${policiesJson}`);
  }

  return args;
}

/** Capability names mcp-v8 accepts in its `--policies-json` map. */
const CAPABILITY_KEYS = ["fetch", "filesystem", "subprocess"] as const;

/**
 * Translate capability policies into mcp-v8's `--policies-json` value, or
 * `undefined` when no capability is granted an OPA policy URL.
 *
 * Only the OPA-URL form is emitted today; it matches the verified compose
 * example (`{"fetch":{"policies":[{"url":"http://opa:8181"}]}}`). Granting a
 * capability without an OPA URL is intentionally a no-op until the exact
 * unconditional-allow flag is wired.
 */
function buildPoliciesJson(
  capabilities?: McpJsCapabilities,
  fsPolicyFilePath?: string,
): string | undefined {
  const policies: Record<string, { policies: { url: string }[] }> = {};

  if (capabilities) {
    for (const key of CAPABILITY_KEYS) {
      const policy = capabilities[key];
      if (!(policy?.enabled && policy.opaUrls?.length)) {
        continue;
      }
      policies[key] = { policies: policy.opaUrls.map((url) => ({ url })) };
    }
  }

  // FS snapshots need the filesystem surface enabled. Mount the local rego
  // policy via a file:// URL unless a capability policy already set one.
  if (fsPolicyFilePath && !policies.filesystem) {
    policies.filesystem = {
      policies: [{ url: `file://${fsPolicyFilePath}` }],
    };
  }

  return Object.keys(policies).length > 0
    ? JSON.stringify(policies)
    : undefined;
}
