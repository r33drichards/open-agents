/**
 * Build an mcp-v8 launch command from structured form fields.
 *
 * The new-session "create" page lets a user configure mcp-v8 args (MCP servers,
 * WASM modules, limits, instructions) with a form instead of hand-editing the
 * raw shell string. We seed from the server's representative command (see
 * `/api/sessions/command-preview`), preserve the per-session/cluster INFRA flags
 * verbatim (ports, node id, cluster/join, storage — never user-editable), and
 * rebuild the editable flags from the form. The result is round-trippable with
 * the existing {@link formatMcpV8Command}/{@link parseMcpV8Command} encoding and
 * is persisted as `commandOverride`.
 */
import { formatMcpV8Command, parseMcpV8Command } from "./worker-command";

/** Flags carrying a value that are preserved verbatim (per-session/cluster). */
const PRESERVE_FLAGS = new Set([
  "--sse-port",
  "--http-port",
  "--cluster-port",
  "--node-id",
  "--advertise-addr",
  "--session-db-path",
  "--join",
  "--heap-store",
  "--heap-dir",
  "--fs-store",
  "--fs-dir",
  "--s3-bucket",
  "--cache-dir",
  // Policies come from the bundled languages / capabilities; not form-edited.
  "--policies-json",
]);

/** Valueless flags that are preserved verbatim. */
const PRESERVE_BOOLEAN_FLAGS = new Set(["--join-as-learner"]);

/** Valueless flags that the form owns (rebuilt, not preserved). */
const EDITABLE_BOOLEAN_FLAGS = new Set(["--allow-external-modules"]);

export type McpServerTransport = "stdio" | "sse";

export interface McpServerEntry {
  name: string;
  transport: McpServerTransport;
  /** stdio: the executable to spawn. */
  command: string;
  /** stdio: whitespace-separated args (assembled as `:arg1:arg2`). */
  args: string;
  /** sse: the server URL. */
  url: string;
}

export interface WasmModuleEntry {
  name: string;
  path: string;
  /** mcp-v8 memory suffix, e.g. `512m`, `1g`. */
  memory: string;
}

export interface CommandFormState {
  instructions: string;
  runJsDescription: string;
  allowExternalModules: boolean;
  /** Empty string = omit the flag. */
  heapMemoryMaxMb: string;
  executionTimeoutSec: string;
  maxConcurrent: string;
  wasmModules: WasmModuleEntry[];
  mcpServers: McpServerEntry[];
}

export function emptyMcpServer(): McpServerEntry {
  return { name: "", transport: "stdio", command: "", args: "", url: "" };
}

export function emptyWasmModule(): WasmModuleEntry {
  return { name: "", path: "", memory: "512m" };
}

interface ArgEntry {
  /** The flag, e.g. `--instructions`; empty for a bare positional token. */
  flag: string;
  value?: string;
  /** The original token(s) this entry occupies. */
  tokens: string[];
}

/**
 * Split an arg vector into flag entries, normalizing `--flag=value` and
 * `--flag value` forms and recognizing valueless flags.
 */
function parseArgEntries(args: string[]): ArgEntry[] {
  const entries: ArgEntry[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) {
      entries.push({ flag: "", value: token, tokens: [token] });
      continue;
    }
    const eq = token.indexOf("=");
    if (eq >= 0) {
      entries.push({
        flag: token.slice(0, eq),
        value: token.slice(eq + 1),
        tokens: [token],
      });
      continue;
    }
    const flag = token;
    const valueless =
      PRESERVE_BOOLEAN_FLAGS.has(flag) || EDITABLE_BOOLEAN_FLAGS.has(flag);
    const next = args[i + 1];
    if (!valueless && next !== undefined && !next.startsWith("--")) {
      entries.push({ flag, value: next, tokens: [flag, next] });
      i++;
    } else {
      entries.push({ flag, tokens: [flag] });
    }
  }
  return entries;
}

/** The preserved (infra) tokens, in their original order. */
export function getPreservedArgs(args: string[]): string[] {
  return parseArgEntries(args)
    .filter(
      (e) => PRESERVE_FLAGS.has(e.flag) || PRESERVE_BOOLEAN_FLAGS.has(e.flag),
    )
    .flatMap((e) => e.tokens);
}

function valuesOf(entries: ArgEntry[], flag: string): string[] {
  return entries
    .filter((e) => e.flag === `--${flag}` && e.value !== undefined)
    .map((e) => e.value as string);
}

/** `name=path:mem` -> entry (path may not contain `:`; mem is the last segment). */
function parseWasmModule(value: string): WasmModuleEntry | null {
  const eq = value.indexOf("=");
  if (eq < 0) {
    return null;
  }
  const name = value.slice(0, eq);
  const rest = value.slice(eq + 1);
  const colon = rest.lastIndexOf(":");
  if (colon < 0) {
    return { name, path: rest, memory: "512m" };
  }
  return { name, path: rest.slice(0, colon), memory: rest.slice(colon + 1) };
}

/** `name=stdio:cmd:arg1:arg2` or `name=sse:url` -> entry. */
function parseMcpServer(value: string): McpServerEntry | null {
  const eq = value.indexOf("=");
  if (eq < 0) {
    return null;
  }
  const name = value.slice(0, eq);
  const rest = value.slice(eq + 1);
  if (rest.startsWith("sse:")) {
    return { ...emptyMcpServer(), name, transport: "sse", url: rest.slice(4) };
  }
  if (rest.startsWith("stdio:")) {
    const [command, ...rargs] = rest.slice(6).split(":");
    return {
      ...emptyMcpServer(),
      name,
      transport: "stdio",
      command: command ?? "",
      args: rargs.join(" "),
    };
  }
  return null;
}

export function emptyFormState(): CommandFormState {
  return {
    instructions: "",
    runJsDescription: "",
    allowExternalModules: false,
    heapMemoryMaxMb: "",
    executionTimeoutSec: "",
    maxConcurrent: "",
    wasmModules: [],
    mcpServers: [],
  };
}

/** Derive initial form state from a parsed command's args. */
export function parseFormFromArgs(args: string[]): CommandFormState {
  const entries = parseArgEntries(args);
  const first = (flag: string) => valuesOf(entries, flag)[0] ?? "";
  return {
    instructions: first("instructions"),
    runJsDescription: first("run-js-description"),
    allowExternalModules: entries.some(
      (e) => e.flag === "--allow-external-modules",
    ),
    heapMemoryMaxMb: first("heap-memory-max"),
    executionTimeoutSec: first("execution-timeout"),
    maxConcurrent: first("max-concurrent-executions"),
    wasmModules: valuesOf(entries, "wasm-module")
      .map(parseWasmModule)
      .filter((m): m is WasmModuleEntry => m !== null),
    mcpServers: valuesOf(entries, "mcp-server")
      .map(parseMcpServer)
      .filter((m): m is McpServerEntry => m !== null),
  };
}

/** Assemble one `--mcp-server` value from a row, or null if incomplete. */
export function assembleMcpServerValue(entry: McpServerEntry): string | null {
  const name = entry.name.trim();
  if (!name) {
    return null;
  }
  if (entry.transport === "sse") {
    const url = entry.url.trim();
    return url ? `${name}=sse:${url}` : null;
  }
  const command = entry.command.trim();
  if (!command) {
    return null;
  }
  const extra = entry.args.trim();
  const argSuffix = extra ? `:${extra.split(/\s+/).join(":")}` : "";
  return `${name}=stdio:${command}${argSuffix}`;
}

/** The editable flags rebuilt from form state (space form, like the binary). */
function formToArgs(form: CommandFormState): string[] {
  const args: string[] = [];
  if (form.allowExternalModules) {
    args.push("--allow-external-modules");
  }
  if (form.instructions.trim()) {
    args.push("--instructions", form.instructions.trim());
  }
  if (form.runJsDescription.trim()) {
    args.push("--run-js-description", form.runJsDescription.trim());
  }
  if (form.heapMemoryMaxMb.trim()) {
    args.push("--heap-memory-max", form.heapMemoryMaxMb.trim());
  }
  if (form.executionTimeoutSec.trim()) {
    args.push("--execution-timeout", form.executionTimeoutSec.trim());
  }
  if (form.maxConcurrent.trim()) {
    args.push("--max-concurrent-executions", form.maxConcurrent.trim());
  }
  for (const mod of form.wasmModules) {
    const name = mod.name.trim();
    const path = mod.path.trim();
    if (name && path) {
      args.push(
        "--wasm-module",
        `${name}=${path}:${mod.memory.trim() || "512m"}`,
      );
    }
  }
  for (const server of form.mcpServers) {
    const value = assembleMcpServerValue(server);
    if (value) {
      args.push("--mcp-server", value);
    }
  }
  return args;
}

/** Assemble the full command line from preserved infra args + form fields. */
export function buildCommandFromForm(
  binary: string,
  infraArgs: string[],
  form: CommandFormState,
): string {
  return formatMcpV8Command(binary, [...infraArgs, ...formToArgs(form)]);
}

/** Parsed seed for the form: binary + preserved infra args + initial state. */
export interface CommandSeed {
  binary: string;
  infraArgs: string[];
  form: CommandFormState;
}

/** Parse a preview command into a seed for the form, or null if unparseable. */
export function seedFromPreview(previewCommand: string): CommandSeed | null {
  try {
    const { binary, args } = parseMcpV8Command(previewCommand);
    return {
      binary,
      infraArgs: getPreservedArgs(args),
      form: parseFormFromArgs(args),
    };
  } catch {
    return null;
  }
}
