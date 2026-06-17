import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import type { DiffResponse } from "../route";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type CachedDiffResponse = {
  data: DiffResponse | null;
  cachedAt: string | null;
  isStale: boolean;
};

export async function GET(_req: Request, context: RouteContext) {
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

  const { sessionRecord } = sessionContext;

  // No cached diff yet (e.g. a session with no sandbox activity). Return an
  // empty 200 rather than a 404 so the client's polling SWR hook treats it as
  // "no diff" instead of an error — a 404 here logged a console error on every
  // poll for sandboxless sessions.
  if (!sessionRecord.cachedDiff) {
    const empty: CachedDiffResponse = {
      data: null,
      cachedAt: null,
      isStale: false,
    };
    return Response.json(empty);
  }

  // Note: cachedDiff is stored as jsonb and cast to DiffResponse without runtime validation.
  // This is safe as long as the schema is only written by our own diff route.
  const response: CachedDiffResponse = {
    data: sessionRecord.cachedDiff as DiffResponse,
    cachedAt:
      sessionRecord.cachedDiffUpdatedAt?.toISOString() ??
      new Date().toISOString(),
    isStale: true,
  };

  return Response.json(response);
}
