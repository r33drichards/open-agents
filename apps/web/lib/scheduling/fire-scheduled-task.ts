import "server-only";

import { generateId } from "ai";
import { nanoid } from "nanoid";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import { runAgentWorkflow } from "@/app/workflows/chat";
import {
  getScheduledTaskById,
  updateScheduledTask,
} from "@/lib/db/scheduled-tasks";
import {
  createSessionWithInitialChat,
  getSessionById,
} from "@/lib/db/sessions";

export interface FireResult {
  fired: boolean;
  reason?: string;
  chatId?: string;
  sessionId?: string;
  runId?: string;
}

function buildPromptMessage(prompt: string): WebAgentUIMessage {
  return {
    id: generateId(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  };
}

/**
 * Resolve the chat the prompt should run in. For same-session tasks this is the
 * task's own chat; for fresh-session tasks a brand-new session + chat is created
 * by cloning the home session's repo configuration.
 */
async function resolveFireTarget(
  taskId: string,
): Promise<
  | { ok: true; chatId: string; sessionId: string }
  | { ok: false; reason: string }
> {
  const task = await getScheduledTaskById(taskId);
  if (!task) {
    return { ok: false, reason: "task-not-found" };
  }
  if (!task.enabled) {
    return { ok: false, reason: "task-disabled" };
  }

  const home = await getSessionById(task.sessionId);
  if (!home || home.status === "archived") {
    return { ok: false, reason: "home-session-unavailable" };
  }

  if (task.fireMode === "same-session") {
    if (!task.chatId) {
      return { ok: false, reason: "missing-target-chat" };
    }
    return { ok: true, chatId: task.chatId, sessionId: task.sessionId };
  }

  // fresh-session: clone the home session's repo/vercel config into a new run.
  // New sessions provision a fresh Vercel sandbox (matching the sessions route);
  // provisioning fills in the rest of the sandbox state.
  const { session, chat } = await createSessionWithInitialChat({
    session: {
      id: nanoid(),
      userId: task.userId,
      title: `Scheduled: ${home.title}`,
      status: "running",
      repoOwner: home.repoOwner,
      repoName: home.repoName,
      branch: home.branch,
      cloneUrl: home.cloneUrl,
      vercelProjectId: home.vercelProjectId,
      vercelProjectName: home.vercelProjectName,
      vercelTeamId: home.vercelTeamId,
      vercelTeamSlug: home.vercelTeamSlug,
      isNewBranch: home.isNewBranch,
      autoCommitPushOverride: home.autoCommitPushOverride,
      autoCreatePrOverride: home.autoCreatePrOverride,
      globalSkillRefs: home.globalSkillRefs,
      sandboxState: { type: "vercel" },
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
    },
    initialChat: {
      id: nanoid(),
      title: "Scheduled run",
      modelId: task.modelId ?? undefined,
    },
  });

  return { ok: true, chatId: chat.id, sessionId: session.id };
}

/**
 * Fire a scheduled task once: start the agent workflow with the task's prompt in
 * the resolved chat. The workflow itself wakes (provisions/restores) the sandbox
 * and exits cleanly if another run is already active on that chat, so firing
 * never interrupts in-progress work.
 */
export async function fireScheduledTask(taskId: string): Promise<FireResult> {
  const task = await getScheduledTaskById(taskId);
  if (!task) {
    return { fired: false, reason: "task-not-found" };
  }

  const target = await resolveFireTarget(taskId);
  if (!target.ok) {
    return { fired: false, reason: target.reason };
  }

  const message = buildPromptMessage(task.prompt);
  const run = await start(runAgentWorkflow, [
    {
      messages: [message],
      chatId: target.chatId,
      sessionId: target.sessionId,
      userId: task.userId,
      requestUrl: "",
      authSession: null,
      assistantId: generateId(),
      maxSteps: 500,
    },
  ]);

  await updateScheduledTask(taskId, {
    lastRunAt: new Date(),
    lastRunChatId: target.chatId,
    lastRunSessionId: target.sessionId,
  });

  return {
    fired: true,
    chatId: target.chatId,
    sessionId: target.sessionId,
    runId: run.runId,
  };
}
