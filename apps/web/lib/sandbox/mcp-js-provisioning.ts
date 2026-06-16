import "server-only";

import {
  connectSandbox,
  DEFAULT_MCP_JS_WORKING_DIRECTORY,
  type McpJsRuntimeConfig,
  type SandboxState,
} from "@open-agents/sandbox";
import {
  updateSessionIfNotArchived,
  type SessionRecord,
} from "@/lib/db/sessions";
import { seedForkedSession } from "@/lib/sandbox/mcp-js/fork";
import { getNextLifecycleVersion } from "@/lib/sandbox/lifecycle";
import { getMcpJsWorkerProvider } from "@/lib/sandbox/mcp-js/worker-provider";
import type { ProvisionSessionSandboxResult } from "@/lib/sandbox/provisioning";

/** The mcp-js member of the {@link SandboxState} union. */
type McpJsSandboxState = Extract<SandboxState, { type: "mcp-js" }>;

/**
 * Resolve the runtime config for a session, carrying forward whatever was
 * persisted on a prior provision so resume re-applies identical settings.
 */
function getSessionRuntimeConfig(session: SessionRecord): McpJsRuntimeConfig {
  const state = session.sandboxState;
  if (state?.type === "mcp-js" && state.runtimeConfig) {
    return state.runtimeConfig;
  }
  return {};
}

/**
 * Build the persisted state for an mcp-js sandbox.
 *
 * Ensures a per-session worker exists (its `baseUrl` is what the client talks
 * to) and persists the stable `session` label plus the declarative runtime
 * config. The worker restores that session's most-recent heap on each run and
 * snapshots the result automatically, so JS globals accumulate across
 * executions without the client tracking the content-addressed heap key.
 */
export async function buildMcpJsSandboxState(
  session: SessionRecord,
): Promise<McpJsSandboxState> {
  const runtimeConfig = getSessionRuntimeConfig(session);
  const worker = await getMcpJsWorkerProvider().ensureWorker({
    sessionId: session.id,
    runtimeConfig,
  });

  // Forked session: seed this worker from the source session's snapshots once,
  // before it serves the agent, then drop the marker so later restores don't
  // reset the session back to the fork point.
  const existing = session.sandboxState;
  const forkSource =
    existing?.type === "mcp-js" ? existing.forkSource : undefined;
  if (forkSource) {
    await seedForkedSession(worker.baseUrl, session.id, forkSource);
  }

  return {
    type: "mcp-js",
    baseUrl: worker.baseUrl,
    session: session.id,
    workingDirectory:
      runtimeConfig.workingDirectory ?? DEFAULT_MCP_JS_WORKING_DIRECTORY,
    runtimeConfig,
  };
}

/**
 * Provision a session against the mcp-js runtime.
 *
 * Unlike the Vercel flow there is no VM to create, no repo to clone, and no
 * snapshot lifecycle — we simply persist the heap-backed state and connect.
 */
export async function provisionMcpJsSandbox(
  session: SessionRecord,
): Promise<ProvisionSessionSandboxResult> {
  const didSetupWorkspace = session.sandboxState?.type !== "mcp-js";
  const sandboxState = await buildMcpJsSandboxState(session);
  const sandbox = await connectSandbox(sandboxState);

  const updatedSession = await updateSessionIfNotArchived(session.id, {
    sandboxState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleVersion: getNextLifecycleVersion(session.lifecycleVersion),
    lifecycleError: null,
  });

  return {
    sandboxState,
    workingDirectory: sandbox.workingDirectory,
    environmentDetails: sandbox.environmentDetails,
    didSetupWorkspace,
    session: updatedSession ?? session,
  };
}
