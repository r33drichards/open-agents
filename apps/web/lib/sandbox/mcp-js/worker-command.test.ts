import { describe, expect, test } from "bun:test";
import { buildMcpV8WorkerArgs } from "./worker-args";
import {
  formatMcpV8Command,
  getCommandArgValue,
  parseMcpV8Command,
} from "./worker-command";

describe("formatMcpV8Command", () => {
  test("leaves plain flags unquoted", () => {
    expect(
      formatMcpV8Command("mcp-v8", ["--sse-port=5001", "--node-id=session"]),
    ).toBe("mcp-v8 --sse-port=5001 --node-id=session");
  });

  test("single-quotes flags carrying JSON (quotes + braces)", () => {
    const policies =
      '--policies-json={"fetch":{"policies":[{"url":"http://opa:8181"}]}}';
    expect(formatMcpV8Command("mcp-v8", [policies])).toBe(
      `mcp-v8 '--policies-json={"fetch":{"policies":[{"url":"http://opa:8181"}]}}'`,
    );
  });

  test("escapes embedded single quotes", () => {
    expect(formatMcpV8Command("bin", ["a'b"])).toBe(`bin 'a'\\''b'`);
  });
});

describe("parseMcpV8Command", () => {
  test("splits a plain command", () => {
    expect(
      parseMcpV8Command("mcp-v8 --sse-port=5001 --node-id=session"),
    ).toEqual({
      binary: "mcp-v8",
      args: ["--sse-port=5001", "--node-id=session"],
    });
  });

  test("keeps quoted JSON as one token", () => {
    const parsed = parseMcpV8Command(
      `mcp-v8 '--policies-json={"fetch":{"policies":[]}}'`,
    );
    expect(parsed).toEqual({
      binary: "mcp-v8",
      args: ['--policies-json={"fetch":{"policies":[]}}'],
    });
  });

  test("collapses extra whitespace", () => {
    expect(parseMcpV8Command("  mcp-v8   --a    --b ")).toEqual({
      binary: "mcp-v8",
      args: ["--a", "--b"],
    });
  });

  test("throws on an unterminated quote", () => {
    expect(() => parseMcpV8Command("mcp-v8 '--x")).toThrow();
  });

  test("throws on an empty command", () => {
    expect(() => parseMcpV8Command("   ")).toThrow();
  });

  test("round-trips a generated worker command", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 5001,
      clusterPort: 5002,
      nodeId: "sess-abc",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
      join: "127.0.0.1:4322",
      asLearner: true,
      transport: "sse",
      runtimeConfig: {
        capabilities: {
          fetch: { enabled: true, opaUrls: ["http://opa:8181"] },
        },
      },
    });
    const formatted = formatMcpV8Command("mcp-v8", args);
    expect(parseMcpV8Command(formatted)).toEqual({ binary: "mcp-v8", args });
  });
});

describe("getCommandArgValue", () => {
  test("reads --flag=value form", () => {
    expect(getCommandArgValue(["--sse-port=5001"], "sse-port")).toBe("5001");
  });

  test("reads --flag value form", () => {
    expect(getCommandArgValue(["--node-id", "session"], "node-id")).toBe(
      "session",
    );
  });

  test("returns undefined when absent", () => {
    expect(getCommandArgValue(["--sse-port=5001"], "node-id")).toBeUndefined();
  });
});
