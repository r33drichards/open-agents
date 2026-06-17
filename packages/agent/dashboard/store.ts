/**
 * Session dashboard: the agent can render a shared, mutable UI ("generative UI")
 * that the user sees in a dedicated "Dashboard" tab. The dashboard is scoped to
 * the session, so every chat/agent in the session reads and writes the same
 * spec — any agent can mutate what another rendered.
 *
 * Like skills and scheduled tasks, this module is intentionally free of
 * `ai`/SDK, DB, and `@json-render/*` imports so its logic can be unit tested
 * directly. The `ai` `tool()` wrapper lives in `../tools/dashboard.ts`, and the
 * durable storage + spec validation are provided by the host app through the
 * {@link DashboardStore} port.
 */

/**
 * A single node in a json-render spec (flat form). `type` names a component in
 * the host app's catalog; the host validates props against that catalog before
 * persisting, so this port treats props as opaque.
 */
export interface DashboardElement {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  /** Event -> action bindings for interactive components. */
  on?: Record<string, unknown>;
  /** Optional visibility condition. */
  visible?: unknown;
  /** Forward-compatible passthrough for other json-render element fields. */
  [key: string]: unknown;
}

/** A json-render spec: a root element id plus a flat map of elements. */
export interface DashboardSpec {
  root: string;
  elements: Record<string, DashboardElement>;
  /**
   * Optional initial state model, read by components via `$state`/`$bindState`/
   * `$bindItem` and by `repeat`/`visible`. The host validates it against the
   * json-render catalog before persisting.
   */
  state?: Record<string, unknown>;
}

/**
 * Durable store for the session dashboard, injected by the host app via the
 * agent's `experimental_context` (the agent package never touches the DB or the
 * json-render catalog).
 */
export interface DashboardStore {
  /** Current spec for the session, or null if nothing has been rendered yet. */
  get(): Promise<DashboardSpec | null>;
  /** Replace the session's dashboard spec. The host validates before saving. */
  set(spec: DashboardSpec): Promise<void>;
}

export type DashboardResult =
  | { success: true; root: string; elementCount: number }
  | { success: true; spec: DashboardSpec | null }
  | { success: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Structural validation kept here so it is testable without the host catalog. */
function validateSpecShape(spec: DashboardSpec): string | null {
  if (!isNonEmptyString(spec.root)) {
    return "Spec must have a non-empty root element id.";
  }
  if (!spec.elements || typeof spec.elements !== "object") {
    return "Spec must have an elements map.";
  }
  if (!spec.elements[spec.root]) {
    return `Spec root "${spec.root}" is not present in elements.`;
  }
  for (const [id, element] of Object.entries(spec.elements)) {
    if (!isNonEmptyString(element?.type)) {
      return `Element "${id}" is missing a component type.`;
    }
    for (const childId of element.children ?? []) {
      if (!spec.elements[childId]) {
        return `Element "${id}" references unknown child "${childId}".`;
      }
    }
  }
  return null;
}

/** Render (replace) the session dashboard with a new spec. */
export async function renderDashboard(
  store: DashboardStore,
  spec: DashboardSpec,
): Promise<DashboardResult> {
  const shapeError = validateSpecShape(spec);
  if (shapeError) {
    return { success: false, error: shapeError };
  }
  try {
    await store.set(spec);
    return {
      success: true,
      root: spec.root,
      elementCount: Object.keys(spec.elements).length,
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/** Read the current session dashboard spec. */
export async function readDashboard(
  store: DashboardStore,
): Promise<DashboardResult> {
  try {
    const spec = await store.get();
    return { success: true, spec };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
