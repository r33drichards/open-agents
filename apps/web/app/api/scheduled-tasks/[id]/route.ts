import {
  deleteScheduledTask,
  getScheduledTaskById,
  updateScheduledTask,
} from "@/lib/db/scheduled-tasks";
import type { ScheduledTask } from "@/lib/db/schema";
import {
  computeNextRun,
  DEFAULT_TIMEZONE,
  parseScheduleInput,
} from "@/lib/scheduling/cron";
import {
  kickScheduledTaskWorkflow,
  stopScheduledTaskWorkflow,
} from "@/lib/scheduling/kick-scheduled-task";
import { scheduledTaskToRecord } from "@/lib/scheduling/scheduled-task-store";
import { getServerSession } from "@/lib/session/get-server-session";

type RouteContext = { params: Promise<{ id: string }> };

async function loadOwnedTask(
  id: string,
  userId: string,
): Promise<ScheduledTask | null> {
  const task = await getScheduledTaskById(id);
  if (!task || task.userId !== userId) {
    return null;
  }
  return task;
}

interface PatchBody {
  enabled?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  fireMode?: unknown;
  timezone?: unknown;
  modelId?: unknown;
}

export async function PATCH(req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await context.params;
  const task = await loadOwnedTask(id, session.user.id);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: Partial<Omit<ScheduledTask, "id" | "userId" | "createdAt">> = {};

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    patch.prompt = body.prompt.trim();
  }
  if (body.fireMode === "same-session" || body.fireMode === "fresh-session") {
    if (body.fireMode === "same-session" && !task.chatId) {
      return Response.json(
        {
          error: "Cannot switch to same-session: this task has no target chat.",
        },
        { status: 400 },
      );
    }
    patch.fireMode = body.fireMode;
  }
  if (typeof body.modelId === "string") {
    patch.modelId = body.modelId.trim() || null;
  }

  if (typeof body.schedule === "string" && body.schedule.trim()) {
    const timezone =
      (typeof body.timezone === "string" && body.timezone.trim()) ||
      task.timezone ||
      DEFAULT_TIMEZONE;
    try {
      const now = new Date();
      const parsed = parseScheduleInput({
        schedule: body.schedule,
        now,
        timezone,
      });
      const nextRunAt = computeNextRun(parsed, now, timezone);
      if (!nextRunAt) {
        return Response.json(
          { error: "That schedule has no upcoming run." },
          { status: 400 },
        );
      }
      patch.scheduleKind = parsed.scheduleKind;
      patch.cronExpression = parsed.cronExpression;
      patch.fireAt = parsed.fireAt;
      patch.timezone = timezone;
      patch.nextRunAt = nextRunAt;
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  } else if (typeof body.timezone === "string" && body.timezone.trim()) {
    patch.timezone = body.timezone.trim();
  }

  const updated = await updateScheduledTask(id, patch);
  if (!updated) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  // Re-sync the durable workflow: stop the current run, then restart it if the
  // task is still enabled so it picks up any schedule change.
  await stopScheduledTaskWorkflow(id);
  if (updated.enabled) {
    await kickScheduledTaskWorkflow(id).catch((error) => {
      console.error(`Failed to restart scheduler for task ${id}:`, error);
    });
  }

  return Response.json({ task: scheduledTaskToRecord(updated) });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await context.params;
  const task = await loadOwnedTask(id, session.user.id);
  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  await stopScheduledTaskWorkflow(id);
  await deleteScheduledTask(id);
  return Response.json({ ok: true });
}
