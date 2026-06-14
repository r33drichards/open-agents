import { describe, expect, test } from "bun:test";
import {
  createScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  type ScheduledTaskRecord,
  type ScheduledTaskStore,
} from "./store";

function memoryStore(initial: ScheduledTaskRecord[] = []): {
  store: ScheduledTaskStore;
  records: Map<string, ScheduledTaskRecord>;
} {
  const records = new Map<string, ScheduledTaskRecord>(
    initial.map((t) => [t.id, t]),
  );
  let counter = 0;
  const store: ScheduledTaskStore = {
    create: (input) => {
      counter += 1;
      const record: ScheduledTaskRecord = {
        id: `task-${counter}`,
        prompt: input.prompt,
        scheduleKind: "recurring",
        cronExpression: "*/5 * * * *",
        fireAt: null,
        fireMode: input.fireMode ?? "same-session",
        timezone: input.timezone ?? "UTC",
        enabled: true,
        nextRunAt: null,
        lastRunAt: null,
      };
      records.set(record.id, record);
      return Promise.resolve(record);
    },
    list: () => Promise.resolve([...records.values()]),
    remove: (id) => Promise.resolve(records.delete(id)),
  };
  return { store, records };
}

describe("createScheduledTask", () => {
  test("rejects an empty prompt", async () => {
    const { store } = memoryStore();
    const result = await createScheduledTask(store, {
      prompt: "  ",
      schedule: "5m",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty schedule", async () => {
    const { store } = memoryStore();
    const result = await createScheduledTask(store, {
      prompt: "do it",
      schedule: "",
    });
    expect(result.success).toBe(false);
  });

  test("creates a task and returns its record", async () => {
    const { store, records } = memoryStore();
    const result = await createScheduledTask(store, {
      prompt: "check ci",
      schedule: "5m",
    });
    expect(result.success).toBe(true);
    expect(records.size).toBe(1);
    if (result.success && "task" in result) {
      expect(result.task.prompt).toBe("check ci");
    }
  });

  test("surfaces a store error as a failure result", async () => {
    const store: ScheduledTaskStore = {
      create: () => Promise.reject(new Error("bad cron")),
      list: () => Promise.resolve([]),
      remove: () => Promise.resolve(false),
    };
    const result = await createScheduledTask(store, {
      prompt: "x",
      schedule: "nonsense",
    });
    expect(result).toEqual({ success: false, error: "bad cron" });
  });
});

describe("listScheduledTasks / removeScheduledTask", () => {
  test("lists tasks", async () => {
    const { store } = memoryStore();
    await createScheduledTask(store, { prompt: "a", schedule: "5m" });
    const result = await listScheduledTasks(store);
    expect(result.success).toBe(true);
    if (result.success && "tasks" in result) {
      expect(result.tasks).toHaveLength(1);
    }
  });

  test("removes an existing task", async () => {
    const { store } = memoryStore();
    const created = await createScheduledTask(store, {
      prompt: "a",
      schedule: "5m",
    });
    const id = created.success && "task" in created ? created.task.id : "";
    const result = await removeScheduledTask(store, id);
    expect(result.success).toBe(true);
  });

  test("reports a missing task", async () => {
    const { store } = memoryStore();
    const result = await removeScheduledTask(store, "nope");
    expect(result.success).toBe(false);
  });

  test("requires an id", async () => {
    const { store } = memoryStore();
    const result = await removeScheduledTask(store, "");
    expect(result.success).toBe(false);
  });
});
