import "server-only";

import { createMcpV8Client } from "@open-agents/sandbox";

/** Reject query results larger than this once serialized (keeps state lean). */
const MAX_RESULT_BYTES = 256 * 1024;
/** Cap a single dashboard query's runtime so it can't tie up the worker. */
const QUERY_TIMEOUT_SECS = 15;
/** Marks the JSON result line in run_js stdout (its `result` field is unused). */
const RESULT_SENTINEL = "__DASHBOARD_QUERY_RESULT__";

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

  // run_js does NOT capture a snippet's return/expression value — its `result`
  // field is always empty; values come back via stdout (`output`). The agent
  // authors query `code` as a function body that `return`s its data, so run it
  // in an awaited async IIFE (top-level await makes the worker wait for async
  // work like fs.readFile/fetch to finish) and log the JSON result on a marked
  // line, which we parse out of `output`.
  const wrapped = `const __dq = await (async () => {\n${params.code}\n})();\nconsole.log(${JSON.stringify(
    RESULT_SENTINEL,
  )} + JSON.stringify(__dq === undefined ? null : __dq));`;

  let result: Awaited<ReturnType<typeof client.runJs>>;
  try {
    result = await client.runJs(wrapped, {
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

  const output = result.output ?? "";
  const markerIndex = output.lastIndexOf(RESULT_SENTINEL);
  if (markerIndex < 0) {
    // Ran but logged no result line (e.g. returned undefined).
    return { ok: true, data: null };
  }
  let json = output.slice(markerIndex + RESULT_SENTINEL.length);
  const newlineIndex = json.indexOf("\n");
  if (newlineIndex >= 0) {
    json = json.slice(0, newlineIndex);
  }
  json = json.trim();
  if (!json) {
    return { ok: true, data: null };
  }
  if (json.length > MAX_RESULT_BYTES) {
    return {
      ok: false,
      error: `Query result too large (${json.length} bytes; max ${MAX_RESULT_BYTES}). Return less data or paginate.`,
    };
  }

  try {
    return { ok: true, data: JSON.parse(json) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: `Query result was not JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
