import type { McpJsRuntimeConfig } from "@open-agents/sandbox";
import { z } from "zod";

/** Validation for a single host-capability policy. */
const capabilityPolicySchema = z
  .object({
    enabled: z.boolean().optional(),
    opaUrls: z.array(z.string().url()).optional(),
  })
  .strict();

/**
 * Validates a session's declarative mcp-js runtime config (the `mcpJs` field of
 * the session-creation request). Kept in lockstep with {@link McpJsRuntimeConfig}.
 */
export const mcpJsRuntimeConfigSchema = z
  .object({
    heapMemoryMaxMb: z.number().int().positive().optional(),
    workingDirectory: z.string().min(1).optional(),
    capabilities: z
      .object({
        fetch: capabilityPolicySchema.optional(),
        filesystem: capabilityPolicySchema.optional(),
        subprocess: capabilityPolicySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Compile-time guarantee the schema output matches the shared package type.
type SchemaOutput = z.infer<typeof mcpJsRuntimeConfigSchema>;
const _typeCheck: McpJsRuntimeConfig = {} as SchemaOutput;
void _typeCheck;

/** Parse and validate an unknown value as an {@link McpJsRuntimeConfig}. */
export function parseMcpJsRuntimeConfig(value: unknown): McpJsRuntimeConfig {
  return mcpJsRuntimeConfigSchema.parse(value);
}
