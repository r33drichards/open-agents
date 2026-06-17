import type { NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import {
  createDashboardSubscriber,
  dashboardChannel,
} from "@/lib/dashboard/realtime";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const encoder = new TextEncoder();

/**
 * Server-Sent Events stream that emits an event whenever this session's
 * dashboard changes (published over Redis pub/sub by the agent's dashboard
 * store). The client uses it to refresh immediately. When Redis is not
 * configured the stream is short and clients fall back to polling.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const subscriber = createDashboardSubscriber();
  if (!subscriber) {
    // Redis disabled: return an empty, immediately-closing stream so the client
    // cleanly falls back to polling.
    return new Response("event: disabled\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const channel = dashboardChannel(sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
        );
      };

      subscriber.on("message", (_channel, message) => {
        send("update", message);
      });

      // Heartbeat so proxies keep the connection open.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        void subscriber.quit().catch(() => {
          subscriber.disconnect();
        });
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      req.signal.addEventListener("abort", cleanup);

      try {
        await subscriber.subscribe(channel);
        send("ready", "{}");
      } catch (error) {
        console.error("[dashboard] failed to subscribe:", error);
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
