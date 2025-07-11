import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createToolAugmentingClient } from "../../decorators/client_exec_client_next.ts";
import type { ClientToolDefinition } from "../../shared/types.ts";

// Define client-specific tools with implementations
const clientTools: ClientToolDefinition[] = [
  {
    name: "echo",
    description: "Echo input message",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to echo",
        },
        repeat: {
          type: "number",
          description: "Number of repetitions, default is 1",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["message"],
    },
    implementation: (args: Record<string, unknown>) => {
      const message = args.message as string;
      const repeat = (args.repeat as number) || 1;
      return {
        content: [{
          text: Array(repeat).fill(message).join(" "),
          type: "text",
        }],
      };
    },
  },
  {
    name: "getCurrentTime",
    description: "Get current timestamp",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Time format: 'iso' or 'timestamp'",
          enum: ["iso", "timestamp"],
        },
      },
      required: [],
    },
    implementation: (args: Record<string, unknown>) => {
      const format = (args.format as string) || "iso";
      const now = new Date();
      return {
        content: [{
          text: format === "timestamp"
            ? now.getTime().toString()
            : now.toISOString(),
          type: "text",
        }],
      };
    },
  },
];

export const createClient = () => {
  const client = createToolAugmentingClient(
    new Client(
      { name: "demo-client", version: "1.0.0" },
      { capabilities: {} },
    ),
    "demo-client-001",
  );

  // Register tools (they will be sent to server on connect)
  client.registerTools(clientTools);

  return client;
};

// Main client execution
async function main() {
  const client = createClient();

  // Connect to server (tools will be automatically registered)
  await client.connect(
    new SSEClientTransport(new URL("http://0.0.0.0:9000/sse")),
  );

  console.log("Client connected and tools registered!");

  // Test tool execution
  const echoResult = await client.callTool({
    name: "echo",
    arguments: {
      message: "Hello Dynamic MCP!",
      repeat: 3,
    },
  });

  console.log("Echo result:", echoResult);

  const timeResult = await client.callTool({
    name: "getCurrentTime",
    arguments: {
      format: "iso",
    },
  });

  await client.close();

  console.log("Time result:", timeResult);
}

// Run if this file is executed directly
if (import.meta.main) {
  main().catch(console.error);
}
