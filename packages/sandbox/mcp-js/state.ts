/**
 * State for connecting to / restoring an mcp-js (mcp-v8) sandbox.
 *
 * The mcp-js runtime is a remote V8 JavaScript execution server reached over
 * HTTP. State accumulates server-side under a stable `session` label across two
 * independent axes the server may enable: a per-session `/work` filesystem and
 * (optionally) V8 heap snapshots. A later run with the same `session` restores
 * that session's most-recent state automatically, so the client only needs to
 * persist the unchanging `session` — never the content-addressed keys, which
 * change on every run. The deployed server runs filesystem-only (no heap), so
 * cross-call state should live in `/work`, not in JS globals.
 */
import type { McpJsRuntimeConfig } from "./runtime-config.ts";

export interface McpJsState {
  /** Base URL of the mcp-v8 server, e.g. `https://mcp-v8.internal:8080`. */
  baseUrl: string;
  /**
   * Stable session label. The server restores this session's latest state
   * (filesystem, and heap if enabled) on each run, so persistence works without
   * the client tracking content-addressed keys.
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
