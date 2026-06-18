"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2,
  TerminalIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Monaco can only run in the browser; load it lazily and skip SSR.
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading editor…
    </div>
  ),
});

interface SessionCommandEditorProps {
  /** Current editor contents. */
  value: string;
  /** The unedited, generated command (used to detect edits and to reset). */
  defaultCommand: string | null;
  /** Whether the generated command is still loading. */
  loading: boolean;
  /** Disable editing (e.g. while a session is being created). */
  disabled?: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}

/**
 * Collapsible "advanced" panel that shows the mcp-v8 sandbox launch command for
 * a new session in a Monaco editor and lets the user customize it. Edits flow
 * up via {@link SessionCommandEditorProps.onChange}; the parent persists a
 * changed command as the session's `runtimeConfig.commandOverride`.
 */
export function SessionCommandEditor({
  value,
  defaultCommand,
  loading,
  disabled,
  onChange,
  onReset,
}: SessionCommandEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [theme, setTheme] = useState<"vs-dark" | "light">("vs-dark");

  // Match Monaco to the app's Tailwind dark-mode class.
  useEffect(() => {
    const sync = () =>
      setTheme(
        document.documentElement.classList.contains("dark")
          ? "vs-dark"
          : "light",
      );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const isEdited = defaultCommand !== null && value !== defaultCommand;

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20 dark:border-white/10 dark:bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 dark:hover:bg-white/[0.04]"
      >
        <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Sandbox command{" "}
          {isEdited && (
            <span className="font-medium text-foreground/80">(customized)</span>
          )}
        </span>
        {expanded ? (
          <ChevronUpIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/50 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-2 px-3.5 py-2">
            <p className="min-w-0 text-xs text-muted-foreground">
              The mcp-v8 command this session&apos;s sandbox launches. Leave it
              as-is to use the auto-generated per-session values; edits are run
              verbatim when the worker starts.
            </p>
            {isEdited && (
              <button
                type="button"
                onClick={onReset}
                disabled={disabled}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </div>
          <div
            className={cn(
              "border-t border-border/30 dark:border-white/[0.04]",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            {loading && defaultCommand === null ? (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading command…
              </div>
            ) : (
              <MonacoEditor
                height="160px"
                defaultLanguage="shell"
                theme={theme}
                value={value}
                onChange={(next) => onChange(next ?? "")}
                options={{
                  readOnly: disabled,
                  minimap: { enabled: false },
                  lineNumbers: "off",
                  wordWrap: "on",
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 8, bottom: 8 },
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                  scrollbar: { vertical: "auto", horizontal: "auto" },
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
