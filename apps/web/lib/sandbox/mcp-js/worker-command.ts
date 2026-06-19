/**
 * Format and parse mcp-v8 worker launch command lines.
 *
 * The new-session UI renders the generated `mcp-v8 …` command and lets the user
 * edit it; an edited command is persisted as
 * {@link import("@open-agents/sandbox").McpJsRuntimeConfig.commandOverride} and
 * spawned verbatim by the subprocess worker provider. Display needs shell
 * quoting (some flags — e.g. `--policies-json` — carry JSON with quotes and
 * spaces); spawning needs the inverse tokenizer. These helpers are pure so the
 * client preview and the server provider share one round-trippable encoding.
 */

/** A command split into its executable and argument vector. */
export interface ParsedCommand {
  binary: string;
  args: string[];
}

/** Tokens with only these characters are safe to render unquoted. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Single-quote a token for display when it contains shell-significant chars. */
function quoteToken(token: string): string {
  if (SHELL_SAFE.test(token)) {
    return token;
  }
  // POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
  return `'${token.replaceAll("'", "'\\''")}'`;
}

/** Render `[binary, ...args]` as a single, copy-pasteable command line. */
export function formatMcpV8Command(binary: string, args: string[]): string {
  return [binary, ...args].map(quoteToken).join(" ");
}

/**
 * Tokenize a command line into `[binary, ...args]`, honoring single quotes,
 * double quotes, and backslash escapes (a minimal POSIX-ish split — no variable
 * or glob expansion). Throws on an unterminated quote/escape or empty command.
 */
export function parseMcpV8Command(command: string): ParsedCommand {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      hasToken = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }

  if (quote || escaped) {
    throw new Error("Unterminated quote or escape in command.");
  }
  if (hasToken) {
    tokens.push(current);
  }

  const [binary, ...args] = tokens;
  if (!binary) {
    throw new Error("Command is empty.");
  }
  return { binary, args };
}

/**
 * Read the value of a `--flag=value` or `--flag value` argument, or `undefined`
 * when the flag is absent.
 */
export function getCommandArgValue(
  args: string[],
  flag: string,
): string | undefined {
  const prefix = `--${flag}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${flag}` && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}
