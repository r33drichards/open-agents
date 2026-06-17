import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/sessions/_lib/session-context";
import { deleteSteerMessage } from "@/lib/db/chat-steer";

type RouteContext = {
  params: Promise<{ sessionId: string; chatId: string; steerId: string }>;
};

export type DeleteSteerResponse = {
  /** False if the message was already consumed by the run (chip resolves inline). */
  removed: boolean;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId, chatId, steerId } = await context.params;

  const chatContext = await requireOwnedSessionChat({
    userId: authResult.userId,
    sessionId,
    chatId,
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const removed = await deleteSteerMessage({ id: steerId, chatId });
  const response: DeleteSteerResponse = { removed };
  return Response.json(response);
}
