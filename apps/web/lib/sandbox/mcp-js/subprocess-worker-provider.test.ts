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

async function makeProvider(overrides: {
  spawn: (command: string, args: string[]) => ReturnType<typeof makeFakeProc>;
  fetchImpl?: (url: string) => Promise<{ ok: boolean }>;
  leavePeer?: (clusterPort: number, nodeId: string) => Promise<void>;
}) {
  const { SubprocessWorkerProvider } = await modulePromise;
  let nextPort = 5001;
  return new SubprocessWorkerProvider({
    binaryPath: "mcp-v8",
    storageDir: "/tmp/mcp-js-test",
    readinessPollMs: 1,
    readinessTimeoutMs: 200,
    spawn: overrides.spawn,
    fetchImpl: overrides.fetchImpl ?? okFetch,
    // The coordinator is "leader" immediately in unit tests.
    leaderReady: () => Promise.resolve(true),
    leavePeer: overrides.leavePeer ?? (() => Promise.resolve()),
    allocatePort: () => Promise.resolve(nextPort++),
    ensureStorageDir: () => Promise.resolve(),
  });
}

describe("SubprocessWorkerProvider", () => {
  let spawnCalls: { command: string; args: string[] }[];
  let procs: ReturnType<typeof makeFakeProc>[];
  const spawn = (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const proc = makeFakeProc();
    procs.push(proc);
    return proc;
  };

  beforeEach(() => {
    spawnCalls = [];
    procs = [];
  });

  test("starts a coordinator, then a learner worker joined to it", async () => {
    const provider = await makeProvider({ spawn });
    const worker = await provider.ensureWorker({ sessionId: "s1" });

    // First spawn is the coordinator (voter, no --join); second is the worker.
    expect(spawnCalls).toHaveLength(2);
    const main = spawnCalls[0]?.args ?? [];
    expect(main).toContain("--node-id=main");
    expect(main).toContain("--cluster-port=5002");
    expect(main.some((a) => a.startsWith("--join="))).toBe(false);
    expect(main).not.toContain("--join-as-learner");

    const w = spawnCalls[1]?.args ?? [];
    expect(worker.baseUrl).toBe("http://127.0.0.1:5003");
    expect(w).toContain("--node-id=s1");
    expect(w).toContain("--join=127.0.0.1:5002");
    expect(w).toContain("--join-as-learner");
    expect(w).toContain("--session-db-path=/tmp/mcp-js-test/sessions/s1");
  });

  test("reuses the coordinator across sessions", async () => {
    const provider = await makeProvider({ spawn });
    await provider.ensureWorker({ sessionId: "s1" });
    await provider.ensureWorker({ sessionId: "s2" });

    // coordinator + 2 workers, not 2 coordinators.
    expect(spawnCalls).toHaveLength(3);
    expect(
      spawnCalls.filter((c) => c.args.includes("--node-id=main")),
    ).toHaveLength(1);
  });

  test("is idempotent for the same session", async () => {
    const provider = await makeProvider({ spawn });
    const first = await provider.ensureWorker({ sessionId: "s1" });
    const second = await provider.ensureWorker({ sessionId: "s1" });

    expect(second.baseUrl).toBe(first.baseUrl);
    expect(spawnCalls).toHaveLength(2); // coordinator + one worker
  });

  test("stopWorker removes the learner from the cluster and kills it", async () => {
    const leaveCalls: { clusterPort: number; nodeId: string }[] = [];
    const provider = await makeProvider({
      spawn,
      leavePeer: (clusterPort, nodeId) => {
        leaveCalls.push({ clusterPort, nodeId });
        return Promise.resolve();
      },
    });
    await provider.ensureWorker({ sessionId: "s1" });
    await provider.stopWorker("s1");

    // The worker process (2nd spawn) is killed; the coordinator is not.
    expect(procs[1]?.killed).toBe(true);
    expect(procs[0]?.killed).toBe(false);
    expect(leaveCalls).toEqual([{ clusterPort: 5002, nodeId: "s1" }]);

    // A later session reuses the coordinator (no new coordinator spawned).
    await provider.ensureWorker({ sessionId: "s1" });
    expect(spawnCalls).toHaveLength(3);
  });

  test("throws and cleans up when a worker exits before readiness", async () => {
    let call = 0;
    const flakyWorkerSpawn = (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const proc = makeFakeProc();
      // 1st spawn (coordinator) stays healthy; 2nd (worker) exits immediately.
      if (call > 0) {
        proc.exitCode = 1;
      }
      call += 1;
      procs.push(proc);
      return proc;
    };
    const provider = await makeProvider({ spawn: flakyWorkerSpawn });

    await expect(provider.ensureWorker({ sessionId: "s1" })).rejects.toThrow(
      /exited before becoming ready/,
    );
  });
});
