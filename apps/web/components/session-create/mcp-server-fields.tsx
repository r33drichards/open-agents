"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emptyMcpServer,
  type McpServerEntry,
  type McpServerTransport,
} from "@/lib/sandbox/mcp-js/command-form";

interface McpServerFieldsProps {
  servers: McpServerEntry[];
  onChange: (next: McpServerEntry[]) => void;
  disabled?: boolean;
}

/**
 * Repeatable rows that build `--mcp-server NAME=stdio:cmd:args` / `=sse:url`
 * entries — connect external MCP servers whose tools become callable from
 * run_js via `mcp.callTool()`.
 */
export function McpServerFields({
  servers,
  onChange,
  disabled,
}: McpServerFieldsProps) {
  const update = (index: number, patch: Partial<McpServerEntry>) =>
    onChange(servers.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const remove = (index: number) =>
    onChange(servers.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      {servers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No MCP servers configured. Add one to expose its tools to{" "}
          <code>run_js</code> via <code>mcp.callTool()</code>.
        </p>
      ) : null}

      {servers.map((server, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
          key={index}
          className="space-y-3 rounded-lg border border-border/70 p-3 dark:border-white/10"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                disabled={disabled}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="myserver"
                value={server.name}
              />
            </Field>
            <Field>
              <FieldLabel>Transport</FieldLabel>
              <Select
                disabled={disabled}
                onValueChange={(v) =>
                  update(index, { transport: v as McpServerTransport })
                }
                value={server.transport}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">sse</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button
              aria-label="Remove MCP server"
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

          {server.transport === "stdio" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Command</FieldLabel>
                <Input
                  disabled={disabled}
                  onChange={(e) => update(index, { command: e.target.value })}
                  placeholder="/usr/local/bin/mcp-v8"
                  value={server.command}
                />
              </Field>
              <Field>
                <FieldLabel>Args</FieldLabel>
                <Input
                  disabled={disabled}
                  onChange={(e) => update(index, { args: e.target.value })}
                  placeholder="--flag value"
                  value={server.args}
                />
                <FieldDescription>
                  Space-separated; joined as <code>:arg1:arg2</code>.
                </FieldDescription>
              </Field>
            </div>
          ) : (
            <Field>
              <FieldLabel>URL</FieldLabel>
              <Input
                disabled={disabled}
                onChange={(e) => update(index, { url: e.target.value })}
                placeholder="http://host:port/sse"
                value={server.url}
              />
            </Field>
          )}
        </div>
      ))}

      <Button
        disabled={disabled}
        onClick={() => onChange([...servers, emptyMcpServer()])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="h-4 w-4" />
        Add MCP server
      </Button>
    </div>
  );
}
