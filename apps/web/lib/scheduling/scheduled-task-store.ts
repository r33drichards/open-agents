import "server-only";

import type {
  CreateScheduledTaskInput,
  ScheduledTaskRecord,
  ScheduledTaskStore,
} from "@open-agents/agent";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTaskById,
  listScheduledTasksByUser,
} from "@/lib/db/scheduled-tasks";
import type { ScheduledTask } from "@/lib/db/schema";
import { nanoid } from "nanoid";
import { computeNextRun, DEFAULT_TIMEZONE, parseScheduleInput } from "./cron";

export function scheduledTaskToRecord(
  task: ScheduledTask,
): ScheduledTaskRecord {
  return {
    id: task.id,
    prompt: task.prompt,
    scheduleKind: task.scheduleKind,
    cronExpression: task.cronExpression,
    fireAt: task.fireAt ? task.fireAt.toISOString() : null,
    fireMode: task.fireMode,
    timezone: task.timezone,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt ? task.nextRunAt.toISOString() : null,
    lastRunAt: task.lastRunAt ? task.lastRunAt.toISOString() : null,
  };
}

/**
 * DB-backed implementation of the agent's {@link ScheduledTaskStore} port,
 * scoped to one user + session + chat. Constructed inside the agent step and
 * passed in-process (mirrors createUserSkillStore).
 */
export function createScheduledTaskStore(params: {
  userId: string;
  sessionId: string;
  /** Required for same-session tasks; ignored for fresh-session tasks. */
  chatId?: string;
}): ScheduledTaskStore {
  return {
    create: async (input: CreateScheduledTaskInput) => {
      const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
      const now = new Date();
      const parsed = parseScheduleInput({
        schedule: input.schedule,
        now,
        timezone,
      });
      const fireMode = input.fireMode ?? "same-session";
      if (fireMode === "same-session" && !params.chatId) {
        throw new Error("Same-session tasks require a target chat.");
      }
      const nextRunAt = computeNextRun(parsed, now, timezone);
      if (!nextRunAt) {
        throw new Error(
          "That schedule has no upcoming run (is the one-shot time in the past?).",
        );
      }

      const task = await createScheduledTask({
        id: nanoid(),
        userId: params.userId,
        sessionId: params.sessionId,
        // same-session tasks fire in the originating chat; fresh-session tasks
        // spawn a new chat each run, so no fixed target chat.
        chatId: fireMode === "same-session" ? (params.chatId ?? null) : null,
        prompt: input.prompt.trim(),
        modelId: input.modelId ?? null,
        scheduleKind: parsed.scheduleKind,
        cronExpression: parsed.cronExpression,
        fireAt: parsed.fireAt,
        timezone,
        fireMode,
        enabled: true,
        nextRunAt,
      });

      // Lazily import the kicker so merely constructing the store (done on every
      // agent step) doesn't pull in the durable-workflow + fire import graph.
      const { kickScheduledTaskWorkflow } =
        await import("./kick-scheduled-task");
      await kickScheduledTaskWorkflow(task.id).catch((error) => {
        console.error(`Failed to start scheduler for task ${task.id}:`, error);
      });

      return scheduledTaskToRecord(task);
    },
    list: async () =>
      (await listScheduledTasksByUser(params.userId)).map(
        scheduledTaskToRecord,
      ),
    remove: async (id: string) => {
      const task = await getScheduledTaskById(id);
      if (!task || task.userId !== params.userId) {
        return false;
      }
      // Deleting the row makes the durable workflow stop on its next decision
      // step (it sees the task is gone and clears its lease).
      return deleteScheduledTask(id);
    },
  };
}
