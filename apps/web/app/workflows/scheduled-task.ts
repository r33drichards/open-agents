import { getWorkflowMetadata, sleep } from "workflow";
import {
  clearScheduledTaskRunIdIfOwned,
  deleteScheduledTask,
  getScheduledTaskById,
  updateScheduledTask,
} from "@/lib/db/scheduled-tasks";
import { computeNextRun } from "@/lib/scheduling/cron";
import { fireScheduledTask } from "@/lib/scheduling/fire-scheduled-task";

// Floor on the sleep between iterations so a misconfigured task can never
// hot-loop the scheduler.
const MIN_SLEEP_MS = 1_000;

interface WakeDecision {
  shouldContinue: boolean;
  wakeAtMs?: number;
  reason?: string;
}

/**
 * Take/refresh the durable-workflow lease for this task. Mirrors
 * claimLifecycleLease in the sandbox lifecycle workflow: a task row points at a
 * single owning run, so a newer run (e.g. after re-enable) supersedes this one.
 */
async function claimLease(taskId: string, runId: string): Promise<boolean> {
  const current = await getScheduledTaskById(taskId);
  if (!current) {
    return false;
  }
  if (current.schedulerRunId && current.schedulerRunId !== runId) {
    return false;
  }
  if (current.schedulerRunId !== runId) {
    await updateScheduledTask(taskId, { schedulerRunId: runId });
  }
  const verified = await getScheduledTaskById(taskId);
  return verified?.schedulerRunId === runId;
}

async function computeWakeDecision(
  taskId: string,
  runId: string,
): Promise<WakeDecision> {
  "use step";

  const task = await getScheduledTaskById(taskId);
  if (!task) {
    return { shouldContinue: false, reason: "task-not-found" };
  }
  if (!task.enabled) {
    return { shouldContinue: false, reason: "task-disabled" };
  }
  if (!(await claimLease(taskId, runId))) {
    return { shouldContinue: false, reason: "run-replaced" };
  }

  const next = computeNextRun(task, new Date(), task.timezone);
  if (!next) {
    return { shouldContinue: false, reason: "no-next-run" };
  }

  await updateScheduledTask(taskId, { nextRunAt: next });
  return { shouldContinue: true, wakeAtMs: next.getTime() };
}

async function fireAndAdvance(
  taskId: string,
  runId: string,
): Promise<{ done: boolean; reason?: string }> {
  "use step";

  const task = await getScheduledTaskById(taskId);
  if (!task) {
    return { done: true, reason: "task-not-found" };
  }
  if (!(await claimLease(taskId, runId))) {
    return { done: true, reason: "run-replaced" };
  }
  if (!task.enabled) {
    await clearScheduledTaskRunIdIfOwned(taskId, runId);
    return { done: true, reason: "task-disabled" };
  }

  await fireScheduledTask(taskId);

  // One-shot tasks self-delete after firing (matches documented behaviour).
  if (task.scheduleKind === "once") {
    await deleteScheduledTask(taskId);
    return { done: true, reason: "once-complete" };
  }

  return { done: false };
}

async function clearLeaseIfOwned(taskId: string, runId: string): Promise<void> {
  "use step";
  await clearScheduledTaskRunIdIfOwned(taskId, runId);
}

/**
 * Durable, self-rescheduling workflow that drives a single scheduled task.
 * Directly adapts sandboxLifecycleWorkflow: claim a lease, sleep until the next
 * occurrence, fire, then loop (recurring) or stop (one-shot). Unlike Claude
 * Code's session-scoped tasks there is no 7-day expiry — these are durable.
 */
export async function scheduledTaskWorkflow(taskId: string) {
  "use workflow";
  // This run's id doubles as the lease token (mirrors how the chat workflow
  // self-claims its activeStreamId). The kicker claims the same id on the row.
  const { workflowRunId: runId } = getWorkflowMetadata();
  while (true) {
    const decision = await computeWakeDecision(taskId, runId);
    if (!decision.shouldContinue || decision.wakeAtMs === undefined) {
      await clearLeaseIfOwned(taskId, runId);
      return { stopped: true, reason: decision.reason ?? "no-decision" };
    }

    const wakeAtMs = Math.max(decision.wakeAtMs, Date.now() + MIN_SLEEP_MS);
    await sleep(new Date(wakeAtMs));

    const result = await fireAndAdvance(taskId, runId);
    if (result.done) {
      await clearLeaseIfOwned(taskId, runId);
      return { stopped: true, reason: result.reason ?? "done" };
    }
  }
}
