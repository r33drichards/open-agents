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
 * System-prompt section describing the catalog (component names, prop schemas,
 * and available actions). Injected into the agent's instructions so it only
 * emits valid, renderable specs.
 */
export const dashboardCatalogPrompt = dashboardCatalog.prompt();
