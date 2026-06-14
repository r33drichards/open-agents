/**
 * Declarative, per-session configuration for an mcp-js (mcp-v8) worker runtime.
 *
 * Supplied when a session is created and persisted in the sandbox state so the
 * same worker can be re-spawned with identical settings on resume. Capabilities
 * are OFF by default (mcp-v8's secure-by-default model); enabling one maps to a
 * launch-time policy the worker is started with.
 */
export interface McpJsRuntimeConfig {
  /** Per-execution V8 heap memory cap, in megabytes. */
  heapMemoryMaxMb?: number;
  /** Nominal working directory reported to the agent. */
  workingDirectory?: string;
  /** Host-capability policies; each capability is denied unless enabled. */
  capabilities?: McpJsCapabilities;
}

/** Per-capability access policies for an mcp-js worker. */
export interface McpJsCapabilities {
  fetch?: McpJsCapabilityPolicy;
  filesystem?: McpJsCapabilityPolicy;
  subprocess?: McpJsCapabilityPolicy;
}

/** Access policy for a single host capability. */
export interface McpJsCapabilityPolicy {
  /** Allow the capability at all. When false/omitted it stays denied. */
  enabled?: boolean;
  /**
   * OPA policy server URLs (Rego) consulted per call. When omitted and
   * `enabled` is true, the capability is allowed unconditionally.
   */
  opaUrls?: string[];
}
