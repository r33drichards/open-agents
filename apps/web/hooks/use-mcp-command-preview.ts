"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

interface CommandPreviewResponse {
  command: string;
}

/**
 * Fetch the mcp-v8 launch command a new session's worker would run, for display
 * (and optional editing) in the new-session UI. Static for a given deployment,
 * so it is cached and not revalidated on focus.
 */
export function useMcpCommandPreview(enabled = true) {
  const { data, error, isLoading } = useSWR<CommandPreviewResponse>(
    enabled ? "/api/sessions/command-preview" : null,
    (url: string) => fetcher<CommandPreviewResponse>(url),
    { revalidateOnFocus: false, revalidateIfStale: false },
  );

  return {
    command: data?.command ?? null,
    loading: isLoading,
    error,
  };
}
