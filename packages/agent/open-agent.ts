import type { SandboxState } from "@open-agents/sandbox";
import { stepCountIs, ToolLoopAgent, type ToolSet } from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import { getToolboxTools } from "./mcp";
import {
  type GatewayModelId,
  gateway,
  type ProviderOptionsByProvider,
} from "./models";

import type { ScheduledTaskStore } from "./scheduling/store";
import type { UserSkillStore } from "./skills/authoring";
import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  cronCreateTool,
  cronDeleteTool,
  cronListTool,
  deleteSkillTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  readSkillTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
  writeSkillTool,
} from "./tools";

export interface AgentModelSelection {
  id: GatewayModelId;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type OpenAgentModelInput = GatewayModelId | AgentModelSelection;

export interface AgentSandboxContext {
  state: SandboxState;
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
}

const callOptionsSchema = z.object({
  sandbox: z.custom<AgentSandboxContext>(),
  model: z.custom<OpenAgentModelInput>().optional(),
  subagentModel: z.custom<OpenAgentModelInput>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  // Durable store for user-authored skills. Constructed fresh inside the host
  // app's agent step and passed in-process (never serialized).
  skillStore: z.custom<UserSkillStore>().optional(),
  // Durable store for scheduled tasks. Same in-process injection as skillStore.
  scheduledTaskStore: z.custom<ScheduledTaskStore>().optional(),
});

export type OpenAgentCallOptions = z.infer<typeof callOptionsSchema>;

export const defaultModelLabel = "anthropic/claude-opus-4.6" as const;
export const defaultModel = gateway(defaultModelLabel);

function normalizeAgentModelSelection(
  selection: OpenAgentModelInput | undefined,
  fallbackId: GatewayModelId,
): AgentModelSelection {
  if (!selection) {
    return { id: fallbackId };
  }

  return typeof selection === "string" ? { id: selection } : selection;
}

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  write_skill: writeSkillTool,
  read_skill: readSkillTool,
  delete_skill: deleteSkillTool,
  cron_create: cronCreateTool,
  cron_list: cronListTool,
  cron_delete: cronDeleteTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

// For the JS-only mcp-v8 sandbox, the file/shell tools are replaced by the
// toolbox's own tools (run_js, language runners) discovered over MCP. Only the
// sandbox-agnostic tools remain built in. (`task` is omitted for now because
// subagents still target the shell/file Sandbox interface.) Skill authoring is
// DB-backed, so it works here too.
const mcpJsMetaTools = {
  todo_write: todoWriteTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  write_skill: writeSkillTool,
  read_skill: readSkillTool,
  delete_skill: deleteSkillTool,
  cron_create: cronCreateTool,
  cron_list: cronListTool,
  cron_delete: cronDeleteTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const openAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(1),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps: _steps }) => {
    return {
      messages: addCacheControl({
        messages,
        model,
      }),
    };
  },
  prepareCall: async ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Open Agent requires call options with sandbox.");
    }

    const mainSelection = normalizeAgentModelSelection(
      options.model,
      defaultModelLabel,
    );
    const subagentSelection = options.subagentModel
      ? normalizeAgentModelSelection(options.subagentModel, defaultModelLabel)
      : undefined;

    const callModel = gateway(mainSelection.id, {
      providerOptionsOverrides: mainSelection.providerOptionsOverrides,
    });
    const subagentModel = subagentSelection
      ? gateway(subagentSelection.id, {
          providerOptionsOverrides: subagentSelection.providerOptionsOverrides,
        })
      : undefined;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const sandboxState = sandbox.state;
    const skills = options.skills ?? [];

    // For an mcp-js sandbox, discover the toolbox's tools over MCP and use them
    // in place of the built-in shell/file tools. Other sandbox types keep the
    // built-in toolset. The cast acknowledges that prepareCall swaps the
    // runtime toolset, which the static `tools` type cannot express.
    let toolSet: typeof tools = settings.tools ?? tools;
    let mcpInstructions: string | undefined;
    let toolEnvironment: "cloud" | "js" = "cloud";

    if (sandboxState.type === "mcp-js") {
      // Pass the session label as X-MCP-Session-Id so the worker keys both the
      // V8 heap and the per-session CAS filesystem to this session (state
      // persists across runs without the agent tracking snapshot handles).
      const { tools: mcpTools, instructions } = await getToolboxTools(
        sandboxState.baseUrl,
        sandboxState.session,
      );
      toolSet = { ...mcpJsMetaTools, ...mcpTools } as unknown as typeof tools;
      mcpInstructions = instructions;
      toolEnvironment = "js";
    }

    const environmentDetails =
      [sandbox.environmentDetails, mcpInstructions]
        .filter(Boolean)
        .join("\n\n") || undefined;

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails,
      skills,
      modelId: mainSelection.id,
      toolEnvironment,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: toolSet,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        skills,
        model: callModel,
        subagentModel,
        skillStore: options.skillStore,
        scheduledTaskStore: options.scheduledTaskStore,
      },
    };
  },
});

export type OpenAgent = typeof openAgent;
