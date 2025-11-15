import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import type { ClientToolDefinition } from "../shared/types.ts";

export const ExecuteToolNotificationSchema: z.ZodObject<{
  method: z.ZodLiteral<"proxy/execute_tool">;
  params: z.ZodObject<{
    id: z.ZodString;
    toolName: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    clientId: z.ZodString;
  }>;
}> = z.object({
  method: z.literal("proxy/execute_tool"),
  params: z.object({
    id: z.string(),
    toolName: z.string(),
    args: z.record(z.unknown()),
    clientId: z.string(),
  }),
});

const ToolResponseResultSchema = z.object({
  status: z.string(),
});

const ClientToolRegistrationResultSchema = z.object({
  status: z.string(),
  registeredTools: z.array(z.string()),
  conflicts: z.array(z.string()).optional(),
});

/**
 * Client-side decorator that enables MCP clients to register and execute tools on remote servers.
 *
 * This class wraps an MCP client and extends it with the capability to:
 * - Register local tool implementations with a remote server
 * - Handle execution requests for registered tools from the server
 * - Automatically manage the registration process during connection
 * - Provide status information about registered tools
 *
 * The ClientExecClient acts as a bridge between local tool implementations and remote
 * MCP servers, allowing distributed tool execution across the MCP protocol.
 *
 * @example
 * ```typescript
 * import { Client } from "@modelcontextprotocol/sdk/client/index.js";
 * import { ClientExecClient } from "./client_exec_client.ts";
 *
 * const client = new Client({ name: "tool-provider", version: "1.0.0" });
 * const toolClient = new ClientExecClient(client, "unique-client-id");
 *
 * // Register tools that the server can execute
 * toolClient.registerTools([
 *   {
 *     name: "file_read",
 *     description: "Read file contents",
 *     inputSchema: {
 *       type: "object",
 *       properties: { path: { type: "string" } },
 *       required: ["path"]
 *     },
 *     implementation: async (args) => {
 *       const content = await Deno.readTextFile(args.path);
 *       return { content };
 *     }
 *   }
 * ]);
 * ```
 */
export class ClientExecClient {
  private client: Client;
  private clientId: string;
  private tools: Map<string, ClientToolDefinition["implementation"]> =
    new Map();
  private toolDefinitions: ClientToolDefinition[] = [];

  constructor(client: Client, clientId: string) {
    this.client = client;
    this.clientId = clientId;

    this.client.setNotificationHandler(
      ExecuteToolNotificationSchema,
      (notification) => this.handleExecutionNotification(notification.params),
    );

    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        const serverProp = target.client[prop as keyof typeof target.client];
        if (typeof serverProp === "function") {
          return serverProp.bind(target.client);
        }
        return serverProp;
      },
    }) as unknown as ClientExecClient & Client;
  }

  /**
   * Register tools (store locally, will be sent to server on connect)
   */
  registerTools(tools: ClientToolDefinition[]) {
    this.toolDefinitions = tools;
    for (const tool of tools) {
      this.tools.set(tool.name, tool.implementation);
    }
  }

  /**
   * Override connect method to register tools after connection
   */
  async connect(transport: Parameters<Client["connect"]>[0]): Promise<void> {
    // Call original connect method
    await this.client.connect(transport);

    // Register tools to server after successful connection
    if (this.toolDefinitions.length > 0) {
      await this.registerToolsToServer();
    }
  }

  /**
   * Register tools to server
   */
  private async registerToolsToServer(): Promise<void> {
    try {
      const toolSchemas = this.toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      const result = await this.client.request(
        {
          method: "client/register_tools",
          params: {
            clientId: this.clientId,
            tools: toolSchemas,
          },
        },
        ClientToolRegistrationResultSchema,
      );

      console.log(
        `Successfully registered ${result.registeredTools.length} tools to server:`,
        result.registeredTools,
      );

      if (result.conflicts && result.conflicts.length > 0) {
        console.warn(
          `Tool registration conflicts for ${result.conflicts.length} tools:`,
          result.conflicts,
        );
      }
    } catch (error) {
      console.error("Failed to register tools to server:", error);
      throw error;
    }
  }

  /**
   * Handle tool execution notification from server
   */
  private async handleExecutionNotification(params: {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    clientId: string;
  }): Promise<void> {
    // Validate client ID
    if (params.clientId !== this.clientId) {
      console.warn(
        `Received execution request for different client: ${params.clientId}, expected: ${this.clientId}`,
      );
      return;
    }

    let success = false;
    let result: unknown;
    let error: string | undefined;

    try {
      const implementation = this.tools.get(params.toolName);
      if (!implementation) {
        throw new Error(
          `Tool ${params.toolName} not found in client ${this.clientId}`,
        );
      }

      // Execute tool
      result = await implementation(params.args);
      success = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Send execution result back to server via request
    try {
      await this.client.request(
        {
          method: "proxy/tool_response",
          params: {
            id: params.id,
            success,
            result,
            error,
          },
        },
        ToolResponseResultSchema,
      );
    } catch (responseError) {
      console.error("Failed to send tool response:", responseError);
    }
  }

  /**
   * Get client status
   */
  getStatus(): {
    clientId: string;
    toolCount: number;
    tools: string[];
    registeredToServer: boolean;
  } {
    return {
      clientId: this.clientId,
      toolCount: this.tools.size,
      tools: Array.from(this.tools.keys()),
      registeredToServer: this.toolDefinitions.length > 0,
    };
  }
}

/**
 * Creates a new ClientExecClient instance that decorates an MCP client with tool registration capabilities.
 *
 * This factory function creates a ClientExecClient that acts as a transparent proxy to the original
 * MCP client while adding the ability to register local tools with remote servers and handle
 * execution requests. The returned object can be used as a drop-in replacement for the original client.
 *
 * @param client - The MCP client instance to decorate with tool registration capabilities
 * @param clientId - Unique identifier for this client (must be unique across all clients connecting to the same server)
 * @returns A decorated client that can register tools with servers and handle remote execution requests
 *
 * @example
 * ```typescript
 * import { Client } from "@modelcontextprotocol/sdk/client/index.js";
 * import { createClientExecClient } from "./client_exec_client.ts";
 * import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
 *
 * const client = new Client({ name: "my-tool-client", version: "1.0.0" });
 * const toolClient = createClientExecClient(client, "tool-provider-1");
 *
 * // Register tools before connecting
 * toolClient.registerTools([
 *   {
 *     name: "calculate",
 *     description: "Perform calculations",
 *     inputSchema: {
 *       type: "object",
 *       properties: { expression: { type: "string" } },
 *       required: ["expression"]
 *     },
 *     implementation: async (args) => ({ result: eval(args.expression) })
 *   }
 * ]);
 *
 * // Connect and tools will be automatically registered
 * const transport = new StdioClientTransport({
 *   command: "server-executable",
 *   args: []
 * });
 * await toolClient.connect(transport);
 * ```
 */
export function createClientExecClient(
  client: Client,
  clientId: string,
): ClientExecClient & Client {
  return new ClientExecClient(client, clientId) as unknown as
    & ClientExecClient
    & Client;
}
