import "server-only";

import { spawn as nodeSpawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { buildMcpV8WorkerArgs } from "./worker-args";
import type {
  EnsureWorkerParams,
  McpJsWorker,
  McpJsWorkerProvider,
} from "./worker-provider";

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
}

interface WorkerHandle {
  proc: SpawnedWorkerProcess;
  baseUrl: string;
  nodeId: string;
}

interface MainHandle {
  proc: SpawnedWorkerProcess;
  clusterPort: number;
  baseUrl: string;
}

const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_READINESS_POLL_MS = 150;
const COORDINATOR_NODE_ID = "main";

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
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly spawn: WorkerSpawn;
  private readonly fetchImpl: WorkerFetch;
  private readonly leaderReady: LeaderReadyProbe;
  private readonly leavePeer: LeavePeer;
  private readonly allocatePort: () => Promise<number>;
  private readonly ensureStorageDir: (dir: string) => Promise<void>;
  private readonly workers = new Map<string, WorkerHandle>();
  private main: MainHandle | undefined;
  private mainStarting: Promise<MainHandle> | undefined;

  constructor(options: SubprocessWorkerProviderOptions) {
    this.binaryPath = options.binaryPath;
    this.storageDir = options.storageDir;
    this.clusterHost = options.clusterHost ?? "127.0.0.1";
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
  }

  /** Lazily start (and single-flight) the coordinator node, returning it once it is leader. */
  private ensureMainNode(): Promise<MainHandle> {
    if (this.main && this.main.proc.exitCode === null) {
      return Promise.resolve(this.main);
    }
    if (this.mainStarting) {
      return this.mainStarting;
    }
    this.mainStarting = this.startMainNode().finally(() => {
      this.mainStarting = undefined;
    });
    return this.mainStarting;
  }

  private async startMainNode(): Promise<MainHandle> {
    await this.ensureStorageDir(`${this.storageDir}/sessions`);
    await this.ensureStorageDir(`${this.storageDir}/heaps`);

    const httpPort = await this.allocatePort();
    const clusterPort = await this.allocatePort();
    const baseUrl = `http://127.0.0.1:${httpPort}`;
    const args = buildMcpV8WorkerArgs({
      httpPort,
      clusterPort,
      nodeId: COORDINATOR_NODE_ID,
      storageDir: this.storageDir,
      advertiseHost: this.clusterHost,
    });

    const proc = this.spawn(this.binaryPath, args);
    proc.once("exit", () => {
      if (this.main?.proc === proc) {
        this.main = undefined;
      }
    });

    await this.waitForReady(baseUrl, proc);
    await this.waitForLeader(clusterPort, proc);

    const handle: MainHandle = { proc, clusterPort, baseUrl };
    this.main = handle;
    return handle;
  }

  async ensureWorker(params: EnsureWorkerParams): Promise<McpJsWorker> {
    const existing = this.workers.get(params.sessionId);
    if (existing && existing.proc.exitCode === null) {
      return { baseUrl: existing.baseUrl };
    }

    const main = await this.ensureMainNode();

    const httpPort = await this.allocatePort();
    const clusterPort = await this.allocatePort();
    const baseUrl = `http://127.0.0.1:${httpPort}`;
    const nodeId = toNodeId(params.sessionId);
    const args = buildMcpV8WorkerArgs({
      httpPort,
      clusterPort,
      nodeId,
      storageDir: this.storageDir,
      advertiseHost: this.clusterHost,
      join: `${this.clusterHost}:${main.clusterPort}`,
      asLearner: true,
      runtimeConfig: params.runtimeConfig,
    });

    const proc = this.spawn(this.binaryPath, args);
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
    if (this.main && this.main.proc.exitCode === null) {
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
    if (this.main && this.main.proc.exitCode === null) {
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
