import type { WebAgentUIMessage } from "@/app/types";
import type { ChatUiStatus } from "@/lib/chat-streaming-state";

type ResumableChat = {
  status: ChatUiStatus;
  resumeStream: () => Promise<void>;
  messages: WebAgentUIMessage[];
  setMessages: (messages: WebAgentUIMessage[]) => void;
};

// One in-flight resume promise per chat id. `resumeStream()` resolves only when
// the resumed stream finishes consuming, so this entry stays pending for the
// whole lifetime of the active stream. Any concurrent or mid-stream resume
// request for the same chat therefore coalesces onto the in-flight one instead
// of opening a second connection to the same workflow run.
const inFlightResumeByChat = new Map<string, Promise<void>>();

/**
 * Resume a chat's server-side stream at most once at a time, per chat.
 *
 * Several independent triggers can ask to resume the same run: the mount-time
 * resume, the focus/visibility recovery probe, and the reactive
 * `activeStreamId` fallback. Two problems arise without coordination:
 *
 * 1. Concurrent resumes. Each `makeRequest` starts with an empty
 *    `activeTextParts` map and pushes a fresh assistant message, so two
 *    resumes attached to the same run produce a duplicated assistant response
 *    and the AI SDK's "Received text-delta for missing text part" error. This
 *    is solved by single-flighting per chat id.
 *
 * 2. Resuming into a partially-rendered message. The resume route replays the
 *    stream from index 0 so the SDK always sees `text-start` before any
 *    `text-delta` (a non-zero start index skips `text-start` and triggers the
 *    same "missing text part" error). But if the in-memory conversation already
 *    ends with an in-progress assistant message — which happens when the tab is
 *    backgrounded mid-stream and later refocused, so the client connection
 *    dropped while the server kept running — replaying `text-start` pushes a
 *    second copy of parts the message already has, duplicating the response.
 *    To avoid that, the trailing in-progress assistant message is dropped
 *    before the replay rebuilds it from scratch, and restored if nothing was
 *    actually replayed (e.g. the run already finished and the GET returned 204).
 */
export function coordinateChatResume(
  chatId: string,
  chat: ResumableChat,
): Promise<void> {
  // A stream is already attaching or active for this chat. Coalesce onto the
  // in-flight resume if there is one; otherwise there is nothing to resume.
  if (chat.status !== "ready" && chat.status !== "error") {
    return inFlightResumeByChat.get(chatId) ?? Promise.resolve();
  }

  const existing = inFlightResumeByChat.get(chatId);
  if (existing) {
    return existing;
  }

  // Start exactly one resume. The check above and this set happen
  // synchronously (no await between them), so two callers in the same tick
  // cannot both pass the guard — JS runs them to completion one at a time.
  const resume = runResume(chat)
    .catch(() => {
      // Single-flight is the only responsibility here; the AI SDK surfaces
      // resume failures via chat status/onError for callers to handle.
    })
    .finally(() => {
      inFlightResumeByChat.delete(chatId);
    });

  inFlightResumeByChat.set(chatId, resume);
  return resume;
}

async function runResume(chat: ResumableChat): Promise<void> {
  const messagesBefore = chat.messages;
  const lastMessage = messagesBefore.at(-1);
  const inProgressAssistant =
    lastMessage?.role === "assistant" ? lastMessage : undefined;

  // Drop the in-progress assistant message so the full replay from index 0
  // rebuilds it cleanly instead of appending duplicate parts onto it.
  if (inProgressAssistant) {
    chat.setMessages(messagesBefore.slice(0, -1));
  }

  try {
    await chat.resumeStream();
  } finally {
    // If the replay produced no assistant message (no active stream — the GET
    // returned 204), restore the message we optimistically removed so the UI
    // does not lose the last response.
    if (inProgressAssistant) {
      const messagesAfter = chat.messages;
      if (messagesAfter.at(-1)?.role !== "assistant") {
        chat.setMessages([...messagesAfter, inProgressAssistant]);
      }
    }
  }
}

/**
 * Test-only: clear all in-flight resume bookkeeping. Exported so unit tests can
 * isolate cases without leaking module state between them.
 */
export function resetChatResumeCoordinatorForTests(): void {
  inFlightResumeByChat.clear();
}
