/**
 * Redis pub/sub for live dashboard updates. When any chat/agent in a session
 * replaces the dashboard spec, we publish to a per-session channel so every open
 * Dashboard tab can refresh immediately instead of waiting for the poll.
 *
 * Pub/sub is best-effort: when Redis is not configured the helpers no-op and
 * clients fall back to polling.
 */
import "server-only";
import type Redis from "ioredis";
import {
  createRedisClient,
  isRedisConfigured,
  warnRedisDisabled,
} from "@/lib/redis";

export function dashboardChannel(sessionId: string): string {
  return `dashboard-updates:${sessionId}`;
}

// A single shared publisher connection for the process. Subscribers must use
// their own dedicated connection (ioredis puts a connection into subscriber
// mode), so those are created per request in the SSE route.
let publisher: Redis | null = null;

function getPublisher(): Redis | null {
  if (!isRedisConfigured()) {
    warnRedisDisabled("dashboard realtime updates");
    return null;
  }
  if (!publisher) {
    publisher = createRedisClient("dashboard-publisher");
  }
  return publisher;
}

/** Notify subscribers that the session's dashboard changed. Best-effort. */
export async function publishDashboardUpdate(sessionId: string): Promise<void> {
  const client = getPublisher();
  if (!client) {
    return;
  }
  try {
    await client.publish(dashboardChannel(sessionId), Date.now().toString());
  } catch (error) {
    console.error("[dashboard] failed to publish update:", error);
  }
}

/** Create a dedicated subscriber connection for one SSE request, or null. */
export function createDashboardSubscriber(): Redis | null {
  if (!isRedisConfigured()) {
    return null;
  }
  return createRedisClient("dashboard-subscriber");
}
