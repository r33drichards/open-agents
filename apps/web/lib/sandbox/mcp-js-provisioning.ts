import "server-only";

import {
  connectSandbox,
  DEFAULT_MCP_JS_WORKING_DIRECTORY,
  type SandboxState,
} from "@open-agents/sandbox";
import {
  updateSessionIfNotArchived,
  type SessionRecord,
} from "@/lib/db/sessions";
import { MCP_JS_BASE_URL } from "@/lib/sandbox/config";
import { getNextLifecycleVersion } from "@/lib/sandbox/lifecycle";
import type { ProvisionSessionSandboxResult } from "@/lib/sandbox/provisioning";

/** The mcp-js member of the {@link SandboxState} union. */
type McpJsSandboxState = Extract<SandboxState, { type: "mcp-js" }>;

/**
 * Build the persisted state for an mcp-js sandbox.
 *
 * The only durable state is the server URL plus a stable `session` label. The
 * server restores that session's most-recent heap on each run and snapshots the
 * result automatically, so JS globals accumulate across executions without the
 * client ever tracking the (content-addressed) heap key. The session row id is
 * a natural stable label and is reused on resume.
 */
export function buildMcpJsSandboxState(
  session: SessionRecord,
): McpJsSandboxState {
  if (!MCP_JS_BASE_URL) {
    throw new Error(
      "MCP_JS_BASE_URL must be set to provision an mcp-js sandbox.",
    );
  }

  return {
    type: "mcp-js",
    baseUrl: MCP_JS_BASE_URL,
    session: session.id,
    workingDirectory: DEFAULT_MCP_JS_WORKING_DIRECTORY,
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
  const sandboxState = buildMcpJsSandboxState(session);
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
