import { tool, type UIToolInvocation } from "ai";
import { z } from "zod";
import {
  type DashboardSpec,
  type DashboardStore,
  renderDashboard,
} from "../dashboard/store";

interface DashboardStoreContext {
  dashboardStore?: DashboardStore;
}

function getStore(experimental_context: unknown): DashboardStore {
  const store = (experimental_context as DashboardStoreContext | undefined)
    ?.dashboardStore;
  if (!store) {
    throw new Error(
      "Dashboard store not available. Rendering UI requires a user session.",
    );
  }
  return store;
}

const elementSchema = z
  .object({
    type: z
      .string()
      .describe(
        "Component name from the Dashboard UI catalog (e.g. Card, Text, Button).",
      ),
    props: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Props for the component, matching the catalog schema."),
    children: z
      .array(z.string())
      .optional()
      .describe(
        "Ids of child elements, rendered inside this element in order.",
      ),
    on: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Event -> action bindings for interactive components, e.g. " +
          '{ "click": { "action": "setState", "params": { "path": "/tab", "value": "a" } } }. ' +
          "Available actions are described in the Dashboard UI catalog section.",
      ),
    visible: z
      .unknown()
      .optional()
      .describe(
        "Optional visibility condition (json-render condition object).",
      ),
  })
  // Forward-compatible: allow other json-render element fields (watch, repeat).
  .catchall(z.unknown());

export const renderDashboardInputSchema = z.object({
  spec: z
    .object({
      root: z.string().describe("Id of the top-level element in `elements`."),
      elements: z
        .record(z.string(), elementSchema)
        .describe("Flat map of element id -> element."),
      state: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Optional initial state model the UI reads via $state/$bindState/" +
            "$bindItem/repeat. Include any data your components reference here, " +
            "with realistic sample values.",
        ),
      dataSources: z
        .record(
          z.string(),
          z.object({
            code: z
              .string()
              .describe(
                "JavaScript run in THIS session's sandbox (same persistent V8 " +
                  "heap + /work filesystem as run_js). Must return " +
                  "JSON-serializable data.",
              ),
            bind: z
              .string()
              .describe(
                'JSON Pointer state path the result is written to, e.g. "/rows".',
              ),
            every: z
              .number()
              .optional()
              .describe(
                "Optional auto-refresh interval in ms. Omit to run once on load.",
              ),
          }),
        )
        .optional()
        .describe(
          "Named live data sources. Each runs in the session sandbox and binds " +
            "its result into `state` at `bind` (auto-runs on load + `every` ms, " +
            "and on demand via the `run_query` action). Keep large/live data " +
            "here instead of pasting it into `state`.",
        ),
    })
    .describe("A json-render spec describing the dashboard to display."),
});

export type RenderDashboardInput = z.infer<typeof renderDashboardInputSchema>;

export const renderDashboardTool = tool({
  description: `Render a rich, interactive UI ("dashboard") for the user from a json-render spec.

The dashboard appears in a dedicated "Dashboard" tab in the session and is SHARED
across the session: every chat/agent in this session sees and can replace the same
dashboard. Calling this REPLACES the current dashboard with the spec you provide.

WHEN TO USE:
- Summarize data, results, or status in a visual layout instead of plain text
- Build a report, table, or metrics view the user can keep open while you work
- Update a shared view that other chats in this session also rely on

USAGE NOTES:
- You may ONLY use components listed in the "Dashboard UI catalog" section of your
  system prompt. Each component documents its allowed props there.
- The spec is a flat map: \`root\` names the top element, and \`elements\` maps ids to
  { type, props, children }. \`children\` lists child element ids in render order.
- Keep specs focused; prefer a single root container (e.g. Stack or Grid) with a
  handful of cards over deeply nested structures.`,
  inputSchema: renderDashboardInputSchema,
  execute: async ({ spec }, { experimental_context }) => {
    const store = getStore(experimental_context);
    return await renderDashboard(store, spec as DashboardSpec);
  },
  toModelOutput: ({ output }) => {
    if (output && "success" in output && output.success && "root" in output) {
      return {
        type: "text",
        value: `Dashboard updated (${output.elementCount} element${
          output.elementCount === 1 ? "" : "s"
        }). The user can view it in the Dashboard tab.`,
      };
    }
    if (output && "success" in output && !output.success) {
      return {
        type: "text",
        value: `Dashboard not updated: ${output.error}`,
      };
    }
    return { type: "text", value: "Dashboard updated." };
  },
});

export type RenderDashboardToolUIPart = UIToolInvocation<
  typeof renderDashboardTool
>;
