import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { buildMcpV8WorkerArgs } from "./worker-args";

mock.module("server-only", () => ({}));

// Real-binary integration test. Drives the actual mcp-v8 binary with the same
// flags the SubprocessWorkerProvider uses, proving the coordinator + learner
// topology works end to end. Skipped automatically when the binary is absent.
const BIN =
  process.env.MCP_JS_BIN ??
  join(process.env.HOME ?? "", "mcp-js/target/debug/server");
const HAVE_BIN = BIN.length > 0 && existsSync(BIN);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        reject(new Error("no port"));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

const children: ReturnType<typeof spawn>[] = [];
function launch(args: string[]) {
  const proc = spawn(BIN, args, { stdio: "ignore" });
  children.push(proc);
  return proc;
}

afterAll(() => {
  for (const c of children) {
    if (c.exitCode === null) {
      c.kill("SIGKILL");
    }
  }
});

describe.if(HAVE_BIN)("mcp-v8 learner cluster (real binary)", () => {
  test("a learner worker joins the coordinator and its death keeps the cluster writable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oa-learner-"));
    const host = "127.0.0.1";

    const mainHttp = await freePort();
    const mainCluster = await freePort();
    launch(
      buildMcpV8WorkerArgs({
        httpPort: mainHttp,
        clusterPort: mainCluster,
        nodeId: "main",
        storageDir: dir,
        advertiseHost: host,
      }),
    );

    // Coordinator becomes the leader (sole voter).
    const leaderUp = await waitFor(async () => {
      const s = await getJson(`http://${host}:${mainCluster}/raft/status`);
      return s?.role === "Leader";
    });
    expect(leaderUp).toBe(true);

    // Spawn a per-session worker that joins as a learner.
    const wHttp = await freePort();
    const wCluster = await freePort();
    const learnerAddr = `${host}:${wCluster}`;
    launch(
      buildMcpV8WorkerArgs({
        httpPort: wHttp,
        clusterPort: wCluster,
        nodeId: "sess1",
        storageDir: dir,
        advertiseHost: host,
        join: `${host}:${mainCluster}`,
        asLearner: true,
      }),
    );

    // The coordinator should record the worker as a non-voting learner.
    const learnerJoined = await waitFor(async () => {
      const s = await getJson(`http://${host}:${mainCluster}/raft/status`);
      const learners = (s?.learners as string[]) ?? [];
      return learners.includes(learnerAddr);
    });
    expect(learnerJoined).toBe(true);

    // The worker reports itself as a learner / follower, not a leader.
    const wStatus = await getJson(`http://${host}:${wCluster}/raft/status`);
    expect(wStatus?.is_learner).toBe(true);
    expect(wStatus?.role).toBe("Follower");

    // Coordinator is still the leader with the learner present.
    const before = await getJson(`http://${host}:${mainCluster}/raft/status`);
    expect(before?.role).toBe("Leader");

    // Kill the learner (an ephemeral worker dying) and remove it from the
    // cluster the way the provider does on exit.
    children[children.length - 1]?.kill("SIGKILL");
    await fetch(`http://${host}:${mainCluster}/raft/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ node_id: "sess1" }),
    }).catch(() => {});

    // The coordinator (sole voter) remains the leader — quorum is intact.
    const stillLeader = await waitFor(async () => {
      const s = await getJson(`http://${host}:${mainCluster}/raft/status`);
      const learners = (s?.learners as string[]) ?? [];
      return s?.role === "Leader" && !learners.includes(learnerAddr);
    });
    expect(stillLeader).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  test("SubprocessWorkerProvider spawns a live, reachable worker via the real binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oa-provider-"));
    const { SubprocessWorkerProvider } =
      await import("./subprocess-worker-provider");
    const provider = new SubprocessWorkerProvider({
      binaryPath: BIN,
      storageDir: dir,
      // Own coordinator ports so the test never adopts a dev-server coordinator.
      coordinatorHttpPort: await freePort(),
      coordinatorClusterPort: await freePort(),
    });

    const worker = await provider.ensureWorker({ sessionId: "session-xyz" });
    expect(worker.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // The worker's MCP HTTP API is actually serving.
    const version = await getJson(`${worker.baseUrl}/api/version`);
    expect(version?.version).toBeDefined();

    // Idempotent: same session returns the same worker.
    const again = await provider.ensureWorker({ sessionId: "session-xyz" });
    expect(again.baseUrl).toBe(worker.baseUrl);

    await provider.stopWorker("session-xyz");
    // Tear down the coordinator too so no child process leaks.
    provider.dispose();
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
