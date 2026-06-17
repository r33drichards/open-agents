"use client";

/**
 * Renders the session's shared generative-UI dashboard. The spec is produced by
 * the agent's `render_dashboard` tool and stored per-session. Updates from any
 * chat/agent in the session arrive live over an SSE stream (Redis pub/sub); a
 * slow poll is kept as a fallback for when Redis is not configured.
 */
import { LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type { Spec } from "@json-render/react";
import type { SessionDashboardResponse } from "@/app/api/sessions/[sessionId]/dashboard/route";
import { DashboardRenderer } from "@/lib/dashboard/registry";
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
      // Slow poll as a fallback; the SSE stream below drives live updates.
      { refreshInterval: 30_000, revalidateOnFocus: true },
    );

  // Subscribe to live dashboard updates pushed by other chats in the session.
  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const source = new EventSource(
      `/api/sessions/${encodeURIComponent(sessionId)}/dashboard/stream`,
    );
    source.addEventListener("update", () => {
      void mutate();
    });
    // EventSource auto-reconnects on error; SWR polling covers any gaps.
    return () => source.close();
  }, [sessionId, mutate]);

  const handleAction = useCallback(
    (actionName: string, actionParams?: Record<string, unknown>) => {
      if (actionName === "refresh_dashboard") {
        void mutate();
        return;
      }
      if (actionName === "notify") {
        const message =
          typeof actionParams?.message === "string"
            ? actionParams.message
            : "Notification";
        toast(message);
      }
    },
    [mutate],
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
            {/* Seed the renderer's state model from the spec's top-level
                `state` field so $state/$bindState/repeat components render with
                the data the model provided (the renderer reads the `state`
                prop, not `spec.state`). */}
            <DashboardRenderer
              spec={spec as unknown as Spec}
              state={spec.state}
              onAction={handleAction}
            />
          </div>
        )}
      </div>
    </div>
  );
}
