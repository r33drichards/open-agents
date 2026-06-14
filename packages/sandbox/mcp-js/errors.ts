/**
 * Error thrown when a filesystem/shell operation is requested that the
 * JS-execution-only mcp-js runtime does not support.
 */
export class McpJsUnsupportedOperationError extends Error {
  constructor(operation: string) {
    super(
      `Operation "${operation}" is not supported on the mcp-js runtime. ` +
        "mcp-js is a JS-execution-only sandbox (mcp-v8): use exec() to run " +
        "JavaScript via run_js. Filesystem and shell access are unavailable.",
    );
    this.name = "McpJsUnsupportedOperationError";
  }
}
