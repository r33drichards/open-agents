"use client";

import type { ScheduledTaskRecord } from "@open-agents/agent";
import { useCallback, useEffect, useState } from "react";

export interface SessionOption {
  id: string;
  title: string;
  chatId: string | null;
}

export interface CreateTaskInput {
  sessionId: string;
  chatId?: string;
  prompt: string;
  schedule: string;
  fireMode: "same-session" | "fresh-session";
  timezone?: string;
}

interface UseScheduledTasks {
  tasks: ScheduledTaskRecord[];
  sessions: SessionOption[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<string | null>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? `Request failed (${res.status})`;
}

export function useScheduledTasks(): UseScheduledTasks {
  const [tasks, setTasks] = useState<ScheduledTaskRecord[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [tasksRes, sessionsRes] = await Promise.all([
        fetch("/api/scheduled-tasks"),
        fetch("/api/sessions?status=active"),
      ]);
      if (!tasksRes.ok) {
        throw new Error(await readError(tasksRes));
      }
      const tasksData = (await tasksRes.json()) as {
        tasks: ScheduledTaskRecord[];
      };
      setTasks(tasksData.tasks);

      if (sessionsRes.ok) {
        const sessionsData = (await sessionsRes.json()) as {
          sessions: Array<{
            id: string;
            title: string;
            latestChatId: string | null;
          }>;
        };
        setSessions(
          sessionsData.sessions.map((s) => ({
            id: s.id,
            title: s.title,
            chatId: s.latestChatId,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTask = useCallback(
    async (input: CreateTaskInput): Promise<string | null> => {
      setError(null);
      const res = await fetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          timezone:
            input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return null;
      }
      await refresh();
      return null;
    },
    [refresh],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setError(null);
      const res = await fetch(`/api/scheduled-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/scheduled-tasks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await refresh();
    },
    [refresh],
  );

  return {
    tasks,
    sessions,
    loading,
    error,
    refresh,
    createTask,
    setEnabled,
    deleteTask,
  };
}
