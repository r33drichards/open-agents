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
// closed connection evicts the entry so the next caller reconnects.
const clients = new Map<string, Promise<Client>>();

async function connect(sseUrl: string): Promise<Client> {
  const client = new Client(
    { name: "open-agents", version: "0.0.0" },
    { capabilities: {} },
  );
  const transport = new SSEClientTransport(new URL(sseUrl));
  // `onclose` is the MCP transport's callback API, not a DOM event target.
  // eslint-disable-next-line unicorn/prefer-add-event-listener -- SDK contract
  transport.onclose = () => {
    clients.delete(sseUrl);
  };
  await client.connect(transport);
  return client;
}

/** Get (or establish) a cached MCP client for the given mcp-v8 base URL. */
export function getMcpClient(baseUrl: string): Promise<Client> {
  const sseUrl = mcpSseUrl(baseUrl);
  let pending = clients.get(sseUrl);
  if (!pending) {
    pending = connect(sseUrl).catch((error) => {
      clients.delete(sseUrl);
      throw error;
    });
    clients.set(sseUrl, pending);
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
export async function getToolboxTools(baseUrl: string): Promise<ToolboxTools> {
  const client = await getMcpClient(baseUrl);
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
