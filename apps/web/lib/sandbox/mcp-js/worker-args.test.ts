import { describe, expect, test } from "bun:test";
import { buildMcpV8WorkerArgs } from "./worker-args";

describe("buildMcpV8WorkerArgs", () => {
  test("emits a coordinator (voter) node's cluster flags (heap+fs off by default)", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 4321,
      clusterPort: 4322,
      nodeId: "main",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
    });

    expect(args).toEqual([
      "--http-port=4321",
      "--session-db-path=/srv/mcp-js/sessions/main",
      "--cluster-port=4322",
      "--node-id=main",
      "--advertise-addr=127.0.0.1:4322",
    ]);
  });

  test("a per-session worker joins as a learner over SSE with a per-node session db", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 5001,
      clusterPort: 5002,
      nodeId: "sess-abc",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
      join: "127.0.0.1:4322",
      asLearner: true,
      transport: "sse",
    });

    expect(args).toEqual([
      "--sse-port=5001",
      "--session-db-path=/srv/mcp-js/sessions/sess-abc",
      "--cluster-port=5002",
      "--node-id=sess-abc",
      "--advertise-addr=127.0.0.1:5002",
      "--join=127.0.0.1:4322",
      "--join-as-learner",
    ]);
  });

  test("heap-on without S3 uses a node-local heap dir", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 4321,
      clusterPort: 4322,
      nodeId: "main",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
      heapSnapshots: true,
    });

    expect(args).toContain("--heap-store=dir");
    expect(args).toContain("--heap-dir=/srv/mcp-js/heaps");
    expect(args.some((a) => a.startsWith("--fs-store"))).toBe(false);
  });

  test("fs-on with S3 emits --fs-store s3 + shared bucket + per-node cache", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 5001,
      clusterPort: 5002,
      nodeId: "sess-abc",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
      fsSnapshots: { enabled: true, s3Bucket: "mcpjs-fs" },
    });

    expect(args).toContain("--fs-store=s3");
    expect(args).toContain("--s3-bucket=mcpjs-fs");
    expect(args).toContain("--cache-dir=/srv/mcp-js/s3-cache/sess-abc");
    // heap stays off by default → no heap flags.
    expect(args.some((a) => a.startsWith("--heap-store"))).toBe(false);
  });

  test("translates OPA-backed capabilities into --policies-json", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 3000,
      clusterPort: 3001,
      nodeId: "n1",
      storageDir: "/data",
      advertiseHost: "127.0.0.1",
      runtimeConfig: {
        capabilities: {
          fetch: { enabled: true, opaUrls: ["http://opa:8181"] },
          filesystem: { enabled: true, opaUrls: ["http://opa:8181"] },
        },
      },
    });

    const policiesArg = args.find((arg) => arg.startsWith("--policies-json="));
    expect(policiesArg).toBeDefined();
    const json = JSON.parse(policiesArg?.split("=").slice(1).join("=") ?? "{}");
    expect(json).toEqual({
      fetch: { policies: [{ url: "http://opa:8181" }] },
      filesystem: { policies: [{ url: "http://opa:8181" }] },
    });
  });

  test("omits policies when a capability is enabled without an OPA url", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 3000,
      clusterPort: 3001,
      nodeId: "n1",
      storageDir: "/data",
      advertiseHost: "127.0.0.1",
      runtimeConfig: { capabilities: { fetch: { enabled: true } } },
    });

    expect(args.some((arg) => arg.startsWith("--policies-json="))).toBe(false);
  });

  test("language bundle adds wasm modules + default fetch/fs policies", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 5001,
      clusterPort: 5002,
      nodeId: "sess-abc",
      storageDir: "/data",
      advertiseHost: "127.0.0.1",
      transport: "sse",
      languageBundle: { dir: "/opt/languages" },
    });

    expect(args).toContain("--allow-external-modules");
    expect(args).toContain("--wasm-module");
    expect(args).toContain("lua=/opt/languages/lua.wasm:512m");
    expect(args).toContain("craftos=/opt/languages/craftos.wasm:512m");

    const policiesArg = args.find((arg) => arg.startsWith("--policies-json="));
    const json = JSON.parse(policiesArg?.split("=").slice(1).join("=") ?? "{}");
    expect(json).toEqual({
      fetch: { policies: [{ url: "file:///opt/languages/fetch.rego" }] },
      filesystem: {
        policies: [{ url: "file:///opt/languages/filesystem.rego" }],
      },
    });
  });

  test("an OPA-backed capability overrides the bundle's default policy", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 5001,
      clusterPort: 5002,
      nodeId: "sess-abc",
      storageDir: "/data",
      advertiseHost: "127.0.0.1",
      languageBundle: { dir: "/opt/languages" },
      runtimeConfig: {
        capabilities: {
          fetch: { enabled: true, opaUrls: ["http://opa:8181"] },
        },
      },
    });

    const policiesArg = args.find((arg) => arg.startsWith("--policies-json="));
    const json = JSON.parse(policiesArg?.split("=").slice(1).join("=") ?? "{}");
    expect(json.fetch).toEqual({ policies: [{ url: "http://opa:8181" }] });
    expect(json.filesystem).toEqual({
      policies: [{ url: "file:///opt/languages/filesystem.rego" }],
    });
  });
});
