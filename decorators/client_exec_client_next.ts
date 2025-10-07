import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ClientToolDefinition } from "../shared/types.ts";

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

const ClientToolRegistrationResultSchema = z.object({
  status: z.string(),
  registeredTools: z.array(z.string()),
  conflicts: z.array(z.string()).optional(),
});

export class ToolAugmentingClient {
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
    }) as unknown as ToolAugmentingClient & Client;
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
   * Intercept incoming tools
   */
  interceptIncomingResponse(
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    originalOnMessage?: (
      message: JSONRPCMessage,
      extra?: MessageExtraInfo,
    ) => void,
  ) {
    if (isJSONRPCResponse(message) && message.result.tools) {
      message.result.tools = (message.result.tools as Array<unknown>).concat(
        this.toolDefinitions,
      );
    }

    originalOnMessage?.(message as JSONRPCMessage, extra);
  }

  /**
   * Intercept outgoing tool calls
   */
  interceptOutgoingRequest(
    message: JSONRPCMessage,
    options: TransportSendOptions,
    originalSend: (
      message: JSONRPCMessage,
      options?: TransportSendOptions,
    ) => Promise<void>,
    originalOnMessage?: (
      message: JSONRPCMessage,
      extra?: MessageExtraInfo,
    ) => void,
  ): Promise<void> | void {
    if (
      isJSONRPCRequest(message) &&
      message.method === CallToolRequestSchema.shape.method.value
    ) {
      const handler = this.tools.get(message.params!.name as string);
      if (handler) {
        // 支持同步和异步 handler
        const resultOrPromise = handler(
          message.params!.arguments as Record<string, unknown>,
        );
        return Promise.resolve(resultOrPromise).then(
          (result) => {
            originalOnMessage?.({
              id: message.id,
              jsonrpc: "2.0",
              result: result as Record<string, unknown>,
            });
          },
        );
      }
    }

    originalSend(message as JSONRPCMessage, options);
  }

  /**
   * Override connect method to register tools after connection
   */
  async connect(transport: Transport): Promise<void> {
    await this.client.connect(transport);

    const originalOnMessage = transport.onmessage?.bind(transport);
    const originalSend = transport.send.bind(transport);

    transport.send = (
      message: unknown,
      options: TransportSendOptions,
    ) => {
      return Promise.resolve(
        this.interceptOutgoingRequest(
          message as JSONRPCMessage,
          options,
          originalSend,
          originalOnMessage,
        ),
      );
    };

    transport.onmessage = (
      message: unknown,
      extra?: MessageExtraInfo,
    ) => {
      this.interceptIncomingResponse(
        message as JSONRPCMessage,
        extra,
        originalOnMessage,
      );
    };
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

    // Remove redeclaration of 'success' if already declared above
    let result: unknown;
    let error: string | undefined;
    let success = false;
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

export function createToolAugmentingClient(
  client: Client,
  clientId: string,
): ToolAugmentingClient & Client {
  return new ToolAugmentingClient(client, clientId) as unknown as
    & ToolAugmentingClient
    & Client;
}
