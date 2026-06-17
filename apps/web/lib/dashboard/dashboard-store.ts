/**
 * Host-app implementation of the agent's {@link DashboardStore} port. Constructed
 * fresh per agent step in the chat workflow and injected via the agent's
 * `experimental_context`. Validates every spec against the json-render catalog
 * before persisting, since specs are model-generated.
 */
import "server-only";
import type { DashboardSpec, DashboardStore } from "@open-agents/agent";
import { formatSpecIssues, type Spec, validateSpec } from "@json-render/core";
import {
  getSessionDashboard,
  upsertSessionDashboard,
} from "@/lib/db/dashboards";

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
      const result = validateSpec(spec as unknown as Spec);
      if (!result.valid) {
        throw new Error(
          `Invalid dashboard spec: ${formatSpecIssues(result.issues)}`,
        );
      }
      await upsertSessionDashboard({
        sessionId: opts.sessionId,
        spec,
        updatedByChatId: opts.chatId ?? null,
      });
    },
  };
}
