import { describe, expect, test } from "bun:test";
import {
  type DashboardSpec,
  type DashboardStore,
  readDashboard,
  renderDashboard,
} from "./store";

function memoryStore(initial: DashboardSpec | null = null): {
  store: DashboardStore;
  current: () => DashboardSpec | null;
} {
  let spec = initial;
  const store: DashboardStore = {
    get: () => Promise.resolve(spec),
    set: (next) => {
      spec = next;
      return Promise.resolve();
    },
  };
  return { store, current: () => spec };
}

const validSpec: DashboardSpec = {
  root: "card",
  elements: {
    card: { type: "Card", props: { title: "Hi" }, children: ["text"] },
    text: { type: "Text", props: { text: "Hello" } },
  },
};

describe("renderDashboard", () => {
  test("persists a valid spec", async () => {
    const { store, current } = memoryStore();
    const result = await renderDashboard(store, validSpec);
    expect(result.success).toBe(true);
    if (result.success && "elementCount" in result) {
      expect(result.elementCount).toBe(2);
      expect(result.root).toBe("card");
    }
    expect(current()).toEqual(validSpec);
  });

  test("rejects a spec with a missing root element", async () => {
    const { store, current } = memoryStore();
    const result = await renderDashboard(store, {
      root: "missing",
      elements: { card: { type: "Card" } },
    });
    expect(result.success).toBe(false);
    expect(current()).toBeNull();
  });

  test("rejects an element without a type", async () => {
    const { store } = memoryStore();
    const result = await renderDashboard(store, {
      root: "card",
      elements: { card: { type: "" } },
    });
    expect(result.success).toBe(false);
  });

  test("rejects a reference to an unknown child", async () => {
    const { store } = memoryStore();
    const result = await renderDashboard(store, {
      root: "card",
      elements: { card: { type: "Card", children: ["ghost"] } },
    });
    expect(result.success).toBe(false);
  });

  test("surfaces store write failures", async () => {
    const store: DashboardStore = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error("db down")),
    };
    const result = await renderDashboard(store, validSpec);
    expect(result).toEqual({ success: false, error: "db down" });
  });
});

describe("readDashboard", () => {
  test("returns the current spec", async () => {
    const { store } = memoryStore(validSpec);
    const result = await readDashboard(store);
    expect(result).toEqual({ success: true, spec: validSpec });
  });

  test("returns null when nothing is rendered", async () => {
    const { store } = memoryStore();
    const result = await readDashboard(store);
    expect(result).toEqual({ success: true, spec: null });
  });
});
