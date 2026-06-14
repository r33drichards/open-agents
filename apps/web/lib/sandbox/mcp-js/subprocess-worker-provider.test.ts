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

  test("spawns a worker and returns its base url once ready", async () => {
    const provider = await makeProvider({ spawn });
    const worker = await provider.ensureWorker({ sessionId: "s1" });

    expect(worker.baseUrl).toBe("http://127.0.0.1:5001");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe("mcp-v8");
    expect(spawnCalls[0]?.args).toContain("--http-port=5001");
  });

  test("is idempotent for the same session", async () => {
    const provider = await makeProvider({ spawn });
    const first = await provider.ensureWorker({ sessionId: "s1" });
    const second = await provider.ensureWorker({ sessionId: "s1" });

    expect(second.baseUrl).toBe(first.baseUrl);
    expect(spawnCalls).toHaveLength(1);
  });

  test("stopWorker kills the process and frees the session", async () => {
    const provider = await makeProvider({ spawn });
    await provider.ensureWorker({ sessionId: "s1" });
    await provider.stopWorker("s1");

    expect(procs[0]?.killed).toBe(true);

    await provider.ensureWorker({ sessionId: "s1" });
    expect(spawnCalls).toHaveLength(2);
  });

  test("throws and cleans up when the worker exits before readiness", async () => {
    const earlyExitSpawn = (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      const proc = makeFakeProc();
      proc.exitCode = 1;
      procs.push(proc);
      return proc;
    };
    const provider = await makeProvider({ spawn: earlyExitSpawn });

    await expect(provider.ensureWorker({ sessionId: "s1" })).rejects.toThrow(
      /exited before becoming ready/,
    );
  });
});
