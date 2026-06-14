import { tool } from "ai";
import { z } from "zod";
import {
  deleteUserSkill,
  readUserSkill,
  type UserSkillStore,
  writeUserSkill,
} from "../skills/authoring";

interface SkillStoreContext {
  skillStore?: UserSkillStore;
}

function getSkillStore(
  experimental_context: unknown,
  toolName: string,
): UserSkillStore {
  const store = (experimental_context as SkillStoreContext | undefined)
    ?.skillStore;
  if (!store) {
    throw new Error(
      `Skill store not available (tool: ${toolName}). Self-authored skills require a user session.`,
    );
  }
  return store;
}

export const writeSkillTool = tool({
  description: `Create or update one of your OWN reusable skills.

Use this to capture a workflow you expect to repeat (a checklist, a recipe, a
project convention) as a named skill. Saved skills persist across sessions and
appear in your "Available skills" list, where you can invoke them later with the
\`skill\` tool. Writing an existing skill name overwrites it — read it first with
\`read_skill\` if you want to edit rather than replace.

The body is plain Markdown instructions to your future self; do not include
YAML frontmatter.`,
  inputSchema: z.object({
    name: z
      .string()
      .describe("Skill slug, e.g. 'deploy-checklist' (lowercased on save)"),
    description: z
      .string()
      .describe("One-line description shown in the skills list"),
    body: z
      .string()
      .describe("Skill instructions in Markdown (no frontmatter)"),
  }),
  execute: ({ name, description, body }, { experimental_context }) =>
    writeUserSkill(getSkillStore(experimental_context, "write_skill"), {
      name,
      description,
      body,
    }),
});

export const readSkillTool = tool({
  description: `Read the full Markdown body of one of your own saved skills.

Use this before editing a skill with \`write_skill\` so you can modify the
existing content instead of overwriting it from scratch.`,
  inputSchema: z.object({
    name: z.string().describe("The skill slug to read"),
  }),
  execute: ({ name }, { experimental_context }) =>
    readUserSkill(getSkillStore(experimental_context, "read_skill"), name),
});

export const deleteSkillTool = tool({
  description: "Delete one of your own saved skills by name.",
  inputSchema: z.object({
    name: z.string().describe("The skill slug to delete"),
  }),
  execute: ({ name }, { experimental_context }) =>
    deleteUserSkill(getSkillStore(experimental_context, "delete_skill"), name),
});
