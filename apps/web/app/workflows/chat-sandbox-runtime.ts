import { discoverSkills } from "@open-agents/agent";
import {
  connectSandbox,
  type Sandbox,
  type SandboxState,
} from "@open-agents/sandbox";
import { getSessionById } from "@/lib/db/sessions";
import { listUserSkills } from "@/lib/db/user-skills";
import {
  kickSandboxProvisioningWorkflow,
  waitForSandboxProvisioningRun,
} from "@/lib/sandbox/provisioning-kick";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getSandboxSkillDirectories } from "@/lib/skills/directories";
import {
  mergeUserSkills,
  userSkillToMetadata,
} from "@/lib/skills/user-skill-store";
import { getCachedSkills, setCachedSkills } from "@/lib/skills-cache";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;
type DiscoveredSkills = Awaited<ReturnType<typeof discoverSkills>>;

export type ResolvedChatSandboxRuntime = {
  sandboxState: SandboxState;
  workingDirectory: string;
  currentBranch?: string;
  environmentDetails?: string;
  skills: DiscoveredSkills;
  didSetupWorkspace: boolean;
  sessionTitle: string;
  repoOwner?: string;
  repoName?: string;
};

async function loadSessionSkills(params: {
  sessionId: string;
  sandboxState: SandboxState;
  sandbox: Sandbox;
}): Promise<DiscoveredSkills> {
  const cachedSkills = await getCachedSkills(
    params.sessionId,
    params.sandboxState,
  );
  if (cachedSkills !== null) {
    return cachedSkills;
  }

  const skillDirs = await getSandboxSkillDirectories(params.sandbox);
  const discoveredSkills = await discoverSkills(params.sandbox, skillDirs);
  await setCachedSkills(
    params.sessionId,
    params.sandboxState,
    discoveredSkills,
  );
  return discoveredSkills;
}

async function getReadySessionSandbox(params: {
  sessionId: string;
  userId: string;
}): Promise<{ session: SessionRecord; didSetupWorkspace: boolean }> {
  let session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (session.status === "archived") {
    throw new Error("Session is archived");
  }
  if (isSandboxActive(session.sandboxState)) {
    return { session, didSetupWorkspace: false };
  }

  const kick = await kickSandboxProvisioningWorkflow(params.sessionId);
  if (kick.runId) {
    await waitForSandboxProvisioningRun(kick.runId);
  }

  session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (!isSandboxActive(session.sandboxState)) {
    throw new Error(session.lifecycleError ?? "Workspace setup failed");
  }

  return { session, didSetupWorkspace: true };
}

export async function resolveChatSandboxRuntime(params: {
  userId: string;
  sessionId: string;
}): Promise<ResolvedChatSandboxRuntime> {
  "use step";

  const { session, didSetupWorkspace } = await getReadySessionSandbox({
    sessionId: params.sessionId,
    userId: params.userId,
  });
  const sandboxState = session.sandboxState;
  if (!sandboxState) {
    throw new Error("Workspace setup failed");
  }
  const sandbox = await connectSandbox(sandboxState);

  const discoveredSkills = await loadSessionSkills({
    sessionId: params.sessionId,
    sandboxState,
    sandbox,
  });

  // User-authored skills are loaded fresh (not cached) so newly written skills
  // are available on the next turn, then merged with sandbox-discovered ones.
  const userSkillRows = await listUserSkills(params.userId);
  const skills = mergeUserSkills(
    discoveredSkills,
    userSkillRows.map(userSkillToMetadata),
  );

  return {
    sandboxState,
    workingDirectory: sandbox.workingDirectory,
    currentBranch: sandbox.currentBranch,
    environmentDetails: sandbox.environmentDetails,
    skills,
    didSetupWorkspace,
    sessionTitle: session.title,
    repoOwner: session.repoOwner ?? undefined,
    repoName: session.repoName ?? undefined,
  };
}
