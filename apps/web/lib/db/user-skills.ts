import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { type UserSkill, userSkills } from "./schema";

/** Normalize a skill name to a stable, case-insensitive slug. */
export function normalizeSkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

/** List all skills authored by a user, oldest first. */
export function listUserSkills(userId: string): Promise<UserSkill[]> {
  return db
    .select()
    .from(userSkills)
    .where(eq(userSkills.userId, userId))
    .orderBy(userSkills.createdAt);
}

/** Fetch a single user skill by (case-insensitive) name. */
export async function getUserSkill(
  userId: string,
  name: string,
): Promise<UserSkill | null> {
  const rows = await db
    .select()
    .from(userSkills)
    .where(
      and(
        eq(userSkills.userId, userId),
        eq(userSkills.name, normalizeSkillName(name)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Create or update a user skill, keyed by (userId, normalized name). */
export async function upsertUserSkill(input: {
  userId: string;
  name: string;
  description: string;
  body: string;
}): Promise<UserSkill> {
  const name = normalizeSkillName(input.name);
  const now = new Date();
  const [row] = await db
    .insert(userSkills)
    .values({
      id: nanoid(),
      userId: input.userId,
      name,
      description: input.description,
      body: input.body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userSkills.userId, userSkills.name],
      set: {
        description: input.description,
        body: input.body,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

/** Delete a user skill by name. Returns true if a row was removed. */
export async function deleteUserSkill(
  userId: string,
  name: string,
): Promise<boolean> {
  const deleted = await db
    .delete(userSkills)
    .where(
      and(
        eq(userSkills.userId, userId),
        eq(userSkills.name, normalizeSkillName(name)),
      ),
    )
    .returning({ id: userSkills.id });
  return deleted.length > 0;
}
