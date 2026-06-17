import type { NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { getSessionDashboard } from "@/lib/db/dashboards";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type SessionDashboardResponse = {
  spec: import("@open-agents/agent").DashboardSpec | null;
  version: number;
  updatedByChatId: string | null;
  updatedAt: string | null;
};

export async function GET(_req: NextRequest, context: RouteContext) {
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

  const dashboard = await getSessionDashboard(sessionId);

  const response: SessionDashboardResponse = {
    spec: dashboard?.spec ?? null,
    version: dashboard?.version ?? 0,
    updatedByChatId: dashboard?.updatedByChatId ?? null,
    updatedAt: dashboard?.updatedAt.toISOString() ?? null,
  };

  return Response.json(response);
}
