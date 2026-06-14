import type { ConnectOptions } from "../factory.ts";

/**
 * Configuration for connecting to an mcp-js (mcp-v8) sandbox.
 *
 * Extends the shared {@link ConnectOptions}; only a subset is meaningful for a
 * JS-execution-only runtime (timeout, env), the rest are accepted for API
 * symmetry with other sandbox providers and ignored.
 */
export interface McpJsSandboxConfig extends ConnectOptions {
  /** Base URL of the mcp-v8 server. */
  baseUrl: string;
  /** Heap snapshot key to restore before the first execution. */
  heap?: string;
  /** Session identifier passed to the server for tagging / logging. */
  session?: string;
  /** Working directory reported to the agent (default: `/work`). */
  workingDirectory?: string;
  /** Extra HTTP headers (e.g. `Authorization`) sent with every request. */
  headers?: Record<string, string>;
}

/** Default nominal working directory for the JS runtime. */
export const DEFAULT_MCP_JS_WORKING_DIRECTORY = "/work";
