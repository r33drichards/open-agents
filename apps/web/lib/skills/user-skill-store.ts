import "server-only";

import type {
  SkillMetadata,
  UserSkillRecord,
  UserSkillStore,
} from "@open-agents/agent";
import {
  deleteUserSkill,
  getUserSkill,
  listUserSkills,
  upsertUserSkill,
} from "@/lib/db/user-skills";
import type { UserSkill } from "@/lib/db/schema";

function toRecord(skill: UserSkill): UserSkillRecord {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
  };
}

/**
 * DB-backed implementation of the agent's {@link UserSkillStore} port, scoped
 * to a single user. Constructed inside the agent step and passed in-process.
 */
export function createUserSkillStore(userId: string): UserSkillStore {
  return {
    list: async () => (await listUserSkills(userId)).map(toRecord),
    get: async (name) => {
      const skill = await getUserSkill(userId, name);
      return skill ? toRecord(skill) : null;
    },
    upsert: async (input) =>
      toRecord(await upsertUserSkill({ userId, ...input })),
    remove: (name) => deleteUserSkill(userId, name),
  };
}

/** Convert a stored user skill into agent-facing skill metadata (inline body). */
export function userSkillToMetadata(skill: UserSkill): SkillMetadata {
  return {
    name: skill.name,
    description: skill.description,
    path: "",
    filename: "",
    options: {},
    source: "user",
    body: skill.body,
  };
}

/**
 * Merge sandbox-discovered skills with the user's authored skills. On a name
 * clash the user-authored skill wins, since it was created intentionally.
 */
export function mergeUserSkills(
  discovered: SkillMetadata[],
  userSkills: SkillMetadata[],
): SkillMetadata[] {
  const userNames = new Set(userSkills.map((s) => s.name.toLowerCase()));
  const keptDiscovered = discovered.filter(
    (s) => !userNames.has(s.name.toLowerCase()),
  );
  return [...keptDiscovered, ...userSkills];
}
