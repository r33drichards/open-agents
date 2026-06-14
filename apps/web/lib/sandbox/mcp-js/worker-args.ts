import type {
  McpJsCapabilities,
  McpJsRuntimeConfig,
} from "@open-agents/sandbox";

/** Inputs for {@link buildMcpV8WorkerArgs}. */
export interface BuildWorkerArgsParams {
  /** Port the worker's HTTP API binds to. */
  httpPort: number;
  /**
   * Shared content-addressed store directory. Heaps and session metadata live
   * under it, so every worker pointed at the same directory shares storage.
   */
  storageDir: string;
  /** Declarative per-session runtime config. */
  runtimeConfig?: McpJsRuntimeConfig;
}

/**
 * Build mcp-v8 launch arguments from a session's declarative runtime config.
 *
 * Storage flags point every worker at the same content-addressed store, so
 * compute is isolated per process while state is shared. Capability policies are
 * emitted only for capabilities granted an OPA policy URL — mcp-v8 is
 * secure-by-default, so anything else stays denied.
 */
export function buildMcpV8WorkerArgs(params: BuildWorkerArgsParams): string[] {
  const args = [
    `--http-port=${params.httpPort}`,
    `--directory-path=${params.storageDir}/heaps`,
    `--session-db-path=${params.storageDir}/sessions`,
  ];

  const policiesJson = buildPoliciesJson(params.runtimeConfig?.capabilities);
  if (policiesJson) {
    args.push(`--policies-json=${policiesJson}`);
  }

  return args;
}

/** Capability names mcp-v8 accepts in its `--policies-json` map. */
const CAPABILITY_KEYS = ["fetch", "filesystem", "subprocess"] as const;

/**
 * Translate capability policies into mcp-v8's `--policies-json` value, or
 * `undefined` when no capability is granted an OPA policy URL.
 *
 * Only the OPA-URL form is emitted today; it matches the verified compose
 * example (`{"fetch":{"policies":[{"url":"http://opa:8181"}]}}`). Granting a
 * capability without an OPA URL is intentionally a no-op until the exact
 * unconditional-allow flag is wired.
 */
function buildPoliciesJson(
  capabilities?: McpJsCapabilities,
): string | undefined {
  if (!capabilities) {
    return undefined;
  }

  const policies: Record<string, { policies: { url: string }[] }> = {};
  for (const key of CAPABILITY_KEYS) {
    const policy = capabilities[key];
    if (!(policy?.enabled && policy.opaUrls?.length)) {
      continue;
    }
    policies[key] = { policies: policy.opaUrls.map((url) => ({ url })) };
  }

  return Object.keys(policies).length > 0
    ? JSON.stringify(policies)
    : undefined;
}
