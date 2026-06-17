"use client";

/**
 * Renders the session's shared generative-UI dashboard. The spec is produced by
 * the agent's `render_dashboard` tool and stored per-session, so this view polls
 * the session dashboard endpoint to pick up changes made by any chat/agent in
 * the session.
 */
import { Renderer, type Spec } from "@json-render/react";
import { LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import type { SessionDashboardResponse } from "@/app/api/sessions/[sessionId]/dashboard/route";
import { dashboardRegistry } from "@/lib/dashboard/registry";
import { Button } from "@/components/ui/button";

async function fetchDashboard(url: string): Promise<SessionDashboardResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to load dashboard");
  }
  return (await res.json()) as SessionDashboardResponse;
}

export function DashboardTabView() {
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params.sessionId ?? "";

  const { data, error, isLoading, mutate, isValidating } =
    useSWR<SessionDashboardResponse>(
      sessionId
        ? `/api/sessions/${encodeURIComponent(sessionId)}/dashboard`
        : null,
      fetchDashboard,
      // Poll so dashboards rendered by other chats in this session show up.
      { refreshInterval: 4000, revalidateOnFocus: true },
    );

  const spec = data?.spec ?? null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Dashboard</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => mutate()}
          disabled={isValidating}
          className="h-7 w-7 px-0"
          aria-label="Refresh dashboard"
        >
          <RefreshCw
            className={
              isValidating ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
            }
          />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !isLoading && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load the dashboard.
            </p>
          </div>
        )}

        {!isLoading && !error && !spec && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-muted-foreground/50">
            <LayoutDashboard className="h-8 w-8" />
            <p className="max-w-sm text-center text-sm">
              No dashboard yet. Ask the agent to render one — for example,
              &ldquo;summarize this in a dashboard.&rdquo;
            </p>
          </div>
        )}

        {!isLoading && !error && spec && (
          <div className="mx-auto max-w-5xl p-4">
            <Renderer
              spec={spec as unknown as Spec}
              registry={dashboardRegistry}
            />
          </div>
        )}
      </div>
    </div>
  );
}
