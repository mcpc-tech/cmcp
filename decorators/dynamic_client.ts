import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolRequest,
  CallToolResult,
  ErrorCode,
  ListToolsRequest,
  ListToolsResult,
  McpError,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

export interface LegacyClientTool extends Tool {
  implementation: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * @deprecated This implementation is non-standard and not recommended.
 */
export class LegacyDynamicClientDecorator {
  private client: Client;
  private clientTools: Map<string, LegacyClientTool> = new Map();

  constructor(client: Client) {
    this.client = client;
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        return target.client[prop as keyof typeof target.client];
      },
    });
  }

  /**
   * Add a client tool
   */
  addClientTool(
    name: string,
    description: string,
    inputSchema: {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
      [x: string]: unknown;
    },
    implementation: (
      args: Record<string, unknown>,
    ) => Promise<unknown> | unknown,
  ) {
    const tool: LegacyClientTool = {
      name,
      description,
      inputSchema,
      implementation,
    };
    this.clientTools.set(name, tool);
  }

  /**
   * Remove a client tool
   */
  removeClientTool(name: string) {
    this.clientTools.delete(name);
  }

  /**
   * Get all client tools
   */
  getClientTools(): LegacyClientTool[] {
    return Array.from(this.clientTools.values());
  }

  /**
   * Override the original listTools method to return predefined client tools only
   */
  listTools(
    _params?: ListToolsRequest["params"],
    _options?: unknown,
  ): Promise<ListToolsResult> {
    const tools = this.getClientTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    return Promise.resolve({
      tools,
    });
  }

  /**
   * Override the original callTool method to execute client tools locally
   */
  async callTool(
    params: CallToolRequest["params"],
    _resultSchema?: unknown,
    _options?: unknown,
  ): Promise<CallToolResult> {
    const { name, arguments: args } = params;

    const clientTool = this.clientTools.get(name);
    if (!clientTool) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool ${name} not found in client tools`,
      );
    }

    try {
      const result = await clientTool.implementation(args || {});

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool ${name}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * List all available tools (both client tools and server tools)
   */
  async listAllTools(
    params?: ListToolsRequest["params"],
  ): Promise<ListToolsResult> {
    try {
      const serverResult = await this.client.listTools(params);

      const clientTools = this.getClientTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

      return {
        tools: [...serverResult.tools, ...clientTools],
      };
    } catch (error) {
      console.warn(
        "Failed to fetch server tools, returning client tools only:",
        error,
      );
      return this.listTools(params);
    }
  }

  /**
   * Call tools (prioritizing client tools, then server tools)
   */
  async callAnyTool(
    params: CallToolRequest["params"],
  ): Promise<CallToolResult> {
    const { name } = params;

    if (this.clientTools.has(name)) {
      return this.callTool(params);
    }

    try {
      const result = await this.client.callTool(params);
      return result as CallToolResult;
    } catch (_error) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool ${name} not found in client or server tools`,
      );
    }
  }
}

/**
 * @deprecated This implementation is non-standard and not recommended.
 */
export function createLegacyDynamicClient(
  client: Client,
): LegacyDynamicClientDecorator {
  return new LegacyDynamicClientDecorator(client);
}
