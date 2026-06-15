import { afterEach, describe, expect, it } from "bun:test";
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

afterEach(() => {
  resetChatResumeCoordinatorForTests();
});

describe("coordinateChatResume", () => {
  it("starts exactly one resume when called concurrently for the same chat", async () => {
    let calls = 0;
    const gate = deferred();
    const chat = {
      status: "ready" as const,
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
    const chat = {
      status: "streaming" as const,
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
    const chat = {
      status: "ready" as const,
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
    const makeChat = (id: string) => ({
      status: "ready" as const,
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
    const chat = {
      status: "ready" as const,
      resumeStream: () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      },
    };

    await coordinateChatResume("chat-1", chat);
    await coordinateChatResume("chat-1", chat);
    expect(calls).toBe(2);
  });
});
