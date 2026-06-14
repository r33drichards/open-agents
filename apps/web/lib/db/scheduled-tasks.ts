import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import {
  type NewScheduledTask,
  type ScheduledTask,
  scheduledTasks,
} from "./schema";

/** Create a scheduled task. */
export async function createScheduledTask(
  input: NewScheduledTask,
): Promise<ScheduledTask> {
  const [row] = await db.insert(scheduledTasks).values(input).returning();
  if (!row) {
    throw new Error("Failed to create scheduled task");
  }
  return row;
}

/** List all scheduled tasks for a user, oldest first. */
export function listScheduledTasksByUser(
  userId: string,
): Promise<ScheduledTask[]> {
  return db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(asc(scheduledTasks.createdAt));
}

/** List the scheduled tasks belonging to a single session. */
export function listScheduledTasksBySession(
  sessionId: string,
): Promise<ScheduledTask[]> {
  return db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.sessionId, sessionId))
    .orderBy(asc(scheduledTasks.createdAt));
}

export async function getScheduledTaskById(
  id: string,
): Promise<ScheduledTask | null> {
  const rows = await db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateScheduledTask(
  id: string,
  patch: Partial<Omit<ScheduledTask, "id" | "userId" | "createdAt">>,
): Promise<ScheduledTask | null> {
  const [row] = await db
    .update(scheduledTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(scheduledTasks.id, id))
    .returning();
  return row ?? null;
}

/** Delete a scheduled task by id. Returns true if a row was removed. */
export async function deleteScheduledTask(id: string): Promise<boolean> {
  const deleted = await db
    .delete(scheduledTasks)
    .where(eq(scheduledTasks.id, id))
    .returning({ id: scheduledTasks.id });
  return deleted.length > 0;
}

/**
 * Atomically claim the durable-workflow lease when no run is recorded.
 * Mirrors {@link claimSessionSandboxProvisioningRunId}.
 */
export async function claimScheduledTaskRunId(
  id: string,
  runId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(scheduledTasks)
    .set({ schedulerRunId: runId, updatedAt: new Date() })
    .where(
      and(eq(scheduledTasks.id, id), isNull(scheduledTasks.schedulerRunId)),
    )
    .returning({ id: scheduledTasks.id });
  return Boolean(updated);
}

/** Release the lease only if this run still owns it. */
export async function clearScheduledTaskRunIdIfOwned(
  id: string,
  runId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(scheduledTasks)
    .set({ schedulerRunId: null, updatedAt: new Date() })
    .where(
      and(eq(scheduledTasks.id, id), eq(scheduledTasks.schedulerRunId, runId)),
    )
    .returning({ id: scheduledTasks.id });
  return Boolean(updated);
}
