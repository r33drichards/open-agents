"use client";

/**
 * React implementations for the dashboard catalog (see `./catalog.ts`). These
 * map each allowed component name to its shadcn/ui implementation so the
 * agent-generated spec renders with the app's own design system.
 */
import { type Components, defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { dashboardCatalog } from "./catalog";

// Each implementation comes straight from `@json-render/shadcn`, paired with the
// matching definition in `./catalog.ts`, so the runtime mapping is correct. The
// cast is only needed because `defineCatalog` widens per-component prop types to
// `unknown`, which the precisely-typed shadcn implementations don't structurally
// satisfy.
const components = {
  Grid: shadcnComponents.Grid,
  Stack: shadcnComponents.Stack,
  Card: shadcnComponents.Card,
  Separator: shadcnComponents.Separator,
  Heading: shadcnComponents.Heading,
  Text: shadcnComponents.Text,
  Badge: shadcnComponents.Badge,
  Alert: shadcnComponents.Alert,
  Progress: shadcnComponents.Progress,
  Table: shadcnComponents.Table,
} as unknown as Components<typeof dashboardCatalog>;

export const { registry: dashboardRegistry } = defineRegistry(
  dashboardCatalog,
  {
    components,
  },
);
