import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Defines the structure for a tool that can be executed on the client.
 * It extends the base 'Tool' type and adds the client-side implementation.
 */
export interface ClientToolDefinition<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> extends Tool {
  /**
   * The client-side function that executes the tool's logic.
   * The 'name', 'description', and 'inputSchema' properties are inherited from the base MCP Tool interface.
   */
  implementation: (args: TArgs) => Promise<TResult> | TResult;
}

// --- Protocol Message Types ---
// (The rest of the file remains the same)

// Base message structure
interface MessageBase {
  type: string;
  payload: unknown;
}

// Client -> Worker Messages (C2W)
export interface C2W_RegisterToolsMessage extends MessageBase {
  type: "c2w/register_tools";
  payload: {
    clientId: string;
    tools: Omit<ClientToolDefinition, "implementation">[];
  };
}

export interface C2W_ToolResponseMessage extends MessageBase {
  type: "c2w/tool_response";
  payload: {
    requestId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  };
}

export interface C2W_UnregisterMessage extends MessageBase {
  type: "c2w/unregister";
  payload: {
    clientId: string;
  };
}

export type ClientToWorkerMessage =
  | C2W_RegisterToolsMessage
  | C2W_ToolResponseMessage
  | C2W_UnregisterMessage;

// Worker -> Client Messages (W2C)
export interface W2C_ExecuteToolMessage extends MessageBase {
  type: "w2c/execute_tool";
  payload: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
}

export type WorkerToClientMessage = W2C_ExecuteToolMessage;
