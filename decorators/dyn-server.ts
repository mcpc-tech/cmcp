import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequest,
  ListToolsRequestSchema,
  ListToolsResult,
  McpError,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolDefinition } from "../shared/types.ts";

export const ToolResponseRequestSchema: z.ZodObject<{
  method: z.ZodLiteral<"proxy/tool_response">;
  params: z.ZodObject<{
    id: z.ZodString;
    success: z.ZodBoolean;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodString>;
  }>;
}> = z.object({
  method: z.literal("proxy/tool_response"),
  params: z.object({
    id: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

export const ClientToolRegistrationRequestSchema: z.ZodObject<{
  method: z.ZodLiteral<"client/register_tools">;
  params: z.ZodObject<{
    clientId: z.ZodString;
    tools: z.ZodArray<z.ZodObject<{
      name: z.ZodString;
      description: z.ZodString;
      inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }>>;
  }>;
}> = z.object({
  method: z.literal("client/register_tools"),
  params: z.object({
    clientId: z.string(),
    tools: z.array(z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.unknown()),
    })),
  }),
});

export class DynServer {
  private server: Server;
  private clientId: string;
  private tools: Map<string, Tool> = new Map();
  private clientTools: Map<string, Set<string>> = new Map(); // clientId -> tool names
  private toolToClient: Map<string, string> = new Map(); // toolName -> clientId
  private useNamespacing: boolean = false; // Enable namespacing for tool isolation
  private pendingRequests: Map<string, {
    resolve: (value: CallToolResult) => void;
    reject: (reason: Error | McpError) => void;
    timeout: number;
  }> = new Map();
  private requestTimeoutMs = 30000; // 30 seconds timeout

  constructor(server: Server, clientId: string) {
    this.server = server;
    this.clientId = clientId;

    this.setupStandardHandlers();

    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        const serverProp = target.server[prop as keyof typeof target.server];
        if (typeof serverProp === "function") {
          return serverProp.bind(target.server);
        }
        return serverProp;
      },
    }) as unknown as DynServer & Server;
  }

  private setupStandardHandlers() {
    // Handle tool list requests
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      return { tools: Array.from(this.tools.values()) };
    });

    // Handle tool call requests
    this.server.setRequestHandler(CallToolRequestSchema, (request, _extra) => {
      return this.callTool(request.params);
    });

    // Handle client tool registration
    this.server.setRequestHandler(
      ClientToolRegistrationRequestSchema,
      (request) => this.handleClientToolRegistration(request.params)
    );

    // Handle client tool execution responses
    this.server.setRequestHandler(
      ToolResponseRequestSchema,
      (request) => this.handleClientResponse(request.params),
    );
  }

  /**
   * Enable or disable tool namespacing for multi-client isolation
   */
  setNamespacing(enabled: boolean) {
    this.useNamespacing = enabled;
  }

  /**
   * Generate tool name with optional namespacing
   */
  private getToolName(clientId: string, toolName: string): string {
    return this.useNamespacing ? `${clientId}:${toolName}` : toolName;
  }

  /**
   * Extract original tool name from namespaced name
   */
  private getOriginalToolName(namespacedName: string): string {
    if (this.useNamespacing && namespacedName.includes(':')) {
      return namespacedName.split(':').slice(1).join(':');
    }
    return namespacedName;
  }

  /**
   * Handle client tool registration
   */
  handleClientToolRegistration(params: {
    clientId: string;
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>;
  }): { status: string; registeredTools: string[]; conflicts: string[] } {
    const { clientId, tools } = params;

    // Clean up previous tools from this client
    this.unregisterClientTools(clientId);

    // Register new tools
    const registeredTools: string[] = [];
    const conflicts: string[] = [];
    const clientToolNames = new Set<string>();

    for (const tool of tools) {
      const toolName = this.getToolName(clientId, tool.name);
      
      // Check for tool name conflicts
      if (this.tools.has(toolName)) {
        const existingOwner = this.toolToClient.get(toolName);
        
        if (this.useNamespacing) {
          // With namespacing, this shouldn't happen unless there's a bug
          console.error(`Unexpected tool name conflict with namespacing: ${toolName}`);
          conflicts.push(tool.name);
          continue;
        } else {
          // Without namespacing, handle conflicts based on strategy
          console.warn(`Tool ${tool.name} already exists, owned by client ${existingOwner}. Skipping registration for client ${clientId}`);
          conflicts.push(tool.name);
          continue;
        }
      }

      this.tools.set(toolName, {
        name: this.useNamespacing ? tool.name : toolName, // Keep original name for display
        description: this.useNamespacing 
          ? `[${clientId}] ${tool.description}` 
          : tool.description,
        inputSchema: tool.inputSchema as Tool["inputSchema"],
      });

      clientToolNames.add(toolName);
      registeredTools.push(tool.name); // Return original name to client
      this.toolToClient.set(toolName, clientId);
    }

    this.clientTools.set(clientId, clientToolNames);

    console.log(`Client ${clientId} registered ${registeredTools.length} tools:`, registeredTools);
    if (conflicts.length > 0) {
      console.warn(`Client ${clientId} had ${conflicts.length} tool conflicts:`, conflicts);
    }

    return {
      status: "success",
      registeredTools,
      conflicts,
    };
  }

  /**
   * Unregister all tools from a specific client
   */
  unregisterClientTools(clientId: string) {
    const clientToolNames = this.clientTools.get(clientId);
    if (clientToolNames) {
      for (const toolName of clientToolNames) {
        this.tools.delete(toolName);
        this.toolToClient.delete(toolName); // Remove tool-to-client mapping
      }
      this.clientTools.delete(clientId);
      console.log(`Unregistered tools for client ${clientId}:`, Array.from(clientToolNames));
    }
  }

  /**
   * Register tools (static registration for backward compatibility)
   */
  registerToolSchemas(tools: ToolDefinition[]) {
    for (const tool of tools) {
      const toolName = this.getToolName('server', tool.name);
      this.tools.set(toolName, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
      this.toolToClient.set(toolName, 'server'); // Mark as server-owned
    }
  }

  /**
   * Notify client to execute tool via notification
   */
  private async notifyClientExecute(
    requestId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const targetClientId = this.toolToClient.get(toolName);
    if (!targetClientId) {
      throw new Error(`No client found for tool: ${toolName}`);
    }

    // If it's a server-owned tool, handle differently
    if (targetClientId === 'server') {
      throw new Error(`Server-owned tools cannot be executed remotely: ${toolName}`);
    }

    const originalToolName = this.getOriginalToolName(toolName);

    await this.server.notification({
      method: "proxy/execute_tool",
      params: {
        id: requestId,
        toolName: originalToolName, // Send original name to client
        args,
        clientId: targetClientId,
      },
    });
  }

  /**
   * Handle tool execution response from client
   */
  handleClientResponse(params: {
    id: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }): { status: string } {
    const pending = this.pendingRequests.get(params.id);
    if (!pending) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Request not found",
      );
    }

    // Clear timeout and pending request
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(params.id);

    if (params.success) {
      const result: CallToolResult = {
        content: [
          {
            type: "text",
            text: typeof params.result === "string"
              ? params.result
              : JSON.stringify(params.result, null, 2),
          },
        ],
      };
      pending.resolve(result);
    } else {
      const errorResult: CallToolResult = {
        content: [
          {
            type: "text",
            text: `Tool execution failed: ${params.error || "Unknown error"}`,
          },
        ],
        isError: true,
      };
      pending.resolve(errorResult);
    }

    return { status: "received" };
  }

  /**
   * List all tools
   */
  listTools(
    _params?: ListToolsRequest["params"],
    _options?: unknown,
  ): Promise<ListToolsResult> {
    const toolList = Array.from(this.tools.values());
    return Promise.resolve({ tools: toolList });
  }

  /**
   * Call tool
   */
  async callTool(
    params: CallToolRequest["params"],
    _resultSchema?: unknown,
    _options?: unknown,
  ): Promise<CallToolResult> {
    const { name, arguments: args } = params;

    // Check if tool exists
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool ${name} not found`,
      );
    }

    const requestId = crypto.randomUUID();

    // Create Promise to wait for execution result
    const resultPromise = new Promise<CallToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new McpError(
            ErrorCode.InternalError,
            `Tool execution timeout for ${name}`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });
    });

    try {
      // Notify client to execute tool via notification
      await this.notifyClientExecute(requestId, name, args || {});
    } catch (error) {
      // Clean up pending request
      const pending = this.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to notify client: ${error}`,
      );
    }

    return await resultPromise;
  }

  /**
   * Handle client disconnect
   */
  handleClientDisconnect(clientId: string) {
    this.unregisterClientTools(clientId);
  }

  /**
   * Set request timeout
   */
  setRequestTimeout(timeoutMs: number) {
    this.requestTimeoutMs = timeoutMs;
  }

  /**
   * Get status information
   */
  getStatus(): {
    clientId: string;
    registeredTools: string[];
    connectedClients: string[];
    clientToolMapping: Record<string, string[]>;
    pendingRequests: number;
  } {
    return {
      clientId: this.clientId,
      registeredTools: Array.from(this.tools.keys()),
      connectedClients: Array.from(this.clientTools.keys()),
      clientToolMapping: Object.fromEntries(
        Array.from(this.clientTools.entries()).map(([clientId, tools]) => [
          clientId,
          Array.from(tools),
        ])
      ),
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Clean up all pending requests
    for (const [_requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(
        new McpError(
          ErrorCode.InternalError,
          "Server shutdown",
        ),
      );
    }
    this.pendingRequests.clear();
  }
}

export function createDynServer(
  server: Server,
  clientId: string,
): DynServer & Server {
  return new DynServer(server, clientId) as unknown as DynServer & Server;
}
