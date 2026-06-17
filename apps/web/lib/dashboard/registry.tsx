"use client";

/**
 * React renderer for the dashboard catalog (see `./catalog.ts`). Uses
 * `createRenderer`, which bundles the state/visibility/action providers so
 * interactive components (tabs, switches, inputs, …) and the built-in
 * `setState` action work out of the box. Custom actions are delivered to the
 * mount point via the `onAction` prop.
 *
 * Each implementation comes from `@json-render/shadcn`. Those component
 * functions take a flat `{ props, children, emit, on, bindings }` shape
 * (`BaseComponentProps`), whereas the renderer invokes registry entries with
 * the element-based `ComponentRenderProps` shape (`{ element, children, … }`).
 * We adapt between the two here — forwarding `element.props` as `props` — which
 * is exactly what `@json-render/react`'s own `defineRegistry` helper does. The
 * raw `shadcnComponents` map cannot be passed to `createRenderer` directly:
 * doing so leaves `props` undefined at runtime and every component throws.
 */
import {
  type ComponentMap,
  type ComponentRenderProps,
  createRenderer,
} from "@json-render/react";
import type { InferCatalogComponents } from "@json-render/core";
import { shadcnComponents } from "@json-render/shadcn";
import { dashboardCatalog } from "./catalog";

type DashboardComponents = ComponentMap<
  InferCatalogComponents<typeof dashboardCatalog>
>;

// Wrap each shadcn component so the renderer's element-based call shape is
// translated to the flat `{ props, … }` shape the implementations expect.
const adaptedComponents = Object.fromEntries(
  Object.entries(shadcnComponents).map(([name, component]) => [
    name,
    ({
      element,
      children,
      emit,
      on,
      bindings,
      loading,
    }: ComponentRenderProps) =>
      (component as (args: unknown) => ReturnType<typeof component>)({
        props: element.props,
        children,
        emit,
        on,
        bindings,
        loading,
      }),
  ]),
) as unknown as DashboardComponents;

export const DashboardRenderer = createRenderer(
  dashboardCatalog,
  adaptedComponents,
);
