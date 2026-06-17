import { describe, expect, test } from "bun:test";
import { dashboardCatalogPrompt, validateDashboardSpec } from "./catalog";

describe("dashboardCatalogPrompt", () => {
  test("directs the model to the render_dashboard tool", () => {
    expect(dashboardCatalogPrompt).toContain("render_dashboard");
    expect(dashboardCatalogPrompt).toContain("# Dashboard UI catalog");
  });

  test("does not carry json-render's emit-patches-as-text framing", () => {
    // The bug: json-render's default prompt tells the model to stream RFC 6902
    // JSON Patch lines as text, which leaked raw {"op":"add",...} JSON into the
    // chat instead of calling the tool. None of that framing should survive.
    expect(dashboardCatalogPrompt).not.toContain("OUTPUT FORMAT");
    expect(dashboardCatalogPrompt).not.toContain("Output ONLY JSONL");
    expect(dashboardCatalogPrompt).not.toContain("one JSON object per line");
    // The example patch line + the trailing RULES section must be gone.
    expect(dashboardCatalogPrompt).not.toContain('{"op":"add","path":"/root"');
    expect(dashboardCatalogPrompt).not.toContain("\nRULES:");
  });

  test("keeps the catalog component reference", () => {
    expect(dashboardCatalogPrompt).toContain("AVAILABLE COMPONENTS");
    // A representative component the agent is expected to use.
    expect(dashboardCatalogPrompt).toContain("Card:");
    // Sliced cleanly from the section header, not an inline mention.
    expect(dashboardCatalogPrompt).not.toContain("AVAILABLE COMPONENTS list");
  });
});

describe("validateDashboardSpec", () => {
  test("accepts a plain spec whose elements omit `visible`", () => {
    // Regression: under zod 4, json-render's `visible: z.any()` field is treated
    // as required, so an un-normalized validate rejected this valid spec.
    const result = validateDashboardSpec({
      root: "main",
      elements: {
        main: { type: "Card", props: { title: "x" }, children: [] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a spec with a top-level state field", () => {
    const result = validateDashboardSpec({
      root: "main",
      elements: {
        main: { type: "Card", props: { title: "x" }, children: [] },
      },
      state: { items: [{ id: "1", title: "a" }] },
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown components", () => {
    const result = validateDashboardSpec({
      root: "main",
      elements: {
        main: { type: "NotARealComponent", props: {}, children: [] },
      },
    });
    expect(result.success).toBe(false);
  });
});
