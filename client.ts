import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createDynClient } from "./decorators/dyn-client.ts";
import { ToolDefinition } from "./decorators/dyn-server.ts";

// Define client-specific tools with implementations
const clientTools: ToolDefinition[] = [
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
      return Array(repeat).fill(message).join(" ");
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
      return format === "timestamp" ? now.getTime() : now.toISOString();
    },
  },
];

const client = createDynClient(
  new Client(
    { name: "demo-client", version: "1.0.0" },
    { capabilities: {} },
  ),
  "demo-client-001",
);

// Register tools (they will be sent to server on connect)
client.registerTools(clientTools);

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

console.log("Time result:", timeResult);
