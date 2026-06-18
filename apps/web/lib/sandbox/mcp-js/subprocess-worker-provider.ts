import "server-only";

import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { McpJsFsSnapshotConfig } from "@/lib/sandbox/config";
import { buildMcpV8WorkerArgs } from "./worker-args";
import { getCommandArgValue, parseMcpV8Command } from "./worker-command";
import type {
  EnsureWorkerParams,
  McpJsWorker,
  McpJsWorkerProvider,
} from "./worker-provider";

/**
 * Resolve the filesystem policy path the mcp-v8 worker reads via `file://`.
 * The policy lives in the repo and is read by the external worker process, so
 * it must be a real on-disk path (not bundled into Next). Resolved here (a
 * server-only module that may use Node APIs) rather than in the
 * workflow-imported config module.
 */
function resolveFsSnapshots(
  fs: McpJsFsSnapshotConfig | undefined,
): McpJsFsSnapshotConfig | undefined {
  if (!fs?.enabled) {
    return fs;
  }
  return {
    ...fs,
    policyFilePath:
      fs.policyFilePath ??
      join(process.cwd(), "lib/sandbox/mcp-js/fs-policy.rego"),
  };
}

/** The subset of a spawned process this provider depends on. */
export interface SpawnedWorkerProcess {
  /** `null` while running; an exit code/`number` once exited. */
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: () => void): unknown;
}

/** Spawn function shape (injectable for tests). */
export type WorkerSpawn = (
  command: string,
  args: string[],
) => SpawnedWorkerProcess;

/** The slice of `fetch` the readiness probe needs (injectable for tests). */
export type WorkerFetch = (url: string) => Promise<{ ok: boolean }>;

/** Probe whether the coordinator has become the Raft leader (injectable). */
export type LeaderReadyProbe = (clusterPort: number) => Promise<boolean>;

/** Remove a learner from the cluster on the coordinator (injectable). */
export type LeavePeer = (clusterPort: number, nodeId: string) => Promise<void>;

/** Construction options for {@link SubprocessWorkerProvider}. */
export interface SubprocessWorkerProviderOptions {
  /** Path to (or name of) the `mcp-v8` binary. */
  binaryPath: string;
  /** Shared content-addressed store directory mounted by every worker. */
  storageDir: string;
  /** Host nodes advertise/reach each other on. Defaults to 127.0.0.1. */
  clusterHost?: string;
  /** Fixed MCP HTTP port for the coordinator (machine-singleton). */
  coordinatorHttpPort?: number;
  /** Fixed Raft cluster port for the coordinator (machine-singleton). */
  coordinatorClusterPort?: number;
  /** Per-session content-addressed filesystem snapshot config (optional). */
  fsSnapshots?: McpJsFsSnapshotConfig;
  /** Persist the V8 heap (globals across runs). Off by default (matches deploy). */
  heapSnapshots?: boolean;
  /**
   * Honor a session's `runtimeConfig.commandOverride` and spawn it verbatim.
   * Off by default — the override runs an arbitrary host process. See
   * `MCP_JS_ALLOW_COMMAND_OVERRIDE`.
   */
  allowCommandOverride?: boolean;
  /** How long to wait for a worker's HTTP API to come up. */
  readinessTimeoutMs?: number;
  /** Delay between readiness polls. */
  readinessPollMs?: number;
  // --- injectables (tests) ---
  spawn?: WorkerSpawn;
  fetchImpl?: WorkerFetch;
  leaderReady?: LeaderReadyProbe;
  leavePeer?: LeavePeer;
  allocatePort?: () => Promise<number>;
  ensureStorageDir?: (dir: string) => Promise<void>;
  removeDir?: (dir: string) => Promise<void>;
}

interface WorkerHandle {
  proc: SpawnedWorkerProcess;
  baseUrl: string;
  nodeId: string;
}

interface MainHandle {
  /** Set when this provider instance spawned the coordinator; absent when adopted. */
  proc?: SpawnedWorkerProcess;
  clusterPort: number;
  baseUrl: string;
  /** True when this instance owns (spawned) the coordinator and may stop it. */
  owned: boolean;
}

const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_READINESS_POLL_MS = 150;
const COORDINATOR_NODE_ID = "main";
const DEFAULT_COORDINATOR_HTTP_PORT = 47_600;
const DEFAULT_COORDINATOR_CLUSTER_PORT = 47_601;

const defaultSpawn: WorkerSpawn = (command, args) =>
  nodeSpawn(command, args, { stdio: "inherit" });

const defaultLeaderReady: LeaderReadyProbe = async (clusterPort) => {
  try {
    const res = await fetch(`http://127.0.0.1:${clusterPort}/raft/status`);
    if (!res.ok) {
      return false;
    }
    const status = (await res.json()) as { role?: string };
    return status.role === "Leader";
  } catch {
    return false;
  }
};

const defaultLeavePeer: LeavePeer = async (clusterPort, nodeId) => {
  try {
    await fetch(`http://127.0.0.1:${clusterPort}/raft/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ node_id: nodeId }),
    });
  } catch {
    // Best-effort: the coordinator drops unreachable peers on its own too.
  }
};

/** Grab an OS-assigned free TCP port. */
function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate an ephemeral port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** mcp-v8 node ids appear in URLs and the peer map; keep them simple. */
function toNodeId(sessionId: string): string {
  const sanitized = sessionId.replace(/[^A-Za-z0-9_-]/g, "-");
  return sanitized === COORDINATOR_NODE_ID ? `s-${sanitized}` : sanitized;
}

/**
 * Runs each session's mcp-v8 worker as a local child process in a Raft cluster:
 * a single long-lived coordinator ("main") node is the voter/leader that owns
 * the write quorum, and each session's worker joins as a non-voting learner.
 * All nodes share one on-disk content-addressed heap store; session metadata is
 * replicated through Raft. Because learners are excluded from quorum, spawning
 * and tearing down per-session workers never affects availability.
 *
 * Intended for local development and self-hosted Node servers (it cannot run on
 * serverless platforms).
 */
export class SubprocessWorkerProvider implements McpJsWorkerProvider {
  private readonly binaryPath: string;
  private readonly storageDir: string;
  private readonly clusterHost: string;
  private readonly coordinatorHttpPort: number;
  private readonly coordinatorClusterPort: number;
  private readonly fsSnapshots: McpJsFsSnapshotConfig | undefined;
  private readonly heapSnapshots: boolean;
  private readonly allowCommandOverride: boolean;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly spawn: WorkerSpawn;
  private readonly fetchImpl: WorkerFetch;
  private readonly leaderReady: LeaderReadyProbe;
  private readonly leavePeer: LeavePeer;
  private readonly allocatePort: () => Promise<number>;
  private readonly ensureStorageDir: (dir: string) => Promise<void>;
  private readonly removeDir: (dir: string) => Promise<void>;
  private readonly workers = new Map<string, WorkerHandle>();
  private main: MainHandle | undefined;
  private mainStarting: Promise<MainHandle> | undefined;

  constructor(options: SubprocessWorkerProviderOptions) {
    this.binaryPath = options.binaryPath;
    this.storageDir = options.storageDir;
    this.clusterHost = options.clusterHost ?? "127.0.0.1";
    this.coordinatorHttpPort =
      options.coordinatorHttpPort ?? DEFAULT_COORDINATOR_HTTP_PORT;
    this.coordinatorClusterPort =
      options.coordinatorClusterPort ?? DEFAULT_COORDINATOR_CLUSTER_PORT;
    this.fsSnapshots = resolveFsSnapshots(options.fsSnapshots);
    this.heapSnapshots = options.heapSnapshots ?? false;
    this.allowCommandOverride = options.allowCommandOverride ?? false;
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.readinessPollMs = options.readinessPollMs ?? DEFAULT_READINESS_POLL_MS;
    this.spawn = options.spawn ?? defaultSpawn;
    this.fetchImpl = options.fetchImpl ?? ((url) => globalThis.fetch(url));
    this.leaderReady = options.leaderReady ?? defaultLeaderReady;
    this.leavePeer = options.leavePeer ?? defaultLeavePeer;
    this.allocatePort = options.allocatePort ?? allocateEphemeralPort;
    this.ensureStorageDir =
      options.ensureStorageDir ??
      ((dir) => mkdir(dir, { recursive: true }).then(() => undefined));
    this.removeDir =
      options.removeDir ?? ((dir) => rm(dir, { recursive: true, force: true }));
  }

  /**
   * Resolve the coordinator node, single-flighted. The coordinator is a
   * machine-wide singleton on fixed ports: if one is already running (started
   * by this or another module instance) we adopt it; otherwise we start it.
   */
  private ensureMainNode(): Promise<MainHandle> {
    if (
      this.main?.owned &&
      this.main.proc &&
      this.main.proc.exitCode === null
    ) {
      return Promise.resolve(this.main);
    }
    if (this.mainStarting) {
      return this.mainStarting;
    }
    this.mainStarting = this.resolveCoordinator().finally(() => {
      this.mainStarting = undefined;
    });
    return this.mainStarting;
  }

  private adoptCoordinator(): MainHandle {
    this.main = {
      clusterPort: this.coordinatorClusterPort,
      baseUrl: `http://127.0.0.1:${this.coordinatorHttpPort}`,
      owned: false,
    };
    return this.main;
  }

  private async resolveCoordinator(): Promise<MainHandle> {
    // 1. Adopt a coordinator already running on the fixed cluster port.
    if (await this.leaderReady(this.coordinatorClusterPort)) {
      return this.adoptCoordinator();
    }

    // 2. Start our own coordinator on the fixed ports.
    //
    // Wipe the coordinator's persisted Raft state first. Its membership is
    // ephemeral operational data — stale per-session learners (and any stale
    // voter) accumulate across restarts and a dead voter would stall the write
    // quorum, leaving the coordinator stuck electing. Heaps are content-
    // addressed under `heaps/` and are NOT touched, so no durable data is lost.
    await this.removeDir(`${this.storageDir}/sessions/${COORDINATOR_NODE_ID}`);
    await this.ensureStorageDir(`${this.storageDir}/sessions`);
    await this.ensureStorageDir(`${this.storageDir}/heaps`);

    const args = buildMcpV8WorkerArgs({
      httpPort: this.coordinatorHttpPort,
      clusterPort: this.coordinatorClusterPort,
      nodeId: COORDINATOR_NODE_ID,
      storageDir: this.storageDir,
      advertiseHost: this.clusterHost,
      // The coordinator must enable fs snapshots too: in cluster mode every
      // node with snapshots on needs the shared blob store, and the leader
      // participates in cluster-wide label replication.
      fsSnapshots: this.fsSnapshots,
      heapSnapshots: this.heapSnapshots,
    });

    const proc = this.spawn(this.binaryPath, args);
    proc.once("exit", () => {
      if (this.main?.proc === proc) {
        this.main = undefined;
      }
    });

    try {
      await this.waitForLeader(this.coordinatorClusterPort, proc);
    } catch (error) {
      // We likely lost a race: another instance holds the coordinator's sled
      // lock, so ours exited. If that coordinator is now up, adopt it.
      if (
        proc.exitCode !== null &&
        (await this.leaderReady(this.coordinatorClusterPort))
      ) {
        return this.adoptCoordinator();
      }
      throw error;
    }

    this.main = {
      proc,
      clusterPort: this.coordinatorClusterPort,
      baseUrl: `http://127.0.0.1:${this.coordinatorHttpPort}`,
      owned: true,
    };
    return this.main;
  }

  /**
   * Resolve how to launch a session's worker: either the argv generated for a
   * cluster learner, or — when {@link allowCommandOverride} is on and the
   * session carries a `commandOverride` — that command parsed and spawned
   * verbatim. In the override path the port and node id are read back from the
   * command (so readiness probing and cluster bookkeeping target the right
   * worker), falling back to an allocated port / the session-derived id.
   */
  private async resolveLaunch(
    params: EnsureWorkerParams,
    main: MainHandle,
  ): Promise<{
    binary: string;
    args: string[];
    httpPort: number;
    nodeId: string;
  }> {
    const override = this.allowCommandOverride
      ? params.runtimeConfig?.commandOverride?.trim()
      : undefined;

    if (override) {
      const { binary, args } = parseMcpV8Command(override);
      const portValue =
        getCommandArgValue(args, "sse-port") ??
        getCommandArgValue(args, "http-port");
      const httpPort = portValue
        ? Number(portValue)
        : await this.allocatePort();
      if (!Number.isInteger(httpPort) || httpPort <= 0) {
        throw new Error(
          "mcp-js command override has an invalid --sse-port/--http-port.",
        );
      }
      return {
        binary,
        args,
        httpPort,
        nodeId:
          getCommandArgValue(args, "node-id") ?? toNodeId(params.sessionId),
      };
    }

    const httpPort = await this.allocatePort();
    const clusterPort = await this.allocatePort();
    const nodeId = toNodeId(params.sessionId);
    const args = buildMcpV8WorkerArgs({
      httpPort,
      clusterPort,
      nodeId,
      storageDir: this.storageDir,
      advertiseHost: this.clusterHost,
      join: `${this.clusterHost}:${main.clusterPort}`,
      asLearner: true,
      // The agent's MCP client connects over SSE (`<baseUrl>/sse`).
      transport: "sse",
      runtimeConfig: params.runtimeConfig,
      fsSnapshots: this.fsSnapshots,
      heapSnapshots: this.heapSnapshots,
    });
    return { binary: this.binaryPath, args, httpPort, nodeId };
  }

  async ensureWorker(params: EnsureWorkerParams): Promise<McpJsWorker> {
    const existing = this.workers.get(params.sessionId);
    if (existing && existing.proc.exitCode === null) {
      return { baseUrl: existing.baseUrl };
    }

    const main = await this.ensureMainNode();

    const launch = await this.resolveLaunch(params, main);
    const { binary, args, httpPort, nodeId } = launch;
    const baseUrl = `http://127.0.0.1:${httpPort}`;

    const proc = this.spawn(binary, args);
    proc.once("exit", () => {
      if (this.workers.get(params.sessionId)?.proc === proc) {
        this.workers.delete(params.sessionId);
        // Drop the dead learner from cluster membership (best effort).
        void this.leavePeer(main.clusterPort, nodeId);
      }
    });
    this.workers.set(params.sessionId, { proc, baseUrl, nodeId });

    try {
      await this.waitForReady(baseUrl, proc);
    } catch (error) {
      await this.stopWorker(params.sessionId);
      throw error;
    }

    return { baseUrl };
  }

  async stopWorker(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId);
    if (!handle) {
      return;
    }
    this.workers.delete(sessionId);
    // Coordinator alive if owned-and-running or adopted (proc undefined).
    if (this.main && (this.main.proc?.exitCode ?? null) === null) {
      await this.leavePeer(this.main.clusterPort, handle.nodeId);
    }
    if (handle.proc.exitCode === null) {
      handle.proc.kill("SIGTERM");
    }
  }

  /**
   * Tear down every worker and the coordinator. Useful for graceful shutdown
   * and to avoid leaking child processes in tests.
   */
  dispose(): void {
    for (const handle of this.workers.values()) {
      if (handle.proc.exitCode === null) {
        handle.proc.kill("SIGTERM");
      }
    }
    this.workers.clear();
    // Only stop the coordinator if we started it; an adopted coordinator may be
    // serving other module instances.
    if (
      this.main?.owned &&
      this.main.proc &&
      this.main.proc.exitCode === null
    ) {
      this.main.proc.kill("SIGTERM");
    }
    this.main = undefined;
  }

  private async waitForReady(
    baseUrl: string,
    proc: SpawnedWorkerProcess,
  ): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(
          `mcp-js worker exited before becoming ready (code ${proc.exitCode}).`,
        );
      }
      try {
        const response = await this.fetchImpl(`${baseUrl}/api/version`);
        if (response.ok) {
          return;
        }
      } catch {
        // Not up yet; keep polling until the deadline.
      }
      await delay(this.readinessPollMs);
    }
    throw new Error(
      `mcp-js worker at ${baseUrl} did not become ready within ${this.readinessTimeoutMs}ms.`,
    );
  }

  private async waitForLeader(
    clusterPort: number,
    proc: SpawnedWorkerProcess,
  ): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(
          `mcp-js coordinator exited before becoming leader (code ${proc.exitCode}).`,
        );
      }
      if (await this.leaderReady(clusterPort)) {
        return;
      }
      await delay(this.readinessPollMs);
    }
    throw new Error(
      `mcp-js coordinator on cluster port ${clusterPort} did not become leader within ${this.readinessTimeoutMs}ms.`,
    );
  }
}
