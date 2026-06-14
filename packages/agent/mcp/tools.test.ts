import { describe, expect, mock, test } from "bun:test";

// `ai` re-exports dynamicTool/jsonSchema from @ai-sdk/provider-utils, which
// bun's ESM loader fails to resolve under `bun test`. Stub the two helpers we
// use so the adapter can be unit tested in isolation (matches models.test.ts).
mock.module("ai", () => ({
  dynamicTool: (def: Record<string, unknown>) => ({ ...def }),
  jsonSchema: (schema: unknown) => ({ jsonSchema: schema }),
}));

const { buildMcpToolSet, mcpResultToText } = await import("./tools");
type McpLike = import("./tools").McpLike;

function fakeClient(overrides: Partial<McpLike> = {}): McpLike {
  return {
    listTools: () =>
      Promise.resolve({
        tools: [
          {
            name: "run_js",
            description: "Run JavaScript",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        ],
      }),
    callTool: () =>
      Promise.resolve({ content: [{ type: "text", text: "42" }] }),
    ...overrides,
  };
}

describe("mcpResultToText", () => {
  test("joins text parts", () => {
    expect(
      mcpResultToText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
  });

  test("serializes non-text parts", () => {
    expect(mcpResultToText({ content: [{ type: "image", data: "x" }] })).toBe(
      '{"type":"image","data":"x"}',
    );
  });

  test("handles missing content", () => {
    expect(mcpResultToText({})).toBe("");
  });
});

describe("buildMcpToolSet", () => {
  test("creates one AI SDK tool per MCP tool, keyed by name", async () => {
    const set = await buildMcpToolSet(fakeClient());
    expect(Object.keys(set)).toEqual(["run_js"]);
    expect(set.run_js?.description).toBe("Run JavaScript");
  });

  test("execute forwards args to callTool and flattens the result", async () => {
    const calls: Array<{ name: string; arguments: unknown }> = [];
    const set = await buildMcpToolSet(
      fakeClient({
        callTool: (req) => {
          calls.push(req);
          return Promise.resolve({
            content: [{ type: "text", text: "84" }],
          });
        },
      }),
    );

    const execute = set.run_js?.execute;
    if (!execute) {
      throw new Error("run_js tool is missing an execute fn");
    }
    const output = await execute(
      { code: "console.log(42*2)" },
      { toolCallId: "t1", messages: [] },
    );

    expect(calls).toEqual([
      { name: "run_js", arguments: { code: "console.log(42*2)" } },
    ]);
    expect(output).toBe("84");
  });

  test("execute throws when the MCP tool reports an error", async () => {
    const set = await buildMcpToolSet(
      fakeClient({
        callTool: () =>
          Promise.resolve({
            isError: true,
            content: [{ type: "text", text: "boom" }],
          }),
      }),
    );
    const execute = set.run_js?.execute;
    if (!execute) {
      throw new Error("run_js tool is missing an execute fn");
    }
    await expect(
      execute({ code: "x" }, { toolCallId: "t1", messages: [] }),
    ).rejects.toThrow("boom");
  });
});
