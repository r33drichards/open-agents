import "server-only";

import { generateId } from "ai";
import { nanoid } from "nanoid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { runAgentWorkflow } from "@/app/workflows/chat";
import type { AgentGroupRole } from "@/lib/agents/types";
import {
  createSessionWithInitialChat,
  getSessionById,
} from "@/lib/db/sessions";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export interface SpawnChildSessionInput {
  /** The session spawning this child (config + isolation are derived from it). */
  parentSessionId: string;
  /** Group this child joins; the child is stamped with groupId + groupRole. */
  groupId: string;
  groupRole: AgentGroupRole;
  /** Display title for the child session. */
  title: string;
  /** Initial prompt the child agent runs. */
  prompt: string;
  /** Model override; falls back to the parent's most-recent chat model. */
  modelId?: string;
  /** Max agent steps for the child run (defaults high, like scheduled tasks). */
  maxSteps?: number;
}

export interface SpawnChildSessionResult {
  sessionId: string;
  chatId: string;
  runId: string;
}

function buildPromptMessage(prompt: string): WebAgentUIMessage {
  return {
    id: generateId(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  };
}

/**
 * Spawn a durable child session that runs an agent on `prompt`. Each child gets
 * a FRESH, ISOLATED sandbox (sandboxState: { type: "vercel" }) cloned from the
 * parent's repo configuration — the same isolation the sessions route and
 * scheduled fresh-session tasks rely on. The agent workflow itself provisions
 * the sandbox on first step.
 *
 * Generalizes the spawn path of fireScheduledTask for multi-agent teams.
 */
export async function spawnChildSession(
  input: SpawnChildSessionInput,
): Promise<SpawnChildSessionResult> {
  const parent = await getSessionById(input.parentSessionId);
  if (!parent) {
    throw new Error("Parent session not found");
  }
  if (parent.status === "archived") {
    throw new Error("Parent session is archived");
  }

  const childSessionId = nanoid();
  const childChatId = nanoid();

  const { session, chat } = await createSessionWithInitialChat({
    session: {
      id: childSessionId,
      userId: parent.userId,
      title: input.title,
      status: "running",
      repoOwner: parent.repoOwner,
      repoName: parent.repoName,
      branch: parent.branch,
      cloneUrl: parent.cloneUrl,
      vercelProjectId: parent.vercelProjectId,
      vercelProjectName: parent.vercelProjectName,
      vercelTeamId: parent.vercelTeamId,
      vercelTeamSlug: parent.vercelTeamSlug,
      isNewBranch: parent.isNewBranch,
      autoCommitPushOverride: parent.autoCommitPushOverride,
      autoCreatePrOverride: parent.autoCreatePrOverride,
      globalSkillRefs: parent.globalSkillRefs,
      // Genealogy + team membership.
      parentSessionId: parent.id,
      groupId: input.groupId,
      groupRole: input.groupRole,
      // Fresh isolated sandbox per child.
      sandboxState: { type: "vercel" },
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
    },
    initialChat: {
      id: childChatId,
      title: input.title,
      modelId: input.modelId ?? undefined,
    },
  });

  const message = buildPromptMessage(input.prompt);
  const run = await start(runAgentWorkflow, [
    {
      messages: [message],
      chatId: chat.id,
      sessionId: session.id,
      userId: parent.userId,
      requestUrl: "",
      authSession: null,
      assistantId: generateId(),
      maxSteps: input.maxSteps ?? 500,
    },
  ]);

  return { sessionId: session.id, chatId: chat.id, runId: run.runId };
}

/**
 * Walk the parentSessionId chain to estimate spawn depth (root = 0). Bounded by
 * `max` hops so a runaway chain can't turn this into an unbounded query. Used to
 * cap recursive spawning.
 */
export async function getSessionDepth(
  sessionId: string,
  max: number,
): Promise<number> {
  let depth = 0;
  let current = await getSessionById(sessionId);
  while (current?.parentSessionId && depth <= max) {
    depth += 1;
    if (depth > max) {
      break;
    }
    current = await getSessionById(current.parentSessionId);
  }
  return depth;
}

/** Re-run an existing child session with a new prompt (e.g. a coordination round). */
export async function rerunChildSession(params: {
  sessionId: string;
  chatId: string;
  userId: string;
  prompt: string;
  maxSteps?: number;
}): Promise<{ runId: string }> {
  const message = buildPromptMessage(params.prompt);
  const run = await start(runAgentWorkflow, [
    {
      messages: [message],
      chatId: params.chatId,
      sessionId: params.sessionId,
      userId: params.userId,
      requestUrl: "",
      authSession: null,
      assistantId: generateId(),
      maxSteps: params.maxSteps ?? 500,
    },
  ]);
  return { runId: run.runId };
}

/** Mark follower/peer sessions in a group archived (cleanup on group end). */
export async function archiveGroupFollowers(groupId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(sessions.groupId, groupId),
        inArray(sessions.groupRole, ["follower", "peer"]),
      ),
    );
}
