import type { ConnectOptions } from "../factory.ts";
import type { Sandbox } from "../interface.ts";
import { McpJsSandbox } from "./sandbox.ts";
import type { McpJsState } from "./state.ts";

/**
 * Connect to an mcp-js (mcp-v8) sandbox from persisted state.
 *
 * Unlike the Vercel provider there is no remote resource to provision — the
 * mcp-v8 server is long-lived and shared — so connecting just constructs a
 * client bound to the server URL and carries forward the heap snapshot key.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async for a uniform promise-rejection contract across sandbox providers
export async function connectMcpJs(
  state: McpJsState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  if (!state.baseUrl) {
    throw new Error(
      "mcp-js sandbox state requires a `baseUrl` for the mcp-v8 server.",
    );
  }

  return new McpJsSandbox({
    baseUrl: state.baseUrl,
    heap: state.heap,
    session: state.session,
    workingDirectory: state.workingDirectory,
    env: options?.env,
    hooks: options?.hooks,
    timeout: options?.timeout,
  });
}
