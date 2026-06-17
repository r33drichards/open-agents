import { describe, expect, test } from "bun:test";
import {
  getSessionResult,
  listGroup,
  readTeamInbox,
  sendTeamMessage,
  spawnSession,
  type AgentTeamMessageRecord,
  type SpawnedSessionRecord,
  type TeamStore,
  waitForTeamMessage,
} from "./store";

interface FakeState {
  sessions: SpawnedSessionRecord[];
  messages: AgentTeamMessageRecord[];
  spawnError?: string;
}

function fakeStore(state: FakeState): TeamStore {
  let counter = 0;
  return {
    spawn: (input) => {
      if (state.spawnError) {
        return Promise.reject(new Error(state.spawnError));
      }
      counter += 1;
      const record: SpawnedSessionRecord = {
        sessionId: `s${counter}`,
        title: input.task,
        groupRole: input.role ?? "follower",
        state: "running",
      };
      state.sessions.push(record);
      return Promise.resolve(record);
    },
    list: () => Promise.resolve(state.sessions),
    status: (sessionId) =>
      Promise.resolve(
        state.sessions.find((s) => s.sessionId === sessionId) ?? null,
      ),
    result: (sessionId) => {
      const found = state.sessions.find((s) => s.sessionId === sessionId);
      return Promise.resolve(
        found
          ? {
              done: found.state !== "running",
              state: found.state,
              summary: "ok",
            }
          : { done: true, state: "unknown" },
      );
    },
    send: (input) => {
      state.messages.push({
        id: `m${state.messages.length + 1}`,
        fromSessionId: "leader",
        toSessionId: input.toSessionId ?? null,
        senderRole: "leader",
        kind: input.kind ?? "task",
        payload: input.payload,
        round: input.round ?? 0,
        createdAt: new Date().toISOString(),
      });
      return Promise.resolve();
    },
    readInbox: () => Promise.resolve(state.messages),
    waitForMessage: () => Promise.resolve(state.messages[0] ?? null),
  };
}

describe("spawnSession", () => {
  test("spawns a follower by default", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const result = await spawnSession(fakeStore(state), {
      task: "Research auth",
      instructions: "Explore the auth module and report findings.",
    });
    expect(result).toMatchObject({ success: true });
    if (result.success && "session" in result) {
      expect(result.session.groupRole).toBe("follower");
      expect(result.session.state).toBe("running");
    }
    expect(state.sessions).toHaveLength(1);
  });

  test("rejects empty instructions", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const result = await spawnSession(fakeStore(state), {
      task: "x",
      instructions: "   ",
    });
    expect(result).toMatchObject({ success: false });
    expect(state.sessions).toHaveLength(0);
  });

  test("surfaces store errors (e.g. depth limit)", async () => {
    const state: FakeState = {
      sessions: [],
      messages: [],
      spawnError: "Spawn depth limit reached (max 2).",
    };
    const result = await spawnSession(fakeStore(state), {
      task: "x",
      instructions: "do work",
    });
    expect(result).toEqual({
      success: false,
      error: "Spawn depth limit reached (max 2).",
    });
  });
});

describe("messaging", () => {
  test("send then read round-trips a payload", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const store = fakeStore(state);
    await sendTeamMessage(store, {
      toSessionId: "s1",
      kind: "task",
      payload: "do the thing",
    });
    const inbox = await readTeamInbox(store);
    expect(inbox).toMatchObject({ success: true });
    if (inbox.success && "messages" in inbox) {
      expect(inbox.messages).toHaveLength(1);
      expect(inbox.messages[0]?.payload).toBe("do the thing");
    }
  });

  test("broadcast omits a recipient", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const store = fakeStore(state);
    await sendTeamMessage(store, { kind: "broadcast", payload: "all hands" });
    expect(state.messages[0]?.toSessionId).toBeNull();
  });

  test("rejects a missing payload", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const result = await sendTeamMessage(fakeStore(state), {
      payload: undefined as unknown as string,
    });
    expect(result).toMatchObject({ success: false });
  });

  test("waitForMessage returns null when inbox empty", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const result = await waitForTeamMessage(fakeStore(state), {
      timeoutMs: 10,
    });
    expect(result).toEqual({ success: true, message: null });
  });
});

describe("listGroup / getSessionResult", () => {
  test("lists spawned sessions", async () => {
    const state: FakeState = {
      sessions: [
        {
          sessionId: "s1",
          title: "a",
          groupRole: "follower",
          state: "running",
        },
      ],
      messages: [],
    };
    const result = await listGroup(fakeStore(state));
    expect(result).toMatchObject({ success: true });
    if (result.success && "sessions" in result) {
      expect(result.sessions).toHaveLength(1);
    }
  });

  test("requires a session id for result", async () => {
    const state: FakeState = { sessions: [], messages: [] };
    const result = await getSessionResult(fakeStore(state), "");
    expect(result).toMatchObject({ success: false });
  });
});
