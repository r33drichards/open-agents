import { tool } from "ai";
import { z } from "zod";
import {
  getSessionResult,
  listGroup,
  readTeamInbox,
  sendTeamMessage,
  spawnSession,
  type TeamStore,
  waitForTeamMessage,
} from "../team/store";

interface TeamStoreContext {
  teamStore?: TeamStore;
}

function getStore(experimental_context: unknown, toolName: string): TeamStore {
  const store = (experimental_context as TeamStoreContext | undefined)
    ?.teamStore;
  if (!store) {
    throw new Error(
      `Team store not available (tool: ${toolName}). Multi-agent teams require a user session.`,
    );
  }
  return store;
}

const messageKindSchema = z
  .enum(["task", "result", "status", "debate", "vote", "broadcast"])
  .describe("Message category (defaults to 'task').");

export const spawnSessionTool = tool({
  description: `Spawn a durable child agent session (a worker or peer) that runs autonomously in its OWN isolated sandbox.

Unlike the in-process \`task\` tool, a spawned session is a real, long-lived session: it keeps running even while you do other work, it has its own filesystem/sandbox, and you can message it back and forth via \`send_message\` / \`read_inbox\`.

Use this to build leader/follower and fan-out architectures: spawn N workers (even in a loop), hand each a slice of the problem, then collect results with \`session_result\` or coordinate live with the message tools.

Be explicit and self-contained in the instructions — the worker runs without you in the loop. Include goals, constraints, file paths/APIs, and how to report back (it can \`send_message\` results to you).`,
  inputSchema: z.object({
    task: z
      .string()
      .describe("Short title for the worker (shown to the user)."),
    instructions: z
      .string()
      .describe(
        "Detailed, self-contained instructions: goal, steps, constraints, and how to report back.",
      ),
    role: z
      .enum(["follower", "peer"])
      .optional()
      .describe(
        "follower (default): worker you coordinate. peer: equal collaborator in a debate/consensus topology.",
      ),
    modelId: z
      .string()
      .optional()
      .describe("Optional model override for the worker."),
  }),
  execute: ({ task, instructions, role, modelId }, { experimental_context }) =>
    spawnSession(getStore(experimental_context, "spawn_session"), {
      task,
      instructions,
      role,
      modelId,
    }),
});

export const listGroupTool = tool({
  description:
    "List the sessions in your team (leader + spawned workers/peers) with their current run state (running/completed/failed).",
  inputSchema: z.object({}),
  execute: (_input, { experimental_context }) =>
    listGroup(getStore(experimental_context, "list_group")),
});

export const sessionResultTool = tool({
  description:
    "Fetch a spawned session's result: whether it has finished and, if so, its final summary. Use list_group to find session ids.",
  inputSchema: z.object({
    sessionId: z.string().describe("The spawned session id to inspect."),
  }),
  execute: ({ sessionId }, { experimental_context }) =>
    getSessionResult(
      getStore(experimental_context, "session_result"),
      sessionId,
    ),
});

export const sendMessageTool = tool({
  description: `Send a message to a worker/peer in your team, or broadcast to everyone (omit toSessionId).

Use this for cross-agent communication: hand a follow-up task to a worker, share findings between peers in a debate round, or request a status update. The recipient receives it in their inbox (read_inbox / wait_for_message).`,
  inputSchema: z.object({
    toSessionId: z
      .string()
      .optional()
      .describe("Recipient session id. Omit to broadcast to the whole group."),
    kind: messageKindSchema.optional(),
    payload: z.string().describe("The message content (text or JSON string)."),
    round: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Coordination/debate round number, if applicable."),
  }),
  execute: ({ toSessionId, kind, payload, round }, { experimental_context }) =>
    sendTeamMessage(getStore(experimental_context, "send_message"), {
      toSessionId,
      kind,
      payload,
      round,
    }),
});

export const readInboxTool = tool({
  description:
    "Read messages in your inbox from other agents (or the human). By default returns unread messages and marks them read.",
  inputSchema: z.object({
    unreadOnly: z
      .boolean()
      .optional()
      .describe("Only return unread messages (default true)."),
    markRead: z
      .boolean()
      .optional()
      .describe("Mark returned messages as read (default true)."),
  }),
  execute: ({ unreadOnly, markRead }, { experimental_context }) =>
    readTeamInbox(getStore(experimental_context, "read_inbox"), {
      unreadOnly: unreadOnly ?? true,
      markRead: markRead ?? true,
    }),
});

export const waitForMessageTool = tool({
  description:
    "Block until a new message arrives in your inbox or the timeout elapses. Use this to wait for a worker to report back or for the next debate round, instead of polling read_inbox in a tight loop.",
  inputSchema: z.object({
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe(
        "Max time to wait in milliseconds (default 60000, max 600000).",
      ),
  }),
  execute: ({ timeoutMs }, { experimental_context }) =>
    waitForTeamMessage(getStore(experimental_context, "wait_for_message"), {
      timeoutMs: timeoutMs ?? 60_000,
    }),
});
