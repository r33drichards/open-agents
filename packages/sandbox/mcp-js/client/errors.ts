/** Error thrown when an mcp-v8 REST request fails. */
export class McpV8Error extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "McpV8Error";
    this.status = status;
  }
}
