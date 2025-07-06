/// <reference lib="webworker" />
import type {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  ClientToWorkerMessage,
  W2C_ExecuteToolMessage,
} from "@mcpc/cmcp/types";

interface PendingRequest {
  resolve: (value: CallToolResult) => void;
  reject: (reason: Error | McpError) => void;
  timeoutId: number;
}

export class ClientExecServerWorker {
  private tools: Map<string, Tool> = new Map(); // Key: namespaced tool name
  private clientTools: Map<string, Set<string>> = new Map(); // Key: clientId, Value: Set of namespaced tool names
  private toolToClient: Map<string, string> = new Map(); // Key: namespaced tool name, Value: clientId
  private pendingRequests: Map<string, PendingRequest> = new Map(); // Key: requestId

  private useNamespacing = true;
  private requestTimeoutMs = 30000;

  constructor() {
    // The message handler should be bound to the class instance
    self.onmessage = this.handleClientMessage.bind(this);
    console.log(
      "ClientExecServerWorker initialized and listening for messages.",
    );
  }

  /**
   * Enables or disables namespacing for tool names (e.g., "clientId:toolName").
   * Recommended to be `true` to avoid conflicts between clients.
   */
  public setNamespacing(enabled: boolean): void {
    this.useNamespacing = enabled;
  }

  public setRequestTimeout(timeoutMs: number): void {
    this.requestTimeoutMs = timeoutMs;
  }

  // --- Private Message Handlers ---

  private handleClientMessage(
    event: MessageEvent<ClientToWorkerMessage>,
  ): void {
    const { type, payload } = event.data;
    switch (type) {
      case "c2w/register_tools":
        this.handleClientToolRegistration(payload as any);
        break;
      case "c2w/tool_response":
        this.handleToolResponse(payload as any);
        break;
      case "c2w/unregister":
        this.handleClientDisconnect((payload as any).clientId);
        break;
      default:
        console.warn("Server worker received an unknown message type:", type);
    }
  }

  private handleClientToolRegistration(params: {
    clientId: string;
    tools: Tool[];
  }): void {
    const { clientId, tools } = params;
    // First, unregister any existing tools for this client to handle reconnections
    this.unregisterClientTools(clientId);

    const registeredToolNames = new Set<string>();
    console.log(`Registering ${tools.length} tools for client: ${clientId}`);

    for (const tool of tools) {
      const toolName = this.getToolName(clientId, tool.name);
      if (this.tools.has(toolName)) {
        console.warn(
          `Tool name conflict: "${tool.name}" from client "${clientId}" already exists. It will be overwritten.`,
        );
      }
      this.tools.set(toolName, {
        name: toolName,
        description: this.useNamespacing
          ? `[${clientId}] ${tool.description}`
          : tool.description,
        inputSchema: tool.inputSchema,
      });
      registeredToolNames.add(toolName);
      this.toolToClient.set(toolName, clientId);
    }
    this.clientTools.set(clientId, registeredToolNames);
  }

  private handleToolResponse(params: {
    requestId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): void {
    const pending = this.pendingRequests.get(params.requestId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(params.requestId);

    if (params.success) {
      const resultText = typeof params.result === "string"
        ? params.result
        : JSON.stringify(params.result, null, 2);
      pending.resolve({
        content: [{ type: "text", text: resultText }],
      });
    } else {
      pending.resolve({
        content: [
          { type: "text", text: `Tool execution failed: ${params.error}` },
        ],
        isError: true,
      });
    }
  }

  private handleClientDisconnect(clientId: string): void {
    console.log(`Client ${clientId} disconnected. Unregistering its tools.`);
    this.unregisterClientTools(clientId);
  }

  private unregisterClientTools(clientId: string): void {
    const clientToolNames = this.clientTools.get(clientId);
    if (clientToolNames) {
      for (const toolName of clientToolNames) {
        this.tools.delete(toolName);
        this.toolToClient.delete(toolName);
      }
      this.clientTools.delete(clientId);
    }
  }

  // --- Public API Methods (for ModelContextProtocol) ---

  public async listTools(
    _params?: ListToolsRequest["params"],
  ): Promise<ListToolsResult> {
    return { tools: Array.from(this.tools.values()) };
  }

  public async callTool(
    params: CallToolRequest["params"],
  ): Promise<CallToolResult> {
    const { name: toolName, arguments: args } = params;
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool "${toolName}" not found.`,
      );
    }

    const targetClientId = this.toolToClient.get(toolName);
    if (!targetClientId) {
      throw new McpError(
        ErrorCode.InternalError,
        `No client mapping found for tool: ${toolName}`,
      );
    }

    const requestId = crypto.randomUUID();

    // Create and store the promise hooks
    const resultPromise = new Promise<CallToolResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new McpError(
            ErrorCode.InternalError,
            `Tool execution for "${toolName}" timed out after ${this.requestTimeoutMs}ms.`,
          ),
        );
      }, this.requestTimeoutMs) as unknown as number;

      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
    });

    // Send execution request to the client
    const executeMessage: W2C_ExecuteToolMessage = {
      type: "w2c/execute_tool",
      payload: {
        requestId,
        toolName: this.getOriginalToolName(toolName), // Send the non-namespaced name
        args: args || {},
      },
    };

    (self as any).postMessage(executeMessage);

    return resultPromise;
  }

  public cleanup(): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(
        new McpError(ErrorCode.InternalError, "Server is shutting down."),
      );
      this.pendingRequests.delete(requestId);
    }
    this.tools.clear();
    this.clientTools.clear();
    this.toolToClient.clear();
    self.onmessage = null; // Stop listening
    console.log("ClientExecServerWorker cleaned up.");
  }

  // --- Helpers ---

  private getToolName(clientId: string, toolName: string): string {
    return this.useNamespacing ? `${clientId}:${toolName}` : toolName;
  }

  private getOriginalToolName(namespacedName: string): string {
    if (this.useNamespacing && namespacedName.includes(":")) {
      return namespacedName.split(":").slice(1).join(":");
    }
    return namespacedName;
  }
}

// --- Worker Entry Point ---
// This ensures that there is only one instance of the server in the worker's global scope.
const server = new ClientExecServerWorker();

// Example of how you might expose the server's public methods to an external caller
// This part is application-specific and depends on how the worker is invoked.
// For now, the server simply listens for messages via `self.onmessage`.
