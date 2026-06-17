"use client";

import type { StateStore } from "@json-render/core";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { DashboardQueryResponse } from "@/app/api/sessions/[sessionId]/dashboard/query/route";
import type { DashboardSpec } from "@open-agents/agent";

/** Don't let an agent-set interval hammer the worker. */
const MIN_INTERVAL_MS = 2000;

/**
 * Runs the dashboard's live data sources against the session's mcp-js sandbox
 * and binds their results into the json-render state store. Each named source
 * auto-runs once when the spec loads/changes and, if it declares `every`, on
 * that interval; the returned `runQuery` re-runs one on demand (the `run_query`
 * action). The query CODE never leaves the server — we only send the source
 * name, and the endpoint runs the persisted, agent-authored snippet.
 *
 * @param version bumps only when the spec actually changes, so auto-run/intervals
 *   don't reset on every background poll.
 */
export function useDashboardQueries(
  sessionId: string,
  spec: DashboardSpec,
  store: StateStore,
  version: number,
): (name: string) => Promise<void> {
  // Latest data sources without making the effect depend on the spec's identity
  // (which changes on every poll).
  const sourcesRef = useRef(spec.dataSources);
  sourcesRef.current = spec.dataSources;

  const runQuery = useCallback(
    async (name: string) => {
      if (!(sessionId && sourcesRef.current?.[name])) {
        return;
      }
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/dashboard/query`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          },
        );
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(detail?.error ?? `Query failed (${res.status})`);
        }
        const { bind, data } = (await res.json()) as DashboardQueryResponse;
        store.set(bind, data);
      } catch (error) {
        toast.error(
          `Data query "${name}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [sessionId, store],
  );

  useEffect(() => {
    const sources = sourcesRef.current;
    if (!sources) {
      return;
    }
    const timers: ReturnType<typeof setInterval>[] = [];
    for (const [name, source] of Object.entries(sources)) {
      void runQuery(name);
      if (typeof source.every === "number") {
        const ms = Math.max(MIN_INTERVAL_MS, source.every);
        timers.push(setInterval(() => void runQuery(name), ms));
      }
    }
    return () => {
      for (const timer of timers) {
        clearInterval(timer);
      }
    };
  }, [version, runQuery]);

  return runQuery;
}
