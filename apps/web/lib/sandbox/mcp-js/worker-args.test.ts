import { describe, expect, test } from "bun:test";
import { buildMcpV8WorkerArgs } from "./worker-args";

describe("buildMcpV8WorkerArgs", () => {
  test("emits port and shared-store flags", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 4321,
      storageDir: "/srv/mcp-js",
    });

    expect(args).toEqual([
      "--http-port=4321",
      "--directory-path=/srv/mcp-js/heaps",
      "--session-db-path=/srv/mcp-js/sessions",
    ]);
  });

  test("translates OPA-backed capabilities into --policies-json", () => {
    const args = buildMcpV8WorkerArgs({
      httpPort: 3000,
      storageDir: "/data",
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
      storageDir: "/data",
      runtimeConfig: { capabilities: { fetch: { enabled: true } } },
    });

    expect(args.some((arg) => arg.startsWith("--policies-json="))).toBe(false);
  });
});
