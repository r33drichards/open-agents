"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  emptyWasmModule,
  type WasmModuleEntry,
} from "@/lib/sandbox/mcp-js/command-form";

interface WasmModuleFieldsProps {
  modules: WasmModuleEntry[];
  onChange: (next: WasmModuleEntry[]) => void;
  disabled?: boolean;
}

/** Repeatable rows that build `--wasm-module name=path:mem` entries. */
export function WasmModuleFields({
  modules,
  onChange,
  disabled,
}: WasmModuleFieldsProps) {
  const update = (index: number, patch: Partial<WasmModuleEntry>) =>
    onChange(modules.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  const remove = (index: number) =>
    onChange(modules.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {modules.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No WASM language modules.
        </p>
      ) : null}

      {modules.map((mod, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
          key={index}
          className="grid gap-3 sm:grid-cols-[1fr_2fr_6rem_auto]"
        >
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input
              disabled={disabled}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="picat"
              value={mod.name}
            />
          </Field>
          <Field>
            <FieldLabel>Path</FieldLabel>
            <Input
              disabled={disabled}
              onChange={(e) => update(index, { path: e.target.value })}
              placeholder="/opt/languages/picat.wasm"
              value={mod.path}
            />
          </Field>
          <Field>
            <FieldLabel>Memory</FieldLabel>
            <Input
              disabled={disabled}
              onChange={(e) => update(index, { memory: e.target.value })}
              placeholder="512m"
              value={mod.memory}
            />
          </Field>
          <Button
            aria-label="Remove WASM module"
            className="self-end"
            disabled={disabled}
            onClick={() => remove(index)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button
        disabled={disabled}
        onClick={() => onChange([...modules, emptyWasmModule()])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="h-4 w-4" />
        Add WASM module
      </Button>
    </div>
  );
}
