import type { SandboxState } from "@open-agents/sandbox";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AgentSandboxContext } from "./open-agent";
import type { UserSkillStore } from "./skills/authoring";
import type { SkillMetadata } from "./skills/types";
import type { TeamStore } from "./team/store";

export const todoStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof todoStatusSchema>;

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo item"),
  content: z.string().describe("The task description"),
  status: todoStatusSchema.describe(
    "Current status. Only ONE task should be in_progress at a time.",
  ),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

export interface AgentContext {
  sandbox: AgentSandboxContext;
  skills?: SkillMetadata[];
  model: LanguageModel;
  subagentModel?: LanguageModel;
  /** Durable store for user-authored skills (injected by the host app). */
  skillStore?: UserSkillStore;
  /** Durable store for multi-agent team operations (injected by the host app). */
  teamStore?: TeamStore;
}

export interface SandboxExecutionContext {
  sandbox: AgentSandboxContext;
}

export function isSandboxState(value: unknown): value is SandboxState {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "vercel" || value.type === "mcp-js")
  );
}

export const EVICTION_THRESHOLD_BYTES = 80 * 1024;
