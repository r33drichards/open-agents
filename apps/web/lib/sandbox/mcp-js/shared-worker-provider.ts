import "server-only";

import type {
  EnsureWorkerParams,
  McpJsWorker,
  McpJsWorkerProvider,
} from "./worker-provider";

/**
 * Legacy "one shared server" provider: every session resolves to the same
 * `MCP_JS_BASE_URL`. Preserves the original behavior and acts as the migration
 * fallback; there is no per-session worker to tear down.
 */
export class SharedWorkerProvider implements McpJsWorkerProvider {
  constructor(private readonly baseUrl: string | undefined) {}

  ensureWorker(_params: EnsureWorkerParams): Promise<McpJsWorker> {
    if (!this.baseUrl) {
      return Promise.reject(
        new Error(
          "MCP_JS_BASE_URL must be set to provision a shared mcp-js worker.",
        ),
      );
    }
    return Promise.resolve({ baseUrl: this.baseUrl });
  }

  stopWorker(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }
}
