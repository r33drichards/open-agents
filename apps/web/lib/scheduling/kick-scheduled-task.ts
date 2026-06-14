import "server-only";

import { getRun, start } from "workflow/api";
import { scheduledTaskWorkflow } from "@/app/workflows/scheduled-task";
import {
  claimScheduledTaskRunId,
  clearScheduledTaskRunIdIfOwned,
  getScheduledTaskById,
  listScheduledTasksByUser,
} from "@/lib/db/scheduled-tasks";

type KickResult =
  | { status: "started" | "existing"; runId: string }
  | { status: "skipped"; runId?: undefined };

async function isRunStillLive(runId: string): Promise<boolean> {
  try {
    const run = getRun(runId);
    if (!(await run.exists)) {
      return false;
    }
    const status = await run.status;
    return status === "pending" || status === "running";
  } catch {
    return false;
  }
}

/**
 * Start the durable scheduler workflow for a task, or reattach to the live one.
 * Mirrors kickSandboxProvisioningWorkflow: start-then-atomically-claim, and
 * cancel the duplicate run if another kick won the race.
 */
export async function kickScheduledTaskWorkflow(
  taskId: string,
): Promise<KickResult> {
  const task = await getScheduledTaskById(taskId);
  if (!task || !task.enabled) {
    return { status: "skipped" };
  }

  if (task.schedulerRunId) {
    if (await isRunStillLive(task.schedulerRunId)) {
      return { status: "existing", runId: task.schedulerRunId };
    }
    await clearScheduledTaskRunIdIfOwned(taskId, task.schedulerRunId);
  }

  const run = await start(scheduledTaskWorkflow, [taskId]);
  const claimed = await claimScheduledTaskRunId(taskId, run.runId);
  if (claimed) {
    return { status: "started", runId: run.runId };
  }

  // Another kick claimed the slot first. If it claimed our own run, keep it;
  // otherwise defer to the existing run and cancel this duplicate.
  const latest = await getScheduledTaskById(taskId);
  if (latest?.schedulerRunId === run.runId) {
    return { status: "started", runId: run.runId };
  }
  if (latest?.schedulerRunId) {
    try {
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cleanup for a duplicate run.
    }
    return { status: "existing", runId: latest.schedulerRunId };
  }

  return { status: "skipped" };
}

/**
 * Stop a task's durable scheduler workflow immediately (used when disabling or
 * deleting). Cancels the run so it stops sleeping, and releases the lease.
 */
export async function stopScheduledTaskWorkflow(taskId: string): Promise<void> {
  const task = await getScheduledTaskById(taskId);
  if (!task?.schedulerRunId) {
    return;
  }
  try {
    getRun(task.schedulerRunId).cancel();
  } catch {
    // Best-effort: the run may already be gone.
  }
  await clearScheduledTaskRunIdIfOwned(taskId, task.schedulerRunId);
}

/**
 * Re-kick any enabled tasks whose scheduler workflow is no longer live (e.g.
 * after the owning run crashed). Durable workflows normally survive on their
 * own, so this is a safety sweep called when listing tasks.
 */
export async function reconcileScheduledTasks(userId: string): Promise<void> {
  const tasks = await listScheduledTasksByUser(userId);
  await Promise.all(
    tasks
      .filter((task) => task.enabled)
      .map(async (task) => {
        if (
          task.schedulerRunId &&
          (await isRunStillLive(task.schedulerRunId))
        ) {
          return;
        }
        await kickScheduledTaskWorkflow(task.id).catch((error) => {
          console.error(
            `Failed to reconcile scheduled task ${task.id}:`,
            error,
          );
        });
      }),
  );
}
