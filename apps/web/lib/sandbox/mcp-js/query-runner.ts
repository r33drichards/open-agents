import "server-only";

import { createMcpV8Client } from "@open-agents/sandbox";

/** Reject query results larger than this once serialized (keeps state lean). */
const MAX_RESULT_BYTES = 256 * 1024;
/** Cap a single dashboard query's runtime so it can't tie up the worker. */
const QUERY_TIMEOUT_SECS = 15;

export type DashboardQueryResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; output?: string };

/**
 * Run a dashboard data-source query (agent-authored JS) in a session's mcp-js
 * sandbox and return its parsed JSON result. Mirrors {@link readLatestSnapshots}
 * in ./fork.ts: it reuses the session label so the worker restores the same
 * persistent V8 heap + `/work` filesystem the agent built during chat.
 */
export async function runDashboardQuery(params: {
  baseUrl: string;
  session?: string;
  code: string;
}): Promise<DashboardQueryResult> {
  const client = createMcpV8Client(params.baseUrl);

  let result: Awaited<ReturnType<typeof client.runJs>>;
  try {
    result = await client.runJs(params.code, {
      session: params.session,
      executionTimeoutSecs: QUERY_TIMEOUT_SECS,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (result.status !== "completed") {
    return {
      ok: false,
      error: result.error ?? `Query ${result.status}`,
      output: result.output ? result.output.slice(0, 2000) : undefined,
    };
  }

  if (result.result === undefined) {
    // The snippet ran but returned nothing to bind.
    return { ok: true, data: null };
  }

  if (result.result.length > MAX_RESULT_BYTES) {
    return {
      ok: false,
      error: `Query result too large (${result.result.length} bytes; max ${MAX_RESULT_BYTES}). Return less data or paginate.`,
    };
  }

  try {
    return { ok: true, data: JSON.parse(result.result) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: `Query result was not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
