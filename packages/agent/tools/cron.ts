import { tool } from "ai";
import { z } from "zod";
import {
  createScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  type ScheduledTaskStore,
} from "../scheduling/store";

interface ScheduledTaskStoreContext {
  scheduledTaskStore?: ScheduledTaskStore;
}

function getStore(
  experimental_context: unknown,
  toolName: string,
): ScheduledTaskStore {
  const store = (experimental_context as ScheduledTaskStoreContext | undefined)
    ?.scheduledTaskStore;
  if (!store) {
    throw new Error(
      `Scheduled-task store not available (tool: ${toolName}). Scheduling requires a user session.`,
    );
  }
  return store;
}

export const cronCreateTool = tool({
  description: `Schedule a prompt to run automatically, later or on repeat.

Use this when the user asks to run something on a schedule, poll for status, or
be reminded later — e.g. "check CI every 10 minutes", "run the tests at 9am on
weekdays", "in 30 minutes, summarize the build log".

The schedule can be:
  - a 5-field cron expression: "0 9 * * 1-5" (weekdays 9am), "*/10 * * * *"
  - an interval: "5m", "2h", "every 30 minutes"
  - a relative one-shot: "in 45 minutes", "in 2 hours"
  - an absolute ISO timestamp for a one-shot: "2026-06-14T15:00:00-04:00"

For natural-language times like "tomorrow at 9am", convert them yourself into a
cron expression or an absolute ISO timestamp using the current date/time before
calling. Times are interpreted in the task's timezone.

fireMode controls where the prompt runs when it fires:
  - "same-session" (default): re-runs in THIS session/chat (its sandbox is woken
    if hibernated). Best for ongoing work on the current task.
  - "fresh-session": spins up a new session each time from this session's repo
    config. Best for independent recurring jobs.`,
  inputSchema: z.object({
    prompt: z
      .string()
      .describe("The instruction to run automatically when the task fires."),
    schedule: z
      .string()
      .describe(
        'Cron ("0 9 * * *"), interval ("5m"), relative ("in 30 minutes"), or ISO timestamp.',
      ),
    fireMode: z
      .enum(["same-session", "fresh-session"])
      .optional()
      .describe(
        "Where the prompt runs when it fires. Defaults to same-session.",
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        "IANA timezone (e.g. 'America/New_York'). Defaults to the host's local zone.",
      ),
  }),
  execute: (
    { prompt, schedule, fireMode, timezone },
    { experimental_context },
  ) =>
    createScheduledTask(getStore(experimental_context, "cron_create"), {
      prompt,
      schedule,
      fireMode,
      timezone,
    }),
});

export const cronListTool = tool({
  description:
    "List your scheduled tasks with their ids, schedules, next/last run times, and whether they're enabled.",
  inputSchema: z.object({}),
  execute: (_input, { experimental_context }) =>
    listScheduledTasks(getStore(experimental_context, "cron_list")),
});

export const cronDeleteTool = tool({
  description:
    "Cancel (delete) a scheduled task by its id. Use cron_list first to find the id.",
  inputSchema: z.object({
    id: z.string().describe("The scheduled task id to cancel."),
  }),
  execute: ({ id }, { experimental_context }) =>
    removeScheduledTask(getStore(experimental_context, "cron_delete"), id),
});
