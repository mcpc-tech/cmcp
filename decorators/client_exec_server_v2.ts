import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  type ListToolsRequest,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  type Tool,
  type ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ClientToolDefinition } from "../shared/types.ts";

type ToolType = z.infer<typeof ToolSchema>;

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
    tools: z.ZodArray<
      z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
      }>
    >;
  }>;
}> = z.object({
  method: z.literal("client/register_tools"),
  params: z.object({
    clientId: z.string(),
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.record(z.unknown()),
      }),
    ),
  }),
});

/**
 * Server-side decorator that enables MCP servers to execute client-registered tools.
 *
 * This class wraps an MCP server and extends it with the capability to:
 * - Accept tool registrations from connected clients
 * - Route tool execution requests to the appropriate client
 * - Handle tool execution responses and timeout management
 * - Provide tool namespacing to avoid conflicts between clients
 *
 * The ClientExecServer acts as a proxy, maintaining a registry of tools provided by
 * different clients and routing execution requests appropriately. It seamlessly
 * integrates with the standard MCP protocol while adding remote tool execution capabilities.
 *
 * @example
 * ```typescript
 * import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 * import { ClientExecServer } from "./client_exec_server_v2.ts";
 *
 * const server = new Server({ name: "my-server", version: "1.0.0" });
 * const clientExecServer = new ClientExecServer(server, "main-client");
 *
 * // The server now automatically handles client tool registrations
 * // and can execute tools registered by connected clients
 * ```
 */
export class ClientExecServer {
  private server: Server;
  private clientId: string;
  private tools: Map<string, Tool> = new Map();
  private clientTools: Map<string, Set<string>> = new Map(); // clientId -> tool names
  private toolToClient: Map<string, string> = new Map(); // toolName -> clientId
  private useNamespacing: boolean = false; // Enable namespacing for tool isolation
  private pendingRequests: Map<
    string,
    {
      resolve: (value: CallToolResult) => void;
      reject: (reason: Error | McpError) => void;
      timeout: number;
    }
  > = new Map();
  private requestTimeoutMs = 30000; // 30 seconds timeout

  constructor(server: Server, clientId: string) {
    this.server = server;
    this.clientId = clientId;
    this.setupStandardHandlers();
  }

  /**
   * Calls a JSON-RPC method on the server.
   */
  private getServerRequestHandler<TReq, TRes>(
    method: string,
  ):
    | ((
      request: TReq,
      extra?: unknown,
    ) => Promise<TRes>)
    | undefined {
    // @ts-expect-error - _requestHandlers is private, but we need to access it
    return (this.server._requestHandlers as Map<
      string,
      (request: TReq, extra?: unknown) => Promise<TRes>
    >).get(method)
      ?.bind(
        this.server,
      );
  }

  private setupStandardHandlers() {
    const toolListHandler = this.getServerRequestHandler<
      ListToolsRequest,
      ListToolsResult
    >(
      ListToolsRequestSchema.shape.method.value,
    );
    const toolCallHandler = this.getServerRequestHandler<
      CallToolRequest,
      CallToolResult
    >(
      CallToolRequestSchema.shape.method.value,
    );

    this.server.setRequestHandler(ListToolsRequestSchema, (request, _extra) => {
      return this.listTools(
        toolListHandler,
        request,
        _extra,
      );
    });

    // Handle tool call requests
    this.server.setRequestHandler(CallToolRequestSchema, (request, _extra) => {
      return this.callTool(
        toolCallHandler,
        request,
        _extra,
      );
    });

    // Handle client tool registration
    this.server.setRequestHandler(
      ClientToolRegistrationRequestSchema,
      (request) => this.handleClientToolRegistration(request.params),
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
    if (this.useNamespacing && namespacedName.includes(":")) {
      return namespacedName.split(":").slice(1).join(":");
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
          console.error(
            `Unexpected tool name conflict with namespacing: ${toolName}`,
          );
          conflicts.push(tool.name);
          continue;
        } else {
          // Without namespacing, handle conflicts based on strategy
          console.warn(
            `Tool ${tool.name} already exists, owned by client ${existingOwner}. Skipping registration for client ${clientId}`,
          );
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

    if (conflicts.length > 0) {
      console.warn(
        `Client ${clientId} had ${conflicts.length} tool conflicts:`,
        conflicts,
      );
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
    }
  }

  /**
   * Register tools (static registration for backward compatibility)
   */
  registerToolSchemas(tools: ClientToolDefinition[]) {
    for (const tool of tools) {
      const toolName = this.getToolName("server", tool.name);
      this.tools.set(toolName, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
      this.toolToClient.set(toolName, "server"); // Mark as server-owned
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
    if (targetClientId === "server") {
      throw new Error(
        `Server-owned tools cannot be executed remotely: ${toolName}`,
      );
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
      throw new McpError(ErrorCode.InvalidRequest, "Request not found");
    }

    // Clear timeout and pending request
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(params.id);

    pending.resolve(params.result as CallToolResult);

    return { status: "received" };
  }

  /**
   * List all tools
   */
  async listTools(
    toolListHandler:
      | ((
        request: ListToolsRequest,
        extra?: unknown,
      ) => Promise<ListToolsResult>)
      | undefined,
    request: ListToolsRequest,
    extra: unknown,
  ): Promise<ListToolsResult> {
    // Server predefined tools
    const { tools: serverTools } = (await toolListHandler?.(request, extra)) ??
      ({ tools: [] } as {
        tools: ToolType[];
      });
    const toolList = Array.from(this.tools.values());
    return Promise.resolve({ tools: toolList.concat(serverTools) });
  }

  /**
   * Call tool
   */
  async callTool(
    toolCallHandler:
      | ((request: CallToolRequest, extra?: unknown) => Promise<CallToolResult>)
      | undefined,
    request: CallToolRequest,
    extra?: unknown,
  ): Promise<CallToolResult> {
    const { name, arguments: args } = request.params;
    // Check if tool exists
    const tool = this.tools.get(name);
    if (!tool) {
      if (!toolCallHandler) {
        throw new McpError(ErrorCode.InvalidRequest, "Tool not found");
      }
      return toolCallHandler?.(request, extra);
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
        ]),
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
      pending.reject(new McpError(ErrorCode.InternalError, "Server shutdown"));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the underlying server instance
   */
  unwrap(): Server {
    return this.server;
  }
}

/**
 * Creates a new ClientExecServer instance that decorates an MCP server with client tool execution capabilities.
 *
 * This factory function creates a ClientExecServer that acts as a transparent proxy to the original
 * MCP server while adding the ability to register and execute tools from connected clients.
 * The returned object can be used as a drop-in replacement for the original server.
 *
 * @param server - The MCP server instance to decorate with client execution capabilities
 * @param clientId - Unique identifier for this server instance (used for tool namespacing)
 * @returns A decorated server that supports both local and remote client tool execution
 *
 * @example
 * ```typescript
 * import { Server } from "@modelcontextprotocol/sdk/server/index.js";
 * import { createClientExecServer } from "./client_exec_server_v2.ts";
 *
 * const server = new Server({ name: "enhanced-server", version: "1.0.0" });
 * const enhancedServer = createClientExecServer(server, "main-server");
 *
 * // Use exactly like a regular MCP server, but with client tool support
 * enhancedServer.setRequestHandler(ListToolsRequestSchema, async () => {
 *   // This will now include both server and client-registered tools
 * });
 * ```
 */
export function createClientExecServer(
  server: Server,
  clientId: string,
): ClientExecServer & Server {
  const execServer = new ClientExecServer(server, clientId);
  
  // Simply assign all methods - no Proxy needed!
  return Object.assign(execServer, server) as ClientExecServer & Server;
}
