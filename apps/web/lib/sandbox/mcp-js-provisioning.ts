import "server-only";

import { randomUUID } from "node:crypto";
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
 * The only durable state is the server URL plus a heap id that carries JS
 * globals forward between executions. An existing heap id is reused so a
 * resumed session keeps its accumulated state; otherwise a fresh one is minted.
 */
export function buildMcpJsSandboxState(
  session: SessionRecord,
): McpJsSandboxState {
  if (!MCP_JS_BASE_URL) {
    throw new Error(
      "MCP_JS_BASE_URL must be set to provision an mcp-js sandbox.",
    );
  }

  const existing = session.sandboxState;
  const heap =
    existing?.type === "mcp-js" && existing.heap
      ? existing.heap
      : `session-${session.id}-${randomUUID()}`;

  return {
    type: "mcp-js",
    baseUrl: MCP_JS_BASE_URL,
    heap,
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
