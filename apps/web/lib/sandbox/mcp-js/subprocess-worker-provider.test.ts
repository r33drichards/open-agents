import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const modulePromise = import("./subprocess-worker-provider");

/** A controllable stand-in for a spawned mcp-v8 process. */
function makeFakeProc() {
  let exitListener: (() => void) | undefined;
  return {
    exitCode: null as number | null,
    killed: false,
    kill(_signal?: NodeJS.Signals): boolean {
      this.killed = true;
      this.exitCode = 0;
      exitListener?.();
      return true;
    },
    once(_event: "exit", listener: () => void) {
      exitListener = listener;
      return this;
    },
    forceExit(code: number) {
      this.exitCode = code;
      exitListener?.();
    },
  };
}

const okFetch = () => Promise.resolve({ ok: true });

const COORD_HTTP = 4000;
const COORD_CLUSTER = 4001;

async function makeProvider(overrides: {
  spawn: (command: string, args: string[]) => ReturnType<typeof makeFakeProc>;
  leaderReady: (clusterPort: number) => Promise<boolean>;
  leavePeer?: (clusterPort: number, nodeId: string) => Promise<void>;
}) {
  const { SubprocessWorkerProvider } = await modulePromise;
  let nextPort = 5001;
  return new SubprocessWorkerProvider({
    binaryPath: "mcp-v8",
    storageDir: "/tmp/mcp-js-test",
    coordinatorHttpPort: COORD_HTTP,
    coordinatorClusterPort: COORD_CLUSTER,
    readinessPollMs: 1,
    readinessTimeoutMs: 200,
    spawn: overrides.spawn,
    fetchImpl: okFetch,
    leaderReady: overrides.leaderReady,
    leavePeer: overrides.leavePeer ?? (() => Promise.resolve()),
    allocatePort: () => Promise.resolve(nextPort++),
    ensureStorageDir: () => Promise.resolve(),
    removeDir: () => Promise.resolve(),
  });
}

describe("SubprocessWorkerProvider", () => {
  let spawnCalls: { command: string; args: string[] }[];
  let procs: ReturnType<typeof makeFakeProc>[];
  // Models reality: no coordinator is reachable until one has been spawned,
  // after which the leader probe succeeds.
  let coordinatorSpawned: boolean;
  const spawn = (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    if (args.includes("--node-id=main")) {
      coordinatorSpawned = true;
    }
    const proc = makeFakeProc();
    procs.push(proc);
    return proc;
  };
  const leaderReady = () => Promise.resolve(coordinatorSpawned);

  beforeEach(() => {
    spawnCalls = [];
    procs = [];
    coordinatorSpawned = false;
  });

  test("starts a coordinator on fixed ports, then a learner worker joined to it", async () => {
    const provider = await makeProvider({ spawn, leaderReady });
    const worker = await provider.ensureWorker({ sessionId: "s1" });

    expect(spawnCalls).toHaveLength(2);
    const main = spawnCalls[0]?.args ?? [];
    expect(main).toContain("--node-id=main");
    expect(main).toContain(`--cluster-port=${COORD_CLUSTER}`);
    expect(main).toContain(`--http-port=${COORD_HTTP}`);
    expect(main.some((a) => a.startsWith("--join="))).toBe(false);

    const w = spawnCalls[1]?.args ?? [];
    expect(worker.baseUrl).toBe("http://127.0.0.1:5001");
    expect(w).toContain("--node-id=s1");
    expect(w).toContain(`--join=127.0.0.1:${COORD_CLUSTER}`);
    expect(w).toContain("--join-as-learner");
    expect(w).toContain("--session-db-path=/tmp/mcp-js-test/sessions/s1");
  });

  test("adopts an already-running coordinator instead of spawning one", async () => {
    // A coordinator is already up (e.g. started by another module instance).
    coordinatorSpawned = true;
    const provider = await makeProvider({ spawn, leaderReady });
    await provider.ensureWorker({ sessionId: "s1" });

    // Only the worker is spawned; the coordinator is adopted.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.args).toContain("--node-id=s1");
    expect(spawnCalls[0]?.args).toContain(`--join=127.0.0.1:${COORD_CLUSTER}`);
  });

  test("reuses the coordinator across sessions", async () => {
    const provider = await makeProvider({ spawn, leaderReady });
    await provider.ensureWorker({ sessionId: "s1" });
    await provider.ensureWorker({ sessionId: "s2" });

    expect(spawnCalls).toHaveLength(3); // 1 coordinator + 2 workers
    expect(
      spawnCalls.filter((c) => c.args.includes("--node-id=main")),
    ).toHaveLength(1);
  });

  test("is idempotent for the same session", async () => {
    const provider = await makeProvider({ spawn, leaderReady });
    const first = await provider.ensureWorker({ sessionId: "s1" });
    const second = await provider.ensureWorker({ sessionId: "s1" });

    expect(second.baseUrl).toBe(first.baseUrl);
    expect(spawnCalls).toHaveLength(2); // coordinator + one worker
  });

  test("stopWorker removes the learner from the cluster and kills it", async () => {
    const leaveCalls: { clusterPort: number; nodeId: string }[] = [];
    const provider = await makeProvider({
      spawn,
      leaderReady,
      leavePeer: (clusterPort, nodeId) => {
        leaveCalls.push({ clusterPort, nodeId });
        return Promise.resolve();
      },
    });
    await provider.ensureWorker({ sessionId: "s1" });
    await provider.stopWorker("s1");

    expect(procs[1]?.killed).toBe(true); // worker
    expect(procs[0]?.killed).toBe(false); // coordinator
    expect(leaveCalls).toEqual([{ clusterPort: COORD_CLUSTER, nodeId: "s1" }]);

    await provider.ensureWorker({ sessionId: "s1" });
    expect(spawnCalls).toHaveLength(3); // coordinator reused
  });

  test("throws and cleans up when a worker exits before readiness", async () => {
    const flakyWorkerSpawn = (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const isCoordinator = args.includes("--node-id=main");
      if (isCoordinator) {
        coordinatorSpawned = true;
      }
      const proc = makeFakeProc();
      if (!isCoordinator) {
        proc.exitCode = 1; // worker exits immediately
      }
      procs.push(proc);
      return proc;
    };
    const provider = await makeProvider({
      spawn: flakyWorkerSpawn,
      leaderReady,
    });

    await expect(provider.ensureWorker({ sessionId: "s1" })).rejects.toThrow(
      /exited before becoming ready/,
    );
  });
});
