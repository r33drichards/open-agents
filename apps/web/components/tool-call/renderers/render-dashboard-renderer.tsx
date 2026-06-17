"use client";

import { LayoutDashboard } from "lucide-react";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { ToolLayout } from "../tool-layout";

export function RenderDashboardRenderer({
  part,
  state,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-render_dashboard">) {
  const output = part.state === "output-available" ? part.output : undefined;
  const outputError =
    output && "success" in output && output.success === false
      ? output.error
      : undefined;

  const elementCount =
    output && "success" in output && output.success && "elementCount" in output
      ? output.elementCount
      : undefined;

  const summary =
    part.state === "input-streaming"
      ? "Building dashboard"
      : outputError
        ? "Dashboard failed"
        : elementCount !== undefined
          ? `Rendered ${elementCount} element${elementCount === 1 ? "" : "s"}`
          : "Updating dashboard";

  const mergedState = outputError
    ? { ...state, error: state.error ?? outputError }
    : state;

  return (
    <ToolLayout
      name="Dashboard"
      icon={<LayoutDashboard className="h-3.5 w-3.5" />}
      summary={summary}
      state={mergedState}
      nameClassName={mergedState.error ? "text-red-500" : undefined}
      onApprove={onApprove}
      onDeny={onDeny}
    />
  );
}
