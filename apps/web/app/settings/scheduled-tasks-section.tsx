"use client";

import type { ScheduledTaskRecord } from "@open-agents/agent";
import { CalendarClock, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  type CreateTaskInput,
  useScheduledTasks,
} from "./scheduled-tasks/use-scheduled-tasks";

function describeTask(task: ScheduledTaskRecord): string {
  if (task.scheduleKind === "once" && task.fireAt) {
    return `Once · ${new Date(task.fireAt).toLocaleString()}`;
  }
  if (task.cronExpression) {
    return `Cron · ${task.cronExpression}`;
  }
  return "Unscheduled";
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function CreateTaskForm({
  sessions,
  onCreate,
}: {
  sessions: ReturnType<typeof useScheduledTasks>["sessions"];
  onCreate: (input: CreateTaskInput) => Promise<string | null>;
}) {
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [fireMode, setFireMode] =
    useState<CreateTaskInput["fireMode"]>("same-session");
  const [submitting, setSubmitting] = useState(false);

  const selectedSession = sessions.find((s) => s.id === sessionId);
  const canSubmit =
    prompt.trim().length > 0 &&
    schedule.trim().length > 0 &&
    sessionId.length > 0 &&
    !(fireMode === "same-session" && !selectedSession?.chatId);

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    const created = await onCreate({
      sessionId,
      chatId:
        fireMode === "same-session"
          ? (selectedSession?.chatId ?? undefined)
          : undefined,
      prompt: prompt.trim(),
      schedule: schedule.trim(),
      fireMode,
    });
    setSubmitting(false);
    if (created === null) {
      setPrompt("");
      setSchedule("");
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-2">
        <Label htmlFor="task-prompt">Prompt</Label>
        <Input
          id="task-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Check CI and address any review comments"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="task-schedule">Schedule</Label>
          <Input
            id="task-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder='"0 9 * * 1-5", "5m", "in 30 minutes"'
          />
        </div>

        <div className="space-y-2">
          <Label>Run mode</Label>
          <Select
            value={fireMode}
            onValueChange={(v) => setFireMode(v as CreateTaskInput["fireMode"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="same-session">
                Same session (this chat)
              </SelectItem>
              <SelectItem value="fresh-session">
                Fresh session each run
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Session</Label>
        <Select value={sessionId} onValueChange={setSessionId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fireMode === "same-session" &&
        selectedSession &&
        !selectedSession.chatId ? (
          <p className="text-xs text-destructive">
            This session has no chat yet. Pick another or use fresh-session.
          </p>
        ) : null}
      </div>

      <Button disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? "Scheduling…" : "Schedule task"}
      </Button>
    </div>
  );
}

export function ScheduledTasksSection() {
  const {
    tasks,
    sessions,
    loading,
    error,
    createTask,
    setEnabled,
    deleteTask,
  } = useScheduledTasks();

  if (loading) {
    return <ScheduledTasksSectionSkeleton />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Schedule a prompt to run automatically on a cron schedule or at a
        one-shot time. Tasks run on Open Agents infrastructure even when this
        tab is closed.
      </p>

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <CreateTaskForm sessions={sessions} onCreate={createTask} />

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <CalendarClock className="h-6 w-6" />
            No scheduled tasks yet.
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{task.prompt}</p>
                <p className="text-xs text-muted-foreground">
                  {describeTask(task)} · {task.fireMode}
                </p>
                <p className="text-xs text-muted-foreground">
                  Next: {formatTime(task.nextRunAt)} · Last:{" "}
                  {formatTime(task.lastRunAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Switch
                  checked={task.enabled}
                  onCheckedChange={(checked) => setEnabled(task.id, checked)}
                  aria-label="Enable task"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteTask(task.id)}
                  aria-label="Delete task"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ScheduledTasksSectionSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}
