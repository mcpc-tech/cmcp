import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool definition with implementation function.
 * Extends the base MCP Tool type with an execution handler.
 */
export interface ClientToolDefinition extends Tool {
  /**
   * Function to execute when this tool is called.
   * @param args - Tool arguments as defined in inputSchema
   * @returns Tool execution result
   */
  implementation: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

// --- Protocol Message Types ---

// Client -> Worker Messages
export interface RegisterToolsMessage {
  type: "c2w/register_tools";
  payload: {
    clientId: string;
    tools: Omit<ClientToolDefinition, "implementation">[];
  };
}

export interface ToolResponseMessage {
  type: "c2w/tool_response";
  payload: {
    requestId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  };
}

export interface UnregisterMessage {
  type: "c2w/unregister";
  payload: {
    clientId: string;
  };
}

export type ClientToWorkerMessage =
  | RegisterToolsMessage
  | ToolResponseMessage
  | UnregisterMessage;

// Worker -> Client Messages
export interface ExecuteToolMessage {
  type: "w2c/execute_tool";
  payload: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
}

export type WorkerToClientMessage = ExecuteToolMessage;
