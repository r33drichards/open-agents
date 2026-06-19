/**
 * The bundled "toolbox" languages a subprocess mcp-v8 worker is launched with,
 * mirroring the standalone mcp-js service image (`deploy/mcp-js/Dockerfile`).
 *
 * In subprocess mode the web container spawns each session's worker itself, so
 * the worker only gets these capabilities if we pass the same `--wasm-module`,
 * `--instructions`, and language policy flags here. The `.wasm` assets, the
 * `bootstrap.js` loader, and the `fetch.rego` / `filesystem.rego` policies must
 * exist under {@link LanguageBundle.dir} in the image (see the web Dockerfile).
 *
 * This module contributes only language-related flags; the worker provider owns
 * cluster, heap, and filesystem-store flags.
 */

/** Where the bundled language assets live, and the flags they imply. */
export interface LanguageBundle {
  /** Directory holding the wasm modules, bootstrap.js, and rego policies. */
  dir: string;
}

/** A bundled WASM language module and its per-module memory cap. */
interface WasmLanguage {
  /** mcp-v8 module name used in `--wasm-module name=path:mem`. */
  name: string;
  /** Asset filename under the bundle directory. */
  file: string;
  /** Memory cap (mcp-v8 size suffix, e.g. `512m`, `1g`). */
  memory: string;
}

/** The WASM languages shipped with the toolbox image, in load order. */
const WASM_LANGUAGES: readonly WasmLanguage[] = [
  { name: "picat", file: "picat.wasm", memory: "512m" },
  { name: "tla", file: "tla_checker.wasm", memory: "512m" },
  { name: "minizinc", file: "minizinc.wasm", memory: "1g" },
  { name: "autolisp", file: "acadlisp.wasm", memory: "512m" },
  { name: "lua", file: "lua.wasm", memory: "512m" },
  { name: "craftos", file: "craftos.wasm", memory: "512m" },
];

/**
 * Agent-facing description of the runtime, kept in sync with the standalone
 * image's `--instructions`. Uses no double quotes so it round-trips cleanly
 * through the command formatter/parser.
 */
const INSTRUCTIONS =
  "Sandboxed V8 JavaScript runtime (run_js) with fetch enabled and a persistent, per-session content-addressed filesystem at /work (await fs.writeFile('/work/x'), fs.readFile, fs.readdir, etc.) that survives across runs in the same session. Load language helpers once per run with (0,eval)(await fs.readFile('/opt/languages/bootstrap.js')) -> picat, tlaplus, minizinc, autolisp, lua, craftos, jsx, markdown, mermaid.";

/** Absolute `file://` URL of the bundle's fetch policy (Rego). */
export function bundledFetchPolicyUrl(dir: string): string {
  return `file://${dir}/fetch.rego`;
}

/** Absolute `file://` URL of the bundle's filesystem policy (Rego). */
export function bundledFilesystemPolicyUrl(dir: string): string {
  return `file://${dir}/filesystem.rego`;
}

/**
 * Build the language-related mcp-v8 launch flags for a bundle: external module
 * loading, the agent instructions, and one `--wasm-module` per language. Policy
 * flags are emitted separately (merged into `--policies-json`).
 */
export function buildLanguageBundleArgs(bundle: LanguageBundle): string[] {
  const args = ["--allow-external-modules", "--instructions", INSTRUCTIONS];
  for (const lang of WASM_LANGUAGES) {
    args.push(
      "--wasm-module",
      `${lang.name}=${bundle.dir}/${lang.file}:${lang.memory}`,
    );
  }
  return args;
}
