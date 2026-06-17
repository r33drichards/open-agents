import { beforeEach, describe, expect, mock, test } from "bun:test";

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
type OwnedSessionResult =
  | { ok: true; sessionRecord: { id: string } }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };
let ownedSessionResult: OwnedSessionResult = {
  ok: true,
  sessionRecord: { id: "session-1" },
};
let groupId: string | null = "group-1";

const insertCalls: Array<Record<string, unknown>> = [];
let listed: Array<Record<string, unknown>> = [];

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
  requireOwnedSession: async () => ownedSessionResult,
}));

mock.module("@/lib/db/agent-groups", () => ({
  getSessionGroupId: async () => groupId,
}));

mock.module("@/lib/db/agent-messages", () => ({
  insertAgentMessage: async (data: Record<string, unknown>) => {
    insertCalls.push(data);
    return { ...data };
  },
  listGroupMessages: async () => listed,
}));

const routeModulePromise = import("./route");

function createContext(sessionId = "session-1") {
  return { params: Promise.resolve({ sessionId }) };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/sessions/session-1/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/sessions/[sessionId]/messages", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ownedSessionResult = { ok: true, sessionRecord: { id: "session-1" } };
    groupId = "group-1";
    insertCalls.length = 0;
    listed = [];
  });

  test("POST injects a human broadcast message", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({ payload: "hello team" }),
      createContext(),
    );
    expect(response.status).toBe(201);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({
      groupId: "group-1",
      fromSessionId: null,
      toSessionId: null,
      senderRole: "human",
      kind: "task",
      payload: "hello team",
    });
  });

  test("POST targets a specific worker when toSessionId set", async () => {
    const { POST } = await routeModulePromise;
    await POST(
      postRequest({ payload: "do x", toSessionId: "worker-2", kind: "status" }),
      createContext(),
    );
    expect(insertCalls[0]).toMatchObject({
      toSessionId: "worker-2",
      kind: "status",
    });
  });

  test("POST rejects an empty payload", async () => {
    const { POST } = await routeModulePromise;
    const response = await POST(postRequest({ payload: "" }), createContext());
    expect(response.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });

  test("POST returns 409 when the session has no team", async () => {
    groupId = null;
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({ payload: "hi" }),
      createContext(),
    );
    expect(response.status).toBe(409);
    expect(insertCalls).toHaveLength(0);
  });

  test("POST surfaces auth failures", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;
    const response = await POST(
      postRequest({ payload: "hi" }),
      createContext(),
    );
    expect(response.status).toBe(401);
  });

  test("GET returns the group's messages", async () => {
    listed = [{ id: "m1", payload: "a" }];
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/messages"),
      createContext(),
    );
    const body = (await response.json()) as { messages: unknown[] };
    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(1);
  });

  test("GET returns empty when no team", async () => {
    groupId = null;
    const { GET } = await routeModulePromise;
    const response = await GET(
      new Request("http://localhost/api/sessions/session-1/messages"),
      createContext(),
    );
    const body = (await response.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });
});
