import { describe, expect, test } from "bun:test";
import {
  assembleMcpServerValue,
  buildCommandFromForm,
  getPreservedArgs,
  parseFormFromArgs,
  seedFromPreview,
} from "./command-form";
import { parseMcpV8Command } from "./worker-command";

// Representative preview command (mirrors /api/sessions/command-preview output):
// infra flags + bundled-language flags (instructions/wasm/policies).
const PREVIEW =
  "/usr/local/bin/mcp-v8 --sse-port=5001 " +
  "--session-db-path=/data/.mcp-js/sessions/session --cluster-port=5002 " +
  "--node-id=session --advertise-addr=127.0.0.1:5002 --join=127.0.0.1:47601 " +
  "--join-as-learner --allow-external-modules " +
  "--instructions 'Run JS for me' " +
  "--wasm-module picat=/opt/languages/picat.wasm:512m " +
  "--wasm-module lua=/opt/languages/lua.wasm:512m " +
  '\'--policies-json={"fetch":{"policies":[]}}\'';

describe("command-form seed", () => {
  test("preserves infra flags verbatim, excludes editable ones", () => {
    const { args } = parseMcpV8Command(PREVIEW);
    const infra = getPreservedArgs(args);
    expect(infra).toContain("--sse-port=5001");
    expect(infra).toContain("--node-id=session");
    expect(infra).toContain("--join=127.0.0.1:47601");
    expect(infra).toContain("--join-as-learner");
    expect(infra).toContain('--policies-json={"fetch":{"policies":[]}}');
    // editable flags are NOT preserved (the form owns them)
    expect(infra).not.toContain("--allow-external-modules");
    expect(infra.join(" ")).not.toContain("--instructions");
    expect(infra.join(" ")).not.toContain("--wasm-module");
  });

  test("parses editable flags into form state", () => {
    const { args } = parseMcpV8Command(PREVIEW);
    const form = parseFormFromArgs(args);
    expect(form.allowExternalModules).toBe(true);
    expect(form.instructions).toBe("Run JS for me");
    expect(form.wasmModules).toHaveLength(2);
    expect(form.wasmModules[0]).toEqual({
      name: "picat",
      path: "/opt/languages/picat.wasm",
      memory: "512m",
    });
    expect(form.mcpServers).toHaveLength(0);
  });

  test("seedFromPreview returns binary + infra + form", () => {
    const seed = seedFromPreview(PREVIEW);
    expect(seed).not.toBeNull();
    expect(seed?.binary).toBe("/usr/local/bin/mcp-v8");
    expect(seed?.form.allowExternalModules).toBe(true);
  });

  test("seedFromPreview returns null on unparseable input", () => {
    expect(seedFromPreview("'unterminated")).toBeNull();
  });
});

describe("buildCommandFromForm", () => {
  test("adds a custom MCP server while preserving infra and not duplicating flags", () => {
    const seed = seedFromPreview(PREVIEW);
    if (!seed) {
      throw new Error("seed failed");
    }
    const form = {
      ...seed.form,
      mcpServers: [
        {
          name: "custom",
          transport: "stdio" as const,
          command: "/usr/local/bin/mcp-v8",
          args: "",
          url: "",
        },
      ],
    };
    const cmd = buildCommandFromForm(seed.binary, seed.infraArgs, form);
    const { binary, args } = parseMcpV8Command(cmd);

    expect(binary).toBe("/usr/local/bin/mcp-v8");
    // infra preserved
    expect(args).toContain("--sse-port=5001");
    expect(args).toContain("--join-as-learner");
    // custom MCP added (space form)
    const mcpIdx = args.indexOf("--mcp-server");
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    expect(args[mcpIdx + 1]).toBe("custom=stdio:/usr/local/bin/mcp-v8");
    // editable flags rebuilt exactly once (no duplication with preserved infra)
    expect(args.filter((a) => a === "--instructions")).toHaveLength(1);
    expect(args.filter((a) => a === "--allow-external-modules")).toHaveLength(
      1,
    );
    expect(args.filter((a) => a === "--wasm-module")).toHaveLength(2);
  });

  test("omits empty scalar flags", () => {
    const cmd = buildCommandFromForm("/bin/mcp-v8", ["--sse-port=5001"], {
      instructions: "",
      runJsDescription: "",
      allowExternalModules: false,
      heapMemoryMaxMb: "",
      executionTimeoutSec: "",
      maxConcurrent: "",
      wasmModules: [],
      mcpServers: [],
    });
    expect(cmd).toBe("/bin/mcp-v8 --sse-port=5001");
  });

  test("emits scalar numeric flags when set", () => {
    const cmd = buildCommandFromForm("/bin/mcp-v8", [], {
      instructions: "",
      runJsDescription: "",
      allowExternalModules: false,
      heapMemoryMaxMb: "256",
      executionTimeoutSec: "120",
      maxConcurrent: "8",
      wasmModules: [],
      mcpServers: [],
    });
    const { args } = parseMcpV8Command(cmd);
    expect(args).toEqual([
      "--heap-memory-max",
      "256",
      "--execution-timeout",
      "120",
      "--max-concurrent-executions",
      "8",
    ]);
  });
});

describe("assembleMcpServerValue", () => {
  test("stdio with args (colon-joined)", () => {
    expect(
      assembleMcpServerValue({
        name: "x",
        transport: "stdio",
        command: "/bin/foo",
        args: "a b",
        url: "",
      }),
    ).toBe("x=stdio:/bin/foo:a:b");
  });

  test("sse with url", () => {
    expect(
      assembleMcpServerValue({
        name: "y",
        transport: "sse",
        command: "",
        args: "",
        url: "http://localhost:9000/sse",
      }),
    ).toBe("y=sse:http://localhost:9000/sse");
  });

  test("returns null when incomplete", () => {
    expect(
      assembleMcpServerValue({
        name: "",
        transport: "stdio",
        command: "/bin/foo",
        args: "",
        url: "",
      }),
    ).toBeNull();
    expect(
      assembleMcpServerValue({
        name: "z",
        transport: "sse",
        command: "",
        args: "",
        url: "",
      }),
    ).toBeNull();
  });
});
