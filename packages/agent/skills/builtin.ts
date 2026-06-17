/**
 * Built-in skills that ship with the agent and are always available (merged
 * into every session alongside sandbox-discovered and user-authored skills).
 * They carry their body inline, so the `skill` tool serves them without reading
 * a sandbox file.
 */

import type { SkillMetadata } from "./types";

const ARCHITECTURE_SELECTOR_BODY = `# Choosing a multi-agent architecture

Pick the coordination topology that matches the **task structure**, not "more
agents is better." Based on "Towards a Science of Scaling Agent Systems"
(arXiv 2512.08296). Mismatched coordination *degrades* performance.

## Step 1 — Estimate task properties
- **toolCount (T):** how many distinct tools the task needs.
- **singleAgentBaseline (P_SA):** roughly, would one strong agent already solve
  this? (0 = no, 1 = almost always).
- **decomposable:** can it split into independent subtasks done in parallel?
- **sequential:** does it require strictly ordered, interdependent steps?
- **highEntropySearch:** open-ended parallel exploration (e.g. web research)?
- **ensemble:** do you just want several independent attempts to aggregate/vote?

## Step 2 — Apply the rules (first match wins)
1. **P_SA ≥ 0.45 → \`sas\` (single agent).** Capability saturation: this is the
   most robust finding — coordination is a net cost once a single agent is
   already good. Don't spawn a team.
2. **sequential → \`sas\`.** Strict step-by-step planning degrades under *every*
   multi-agent variant (−39% to −70% in the paper).
3. **domainComplexity > 0.40, not decomposable, not search → \`sas\`.**
4. **ensemble → \`independent\`.** Run N agents in parallel, no peer comms, then
   concatenate/vote. Cheapest parallel topology; no verification.
5. **highEntropySearch → \`decentralized\`.** Peer-to-peer debate explores
   breadth then converges (e.g. web navigation +9.2%).
6. **decomposable AND T ≥ 7 → \`decentralized\`.** Tool-heavy work makes an
   orchestrator a bottleneck; peers parallelize better.
7. **decomposable → \`centralized\`.** An orchestrator assigns subtasks and acts
   as a validation bottleneck (lowest error amplification ~4.4×). Best for
   decomposable analysis (Finance +80.8%).
8. **T ≤ 4 and no decomposition → \`sas\`.** Coordination overhead isn't justified.
9. **Otherwise → \`centralized\`** (supervised coordination with verification).

\`hybrid\` (orchestrator + limited peer rounds) has the highest overhead (515%)
and is rarely optimal; use it only as a "least-worst" choice in degrading domains
when you must run a team.

## Step 3 — Act
- If the answer is **sas**, just do the task yourself (no spawning).
- Otherwise, build the team with the spawn/messaging tools:
  - **independent:** \`spawn_session\` N workers with the same goal; collect with
    \`session_result\`; synthesize (no cross-checking).
  - **centralized:** \`spawn_session\` N followers, hand each a subtask via
    \`send_message\`, gather results, cross-check, and synthesize.
  - **decentralized:** \`spawn_session\` N peers (role: "peer"); run debate rounds
    by \`send_message\` (kind "debate") between them and \`wait_for_message\`;
    converge on consensus.
  - **hybrid:** centralized rounds plus a few peer-exchange rounds.

Default team size n=3; centralized/hybrid up to r=5 orchestrator rounds;
decentralized d=3 debate rounds.

State your chosen architecture and a one-line rationale before spawning.

$ARGUMENTS`;

export const architectureSelectorSkill: SkillMetadata = {
  name: "architecture-selector",
  description:
    "Decide whether to use a single agent or a multi-agent team, and which topology (independent/centralized/decentralized/hybrid), from measurable task properties. Use before spawning sub-agents.",
  path: "",
  filename: "",
  options: {},
  source: "builtin",
  body: ARCHITECTURE_SELECTOR_BODY,
};

/** All built-in skills, always merged into a session's skill set. */
export const BUILTIN_SKILLS: SkillMetadata[] = [architectureSelectorSkill];
