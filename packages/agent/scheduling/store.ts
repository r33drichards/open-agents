/**
 * Scheduled tasks: the agent can schedule a prompt to re-run automatically on a
 * cron schedule (recurring) or at a one-shot time, and list/cancel those tasks.
 *
 * Like self-authored skills, this module is intentionally free of `ai`/SDK and
 * DB imports so its logic can be unit tested directly. The `ai` `tool()`
 * wrappers live in `../tools/cron.ts`, and the durable storage + cron parsing
 * are provided by the host app through the {@link ScheduledTaskStore} port.
 */

export type ScheduleKind = "recurring" | "once";
export type ScheduledTaskFireMode = "same-session" | "fresh-session";

/** A persisted scheduled task, as seen by the agent (times are ISO strings). */
export interface ScheduledTaskRecord {
  id: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  cronExpression: string | null;
  fireAt: string | null;
  fireMode: ScheduledTaskFireMode;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface CreateScheduledTaskInput {
  prompt: string;
  /**
   * Cron expression ("0 9 * * *"), interval ("5m", "every 2 hours"), relative
   * one-shot ("in 30 minutes"), or absolute ISO timestamp. The host validates
   * and normalizes this; invalid input surfaces as an error result.
   */
  schedule: string;
  fireMode?: ScheduledTaskFireMode;
  /** IANA timezone; the host defaults to its local zone when omitted. */
  timezone?: string;
  modelId?: string;
}

/**
 * Durable store for scheduled tasks, injected by the host app via the agent's
 * `experimental_context` (the agent package never touches the DB or scheduler).
 */
export interface ScheduledTaskStore {
  create(input: CreateScheduledTaskInput): Promise<ScheduledTaskRecord>;
  list(): Promise<ScheduledTaskRecord[]>;
  remove(id: string): Promise<boolean>;
}

export type SchedulingResult =
  | { success: true; task: ScheduledTaskRecord }
  | { success: true; tasks: ScheduledTaskRecord[] }
  | { success: true; id: string }
  | { success: false; error: string };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Create a scheduled task. */
export async function createScheduledTask(
  store: ScheduledTaskStore,
  input: CreateScheduledTaskInput,
): Promise<SchedulingResult> {
  if (!nonEmpty(input.prompt)) {
    return { success: false, error: "A prompt to run is required." };
  }
  if (!nonEmpty(input.schedule)) {
    return { success: false, error: "A schedule is required." };
  }
  try {
    const task = await store.create(input);
    return { success: true, task };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** List all scheduled tasks. */
export async function listScheduledTasks(
  store: ScheduledTaskStore,
): Promise<SchedulingResult> {
  try {
    const tasks = await store.list();
    return { success: true, tasks };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Cancel a scheduled task by id. */
export async function removeScheduledTask(
  store: ScheduledTaskStore,
  id: string,
): Promise<SchedulingResult> {
  if (!nonEmpty(id)) {
    return { success: false, error: "A task id is required." };
  }
  try {
    const removed = await store.remove(id);
    if (!removed) {
      return { success: false, error: `No scheduled task with id "${id}".` };
    }
    return { success: true, id };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
