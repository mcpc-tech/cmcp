import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { ToolDefinition } from "./dyn-server.ts";

const ExecuteToolNotificationSchema = z.object({
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

export class DynClient {
  private client: Client;
  private clientId: string;
  private tools: Map<string, ToolDefinition["implementation"]> = new Map();

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
    }) as unknown as DynClient & Client;
  }

  /**
   * Register tools (register both definitions and implementations)
   */
  registerTools(tools: ToolDefinition[]) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool.implementation);
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
  getStatus() {
    return {
      clientId: this.clientId,
      toolCount: this.tools.size,
      tools: Array.from(this.tools.keys()),
    };
  }
}

export function createDynClient(
  client: Client,
  clientId: string,
): DynClient & Client {
  return new DynClient(client, clientId) as unknown as DynClient & Client;
}
