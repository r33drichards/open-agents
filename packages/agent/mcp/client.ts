import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ToolSet } from "ai";
import { buildMcpToolSet, type McpCallResult, type McpLike } from "./tools";

/** Path on the mcp-v8 server that serves the SSE MCP transport. */
const MCP_SSE_PATH = "/sse";

/**
 * Build the SSE MCP URL for a sandbox base URL.
 * Override the path with `MCP_JS_SSE_PATH` if the server mounts it elsewhere.
 */
export function mcpSseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const path = process.env.MCP_JS_SSE_PATH ?? MCP_SSE_PATH;
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

// The toolbox is long-lived and shared, so a single MCP client per SSE URL is
// reused across turns for the lifetime of the server process. A failed or
// closed connection evicts the entry so the next caller reconnects. The cache
// key includes the session id, sent as the X-MCP-Session-Id connection header
// that keys server-side heap/fs state.
const clients = new Map<string, Promise<Client>>();

function clientKey(sseUrl: string, session?: string): string {
  return session ? `${sseUrl}#${session}` : sseUrl;
}

async function connect(sseUrl: string, session?: string): Promise<Client> {
  const client = new Client(
    { name: "open-agents", version: "0.0.0" },
    { capabilities: {} },
  );
  // Send the session label as X-MCP-Session-Id so the mcp-v8 worker restores
  // this session's latest heap and content-addressed filesystem on each run.
  // Set it on both the message POSTs (requestInit) and the SSE GET
  // (eventSourceInit) so it is present on the initialize request the server
  // reads to bind the session.
  const headers = session ? { "X-MCP-Session-Id": session } : undefined;
  const transport = new SSEClientTransport(
    new URL(sseUrl),
    headers
      ? {
          requestInit: { headers },
          eventSourceInit: {
            fetch: (url: string | URL | Request, init?: RequestInit) =>
              fetch(url, {
                ...init,
                headers: { ...init?.headers, ...headers },
              }),
          },
        }
      : undefined,
  );
  // `onclose` is the MCP transport's callback API, not a DOM event target.
  // eslint-disable-next-line unicorn/prefer-add-event-listener -- SDK contract
  transport.onclose = () => {
    clients.delete(clientKey(sseUrl, session));
  };
  await client.connect(transport);
  return client;
}

/** Get (or establish) a cached MCP client for the given mcp-v8 base URL. */
export function getMcpClient(
  baseUrl: string,
  session?: string,
): Promise<Client> {
  const sseUrl = mcpSseUrl(baseUrl);
  const key = clientKey(sseUrl, session);
  let pending = clients.get(key);
  if (!pending) {
    pending = connect(sseUrl, session).catch((error) => {
      clients.delete(key);
      throw error;
    });
    clients.set(key, pending);
  }
  return pending;
}

export interface ToolboxTools {
  tools: ToolSet;
  /** The server's own usage instructions, to fold into the system prompt. */
  instructions?: string;
}

/**
 * Connect to the toolbox over MCP and return its tools (adapted to the AI SDK)
 * plus the server's advertised instructions.
 */
export async function getToolboxTools(
  baseUrl: string,
  session?: string,
): Promise<ToolboxTools> {
  const client = await getMcpClient(baseUrl, session);
  // The SDK client's result types are richer than the adapter needs; bridge
  // them through the minimal McpLike shape the tool builder consumes.
  const adapter: McpLike = {
    listTools: () => client.listTools(),
    callTool: (req) => client.callTool(req) as Promise<McpCallResult>,
    getInstructions: () => client.getInstructions(),
  };
  const tools = await buildMcpToolSet(adapter);
  return { tools, instructions: client.getInstructions() };
}
