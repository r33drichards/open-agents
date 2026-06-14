import { listScheduledTasksByUser } from "@/lib/db/scheduled-tasks";
import { getChatById, getSessionById } from "@/lib/db/sessions";
import { reconcileScheduledTasks } from "@/lib/scheduling/kick-scheduled-task";
import {
  createScheduledTaskStore,
  scheduledTaskToRecord,
} from "@/lib/scheduling/scheduled-task-store";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Safety sweep: re-kick any enabled task whose durable workflow died.
  await reconcileScheduledTasks(session.user.id).catch((error) => {
    console.error("Failed to reconcile scheduled tasks:", error);
  });

  const tasks = await listScheduledTasksByUser(session.user.id);
  return Response.json({ tasks: tasks.map(scheduledTaskToRecord) });
}

interface CreateBody {
  sessionId?: unknown;
  chatId?: unknown;
  prompt?: unknown;
  schedule?: unknown;
  fireMode?: unknown;
  timezone?: unknown;
  modelId?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as CreateBody | null;
  if (!body) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sessionId = asString(body.sessionId);
  const prompt = asString(body.prompt);
  const schedule = asString(body.schedule);
  const fireMode =
    body.fireMode === "fresh-session" ? "fresh-session" : "same-session";
  const timezone = asString(body.timezone);
  const modelId = asString(body.modelId);

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!schedule) {
    return Response.json({ error: "schedule is required" }, { status: 400 });
  }

  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord || sessionRecord.userId !== userId) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  let chatId: string | undefined;
  if (fireMode === "same-session") {
    chatId = asString(body.chatId);
    if (!chatId) {
      return Response.json(
        { error: "chatId is required for same-session tasks" },
        { status: 400 },
      );
    }
    const chat = await getChatById(chatId);
    if (!chat || chat.sessionId !== sessionId) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }
  }

  const store = createScheduledTaskStore({ userId, sessionId, chatId });
  try {
    const task = await store.create({
      prompt,
      schedule,
      fireMode,
      timezone,
      modelId,
    });
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
