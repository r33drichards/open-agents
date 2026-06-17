/**
 * Host-app implementation of the agent's {@link DashboardStore} port. Constructed
 * fresh per agent step in the chat workflow and injected via the agent's
 * `experimental_context`. Validates every spec against the json-render catalog
 * before persisting, since specs are model-generated.
 */
import "server-only";
import type { DashboardSpec, DashboardStore } from "@open-agents/agent";
import { validateDashboardSpec } from "./catalog";
import {
  getSessionDashboard,
  upsertSessionDashboard,
} from "@/lib/db/dashboards";
import { publishDashboardUpdate } from "./realtime";

export function createDashboardStore(opts: {
  sessionId: string;
  chatId?: string;
}): DashboardStore {
  return {
    async get(): Promise<DashboardSpec | null> {
      const row = await getSessionDashboard(opts.sessionId);
      return row?.spec ?? null;
    },
    async set(spec: DashboardSpec): Promise<void> {
      // Catalog-aware validation: rejects unknown components and props that
      // don't match the catalog schema, not just structural issues.
      const result = validateDashboardSpec(spec);
      if (!result.success) {
        const detail =
          result.error?.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ") ?? "unknown validation error";
        throw new Error(`Invalid dashboard spec: ${detail}`);
      }
      await upsertSessionDashboard({
        sessionId: opts.sessionId,
        spec,
        updatedByChatId: opts.chatId ?? null,
      });
      // Best-effort realtime notify so other open tabs refresh immediately.
      await publishDashboardUpdate(opts.sessionId);
    },
  };
}
