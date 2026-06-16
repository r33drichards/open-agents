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
}

/**
 * Build mcp-v8 launch arguments for a clustered worker.
 *
 * The coordinator ("main") node runs as a voter and owns the write quorum;
 * per-session workers join as non-voting learners so their churn never affects
 * the cluster's ability to commit (see the mcp-js learner support). Heaps are
 * shared via `--directory-path`; session metadata is replicated through Raft.
 * Capability policies are emitted only for capabilities granted an OPA policy
 * URL — mcp-v8 is secure-by-default, so anything else stays denied.
 */
export function buildMcpV8WorkerArgs(params: BuildWorkerArgsParams): string[] {
  const portFlag = params.transport === "sse" ? "sse-port" : "http-port";
  const fs = params.fsSnapshots;
  // `--s3-bucket` selects the heap backend AND backs the fs blob store, and it
  // is mutually exclusive with `--directory-path`. So when fs snapshots use S3,
  // route heaps to S3 too (with a local write-through cache) and omit the
  // file-backed `--directory-path`.
  const useS3 = Boolean(fs?.enabled && fs.s3Bucket);

  const args = [
    `--${portFlag}=${params.httpPort}`,
    `--session-db-path=${params.storageDir}/sessions/${params.nodeId}`,
    `--cluster-port=${params.clusterPort}`,
    `--node-id=${params.nodeId}`,
    `--advertise-addr=${params.advertiseHost}:${params.clusterPort}`,
  ];
  if (!useS3) {
    args.push(`--directory-path=${params.storageDir}/heaps`);
  }

  if (params.join) {
    args.push(`--join=${params.join}`);
  }
  if (params.asLearner) {
    args.push("--join-as-learner");
  }

  if (fs?.enabled) {
    args.push("--enable-fs-snapshots");
    // Cluster mode requires a shared blob store. The worker reads AWS_* creds
    // (and AWS_ENDPOINT_URL / AWS_S3_FORCE_PATH_STYLE for MinIO) from its
    // inherited environment.
    if (fs.s3Bucket) {
      args.push(`--s3-bucket=${fs.s3Bucket}`);
      // Per-node local write-through cache for the shared S3 blob store.
      args.push(`--cache-dir=${params.storageDir}/fs-cache/${params.nodeId}`);
    }
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
