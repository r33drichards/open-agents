/**
 * Multi-agent teams: a leader agent can spawn durable child sessions (workers /
 * peers), each with its own isolated sandbox, and coordinate with them through a
 * durable message bus (mailboxes). These primitives let the leader build any of
 * the canonical topologies — leader/follower, fan-out, peer debate — directly
 * from its own loop.
 *
 * Like the scheduling and skill-authoring modules, this file is intentionally
 * free of `ai`/SDK and DB imports so its logic can be unit tested directly. The
 * `tool()` wrappers live in `../tools/team.ts`; durable storage, child-session
 * spawning, and workflow handles are provided by the host app via the
 * {@link TeamStore} port (injected through `experimental_context`).
 */

export type SpawnedSessionState =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type AgentTeamRole = "leader" | "follower" | "peer";

export type AgentTeamMessageSenderRole = AgentTeamRole | "human" | "system";

export type AgentTeamMessageKind =
  | "task"
  | "result"
  | "status"
  | "debate"
  | "vote"
  | "broadcast";

export interface SpawnedSessionRecord {
  sessionId: string;
  title: string;
  groupRole: AgentTeamRole;
  state: SpawnedSessionState;
}

export interface SpawnSessionInput {
  /** Short title shown in the UI. */
  task: string;
  /** Detailed instructions/prompt the worker runs autonomously. */
  instructions: string;
  /** Spawn as a "follower" (default) or "peer". */
  role?: "follower" | "peer";
  /** Optional model override for the worker. */
  modelId?: string;
}

export interface AgentTeamMessageRecord {
  id: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  senderRole: AgentTeamMessageSenderRole;
  kind: AgentTeamMessageKind;
  payload: unknown;
  round: number;
  createdAt: string;
}

export interface SendMessageInput {
  /** Recipient session id; omit to broadcast to the whole group. */
  toSessionId?: string;
  kind?: AgentTeamMessageKind;
  payload: unknown;
  round?: number;
}

export interface SessionResult {
  done: boolean;
  state: SpawnedSessionState;
  summary?: string;
}

/**
 * Durable store for multi-agent team operations, injected by the host app. The
 * agent package never touches the DB, sandboxes, or the durable workflow engine.
 */
export interface TeamStore {
  spawn(input: SpawnSessionInput): Promise<SpawnedSessionRecord>;
  /** The id of the group this session belongs to, or null if it has none yet. */
  groupId(): Promise<string | null>;
  list(): Promise<SpawnedSessionRecord[]>;
  status(sessionId: string): Promise<SpawnedSessionRecord | null>;
  result(sessionId: string): Promise<SessionResult>;
  send(input: SendMessageInput): Promise<void>;
  readInbox(input?: {
    unreadOnly?: boolean;
    markRead?: boolean;
  }): Promise<AgentTeamMessageRecord[]>;
  waitForMessage(input: {
    timeoutMs: number;
  }): Promise<AgentTeamMessageRecord | null>;
}

export type TeamResult =
  | { success: true; session: SpawnedSessionRecord }
  | {
      success: true;
      sessions: SpawnedSessionRecord[];
      groupId: string | null;
    }
  | { success: true; result: SessionResult }
  | { success: true; messages: AgentTeamMessageRecord[] }
  | { success: true; message: AgentTeamMessageRecord | null }
  | { success: true; sent: true }
  | { success: false; error: string };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Spawn a durable child session (worker/peer). */
export async function spawnSession(
  store: TeamStore,
  input: SpawnSessionInput,
): Promise<TeamResult> {
  if (!nonEmpty(input.task)) {
    return { success: false, error: "A task title is required." };
  }
  if (!nonEmpty(input.instructions)) {
    return {
      success: false,
      error: "Instructions for the worker are required.",
    };
  }
  try {
    const session = await store.spawn(input);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** List sessions in the leader's group with their current state. */
export async function listGroup(store: TeamStore): Promise<TeamResult> {
  try {
    const [sessions, groupId] = await Promise.all([
      store.list(),
      store.groupId(),
    ]);
    return { success: true, sessions, groupId };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Fetch one child session's result/summary. */
export async function getSessionResult(
  store: TeamStore,
  sessionId: string,
): Promise<TeamResult> {
  if (!nonEmpty(sessionId)) {
    return { success: false, error: "A session id is required." };
  }
  try {
    const result = await store.result(sessionId);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Send a message to a worker/peer (or broadcast to the whole group). */
export async function sendTeamMessage(
  store: TeamStore,
  input: SendMessageInput,
): Promise<TeamResult> {
  if (input.payload === undefined || input.payload === null) {
    return { success: false, error: "A message payload is required." };
  }
  try {
    await store.send(input);
    return { success: true, sent: true };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Read the leader's (or worker's) inbox. */
export async function readTeamInbox(
  store: TeamStore,
  input?: { unreadOnly?: boolean; markRead?: boolean },
): Promise<TeamResult> {
  try {
    const messages = await store.readInbox(input);
    return { success: true, messages };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Block (poll) until a new inbox message arrives or the timeout elapses. */
export async function waitForTeamMessage(
  store: TeamStore,
  input: { timeoutMs: number },
): Promise<TeamResult> {
  try {
    const message = await store.waitForMessage(input);
    return { success: true, message };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
