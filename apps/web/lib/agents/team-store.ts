import "server-only";

import { nanoid } from "nanoid";
import type {
  AgentTeamMessageRecord,
  SendMessageInput,
  SessionResult,
  SpawnedSessionRecord,
  SpawnedSessionState,
  SpawnSessionInput,
  TeamStore,
} from "@open-agents/agent";
import {
  ensureAgentGroupForLeader,
  getAgentGroupByLeaderSessionId,
  getGroupSessions,
} from "@/lib/db/agent-groups";
import {
  insertAgentMessage,
  markInboxRead,
  readInboxSince,
  readSessionInbox,
} from "@/lib/db/agent-messages";
import {
  getChatsBySessionId,
  getChatMessages,
  getSessionById,
} from "@/lib/db/sessions";
import type { AgentMessage, Session } from "@/lib/db/schema";
import { MAX_GROUP_AGENTS, MAX_SPAWN_DEPTH } from "@/lib/agents/types";
import { getSessionDepth, spawnChildSession } from "@/lib/sessions/spawn-child";

function extractAssistantText(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      texts.push(part.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/** Map a session + its chats' streaming state to a coarse run state. */
async function deriveSessionState(
  session: Session,
): Promise<SpawnedSessionState> {
  if (session.status === "archived") {
    return "cancelled";
  }
  if (session.status === "failed") {
    return "failed";
  }
  const chats = await getChatsBySessionId(session.id);
  const isStreaming = chats.some((chat) => chat.activeStreamId != null);
  return isStreaming ? "running" : "completed";
}

function toMessageRecord(message: AgentMessage): AgentTeamMessageRecord {
  return {
    id: message.id,
    fromSessionId: message.fromSessionId,
    toSessionId: message.toSessionId,
    senderRole: message.senderRole,
    kind: message.kind,
    payload: message.payload,
    round: message.round,
    createdAt: message.createdAt.toISOString(),
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * DB-backed implementation of the agent's {@link TeamStore} port, scoped to the
 * acting session. Constructed inside the agent step and passed in-process
 * (mirrors createScheduledTaskStore / createUserSkillStore).
 */
export function createTeamStore(params: {
  userId: string;
  sessionId: string;
  chatId: string;
}): TeamStore {
  /** Resolve the group this session belongs to (as leader or member). */
  async function resolveGroupId(): Promise<string | null> {
    const session = await getSessionById(params.sessionId);
    if (session?.groupId) {
      return session.groupId;
    }
    const led = await getAgentGroupByLeaderSessionId(params.sessionId);
    return led?.id ?? null;
  }

  async function resolveSenderRole(): Promise<"leader" | "follower" | "peer"> {
    const session = await getSessionById(params.sessionId);
    return session?.groupRole ?? "leader";
  }

  return {
    spawn: async (input: SpawnSessionInput): Promise<SpawnedSessionRecord> => {
      const depth = await getSessionDepth(
        params.sessionId,
        MAX_SPAWN_DEPTH + 1,
      );
      if (depth >= MAX_SPAWN_DEPTH) {
        throw new Error(
          `Spawn depth limit reached (max ${MAX_SPAWN_DEPTH}). This worker cannot spawn further sub-agents.`,
        );
      }

      // Ad-hoc spawning is a leader-coordinated (centralized) topology by
      // default; run_team sets a specific architecture when used.
      const group = await ensureAgentGroupForLeader({
        userId: params.userId,
        leaderSessionId: params.sessionId,
        architecture: "centralized",
        groupId: nanoid(),
      });

      const members = await getGroupSessions(group.id);
      const followerCount = members.filter(
        (m) => m.groupRole === "follower" || m.groupRole === "peer",
      ).length;
      if (followerCount >= MAX_GROUP_AGENTS) {
        throw new Error(`Group agent limit reached (max ${MAX_GROUP_AGENTS}).`);
      }

      const role = input.role ?? "follower";
      const spawned = await spawnChildSession({
        parentSessionId: params.sessionId,
        groupId: group.id,
        groupRole: role,
        title: input.task,
        prompt: input.instructions,
        modelId: input.modelId,
      });

      return {
        sessionId: spawned.sessionId,
        title: input.task,
        groupRole: role,
        state: "running",
      };
    },

    list: async (): Promise<SpawnedSessionRecord[]> => {
      const groupId = await resolveGroupId();
      if (!groupId) {
        return [];
      }
      const members = await getGroupSessions(groupId);
      return Promise.all(
        members.map(async (session) => ({
          sessionId: session.id,
          title: session.title,
          groupRole: (session.groupRole ?? "follower") as
            | "leader"
            | "follower"
            | "peer",
          state: await deriveSessionState(session),
        })),
      );
    },

    status: async (sessionId: string): Promise<SpawnedSessionRecord | null> => {
      const session = await getSessionById(sessionId);
      if (!session) {
        return null;
      }
      return {
        sessionId: session.id,
        title: session.title,
        groupRole: (session.groupRole ?? "follower") as
          | "leader"
          | "follower"
          | "peer",
        state: await deriveSessionState(session),
      };
    },

    result: async (sessionId: string): Promise<SessionResult> => {
      const session = await getSessionById(sessionId);
      if (!session) {
        return { done: true, state: "unknown" };
      }
      const state = await deriveSessionState(session);
      const done = state !== "running";
      if (!done) {
        return { done: false, state };
      }
      const chats = await getChatsBySessionId(sessionId);
      const primaryChat = chats[0];
      if (!primaryChat) {
        return { done: true, state };
      }
      const messages = await getChatMessages(primaryChat.id);
      const lastAssistant = messages.findLast((m) => m.role === "assistant");
      const summary = lastAssistant
        ? extractAssistantText(lastAssistant.parts)
        : undefined;
      return { done: true, state, summary };
    },

    send: async (input: SendMessageInput): Promise<void> => {
      const groupId = await resolveGroupId();
      if (!groupId) {
        throw new Error(
          "No team to message yet. Spawn a worker with spawn_session first.",
        );
      }
      const senderRole = await resolveSenderRole();
      await insertAgentMessage({
        id: nanoid(),
        groupId,
        fromSessionId: params.sessionId,
        toSessionId: input.toSessionId ?? null,
        senderRole,
        kind: input.kind ?? "task",
        payload: input.payload,
        round: input.round ?? 0,
      });
    },

    readInbox: async (input): Promise<AgentTeamMessageRecord[]> => {
      const groupId = await resolveGroupId();
      if (!groupId) {
        return [];
      }
      const messages = await readSessionInbox({
        groupId,
        sessionId: params.sessionId,
        unreadOnly: input?.unreadOnly ?? true,
      });
      if (input?.markRead ?? true) {
        await markInboxRead({ groupId, sessionId: params.sessionId });
      }
      return messages.map(toMessageRecord);
    },

    waitForMessage: async (input): Promise<AgentTeamMessageRecord | null> => {
      const groupId = await resolveGroupId();
      if (!groupId) {
        return null;
      }
      const deadline = Date.now() + input.timeoutMs;
      const since = new Date();
      const pollMs = 1000;
      while (Date.now() < deadline) {
        const fresh = await readInboxSince({
          groupId,
          sessionId: params.sessionId,
          since,
        });
        const first = fresh[0];
        if (first) {
          await markInboxRead({ groupId, sessionId: params.sessionId });
          return toMessageRecord(first);
        }
        await delay(pollMs);
      }
      return null;
    },
  };
}
