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

export interface ToolDefinition extends Tool {
  implementation: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const ToolResponseRequestSchema = z.object({
  method: z.literal("proxy/tool_response"),
  params: z.object({
    id: z.string(),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
});

export interface ToolDefinition extends Tool {
  implementation: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export class DynServer {
  private server: Server;
  private clientId: string;
  private tools: Map<string, Tool> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: CallToolResult) => void;
    reject: (reason: Error | McpError) => void;
    timeout: number;
  }> = new Map();
  private requestTimeoutMs = 30000; // 30 seconds timeout

  constructor(server: Server, clientId: string) {
    this.server = server;
    this.clientId = clientId;

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

  /**
   * Register tools (only register definitions, not implementations)
   */
  registerTools(tools: ToolDefinition[]) {
    for (const tool of tools) {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      return { tools: Array.from(this.tools.values()) };
    });

    this.server.setRequestHandler(CallToolRequestSchema, (request, _extra) => {
      return this.callTool(request.params);
    });

    this.server.setRequestHandler(
      ToolResponseRequestSchema,
      (request) => this.handleClientResponse(request.params),
    );
  }

  /**
   * Notify client to execute tool via notification
   */
  private async notifyClientExecute(
    requestId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    await this.server.notification({
      method: "proxy/execute_tool",
      params: {
        id: requestId,
        toolName,
        args,
        clientId: this.clientId,
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
   * Set request timeout
   */
  setRequestTimeout(timeoutMs: number) {
    this.requestTimeoutMs = timeoutMs;
  }

  /**
   * Get status information
   */
  getStatus() {
    return {
      clientId: this.clientId,
      registeredTools: Array.from(this.tools.keys()),
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
