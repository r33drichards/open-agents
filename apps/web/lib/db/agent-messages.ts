import "server-only";

import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { agentMessages, type NewAgentMessage } from "./schema";
import { db } from "./client";

export async function insertAgentMessage(data: NewAgentMessage) {
  const [message] = await db.insert(agentMessages).values(data).returning();
  if (!message) {
    throw new Error("Failed to insert agent message");
  }
  return message;
}

/**
 * Reads a session's inbox: messages addressed directly to it plus group
 * broadcasts (toSessionId IS NULL). Optionally filters to unread only.
 */
export async function readSessionInbox(params: {
  groupId: string;
  sessionId: string;
  unreadOnly?: boolean;
  limit?: number;
}) {
  const recipientMatch = or(
    eq(agentMessages.toSessionId, params.sessionId),
    isNull(agentMessages.toSessionId),
  );
  const where = params.unreadOnly
    ? and(
        eq(agentMessages.groupId, params.groupId),
        recipientMatch,
        eq(agentMessages.status, "unread"),
      )
    : and(eq(agentMessages.groupId, params.groupId), recipientMatch);

  const query = db
    .select()
    .from(agentMessages)
    .where(where)
    .orderBy(asc(agentMessages.createdAt));

  return params.limit ? query.limit(params.limit) : query;
}

/** Reads all messages exchanged in a given round (for debate/peer rounds). */
export async function readGroupRound(params: {
  groupId: string;
  round: number;
}) {
  return db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.groupId, params.groupId),
        eq(agentMessages.round, params.round),
      ),
    )
    .orderBy(asc(agentMessages.createdAt));
}

export async function markInboxRead(params: {
  groupId: string;
  sessionId: string;
}) {
  await db
    .update(agentMessages)
    .set({ status: "read", readAt: new Date() })
    .where(
      and(
        eq(agentMessages.groupId, params.groupId),
        or(
          eq(agentMessages.toSessionId, params.sessionId),
          isNull(agentMessages.toSessionId),
        ),
        eq(agentMessages.status, "unread"),
      ),
    );
}

/** Lists a group's messages (newest first) for display in the chat UI. */
export async function listGroupMessages(params: {
  groupId: string;
  limit?: number;
}) {
  const query = db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.groupId, params.groupId))
    .orderBy(desc(agentMessages.createdAt));
  return params.limit ? query.limit(params.limit) : query;
}

/**
 * Returns inbox messages created after `since`, used by waitForMessage polling.
 */
export async function readInboxSince(params: {
  groupId: string;
  sessionId: string;
  since: Date;
}) {
  return db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.groupId, params.groupId),
        or(
          eq(agentMessages.toSessionId, params.sessionId),
          isNull(agentMessages.toSessionId),
        ),
        gt(agentMessages.createdAt, params.since),
      ),
    )
    .orderBy(asc(agentMessages.createdAt));
}
