/**
 * Self-authored skills: the agent can create, read, and delete its own skills,
 * which persist (per user) and become invocable like any other skill.
 *
 * This module is intentionally free of `ai`/SDK imports so its logic can be
 * unit tested directly. The `ai` `tool()` wrappers live in
 * `../tools/skill-authoring.ts`, and the durable storage is provided by the
 * host app through the {@link UserSkillStore} port.
 */

/** A persisted user-authored skill. */
export interface UserSkillRecord {
  name: string;
  description: string;
  /** Skill instructions in Markdown (no frontmatter). */
  body: string;
}

/**
 * Durable store for user-authored skills, injected by the host app via the
 * agent's `experimental_context` (the agent package never touches the DB).
 */
export interface UserSkillStore {
  list(): Promise<UserSkillRecord[]>;
  get(name: string): Promise<UserSkillRecord | null>;
  upsert(input: UserSkillRecord): Promise<UserSkillRecord>;
  remove(name: string): Promise<boolean>;
}

export type SkillAuthoringResult =
  | { success: true; name: string; description: string; body?: string }
  | { success: false; error: string };

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** Create or update a user skill. */
export async function writeUserSkill(
  store: UserSkillStore,
  input: { name: string; description: string; body: string },
): Promise<SkillAuthoringResult> {
  if (!nonEmpty(input.name)) {
    return { success: false, error: "Skill name is required." };
  }
  if (!nonEmpty(input.description)) {
    return { success: false, error: "Skill description is required." };
  }
  if (!nonEmpty(input.body)) {
    return { success: false, error: "Skill body is required." };
  }

  const saved = await store.upsert({
    name: input.name,
    description: input.description,
    body: input.body,
  });
  return {
    success: true,
    name: saved.name,
    description: saved.description,
  };
}

/** Read the full body of an existing user skill (for editing). */
export async function readUserSkill(
  store: UserSkillStore,
  name: string,
): Promise<SkillAuthoringResult> {
  const skill = await store.get(name);
  if (!skill) {
    return { success: false, error: `Skill "${name}" not found.` };
  }
  return {
    success: true,
    name: skill.name,
    description: skill.description,
    body: skill.body,
  };
}

/** Delete a user skill by name. */
export async function deleteUserSkill(
  store: UserSkillStore,
  name: string,
): Promise<SkillAuthoringResult> {
  const removed = await store.remove(name);
  if (!removed) {
    return { success: false, error: `Skill "${name}" not found.` };
  }
  return { success: true, name, description: "" };
}
