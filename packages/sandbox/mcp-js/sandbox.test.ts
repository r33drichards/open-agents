import { describe, expect, test } from "bun:test";
import { connectMcpJs } from "./connect.ts";
import { McpJsUnsupportedOperationError } from "./errors.ts";
import { McpJsSandbox } from "./sandbox.ts";

describe("McpJsSandbox", () => {
  test("reports the js type and a working directory", () => {
    const sandbox = new McpJsSandbox({ baseUrl: "http://localhost:8080" });
    expect(sandbox.type).toBe("js");
    expect(sandbox.workingDirectory).toBe("/work");
    expect(sandbox.environmentDetails).toContain("mcp-js");
  });

  test("filesystem operations are unsupported", async () => {
    const sandbox = new McpJsSandbox({ baseUrl: "http://localhost:8080" });
    await expect(sandbox.readFile("/x", "utf-8")).rejects.toBeInstanceOf(
      McpJsUnsupportedOperationError,
    );
    await expect(
      sandbox.writeFile("/x", "data", "utf-8"),
    ).rejects.toBeInstanceOf(McpJsUnsupportedOperationError);
    await expect(
      sandbox.readdir("/x", { withFileTypes: true }),
    ).rejects.toBeInstanceOf(McpJsUnsupportedOperationError);
  });

  test("getState round-trips the session label without a heap key", () => {
    const sandbox = new McpJsSandbox({
      baseUrl: "http://localhost:8080",
      session: "sess-1",
    });
    expect(sandbox.getState()).toEqual({
      baseUrl: "http://localhost:8080",
      session: "sess-1",
      workingDirectory: "/work",
    });
  });

  test("getState includes an explicit heap override when set", () => {
    const sandbox = new McpJsSandbox({
      baseUrl: "http://localhost:8080",
      session: "sess-1",
      heap: "heap-123",
    });
    expect(sandbox.getState().heap).toBe("heap-123");
  });

  test("connectMcpJs requires a baseUrl", async () => {
    await expect(connectMcpJs({ baseUrl: "" })).rejects.toThrow(/baseUrl/);
  });
});
