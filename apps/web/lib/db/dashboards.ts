import type { DashboardSpec } from "@open-agents/agent";
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { sessionDashboards } from "./schema";

export type SessionDashboard = {
  sessionId: string;
  spec: DashboardSpec;
  updatedByChatId: string | null;
  version: number;
  updatedAt: Date;
};

/** Read the session's dashboard, or null if nothing has been rendered yet. */
export async function getSessionDashboard(
  sessionId: string,
): Promise<SessionDashboard | null> {
  const [row] = await db
    .select()
    .from(sessionDashboards)
    .where(eq(sessionDashboards.sessionId, sessionId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    sessionId: row.sessionId,
    spec: row.spec,
    updatedByChatId: row.updatedByChatId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/**
 * Insert or replace the session's dashboard spec, bumping `version` so polling
 * clients can detect the change.
 */
export async function upsertSessionDashboard(input: {
  sessionId: string;
  spec: DashboardSpec;
  updatedByChatId?: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(sessionDashboards)
    .values({
      sessionId: input.sessionId,
      spec: input.spec,
      updatedByChatId: input.updatedByChatId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionDashboards.sessionId,
      set: {
        spec: input.spec,
        updatedByChatId: input.updatedByChatId ?? null,
        version: sql`${sessionDashboards.version} + 1`,
        updatedAt: now,
      },
    });
}
