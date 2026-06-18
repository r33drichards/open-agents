/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

import { isHobbyResourceProfile } from "../deployment/resource-profile.ts";

/** SDK safety buffer reserved for sandbox before-stop hooks (30 seconds) */
const VERCEL_SANDBOX_TIMEOUT_BUFFER_MS = 30 * 1000;

/** Standard timeout for new cloud sandboxes (5 hours minus hook buffer) */
const STANDARD_SANDBOX_TIMEOUT_MS =
  5 * 60 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Hobby-compatible timeout for new cloud sandboxes (40 minutes minus hook buffer) */
const HOBBY_SANDBOX_TIMEOUT_MS =
  40 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Default timeout for new cloud sandboxes */
export const DEFAULT_SANDBOX_TIMEOUT_MS = isHobbyResourceProfile()
  ? HOBBY_SANDBOX_TIMEOUT_MS
  : STANDARD_SANDBOX_TIMEOUT_MS;

/** Default vCPU count for new cloud sandboxes */
export const DEFAULT_SANDBOX_VCPUS = isHobbyResourceProfile() ? 1 : 4;

/** Manual extension duration for explicit fallback flows (20 minutes) */
export const EXTEND_TIMEOUT_DURATION_MS = 20 * 60 * 1000;

/** Inactivity window before lifecycle hibernates an idle sandbox (30 minutes) */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Buffer for sandbox expiry checks (10 seconds) */
export const SANDBOX_EXPIRES_BUFFER_MS = 10 * 1000;

/** Grace window before treating a lifecycle run as stale (2 minutes) */
export const SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS = 2 * 60 * 1000;

/** Minimum sleep between lifecycle workflow loop iterations (5 seconds) */
export const SANDBOX_LIFECYCLE_MIN_SLEEP_MS = 5 * 1000;

/**
 * Default ports to expose from cloud sandboxes.
 * Limited to 5 ports. Covers the most common framework defaults
 * plus the built-in code editor:
 * - 3000: Next.js, Express, Remix
 * - 5173: Vite, SvelteKit
 * - 4321: Astro
 * - 8000: code-server (built-in editor)
 */
export const DEFAULT_SANDBOX_PORTS = [3000, 5173, 4321, 8000];
export const CODE_SERVER_PORT = 8000;

/** Default working directory for sandboxes, used for path display */
export const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

/**
 * Optional base snapshot for fresh cloud sandboxes.
 *
 * Forked deployments should provide their own snapshot ID if they want a
 * preconfigured image. When unset, sandboxes start from Vercel's standard
 * runtime so deployments are not tied to a private snapshot in another scope.
 */
export const DEFAULT_SANDBOX_BASE_SNAPSHOT_ID =
  process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;

/**
 * Default mcp-js (mcp-v8) server used when `MCP_JS_BASE_URL` is unset.
 *
 * The mcp-js runtime is the only sandbox type, so a default keeps it working
 * out of the box; override with `MCP_JS_BASE_URL` to point at another toolbox.
 */
const DEFAULT_MCP_JS_BASE_URL =
  "https://toolbox-production-e539.up.railway.app";

/**
 * Base URL of an mcp-js (mcp-v8) JavaScript execution server.
 *
 * Sessions are always provisioned against this runtime (the agent connects to
 * it over MCP and uses its tools); there is nothing to clone or snapshot —
 * provisioning just points at this server.
 */
export const MCP_JS_BASE_URL =
  process.env.MCP_JS_BASE_URL ?? DEFAULT_MCP_JS_BASE_URL;

/**
 * How per-session mcp-js workers are spawned.
 *
 * - `shared`: every session uses the single {@link MCP_JS_BASE_URL} server
 *   (legacy behavior / fallback).
 * - `subprocess`: each session gets a local `mcp-v8` child process sharing an
 *   on-disk content-addressed store (local dev / self-hosted Node).
 */
export type McpJsWorkerMode = "shared" | "subprocess";

/** Resolve the configured worker mode (defaults to `shared`). */
export function getMcpJsWorkerMode(): McpJsWorkerMode {
  return process.env.MCP_JS_WORKER_MODE?.toLowerCase() === "subprocess"
    ? "subprocess"
    : "shared";
}

/** Path to (or name of) the `mcp-v8` binary used by the subprocess provider. */
export const MCP_JS_BIN = process.env.MCP_JS_BIN ?? "mcp-v8";

/** Shared content-addressed store directory for subprocess-mode workers. */
export const MCP_JS_STORAGE_DIR = process.env.MCP_JS_STORAGE_DIR ?? ".mcp-js";

/** Host the local mcp-v8 cluster nodes advertise/reach each other on. */
export const MCP_JS_CLUSTER_HOST =
  process.env.MCP_JS_CLUSTER_HOST ?? "127.0.0.1";

/**
 * Fixed ports for the coordinator ("main") node so it can be a machine-wide
 * singleton: any provider instance (Next/Workflow may load the module more than
 * once) discovers the running coordinator at these ports instead of spawning a
 * second one (which would deadlock on the coordinator's sled lock).
 */
export const MCP_JS_COORDINATOR_HTTP_PORT = Number(
  process.env.MCP_JS_COORDINATOR_HTTP_PORT ?? 47600,
);
export const MCP_JS_COORDINATOR_CLUSTER_PORT = Number(
  process.env.MCP_JS_COORDINATOR_CLUSTER_PORT ?? 47601,
);

/**
 * Content-addressed filesystem snapshot config for mcp-js workers. When
 * enabled, every worker mounts a per-session CAS filesystem (alongside the V8
 * heap) so `fs.*` calls in run_js persist across runs. In cluster mode the blob
 * store must be shared, so a `--s3-bucket` (S3-compatible: real AWS or MinIO via
 * AWS_ENDPOINT_URL/AWS_S3_FORCE_PATH_STYLE) is required — the workers inherit
 * the AWS_* credentials from this process's environment.
 */
export type McpJsFsSnapshotConfig = {
  enabled: boolean;
  /** S3 bucket backing the shared blob store (required in cluster mode). */
  s3Bucket?: string;
  /**
   * Override path to the filesystem OPA/rego policy mounted into each worker.
   * When unset the (server-only) worker provider resolves the default policy
   * shipped in this repo. Note: this module is imported by workflow functions,
   * so it must not touch Node `path`/`fs` — path resolution happens there.
   */
  policyFilePath?: string;
};

export const MCP_JS_FS_SNAPSHOTS_ENABLED =
  process.env.MCP_JS_FS_SNAPSHOTS === "true";

/**
 * Whether subprocess-mode workers persist the V8 heap (JS globals across runs).
 *
 * Off by default: heap snapshots run in a V8 SnapshotCreator isolate that
 * disables WebAssembly, and the deployed mcp-js runs heap-off (fs-only) so the
 * bundled WASM languages work. Matching that locally keeps behaviour faithful —
 * cross-call state lives in the per-session `/work` filesystem, not in globals.
 * Set `MCP_JS_HEAP_SNAPSHOTS=true` to re-enable heap persistence (incompatible
 * with WASM modules).
 */
export const MCP_JS_HEAP_SNAPSHOTS_ENABLED =
  process.env.MCP_JS_HEAP_SNAPSHOTS === "true";

export const MCP_JS_S3_BUCKET = process.env.MCP_JS_S3_BUCKET;

/**
 * Whether the subprocess worker provider honors a session's
 * {@link import("@open-agents/sandbox").McpJsRuntimeConfig.commandOverride}.
 *
 * Off by default: the override is spawned verbatim as a host child process, so
 * enabling it lets any session author run an arbitrary command on the host.
 * Only turn this on for trusted, single-tenant deployments. The override is
 * still persisted and editable in the UI regardless — this flag only controls
 * whether it is applied at spawn time.
 */
export const MCP_JS_ALLOW_COMMAND_OVERRIDE =
  process.env.MCP_JS_ALLOW_COMMAND_OVERRIDE === "true";

/** Filesystem-snapshot config for spawned workers, or `enabled: false`. */
export function getMcpJsFsSnapshotConfig(): McpJsFsSnapshotConfig {
  return {
    enabled: MCP_JS_FS_SNAPSHOTS_ENABLED,
    s3Bucket: MCP_JS_S3_BUCKET,
    policyFilePath: process.env.MCP_JS_FS_POLICY_FILE,
  };
}

/** Options for the subprocess worker provider, sourced from the environment. */
export function getSubprocessWorkerOptions(): {
  binaryPath: string;
  storageDir: string;
  clusterHost: string;
  coordinatorHttpPort: number;
  coordinatorClusterPort: number;
  fsSnapshots: McpJsFsSnapshotConfig;
  heapSnapshots: boolean;
  allowCommandOverride: boolean;
} {
  return {
    binaryPath: MCP_JS_BIN,
    storageDir: MCP_JS_STORAGE_DIR,
    clusterHost: MCP_JS_CLUSTER_HOST,
    coordinatorHttpPort: MCP_JS_COORDINATOR_HTTP_PORT,
    coordinatorClusterPort: MCP_JS_COORDINATOR_CLUSTER_PORT,
    fsSnapshots: getMcpJsFsSnapshotConfig(),
    heapSnapshots: MCP_JS_HEAP_SNAPSHOTS_ENABLED,
    allowCommandOverride: MCP_JS_ALLOW_COMMAND_OVERRIDE,
  };
}

/** Whether the mcp-js runtime is selected for sandbox provisioning. */
export function isMcpJsRuntimeEnabled(): boolean {
  return Boolean(MCP_JS_BASE_URL) || getMcpJsWorkerMode() === "subprocess";
}
