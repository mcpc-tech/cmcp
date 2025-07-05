import { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool definition with client-side implementation
 * Used by clients to define tools that execute locally
 */
export interface ToolDefinition extends Tool {
  implementation: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}
