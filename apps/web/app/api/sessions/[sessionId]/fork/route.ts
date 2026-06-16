import { nanoid } from "nanoid";
import {
  DEFAULT_MCP_JS_WORKING_DIRECTORY,
  type McpJsRuntimeConfig,
  type SandboxState,
} from "@open-agents/sandbox";
import { checkBotProtection } from "@/lib/botid";
import { forkSessionWithChat, getSessionById } from "@/lib/db/sessions";
import { readLatestSnapshots } from "@/lib/sandbox/mcp-js/fork";
import { kickSandboxProvisioningWorkflow } from "@/lib/sandbox/provisioning-kick";
import { getServerSession } from "@/lib/session/get-server-session";

type ForkRequest = {
  /** Copy the source's most-recent chat history into the fork (default false). */
  copyMessages?: boolean;
};

/**
 * Fork a session: create a new session seeded from this session's mcp-js V8
 * heap and content-addressed filesystem. Only mcp-js sessions can be forked
 * (they have a content-addressed heap + fs to duplicate).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await getServerSession();
  if (!auth?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotProtection();
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  const { sessionId } = await params;
  const source = await getSessionById(sessionId);
  if (!source) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (source.userId !== auth.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const sourceState = source.sandboxState;
  if (sourceState?.type !== "mcp-js") {
    return Response.json(
      { error: "Only mcp-js sessions can be forked" },
      { status: 400 },
    );
  }

  let body: ForkRequest = {};
  try {
    const raw: unknown = await req.json();
    if (raw && typeof raw === "object") {
      body = raw as ForkRequest;
    }
  } catch {
    // Empty/invalid body is fine — defaults apply.
  }

  const runtimeConfig: McpJsRuntimeConfig = sourceState.runtimeConfig ?? {};

  // Read the source's latest heap + fs snapshots directly from its running
  // worker (the persisted baseUrl). We deliberately do NOT call ensureWorker
  // here: the worker is owned by the provisioning context and holds the sled
  // lock for the session db, so spawning a second one for the same session
  // would fail. If the source's worker isn't reachable, ask the caller to open
  // the source session first (which provisions/wakes its sandbox).
  if (!sourceState.baseUrl) {
    return Response.json(
      { error: "Source session has no active sandbox to fork from." },
      { status: 409 },
    );
  }
  let forkSource: { heap?: string; fs?: string };
  try {
    forkSource = await readLatestSnapshots(sourceState.baseUrl, source.id);
  } catch (error) {
    // Best-effort: nudge the source's sandbox awake so a retry can succeed.
    await kickSandboxProvisioningWorkflow(source.id);
    return Response.json(
      {
        error: `Source session sandbox is not ready. Open it once, then try forking again. (${
          error instanceof Error ? error.message : String(error)
        })`,
      },
      { status: 409 },
    );
  }

  const newSessionId = nanoid();
  const newChatId = nanoid();

  // Initial sandbox state carries the fork seed; provisioning spawns this
  // session's own worker, mounts the seed once, and clears the marker (see
  // buildMcpJsSandboxState). baseUrl MUST be empty here: isSandboxActive treats
  // any mcp-js state with a baseUrl as already-provisioned, which would skip
  // provisioning and leave the fork pointing at the source's worker.
  const sandboxState: SandboxState = {
    type: "mcp-js",
    baseUrl: "",
    session: newSessionId,
    workingDirectory:
      sourceState.workingDirectory ?? DEFAULT_MCP_JS_WORKING_DIRECTORY,
    runtimeConfig,
    forkSource,
  };

  const result = await forkSessionWithChat({
    source,
    newSessionId,
    newChatId,
    title: `${source.title} (fork)`,
    sandboxState,
    copyMessages: body.copyMessages === true,
  });

  await kickSandboxProvisioningWorkflow(result.session.id);

  return Response.json(result, { status: 201 });
}
