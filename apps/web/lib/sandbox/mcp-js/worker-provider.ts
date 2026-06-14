import "server-only";

import type { McpJsRuntimeConfig } from "@open-agents/sandbox";
import {
  getMcpJsWorkerMode,
  getSubprocessWorkerOptions,
  MCP_JS_BASE_URL,
} from "@/lib/sandbox/config";
import { SharedWorkerProvider } from "./shared-worker-provider";
import { SubprocessWorkerProvider } from "./subprocess-worker-provider";

/** Parameters for {@link McpJsWorkerProvider.ensureWorker}. */
export interface EnsureWorkerParams {
  /** Open-agents session id; also the worker's stable identity. */
  sessionId: string;
  /** Declarative runtime config the worker is launched with. */
  runtimeConfig?: McpJsRuntimeConfig;
}

/** A running mcp-js worker the sandbox client can connect to. */
export interface McpJsWorker {
  /** Base URL the sandbox client should hit for this session's worker. */
  baseUrl: string;
}

/**
 * Spawns and tears down per-session mcp-js (mcp-v8) workers.
 *
 * Implementations differ only in *where* the worker runs (a local child
 * process, a Kubernetes resource, or a single shared server); callers see one
 * idempotent `ensureWorker` / `stopWorker` contract.
 */
export interface McpJsWorkerProvider {
  /** Idempotently ensure a worker exists for the session; return its URL. */
  ensureWorker(params: EnsureWorkerParams): Promise<McpJsWorker>;
  /** Tear down the session's worker (idempotent / no-op if absent). */
  stopWorker(sessionId: string): Promise<void>;
}

let cachedProvider: McpJsWorkerProvider | undefined;

/**
 * Resolve the configured worker provider (memoized as a process singleton so
 * the subprocess registry persists across requests).
 */
export function getMcpJsWorkerProvider(): McpJsWorkerProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  cachedProvider =
    getMcpJsWorkerMode() === "subprocess"
      ? new SubprocessWorkerProvider(getSubprocessWorkerOptions())
      : new SharedWorkerProvider(MCP_JS_BASE_URL);

  return cachedProvider;
}

/** Reset the memoized provider. Test-only. */
export function resetMcpJsWorkerProviderForTests(): void {
  cachedProvider = undefined;
}
