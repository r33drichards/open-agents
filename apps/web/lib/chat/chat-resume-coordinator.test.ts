import { afterEach, describe, expect, it } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import type { ChatUiStatus } from "@/lib/chat-streaming-state";
import {
  coordinateChatResume,
  resetChatResumeCoordinatorForTests,
} from "./chat-resume-coordinator";

type Deferred = {
  promise: Promise<void>;
  release: () => void;
};

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function userMessage(id: string): WebAgentUIMessage {
  return { id, role: "user", parts: [] } as WebAgentUIMessage;
}

function assistantMessage(id: string): WebAgentUIMessage {
  return { id, role: "assistant", parts: [] } as WebAgentUIMessage;
}

type FakeChat = {
  status: ChatUiStatus;
  messages: WebAgentUIMessage[];
  setMessages: (messages: WebAgentUIMessage[]) => void;
  resumeStream: () => Promise<void>;
};

afterEach(() => {
  resetChatResumeCoordinatorForTests();
});

describe("coordinateChatResume", () => {
  it("starts exactly one resume when called concurrently for the same chat", async () => {
    let calls = 0;
    const gate = deferred();
    const chat: FakeChat = {
      status: "ready",
      messages: [userMessage("u1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      resumeStream: () => {
        calls += 1;
        return gate.promise;
      },
    };

    const a = coordinateChatResume("chat-1", chat);
    const b = coordinateChatResume("chat-1", chat);
    const c = coordinateChatResume("chat-1", chat);

    expect(calls).toBe(1);

    gate.release();
    await Promise.all([a, b, c]);
  });

  it("does not resume while the chat is already submitting/streaming", async () => {
    let calls = 0;
    const chat: FakeChat = {
      status: "streaming",
      messages: [userMessage("u1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      resumeStream: () => {
        calls += 1;
        return Promise.resolve();
      },
    };

    await coordinateChatResume("chat-1", chat);
    expect(calls).toBe(0);
  });

  it("allows a new resume after the previous one settles", async () => {
    let calls = 0;
    const chat: FakeChat = {
      status: "ready",
      messages: [userMessage("u1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      resumeStream: () => {
        calls += 1;
        return Promise.resolve();
      },
    };

    await coordinateChatResume("chat-1", chat);
    await coordinateChatResume("chat-1", chat);
    expect(calls).toBe(2);
  });

  it("isolates in-flight resumes per chat id", async () => {
    const calls: string[] = [];
    const gate = deferred();
    const makeChat = (id: string): FakeChat => ({
      status: "ready",
      messages: [userMessage("u1")],
      setMessages() {
        // no-op for this test
      },
      resumeStream: () => {
        calls.push(id);
        return gate.promise;
      },
    });

    const a = coordinateChatResume("chat-1", makeChat("chat-1"));
    const b = coordinateChatResume("chat-2", makeChat("chat-2"));

    expect(calls.sort()).toEqual(["chat-1", "chat-2"]);

    gate.release();
    await Promise.all([a, b]);
  });

  it("clears in-flight state even when resume rejects", async () => {
    let calls = 0;
    const chat: FakeChat = {
      status: "ready",
      messages: [userMessage("u1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      resumeStream: () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      },
    };

    await coordinateChatResume("chat-1", chat);
    await coordinateChatResume("chat-1", chat);
    expect(calls).toBe(2);
  });

  it("strips a trailing in-progress assistant message before replaying, so the rebuild does not duplicate it", async () => {
    let messagesAtResume: WebAgentUIMessage[] = [];
    const chat: FakeChat = {
      status: "ready",
      messages: [userMessage("u1"), assistantMessage("a1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      resumeStream: () => {
        messagesAtResume = chat.messages;
        // Simulate the replay rebuilding the assistant message from index 0.
        chat.messages = [...chat.messages, assistantMessage("a1-rebuilt")];
        return Promise.resolve();
      },
    };

    await coordinateChatResume("chat-1", chat);

    // The trailing assistant message was removed before the replay ran.
    expect(messagesAtResume.map((m) => m.role)).toEqual(["user"]);
    // The final conversation has a single assistant message, not two.
    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("restores the stripped assistant message when nothing is replayed (204)", async () => {
    const chat: FakeChat = {
      status: "error",
      messages: [userMessage("u1"), assistantMessage("a1")],
      setMessages: (messages) => {
        chat.messages = messages;
      },
      // No active stream: resumeStream is a no-op (the GET returned 204).
      resumeStream: () => Promise.resolve(),
    };

    await coordinateChatResume("chat-1", chat);

    // The optimistically removed assistant message is restored.
    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });
});
