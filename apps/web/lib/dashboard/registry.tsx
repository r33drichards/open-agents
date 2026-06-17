"use client";

/**
 * React renderer for the dashboard catalog (see `./catalog.ts`). Uses
 * `createRenderer`, which bundles the state/visibility/action providers so
 * interactive components (tabs, switches, inputs, …) and the built-in
 * `setState` action work out of the box. Custom actions are delivered to the
 * mount point via the `onAction` prop.
 *
 * Each implementation comes straight from `@json-render/shadcn`, paired with the
 * matching definition in `./catalog.ts`. The cast is only needed because the
 * catalog widens per-component prop types to `unknown`, which the precisely
 * typed shadcn implementations don't structurally satisfy.
 */
import { type ComponentMap, createRenderer } from "@json-render/react";
import type { InferCatalogComponents } from "@json-render/core";
import { shadcnComponents } from "@json-render/shadcn";
import { dashboardCatalog } from "./catalog";

type DashboardComponents = ComponentMap<
  InferCatalogComponents<typeof dashboardCatalog>
>;

export const DashboardRenderer = createRenderer(
  dashboardCatalog,
  shadcnComponents as unknown as DashboardComponents,
);
