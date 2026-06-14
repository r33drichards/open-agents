import { dynamicTool, jsonSchema, type ToolSet } from "ai";

/**
 * Minimal structural view of an MCP client, satisfied by the official
 * `@modelcontextprotocol/sdk` `Client`. Kept narrow so the adapter is unit
 * testable without a live connection.
 */
export interface McpLike {
  listTools(): Promise<{ tools: McpToolDef[] }>;
  callTool(req: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallResult>;
  getInstructions?(): string | undefined;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpCallResult {
  content?: McpContentPart[];
  isError?: boolean;
}

/** Flatten an MCP tool result into the plain text the model consumes. */
export function mcpResultToText(result: McpCallResult): string {
  return (result.content ?? [])
    .map((part) =>
      part.type === "text" ? (part.text ?? "") : JSON.stringify(part),
    )
    .join("\n");
}

const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} } as const;

/**
 * Adapt every tool advertised by an MCP server into an AI SDK `ToolSet`.
 *
 * Each MCP tool becomes a `dynamicTool` whose JSON-schema input mirrors the
 * server's declared schema and whose `execute` proxies through to
 * `client.callTool`, surfacing the flattened text result (or throwing on a
 * tool-level error so the agent loop can react).
 */
export async function buildMcpToolSet(client: McpLike): Promise<ToolSet> {
  const { tools } = await client.listTools();
  const set: ToolSet = {};

  for (const def of tools) {
    set[def.name] = dynamicTool({
      description: def.description ?? "",
      inputSchema: jsonSchema(
        (def.inputSchema as object) ?? EMPTY_OBJECT_SCHEMA,
      ),
      execute: async (args) => {
        const result = await client.callTool({
          name: def.name,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        const text = mcpResultToText(result);
        if (result.isError) {
          throw new Error(text || `MCP tool "${def.name}" failed`);
        }
        return text;
      },
    });
  }

  return set;
}
