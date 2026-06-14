/**
 * State for connecting to / restoring an mcp-js (mcp-v8) sandbox.
 *
 * The mcp-js runtime is a remote V8 JavaScript execution server reached over
 * HTTP, so the only durable state we need is how to reach it plus the heap
 * snapshot key that carries JS state forward between executions.
 */
export interface McpJsState {
  /** Base URL of the mcp-v8 server, e.g. `https://mcp-v8.internal:8080`. */
  baseUrl: string;
  /**
   * Heap snapshot key produced by the previous execution. Threaded into the
   * next `run_js` call so globals persist across tool calls (stateful servers).
   */
  heap?: string;
  /** Session identifier passed to the server for tagging / logging. */
  session?: string;
  /** Working directory reported to the agent (nominal; e.g. the scratch dir). */
  workingDirectory?: string;
}
