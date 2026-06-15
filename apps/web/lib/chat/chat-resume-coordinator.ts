import type { ChatUiStatus } from "@/lib/chat-streaming-state";

type ResumableChat = {
  status: ChatUiStatus;
  resumeStream: () => Promise<void>;
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
 * `activeStreamId` fallback. Without coordination, two of them attach to the
 * same active workflow run concurrently. Because every `makeRequest` starts
 * with an empty `activeTextParts` map and pushes a fresh assistant message,
 * concurrent resumes produce a duplicated assistant response and the AI SDK's
 * "Received text-delta for missing text part" error.
 *
 * This serializes them: while a resume is in flight (or the chat is already
 * submitting/streaming) further requests are coalesced onto the existing
 * promise rather than starting another stream.
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
  const resume = chat
    .resumeStream()
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

/**
 * Test-only: clear all in-flight resume bookkeeping. Exported so unit tests can
 * isolate cases without leaking module state between them.
 */
export function resetChatResumeCoordinatorForTests(): void {
  inFlightResumeByChat.clear();
}
