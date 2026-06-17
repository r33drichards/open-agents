/**
 * Architecture selector for multi-agent teams.
 *
 * Encodes the decision procedure from "Towards a Science of Scaling Agent
 * Systems" (arXiv 2512.08296, §4.3 + Appendix C): pick the coordination
 * topology that matches measurable task structure rather than "more agents is
 * better". The single most robust finding is the capability-saturation boundary
 * (~0.45 single-agent baseline); coordination is a net cost above it.
 *
 * Pure and dependency-free so it can be unit tested directly and reused by the
 * orchestrator. The `tool()` / skill wrappers live elsewhere.
 */

export type SelectedArchitecture =
  | "sas"
  | "independent"
  | "centralized"
  | "decentralized"
  | "hybrid";

export interface ArchitectureSelectionInput {
  /** Number of distinct tools the task exposes (T). */
  toolCount: number;
  /**
   * Estimated single-agent success rate in [0,1] (P_SA). When a strong model
   * already solves the task alone, coordination yields diminishing returns.
   */
  singleAgentBaseline?: number;
  /** Task splits into independent subtasks analyzable in parallel. */
  decomposable?: boolean;
  /** Task requires strictly ordered, interdependent steps (e.g. planning). */
  sequential?: boolean;
  /** Open-ended parallel exploration of a high-entropy space (e.g. web search). */
  highEntropySearch?: boolean;
  /** Independent parallel attempts to be aggregated/voted (ensemble sampling). */
  ensemble?: boolean;
  /** Optional domain complexity score D in [0,1] (Appendix C). */
  domainComplexity?: number;
}

export interface ArchitectureSelection {
  architecture: SelectedArchitecture;
  /** Suggested topology parameters (n agents, r/d/p rounds). */
  config: { n: number; r: number; d: number; p: number };
  rationale: string;
}

/** Capability-saturation boundary on the single-agent baseline (paper §4.3). */
export const CAPABILITY_SATURATION_BASELINE = 0.45;
/** Domain-complexity threshold above which coordination tends to hurt (App. C). */
export const DOMAIN_COMPLEXITY_THRESHOLD = 0.4;
/** Tool count at/above which orchestrator bottlenecks become costly (§4.3). */
export const TOOL_HEAVY_THRESHOLD = 7;
/** Tool count at/below which coordination overhead is rarely justified. */
export const LOW_TOOL_THRESHOLD = 4;

function configFor(
  architecture: SelectedArchitecture,
): ArchitectureSelection["config"] {
  // Defaults follow the paper's Appendix E.2.
  if (architecture === "sas") {
    return { n: 1, r: 0, d: 0, p: 0 };
  }
  if (architecture === "decentralized") {
    return { n: 3, r: 0, d: 3, p: 0 };
  }
  if (architecture === "hybrid") {
    return { n: 3, r: 5, d: 0, p: 1 };
  }
  if (architecture === "independent") {
    return { n: 3, r: 0, d: 0, p: 0 };
  }
  // centralized
  return { n: 3, r: 5, d: 0, p: 0 };
}

function decide(input: ArchitectureSelectionInput): {
  architecture: SelectedArchitecture;
  rationale: string;
} {
  const {
    toolCount,
    singleAgentBaseline,
    decomposable,
    sequential,
    highEntropySearch,
    ensemble,
    domainComplexity,
  } = input;

  if (
    singleAgentBaseline !== undefined &&
    singleAgentBaseline >= CAPABILITY_SATURATION_BASELINE
  ) {
    return {
      architecture: "sas",
      rationale: `Single-agent baseline (~${singleAgentBaseline.toFixed(2)}) is at/above the ${CAPABILITY_SATURATION_BASELINE} capability-saturation boundary, so coordination would be a net cost. Use a single agent.`,
    };
  }

  if (sequential) {
    return {
      architecture: "sas",
      rationale:
        "Task has strict sequential interdependence (e.g. planning); all multi-agent variants degrade here because coordination fragments the reasoning budget. Use a single agent.",
    };
  }

  if (
    domainComplexity !== undefined &&
    domainComplexity > DOMAIN_COMPLEXITY_THRESHOLD &&
    !highEntropySearch &&
    !decomposable
  ) {
    return {
      architecture: "sas",
      rationale: `Domain complexity (${domainComplexity.toFixed(2)}) exceeds the ${DOMAIN_COMPLEXITY_THRESHOLD} threshold without a parallelizable structure; coordination overhead would dominate. Use a single agent.`,
    };
  }

  if (ensemble) {
    return {
      architecture: "independent",
      rationale:
        "Ensemble/parallel-sampling task: run independent attempts and aggregate. No cross-agent verification needed, so the cheapest parallel topology fits.",
    };
  }

  if (highEntropySearch) {
    return {
      architecture: "decentralized",
      rationale:
        "Open-ended, high-entropy parallel exploration (e.g. web navigation) benefits from peer-to-peer information fusion; decentralized debate explores breadth then converges.",
    };
  }

  if (decomposable && toolCount >= TOOL_HEAVY_THRESHOLD) {
    return {
      architecture: "decentralized",
      rationale: `Decomposable but tool-heavy (T=${toolCount} ≥ ${TOOL_HEAVY_THRESHOLD}): an orchestrator bottleneck would compound the tool-coordination tax, so prefer decentralized peers where parallelization and redundancy outweigh efficiency losses.`,
    };
  }

  if (decomposable) {
    return {
      architecture: "centralized",
      rationale:
        "Task decomposes into independent parallel subtasks; a central orchestrator assigns work and acts as a validation bottleneck (lowest error amplification, ~4.4x), giving the largest gains on decomposable analysis.",
    };
  }

  if (toolCount <= LOW_TOOL_THRESHOLD) {
    return {
      architecture: "sas",
      rationale: `Low tool count (T=${toolCount} ≤ ${LOW_TOOL_THRESHOLD}) and no clear decomposition; orchestration overhead is not justified. Use a single agent.`,
    };
  }

  return {
    architecture: "centralized",
    rationale:
      "No strong decomposition signal but enough tool surface to benefit from supervised coordination; centralized adds a verification bottleneck while containing overhead.",
  };
}

/** Recommend a coordination architecture from measurable task properties. */
export function selectArchitecture(
  input: ArchitectureSelectionInput,
): ArchitectureSelection {
  const { architecture, rationale } = decide(input);
  return { architecture, config: configFor(architecture), rationale };
}
