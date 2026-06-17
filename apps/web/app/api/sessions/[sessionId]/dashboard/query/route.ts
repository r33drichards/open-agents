import type { NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import { getSessionDashboard } from "@/lib/db/dashboards";
import { runDashboardQuery } from "@/lib/sandbox/mcp-js/query-runner";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export type DashboardQueryResponse = {
  /** JSON Pointer the client should write `data` into. */
  bind: string;
  data: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Run one of the dashboard's agent-authored data sources in the session's
 * mcp-js sandbox and return its result for the client to bind into dashboard
 * state. Only named sources from the persisted spec run — never client-supplied
 * code — and only for JS-sandbox sessions.
 */
export async function POST(req: NextRequest, context: RouteContext) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name =
    isRecord(body) && typeof body.name === "string" ? body.name : null;
  if (!name) {
    return Response.json(
      { error: "A data source `name` is required" },
      { status: 400 },
    );
  }

  const dashboard = await getSessionDashboard(sessionId);
  const source = dashboard?.spec.dataSources?.[name];
  if (!source) {
    return Response.json(
      { error: `No data source named "${name}" on the dashboard` },
      { status: 404 },
    );
  }

  const { sandboxState } = sessionContext.sessionRecord;
  if (sandboxState?.type !== "mcp-js") {
    return Response.json(
      {
        error:
          "Dashboard data queries need a JS sandbox session (mcp-js). This session has none.",
      },
      { status: 409 },
    );
  }

  const result = await runDashboardQuery({
    baseUrl: sandboxState.baseUrl,
    session: sandboxState.session,
    code: source.code,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.error, output: result.output },
      { status: 502 },
    );
  }

  const response: DashboardQueryResponse = {
    bind: source.bind,
    data: result.data,
  };
  return Response.json(response);
}
