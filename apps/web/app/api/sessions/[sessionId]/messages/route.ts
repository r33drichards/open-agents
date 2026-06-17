import { nanoid } from "nanoid";
import { z } from "zod";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { getSessionGroupId } from "@/lib/db/agent-groups";
import { insertAgentMessage, listGroupMessages } from "@/lib/db/agent-messages";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const postBodySchema = z.object({
  /** Recipient session id; omit to broadcast to the whole group. */
  toSessionId: z.string().optional(),
  kind: z
    .enum(["task", "result", "status", "debate", "vote", "broadcast"])
    .optional(),
  /** Message content (text or JSON string). */
  payload: z.string().min(1, "A message payload is required."),
});

/**
 * Human-in-the-loop participation in an agent team's message bus. The human,
 * viewing a session that belongs to a team, can post a message into the team's
 * inbox (to one member or broadcast). Agents read it via read_inbox /
 * wait_for_message.
 */
export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  let body: z.infer<typeof postBodySchema>;
  try {
    body = postBodySchema.parse(await req.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid request body")
        : "Invalid request body";
    return Response.json({ error: message }, { status: 400 });
  }

  const groupId = await getSessionGroupId(sessionId);
  if (!groupId) {
    return Response.json(
      { error: "This session is not part of an agent team." },
      { status: 409 },
    );
  }

  const message = await insertAgentMessage({
    id: nanoid(),
    groupId,
    fromSessionId: null,
    toSessionId: body.toSessionId ?? null,
    senderRole: "human",
    kind: body.kind ?? "task",
    payload: body.payload,
    round: 0,
  });

  return Response.json({ message }, { status: 201 });
}

/** List the team's messages (newest first) for rendering in the chat UI. */
export async function GET(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const groupId = await getSessionGroupId(sessionId);
  if (!groupId) {
    return Response.json({ messages: [] });
  }

  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 100, 500) : 100;
  const messages = await listGroupMessages({ groupId, limit });

  return Response.json({ messages });
}
