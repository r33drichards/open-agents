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
}
