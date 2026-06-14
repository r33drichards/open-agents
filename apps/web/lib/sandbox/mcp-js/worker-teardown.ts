import "server-only";

import type { SandboxState } from "@open-agents/sandbox";
import { getMcpJsWorkerProvider } from "./worker-provider";

/**
 * Tear down a session's mcp-js worker when its sandbox stops.
 *
 * No-op for non-mcp-js sandboxes. Durable state survives in the shared
 * content-addressed store under the session label, so a later resume simply
 * re-spawns a fresh worker. Failures are logged, not thrown — teardown is
 * best-effort cleanup on an already-stopping path.
 */
export async function stopMcpJsWorkerForSession(params: {
  sessionId: string;
  sandboxState: SandboxState | null | undefined;
}): Promise<void> {
  if (params.sandboxState?.type !== "mcp-js") {
    return;
  }
  try {
    await getMcpJsWorkerProvider().stopWorker(params.sessionId);
  } catch (error) {
    console.error(
      `Failed to stop mcp-js worker for session ${params.sessionId}:`,
      error,
    );
  }
}
