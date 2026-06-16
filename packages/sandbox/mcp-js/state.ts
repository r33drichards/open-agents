/**
 * State for connecting to / restoring an mcp-js (mcp-v8) sandbox.
 *
 * The mcp-js runtime is a remote V8 JavaScript execution server reached over
 * HTTP. State accumulates server-side under a stable `session` label: each
 * execution snapshots the V8 heap automatically, and a later run with the same
 * `session` restores that session's most-recent heap. The client therefore only
 * needs to persist the unchanging `session` — never the content-addressed heap
 * key, which changes on every run.
 */
import type { McpJsRuntimeConfig } from "./runtime-config.ts";

export interface McpJsState {
  /** Base URL of the mcp-v8 server, e.g. `https://mcp-v8.internal:8080`. */
  baseUrl: string;
  /**
   * Stable session label. The server restores this session's latest heap on
   * each run, so JS globals persist across executions without the client
   * tracking heap keys.
   */
  session?: string;
  /**
   * Optional explicit heap snapshot key to restore. Takes precedence over the
   * session fallback; normally unset.
   */
  heap?: string;
  /** Working directory reported to the agent (nominal; e.g. the scratch dir). */
  workingDirectory?: string;
  /**
   * Declarative per-session worker runtime config. Persisted so a resumed
   * session re-spawns its worker with identical capabilities/policies.
   */
  runtimeConfig?: McpJsRuntimeConfig;
  /**
   * Set on a forked session to seed it from a source session's snapshots. On
   * first provisioning the worker mounts these and records them as this
   * session's latest heap/fs, then this field is cleared so later restores do
   * not reset the session back to the fork point.
   */
  forkSource?: {
    /** Source session's latest heap CA id (V8 globals). */
    heap?: string;
    /** Source session's latest filesystem CA id. */
    fs?: string;
  };
}
