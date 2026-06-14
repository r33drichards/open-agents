// interface
export type {
  ExecResult,
  Sandbox,
  SandboxHook,
  SandboxHooks,
  SandboxStats,
  SandboxType,
  SnapshotResult,
} from "./interface.ts";

// shared types
export type { Source, FileEntry, SandboxStatus } from "./types.ts";

// factory
export {
  connectSandbox,
  type SandboxState,
  type ConnectOptions,
  type SandboxConnectConfig,
} from "./factory.ts";

// git helpers
export {
  hasUncommittedChanges,
  stageAll,
  getCurrentBranch,
  getHeadSha,
  getStagedDiff,
  getChangedFiles,
  detectBinaryFiles,
  readFileContents,
  getFileModes,
  syncToRemote,
  syncToRemotePreservingChanges,
  withTemporaryGitHubAuth,
  type FileChange,
  type FileChangeStatus,
  type FileWithContent,
} from "./git.ts";

// vercel
export {
  connectVercelSandbox,
  VercelSandbox,
  type VercelSandboxConfig,
  type VercelSandboxConnectConfig,
  type VercelState,
} from "./vercel/index.ts";

// mcp-js (mcp-v8)
export {
  connectMcpJs,
  createMcpV8Client,
  DEFAULT_MCP_JS_WORKING_DIRECTORY,
  type McpJsCapabilities,
  type McpJsCapabilityPolicy,
  type McpJsRuntimeConfig,
  McpJsSandbox,
  type McpJsSandboxConfig,
  type McpJsState,
  McpJsUnsupportedOperationError,
  McpV8Client,
  McpV8Error,
  type RunJsOptions,
  type RunJsResult,
} from "./mcp-js/index.ts";
