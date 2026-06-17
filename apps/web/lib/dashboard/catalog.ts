/**
 * The json-render catalog for the session dashboard: the closed set of
 * components the agent's `render_dashboard` tool is allowed to emit. This file
 * is server-safe (no React imports) so it can be used both to validate specs
 * before persisting and to generate the system-prompt section that documents
 * the catalog to the model.
 *
 * The matching component implementations live in `./registry.tsx`.
 */
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";

export const dashboardCatalog = defineCatalog(schema, {
  components: {
    // Layout
    Grid: shadcnComponentDefinitions.Grid,
    Stack: shadcnComponentDefinitions.Stack,
    Card: shadcnComponentDefinitions.Card,
    Separator: shadcnComponentDefinitions.Separator,
    // Content
    Heading: shadcnComponentDefinitions.Heading,
    Text: shadcnComponentDefinitions.Text,
    Badge: shadcnComponentDefinitions.Badge,
    Alert: shadcnComponentDefinitions.Alert,
    Progress: shadcnComponentDefinitions.Progress,
    Table: shadcnComponentDefinitions.Table,
  },
  // No interactive actions in this first slice — display components only.
  actions: {},
});

/**
 * System-prompt section describing the catalog (component names + prop schemas).
 * Injected into the agent's instructions so it only emits valid specs.
 */
export const dashboardCatalogPrompt = dashboardCatalog.prompt();
