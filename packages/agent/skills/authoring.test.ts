import { describe, expect, test } from "bun:test";
import {
  deleteUserSkill,
  readUserSkill,
  type UserSkillRecord,
  type UserSkillStore,
  writeUserSkill,
} from "./authoring";

function memoryStore(initial: UserSkillRecord[] = []): UserSkillStore {
  const map = new Map<string, UserSkillRecord>(
    initial.map((s) => [s.name.toLowerCase(), s]),
  );
  return {
    list: () => Promise.resolve([...map.values()]),
    get: (name) => Promise.resolve(map.get(name.toLowerCase()) ?? null),
    upsert: (input) => {
      const record = { ...input, name: input.name.toLowerCase() };
      map.set(record.name, record);
      return Promise.resolve(record);
    },
    remove: (name) => Promise.resolve(map.delete(name.toLowerCase())),
  };
}

describe("writeUserSkill", () => {
  test("creates a skill", async () => {
    const store = memoryStore();
    const result = await writeUserSkill(store, {
      name: "Deploy-Checklist",
      description: "Steps to deploy",
      body: "1. test\n2. ship",
    });
    expect(result).toEqual({
      success: true,
      name: "deploy-checklist",
      description: "Steps to deploy",
    });
    expect(await store.get("deploy-checklist")).not.toBeNull();
  });

  test("updates an existing skill (upsert)", async () => {
    const store = memoryStore([
      { name: "notes", description: "old", body: "old body" },
    ]);
    await writeUserSkill(store, {
      name: "notes",
      description: "new",
      body: "new body",
    });
    expect(await store.get("notes")).toEqual({
      name: "notes",
      description: "new",
      body: "new body",
    });
  });

  test("rejects empty fields", async () => {
    const store = memoryStore();
    expect(
      await writeUserSkill(store, { name: " ", description: "d", body: "b" }),
    ).toEqual({ success: false, error: "Skill name is required." });
    expect(
      await writeUserSkill(store, { name: "n", description: "", body: "b" }),
    ).toEqual({ success: false, error: "Skill description is required." });
    expect(
      await writeUserSkill(store, { name: "n", description: "d", body: "" }),
    ).toEqual({ success: false, error: "Skill body is required." });
  });
});

describe("readUserSkill", () => {
  test("returns body for an existing skill", async () => {
    const store = memoryStore([
      { name: "notes", description: "d", body: "the body" },
    ]);
    expect(await readUserSkill(store, "notes")).toEqual({
      success: true,
      name: "notes",
      description: "d",
      body: "the body",
    });
  });

  test("errors for a missing skill", async () => {
    expect(await readUserSkill(memoryStore(), "ghost")).toEqual({
      success: false,
      error: 'Skill "ghost" not found.',
    });
  });
});

describe("deleteUserSkill", () => {
  test("removes an existing skill", async () => {
    const store = memoryStore([{ name: "notes", description: "d", body: "b" }]);
    expect(await deleteUserSkill(store, "notes")).toEqual({
      success: true,
      name: "notes",
      description: "",
    });
    expect(await store.get("notes")).toBeNull();
  });

  test("errors for a missing skill", async () => {
    expect(await deleteUserSkill(memoryStore(), "ghost")).toEqual({
      success: false,
      error: 'Skill "ghost" not found.',
    });
  });
});
