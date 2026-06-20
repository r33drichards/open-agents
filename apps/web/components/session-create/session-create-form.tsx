"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMcpCommandPreview } from "@/hooks/use-mcp-command-preview";
import { useSessions } from "@/hooks/use-sessions";
import {
  buildCommandFromForm,
  type CommandFormState,
  type CommandSeed,
  emptyFormState,
  seedFromPreview,
} from "@/lib/sandbox/mcp-js/command-form";
import { McpServerFields } from "./mcp-server-fields";
import { WasmModuleFields } from "./wasm-module-fields";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-medium text-sm">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function SessionCreateForm() {
  const router = useRouter();
  const { createSession } = useSessions();
  const { command: previewCommand, loading: previewLoading } =
    useMcpCommandPreview();

  const [seed, setSeed] = useState<CommandSeed | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [form, setForm] = useState<CommandFormState>(emptyFormState);
  const [title, setTitle] = useState("");
  // When non-null, the user is editing the raw command directly (escape hatch);
  // the structured form is the source of truth otherwise.
  const [rawOverride, setRawOverride] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (seeded || !previewCommand) {
      return;
    }
    const parsed = seedFromPreview(previewCommand);
    if (parsed) {
      setSeed(parsed);
      setForm(parsed.form);
    }
    setSeeded(true);
  }, [previewCommand, seeded]);

  const assembledCommand = useMemo(
    () => (seed ? buildCommandFromForm(seed.binary, seed.infraArgs, form) : ""),
    [seed, form],
  );
  const effectiveCommand = rawOverride ?? assembledCommand;
  const patch = (next: Partial<CommandFormState>) =>
    setForm((prev) => ({ ...prev, ...next }));
  const formDisabled = submitting || rawOverride !== null;

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const commandOverride =
        effectiveCommand &&
        previewCommand &&
        effectiveCommand.trim() !== previewCommand.trim()
          ? effectiveCommand
          : undefined;
      const { session, chat } = await createSession({
        title: title.trim() || undefined,
        isNewBranch: false,
        sandboxType: "vercel",
        autoCommitPush: false,
        autoCreatePr: false,
        commandOverride,
      });
      router.push(`/sessions/${session.id}/chats/${chat.id}`);
    } catch {
      // createSession surfaces its own error toast; just re-enable the form.
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:py-10">
      <div className="space-y-1">
        <h1 className="font-semibold text-xl">Create session</h1>
        <p className="text-muted-foreground text-sm">
          Configure the mcp-v8 sandbox this session launches. Defaults match the
          standard runtime; adjust the fields to customize the worker command.
        </p>
      </div>

      <Section title="Session">
        <Field>
          <FieldLabel htmlFor="session-title">Title</FieldLabel>
          <Input
            disabled={submitting}
            id="session-title"
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional — a name auto-generates if left blank"
            value={title}
          />
        </Field>
      </Section>

      <Separator />

      <Section
        description="Limits and module loading for the V8 runtime."
        title="Runtime"
      >
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="allow-external">
              Allow external module imports
            </FieldLabel>
            <FieldDescription>
              Permit <code>npm:</code> / <code>jsr:</code> / URL imports.
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={form.allowExternalModules}
            disabled={formDisabled}
            id="allow-external"
            onCheckedChange={(v) => patch({ allowExternalModules: v })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="heap-max">Heap memory (MB)</FieldLabel>
            <Input
              disabled={formDisabled}
              id="heap-max"
              inputMode="numeric"
              onChange={(e) => patch({ heapMemoryMaxMb: e.target.value })}
              placeholder="default"
              value={form.heapMemoryMaxMb}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="exec-timeout">Exec timeout (s)</FieldLabel>
            <Input
              disabled={formDisabled}
              id="exec-timeout"
              inputMode="numeric"
              onChange={(e) => patch({ executionTimeoutSec: e.target.value })}
              placeholder="default"
              value={form.executionTimeoutSec}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="max-concurrent">Max concurrent</FieldLabel>
            <Input
              disabled={formDisabled}
              id="max-concurrent"
              inputMode="numeric"
              onChange={(e) => patch({ maxConcurrent: e.target.value })}
              placeholder="default"
              value={form.maxConcurrent}
            />
          </Field>
        </div>
      </Section>

      <Separator />

      <Section
        description="Override the server instructions and the run_js tool description advertised to the agent."
        title="Instructions"
      >
        <Field>
          <FieldLabel htmlFor="instructions">Instructions</FieldLabel>
          <Textarea
            className="min-h-24 font-mono text-xs"
            disabled={formDisabled}
            id="instructions"
            onChange={(e) => patch({ instructions: e.target.value })}
            value={form.instructions}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="run-js-desc">run_js description</FieldLabel>
          <Textarea
            className="min-h-16 font-mono text-xs"
            disabled={formDisabled}
            id="run-js-desc"
            onChange={(e) => patch({ runJsDescription: e.target.value })}
            placeholder="Optional"
            value={form.runJsDescription}
          />
        </Field>
      </Section>

      <Separator />

      <Section
        description="WebAssembly language modules mounted into the runtime."
        title="WASM modules"
      >
        <WasmModuleFields
          disabled={formDisabled}
          modules={form.wasmModules}
          onChange={(wasmModules) => patch({ wasmModules })}
        />
      </Section>

      <Separator />

      <Section
        description="Connect external MCP servers; their tools become callable from run_js."
        title="MCP servers"
      >
        <McpServerFields
          disabled={formDisabled}
          onChange={(mcpServers) => patch({ mcpServers })}
          servers={form.mcpServers}
        />
      </Section>

      <Separator />

      <Section
        description="The exact command the worker launches. Custom args only take effect for allowlisted users; otherwise the session starts with the default runtime."
        title="Resulting command"
      >
        <Textarea
          className="min-h-28 font-mono text-xs"
          onChange={(e) => setRawOverride(e.target.value)}
          readOnly={rawOverride === null}
          value={effectiveCommand}
        />
        {rawOverride === null ? (
          <Button
            disabled={!seed}
            onClick={() => setRawOverride(assembledCommand)}
            size="sm"
            type="button"
            variant="outline"
          >
            Edit raw command
          </Button>
        ) : (
          <Button
            onClick={() => setRawOverride(null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Back to form
          </Button>
        )}
      </Section>

      <div className="flex items-center justify-end gap-3 border-border/50 border-t pt-6">
        <Button asChild disabled={submitting} variant="ghost">
          <Link href="/sessions">Cancel</Link>
        </Button>
        <Button
          disabled={submitting || previewLoading}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create session
        </Button>
      </div>
    </div>
  );
}
