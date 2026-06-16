import "server-only";

import { createMcpV8Client } from "@open-agents/sandbox";

/** A source session's latest content-addressed snapshots. */
export type McpJsSnapshotIds = {
  /** Latest V8 heap CA id, if the session has any heap state. */
  heap?: string;
  /** Latest filesystem CA id, if the session has any fs state. */
  fs?: string;
};

// A no-op program: restores the session's heap/fs, changes nothing, and lets
// the server report the resulting (== current) snapshot ids.
const NOOP_CODE = "void 0;";

/**
 * Read a session's latest heap + filesystem snapshot ids from its mcp-v8
 * worker. Runs a no-op `run_js` under the session label so the server restores
 * and re-reports the session's current snapshots. The worker must be running.
 */
export async function readLatestSnapshots(
  baseUrl: string,
  session: string,
): Promise<McpJsSnapshotIds> {
  const client = createMcpV8Client(baseUrl);
  const result = await client.runJs(NOOP_CODE, { session });
  if (result.status !== "completed") {
    throw new Error(
      `Failed to read snapshots for session ${session}: ${result.error ?? result.status}`,
    );
  }
  return { heap: result.heap, fs: result.fs };
}

/**
 * Seed a forked session's worker from a source session's snapshots. Runs a
 * no-op `run_js` under the new session label with explicit `heap`/`fs` handles,
 * which mounts the source state and records it as the new session's latest
 * snapshot. Subsequent session-based runs then carry the fork forward.
 *
 * Idempotent in effect: re-seeding with the same source ids just re-records the
 * same head, but callers should clear the fork marker after the first seed so a
 * later restore never resets the session back to the fork point.
 */
export async function seedForkedSession(
  baseUrl: string,
  session: string,
  source: McpJsSnapshotIds,
): Promise<void> {
  if (!(source.heap || source.fs)) {
    return;
  }
  const client = createMcpV8Client(baseUrl);
  const result = await client.runJs(NOOP_CODE, {
    session,
    heap: source.heap,
    fs: source.fs,
  });
  if (result.status !== "completed") {
    throw new Error(
      `Failed to seed forked session ${session}: ${result.error ?? result.status}`,
    );
  }
}
