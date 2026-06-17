import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { AgentArchitecture, AgentGroupConfig } from "@/lib/agents/types";
import { db } from "./client";
import { agentGroups, type NewAgentGroup, sessions } from "./schema";

export async function getAgentGroupById(groupId: string) {
  return db.query.agentGroups.findFirst({
    where: eq(agentGroups.id, groupId),
  });
}

export async function getAgentGroupByLeaderSessionId(leaderSessionId: string) {
  return db.query.agentGroups.findFirst({
    where: eq(agentGroups.leaderSessionId, leaderSessionId),
  });
}

export async function createAgentGroup(data: NewAgentGroup) {
  const [group] = await db.insert(agentGroups).values(data).returning();
  if (!group) {
    throw new Error("Failed to create agent group");
  }
  return group;
}

/**
 * Returns the agent group led by `leaderSessionId`, creating one if absent.
 * Used by the low-level spawn tools so a leader can begin spawning workers
 * without first declaring a formal team. Also stamps the leader session's
 * groupId/groupRole.
 */
export async function ensureAgentGroupForLeader(params: {
  userId: string;
  leaderSessionId: string;
  architecture: AgentArchitecture;
  config?: AgentGroupConfig;
  groupId: string;
}) {
  const existing = await getAgentGroupByLeaderSessionId(params.leaderSessionId);
  if (existing) {
    return existing;
  }

  const group = await createAgentGroup({
    id: params.groupId,
    userId: params.userId,
    leaderSessionId: params.leaderSessionId,
    architecture: params.architecture,
    config: params.config ?? {},
  });

  await db
    .update(sessions)
    .set({ groupId: group.id, groupRole: "leader", updatedAt: new Date() })
    .where(eq(sessions.id, params.leaderSessionId));

  return group;
}

export async function updateAgentGroup(
  groupId: string,
  data: Partial<Omit<NewAgentGroup, "id" | "userId" | "createdAt">>,
) {
  const [group] = await db
    .update(agentGroups)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentGroups.id, groupId))
    .returning();
  return group;
}

/**
 * Atomically claims the orchestration lease when no run is currently recorded.
 * Mirrors claimSessionLifecycleRunId. Returns true when the claim succeeds.
 */
export async function claimAgentGroupOrchestrationRunId(
  groupId: string,
  runId: string,
) {
  const [updated] = await db
    .update(agentGroups)
    .set({ orchestrationRunId: runId, updatedAt: new Date() })
    .where(
      and(eq(agentGroups.id, groupId), isNull(agentGroups.orchestrationRunId)),
    )
    .returning({ id: agentGroups.id });

  return Boolean(updated);
}

/** Sessions that belong to a group (leader + followers/peers). */
export async function getGroupSessions(groupId: string) {
  return db.query.sessions.findMany({
    where: eq(sessions.groupId, groupId),
  });
}
