import type { Dirent } from "fs";
import type {
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxStats,
  SandboxType,
} from "../interface.ts";
import { createMcpV8Client, type McpV8Client } from "./client/index.ts";
import {
  DEFAULT_MCP_JS_WORKING_DIRECTORY,
  type McpJsSandboxConfig,
} from "./config.ts";
import { McpJsUnsupportedOperationError } from "./errors.ts";
import type { McpJsState } from "./state.ts";

const ENVIRONMENT_DETAILS = [
  "This is an mcp-js (mcp-v8) sandbox: a remote V8 JavaScript execution engine.",
  "It is JS-execution-only — there is no POSIX shell, git, or persistent",
  "filesystem. The `exec` capability runs JavaScript source (ES modules with",
  "top-level await); use `console.log(...)` to produce output. Globals persist",
  "across calls via heap snapshots. Filesystem and bash tools are unavailable.",
].join(" ");

/**
 * A {@link Sandbox} backed by an mcp-v8 server over its HTTP REST API.
 *
 * `exec` interprets the supplied command as JavaScript and runs it via the
 * server's `run_js` flow (submit → poll → collect console output). Filesystem
 * and shell operations are unsupported and throw.
 */
export class McpJsSandbox implements Sandbox {
  readonly type: SandboxType = "js";
  readonly workingDirectory: string;
  readonly env?: Record<string, string>;
  readonly hooks?: SandboxHooks;
  readonly environmentDetails = ENVIRONMENT_DETAILS;

  private readonly client: McpV8Client;
  private readonly baseUrl: string;
  /** Stable session label; the server restores its latest heap on each run. */
  private readonly session?: string;
  /** Optional explicit heap override; normally unset (session drives state). */
  private readonly heap?: string;

  constructor(config: McpJsSandboxConfig) {
    this.baseUrl = config.baseUrl;
    this.client = createMcpV8Client(config.baseUrl, {
      headers: config.headers,
    });
    this.workingDirectory =
      config.workingDirectory ?? DEFAULT_MCP_JS_WORKING_DIRECTORY;
    this.env = config.env;
    this.hooks = config.hooks;
    this.session = config.session;
    this.heap = config.heap;
  }

  /**
   * Run the given command as JavaScript in the V8 isolate.
   *
   * @param command - JavaScript source to execute.
   * @param _cwd - Ignored; the JS runtime has no working directory semantics.
   * @param timeoutMs - Per-execution timeout (converted to whole seconds).
   */
  async exec(
    command: string,
    _cwd: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal },
  ): Promise<ExecResult> {
    const executionTimeoutSecs =
      timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) : undefined;

    // No heap is passed: the server restores this session's latest heap and
    // snapshots the result automatically, so the stable `session` label carries
    // state forward without the client tracking content-addressed heap keys.
    const run = await this.client.runJs(command, {
      heap: this.heap,
      session: this.session,
      executionTimeoutSecs,
      signal: options?.signal,
    });

    if (run.status === "completed") {
      return {
        success: true,
        exitCode: 0,
        stdout: run.output,
        stderr: "",
        truncated: false,
      };
    }

    const stderr =
      run.error ??
      (run.status === "timed_out"
        ? "Execution timed out"
        : run.status === "cancelled"
          ? "Execution cancelled"
          : "Execution failed");

    return {
      success: false,
      exitCode: run.status === "cancelled" ? null : 1,
      stdout: run.output,
      stderr,
      truncated: false,
    };
  }

  // --- Filesystem operations: unsupported on a JS-execution-only runtime. ---

  readFile(_path: string, _encoding: "utf-8"): Promise<string> {
    return Promise.reject(new McpJsUnsupportedOperationError("readFile"));
  }

  readFileBuffer(_path: string): Promise<Buffer> {
    return Promise.reject(new McpJsUnsupportedOperationError("readFileBuffer"));
  }

  writeFile(
    _path: string,
    _content: string,
    _encoding: "utf-8",
  ): Promise<void> {
    return Promise.reject(new McpJsUnsupportedOperationError("writeFile"));
  }

  stat(_path: string): Promise<SandboxStats> {
    return Promise.reject(new McpJsUnsupportedOperationError("stat"));
  }

  access(_path: string): Promise<void> {
    return Promise.reject(new McpJsUnsupportedOperationError("access"));
  }

  mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    return Promise.reject(new McpJsUnsupportedOperationError("mkdir"));
  }

  readdir(_path: string, _options: { withFileTypes: true }): Promise<Dirent[]> {
    return Promise.reject(new McpJsUnsupportedOperationError("readdir"));
  }

  // --- Lifecycle ---

  stop(): Promise<void> {
    // Executions are ephemeral and the server is shared; nothing to tear down.
    return Promise.resolve();
  }

  getState(): McpJsState {
    return {
      baseUrl: this.baseUrl,
      session: this.session,
      workingDirectory: this.workingDirectory,
      ...(this.heap ? { heap: this.heap } : {}),
    };
  }
}
