/**
 * The json-render catalog for the session dashboard: the closed set of
 * components and actions the agent's `render_dashboard` tool is allowed to emit.
 * This file is server-safe (no React imports) so it can be used both to validate
 * specs before persisting and to generate the system-prompt section that
 * documents the catalog to the model.
 *
 * The matching component implementations live in `./registry.tsx`, and the
 * action handlers are wired where the renderer is mounted (`dashboard-tab-view`).
 */
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import type { DashboardSpec } from "@open-agents/agent";

export const dashboardCatalog = defineCatalog(schema, {
  // Expose the full shadcn component set. Layout (Grid/Stack/Card), content
  // (Heading/Text/Badge/Table/Alert/Progress) and interactive components
  // (Button/Input/Select/Switch/Checkbox/Tabs/Accordion/Dialog/…) are all
  // available; interactive components drive local dashboard state via the
  // built-in `setState` action.
  components: shadcnComponentDefinitions,
  // Custom actions handled client-side by the dashboard tab. The built-in
  // `setState` action is always available in addition to these.
  actions: {
    refresh_dashboard: {
      description:
        "Re-fetch the latest dashboard from the server. Use on a refresh button.",
    },
    notify: {
      description:
        "Show a short toast message to the user. Params: { message: string }.",
    },
  },
});

/**
 * Instructions that tell the model HOW to render — by calling the
 * `render_dashboard` tool with a complete spec — and forbid emitting raw spec
 * text. This deliberately REPLACES json-render's own "output format" framing
 * (see below), because that framing prescribes a different integration.
 */
const DASHBOARD_PROMPT_HEADER = `# Dashboard UI catalog

You can render a rich, interactive UI ("dashboard") for the user. It appears in a
dedicated "Dashboard" tab in the session and is SHARED across the session.

HOW TO RENDER — READ THIS CAREFULLY:
- Render ONLY by calling the \`render_dashboard\` tool, passing a complete
  json-render spec as the \`spec\` argument. The tool is the ONLY thing that draws
  UI for the user.
- NEVER write a spec, JSON Patch operations (lines like {"op":"add",...}), JSONL,
  or a \`\`\`spec / \`\`\`json code fence into your chat message. That text is NOT
  rendered — the user just sees a wall of raw JSON. To show UI, call the tool;
  otherwise reply with normal prose.
- Each call REPLACES the whole dashboard, so always send the full spec.

SPEC SHAPE:
A spec is a flat map of elements:
  { "root": "<id>", "elements": { "<id>": { "type", "props", "children" } }, "state"?: { ... } }
- \`root\` is the id of the top-level element.
- \`elements\` maps each element id to { type, props, children }. \`type\` is a
  component from the catalog below; \`props\` matches that component's schema;
  \`children\` lists child element ids in render order. Every id used in any
  \`children\` array MUST exist as its own entry in \`elements\`.
- \`on\`, \`visible\`, \`watch\`, and \`repeat\` are OPTIONAL top-level fields on an
  element (siblings of type/props/children), never inside \`props\`.

STATE & LISTS:
- \`state\` is an optional top-level field on the spec that seeds the state model.
  Components that use { "$state": "/path" }, { "$bindState": "/path" },
  { "$bindItem": "field" }, \`visible\`, or \`repeat\` read from it, so include any
  data they reference inline in \`state\`. Include realistic sample data — never
  leave a referenced array empty.
- To render a list backed by a state array, put a \`repeat\` field on a container
  element: { "repeat": { "statePath": "/items", "key": "id" } }. Its children are
  expanded once per array item; inside them use { "$item": "field" } for a field
  of the current item and { "$index": true } for the index. Do NOT hardcode one
  element per item.

The components, actions, and other spec features you may use are documented below.`;

/**
 * json-render's `prompt()` documents the catalog (components, actions, events,
 * visibility, validation, …) but ALSO prescribes a streaming output protocol:
 * "emit RFC 6902 JSON Patch JSONL as text". We do not use that protocol — the
 * agent renders dashboards by calling the `render_dashboard` tool with a full
 * spec. Injecting those instructions verbatim made the model print raw
 * {"op":"add",...} lines straight into the chat instead of calling the tool
 * (the spec leaked as unreadable JSON text).
 *
 * So we keep only the catalog *reference* — everything from the
 * "AVAILABLE COMPONENTS" section onward — and drop both the leading patch/JSONL
 * "OUTPUT FORMAT" sections and the trailing "RULES:" section (which re-states
 * the patch-output protocol). The reference is then prefixed with our own
 * tool-oriented {@link DASHBOARD_PROMPT_HEADER}.
 */
function buildDashboardCatalogPrompt(): string {
  const raw = dashboardCatalog.prompt();
  // Match the section header ("AVAILABLE COMPONENTS (N):"), not the inline
  // mentions ("…the AVAILABLE COMPONENTS list…") that appear earlier.
  const referenceMatch = raw.match(/^AVAILABLE COMPONENTS \(/m);
  const rulesMatch = raw.match(/^RULES:/m);

  // Defensive fallback: if json-render restructures its prompt and we can no
  // longer locate the reference section, keep the whole thing. The header's
  // explicit "never print patch text" prohibition still leads.
  if (referenceMatch?.index === undefined) {
    return [DASHBOARD_PROMPT_HEADER, raw].join("\n\n");
  }

  const reference = raw.slice(referenceMatch.index, rulesMatch?.index).trim();
  return [DASHBOARD_PROMPT_HEADER, reference].join("\n\n");
}

/**
 * System-prompt section injected into the agent's instructions: how to render
 * (via the `render_dashboard` tool) plus the catalog reference (component names,
 * prop schemas, and available actions) so it only emits valid, renderable specs.
 */
export const dashboardCatalogPrompt = buildDashboardCatalogPrompt();

/**
 * json-render 0.19's element schema declares the (optional) `visible` field as
 * `z.any()`. Under zod 4 — unlike zod 3 — a `z.any()` object key is treated as
 * REQUIRED, so the generated spec validator rejects any element that omits
 * `visible` ("expected nonoptional, received undefined"), which is almost every
 * element. Validate against a normalized copy that fills in the (always-true)
 * default, leaving the caller's spec untouched so we persist/render exactly what
 * the model produced.
 */
function withVisibleDefaults(spec: DashboardSpec): DashboardSpec {
  return {
    ...spec,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([id, element]) => [
        id,
        "visible" in element ? element : { ...element, visible: true },
      ]),
    ),
  };
}

/**
 * Catalog-aware validation for a model-generated dashboard spec. Rejects unknown
 * components and props that don't match the catalog, not just structural issues.
 * Wraps {@link dashboardCatalog.validate} with the zod-4 `visible` normalization.
 */
export function validateDashboardSpec(spec: DashboardSpec) {
  return dashboardCatalog.validate(withVisibleDefaults(spec));
}
