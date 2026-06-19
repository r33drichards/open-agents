import {
  getMcpJsFsSnapshotConfig,
  MCP_JS_BIN,
  MCP_JS_BUNDLED_LANGUAGES,
  MCP_JS_CLUSTER_HOST,
  MCP_JS_COORDINATOR_CLUSTER_PORT,
  MCP_JS_HEAP_SNAPSHOTS_ENABLED,
  MCP_JS_LANGUAGES_DIR,
  MCP_JS_STORAGE_DIR,
} from "@/lib/sandbox/config";
import { buildMcpV8WorkerArgs } from "@/lib/sandbox/mcp-js/worker-args";
import { formatMcpV8Command } from "@/lib/sandbox/mcp-js/worker-command";
import { getServerSession } from "@/lib/session/get-server-session";

/**
 * Representative per-session worker ports / node id. The real worker is given
 * ephemeral ports and a session-derived node id at launch; this template shows
 * the *shape* of the command so it can be reviewed (and optionally edited)
 * before the session is created.
 */
const SAMPLE_HTTP_PORT = 5001;
const SAMPLE_CLUSTER_PORT = 5002;
const SAMPLE_NODE_ID = "session";

/**
 * Returns the mcp-v8 launch command a new session's worker would run, built
 * from the same config and argument builder the subprocess provider uses. The
 * UI shows this in an editor; an edited command becomes the session's
 * `runtimeConfig.commandOverride`.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const args = buildMcpV8WorkerArgs({
    httpPort: SAMPLE_HTTP_PORT,
    clusterPort: SAMPLE_CLUSTER_PORT,
    nodeId: SAMPLE_NODE_ID,
    storageDir: MCP_JS_STORAGE_DIR,
    advertiseHost: MCP_JS_CLUSTER_HOST,
    join: `${MCP_JS_CLUSTER_HOST}:${MCP_JS_COORDINATOR_CLUSTER_PORT}`,
    asLearner: true,
    // The agent's MCP client connects over SSE (`<baseUrl>/sse`).
    transport: "sse",
    fsSnapshots: getMcpJsFsSnapshotConfig(),
    heapSnapshots: MCP_JS_HEAP_SNAPSHOTS_ENABLED,
    languageBundle: MCP_JS_BUNDLED_LANGUAGES
      ? { dir: MCP_JS_LANGUAGES_DIR }
      : undefined,
  });

  return Response.json({ command: formatMcpV8Command(MCP_JS_BIN, args) });
}
