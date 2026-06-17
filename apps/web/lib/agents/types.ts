/**
 * Shared types for multi-agent teams (spawnable sub-sessions).
 *
 * A "team" is a leader session that spawns a group of follower/peer sessions
 * coordinating under one of the five canonical topologies characterized in
 * "Towards a Science of Scaling Agent Systems" (arXiv 2512.08296):
 *   - sas:           single agent, no coordination (baseline)
 *   - independent:   N agents in parallel, aggregator concatenates (no peer comms)
 *   - centralized:   orchestrator decomposes/assigns/verifies across r rounds
 *   - decentralized: all-to-all peer debate across d rounds, then consensus
 *   - hybrid:        centralized control + limited peer rounds
 */

export const AGENT_ARCHITECTURES = [
  "sas",
  "independent",
  "centralized",
  "decentralized",
  "hybrid",
] as const;

export type AgentArchitecture = (typeof AGENT_ARCHITECTURES)[number];

export const AGENT_GROUP_ROLES = ["leader", "follower", "peer"] as const;
export type AgentGroupRole = (typeof AGENT_GROUP_ROLES)[number];

export const AGENT_GROUP_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AgentGroupStatus = (typeof AGENT_GROUP_STATUSES)[number];

export const AGENT_MESSAGE_SENDER_ROLES = [
  "leader",
  "follower",
  "peer",
  "human",
  "system",
] as const;
export type AgentMessageSenderRole =
  (typeof AGENT_MESSAGE_SENDER_ROLES)[number];

export const AGENT_MESSAGE_KINDS = [
  "task",
  "result",
  "status",
  "debate",
  "vote",
  "broadcast",
] as const;
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number];

/**
 * Topology configuration for an agent group. Defaults follow the paper's
 * Appendix E.2: n=3 agents, r=5 orchestrator rounds, d=3 debate rounds.
 */
export interface AgentGroupConfig {
  /** Number of follower/peer agents to spawn. */
  n?: number;
  /** Max orchestrator rounds (centralized/hybrid). */
  r?: number;
  /** Max debate rounds (decentralized). */
  d?: number;
  /** Peer-exchange rounds (hybrid). */
  p?: number;
  /** Per-group token budget guard. */
  maxTokens?: number;
  /** Spawn-depth of the leader, used to bound recursive spawning. */
  depth?: number;
}

/** Default topology parameters from the paper (Appendix E.2). */
export const DEFAULT_AGENT_GROUP_CONFIG: Required<
  Pick<AgentGroupConfig, "n" | "r" | "d" | "p">
> = {
  n: 3,
  r: 5,
  d: 3,
  p: 1,
};

/** Bound on recursive spawning to prevent runaway fan-out (Phase 5 guard). */
export const MAX_SPAWN_DEPTH = 2;
/** Bound on concurrent followers per group. */
export const MAX_GROUP_AGENTS = 8;
