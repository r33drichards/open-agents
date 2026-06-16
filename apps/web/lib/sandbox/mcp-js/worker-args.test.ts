import { describe, expect, test } from "bun:test";
import { buildMcpV8WorkerArgs } from "./worker-args";

describe("buildMcpV8WorkerArgs", () => {
  test("emits a coordinator (voter) node's cluster flags", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 4321,
      clusterPort: 4322,
      nodeId: "main",
      storageDir: "/srv/mcp-js",
      advertiseHost: "127.0.0.1",
    });

    expect(args).toEqual([
      "--http-port=4321",
      "--directory-path=/srv/mcp-js/heaps",
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
      "--directory-path=/srv/mcp-js/heaps",
      "--session-db-path=/srv/mcp-js/sessions/sess-abc",
      "--cluster-port=5002",
      "--node-id=sess-abc",
      "--advertise-addr=127.0.0.1:5002",
      "--join=127.0.0.1:4322",
      "--join-as-learner",
    ]);
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
});
