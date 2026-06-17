import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import type { WebAgentUIMessage } from "@/app/types";
import {
  enqueueSteerMessage,
  listPendingSteerMessages,
  type QueuedSteerMessage,
  type SteerMessageParts,
} from "@/lib/db/chat-steer";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string }>;
};

export type EnqueueSteerRequest = {
  parts: SteerMessageParts;
};

export type EnqueueSteerResponse = {
  queued: QueuedSteerMessage;
};

export type PendingSteerResponse = {
  pending: QueuedSteerMessage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A queued steer message must carry at least one non-empty text part. */
function hasRenderableText(parts: WebAgentUIMessage["parts"]): boolean {
  return parts.some(
    (part) =>
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0,
  );
}

export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parts =
    isRecord(body) && Array.isArray(body.parts)
      ? (body.parts as WebAgentUIMessage["parts"])
      : null;
  if (!parts || parts.length === 0 || !hasRenderableText(parts)) {
    return Response.json(
      { error: "A non-empty message is required" },
      { status: 400 },
    );
  }

  const queued = await enqueueSteerMessage({
    chatId,
    userId: authResult.userId,
    parts,
  });

  const response: EnqueueSteerResponse = { queued };
  return Response.json(response);
}

export async function GET(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const pending = await listPendingSteerMessages(chatId);
  const response: PendingSteerResponse = { pending };
  return Response.json(response);
}
