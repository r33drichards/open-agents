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

/** Construction options for {@link SubprocessWorkerProvider}. */
export interface SubprocessWorkerProviderOptions {
  /** Path to (or name of) the `mcp-v8` binary. */
  binaryPath: string;
  /** Shared content-addressed store directory mounted by every worker. */
  storageDir: string;
  /** How long to wait for a worker's HTTP API to come up. */
  readinessTimeoutMs?: number;
  /** Delay between readiness polls. */
  readinessPollMs?: number;
  // --- injectables (tests) ---
  spawn?: WorkerSpawn;
  fetchImpl?: WorkerFetch;
  allocatePort?: () => Promise<number>;
  ensureStorageDir?: (dir: string) => Promise<void>;
}

interface WorkerHandle {
  proc: SpawnedWorkerProcess;
  baseUrl: string;
}

const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_READINESS_POLL_MS = 150;

const defaultSpawn: WorkerSpawn = (command, args) =>
  nodeSpawn(command, args, { stdio: "inherit" });

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

/**
 * Runs each session's mcp-v8 worker as a local child process, all pointed at a
 * shared on-disk content-addressed store. Intended for local development and
 * self-hosted Node servers (it cannot run on serverless platforms).
 */
export class SubprocessWorkerProvider implements McpJsWorkerProvider {
  private readonly binaryPath: string;
  private readonly storageDir: string;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly spawn: WorkerSpawn;
  private readonly fetchImpl: WorkerFetch;
  private readonly allocatePort: () => Promise<number>;
  private readonly ensureStorageDir: (dir: string) => Promise<void>;
  private readonly workers = new Map<string, WorkerHandle>();

  constructor(options: SubprocessWorkerProviderOptions) {
    this.binaryPath = options.binaryPath;
    this.storageDir = options.storageDir;
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.readinessPollMs = options.readinessPollMs ?? DEFAULT_READINESS_POLL_MS;
    this.spawn = options.spawn ?? defaultSpawn;
    this.fetchImpl = options.fetchImpl ?? ((url) => globalThis.fetch(url));
    this.allocatePort = options.allocatePort ?? allocateEphemeralPort;
    this.ensureStorageDir =
      options.ensureStorageDir ??
      ((dir) => mkdir(dir, { recursive: true }).then(() => undefined));
  }

  async ensureWorker(params: EnsureWorkerParams): Promise<McpJsWorker> {
    const existing = this.workers.get(params.sessionId);
    if (existing && existing.proc.exitCode === null) {
      return { baseUrl: existing.baseUrl };
    }

    await this.ensureStorageDir(this.storageDir);

    const port = await this.allocatePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const args = buildMcpV8WorkerArgs({
      httpPort: port,
      storageDir: this.storageDir,
      runtimeConfig: params.runtimeConfig,
    });

    const proc = this.spawn(this.binaryPath, args);
    proc.once("exit", () => {
      if (this.workers.get(params.sessionId)?.proc === proc) {
        this.workers.delete(params.sessionId);
      }
    });
    this.workers.set(params.sessionId, { proc, baseUrl });

    try {
      await this.waitForReady(baseUrl, proc);
    } catch (error) {
      await this.stopWorker(params.sessionId);
      throw error;
    }

    return { baseUrl };
  }

  stopWorker(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId);
    if (!handle) {
      return Promise.resolve();
    }
    this.workers.delete(sessionId);
    if (handle.proc.exitCode === null) {
      handle.proc.kill("SIGTERM");
    }
    return Promise.resolve();
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
}
