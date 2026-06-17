import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { WebAgentUIMessage } from "@/app/types";
import { db } from "./client";
import { type ChatSteerMessage, chatSteerMessages } from "./schema";

export type SteerMessageParts = WebAgentUIMessage["parts"];

export type QueuedSteerMessage = {
  id: string;
  chatId: string;
  parts: SteerMessageParts;
  createdAt: string;
};

function toQueued(row: ChatSteerMessage): QueuedSteerMessage {
  return {
    id: row.id,
    chatId: row.chatId,
    parts: row.parts as SteerMessageParts,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Enqueue a steer message for an in-flight run to pick up between steps. */
export async function enqueueSteerMessage(params: {
  chatId: string;
  userId: string;
  parts: SteerMessageParts;
}): Promise<QueuedSteerMessage> {
  const [row] = await db
    .insert(chatSteerMessages)
    .values({
      id: nanoid(),
      chatId: params.chatId,
      userId: params.userId,
      parts: params.parts,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to enqueue steer message");
  }
  return toQueued(row);
}

/** Unconsumed steer messages for a chat, oldest first (for chips / reconnect). */
export async function listPendingSteerMessages(
  chatId: string,
): Promise<QueuedSteerMessage[]> {
  const rows = await db
    .select()
    .from(chatSteerMessages)
    .where(
      and(
        eq(chatSteerMessages.chatId, chatId),
        isNull(chatSteerMessages.consumedAt),
      ),
    )
    .orderBy(asc(chatSteerMessages.createdAt));
  return rows.map(toQueued);
}

/**
 * Atomically claim all unconsumed steer messages for a chat: mark them consumed
 * and return them, oldest first. The workflow calls this between agent steps.
 * Marking-on-read prevents a reconnecting/duplicate run from replaying them.
 */
export async function drainSteerMessages(
  chatId: string,
): Promise<QueuedSteerMessage[]> {
  const rows = await db
    .update(chatSteerMessages)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(chatSteerMessages.chatId, chatId),
        isNull(chatSteerMessages.consumedAt),
      ),
    )
    .returning();
  return rows
    .map(toQueued)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Delete a still-unconsumed steer message (user removed the chip before the
 * agent picked it up). No-ops if it was already consumed — returns whether a
 * row was removed.
 */
export async function deleteSteerMessage(params: {
  id: string;
  chatId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(chatSteerMessages)
    .where(
      and(
        eq(chatSteerMessages.id, params.id),
        eq(chatSteerMessages.chatId, params.chatId),
        isNull(chatSteerMessages.consumedAt),
      ),
    )
    .returning({ id: chatSteerMessages.id });
  return rows.length > 0;
}
