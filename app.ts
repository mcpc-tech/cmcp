import { OpenAPIHono } from "@hono/zod-openapi";
import { messageHandler } from "./controller/messages.controller.ts";
import { sseHandler } from "./controller/sse.controller.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  createDynServer,
  ToolDefinition,
} from "./decorators/dyn-server.ts";

export const tools: ToolDefinition[] = [
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
];

export const createMCPServer = () => {
  const server = createDynServer(
    new Server({
      name: "1",
      version: "0.1.0",
    }, { capabilities: { tools: {} } }),
    "1",
  );

  server.registerTools(tools);

  return Promise.resolve(server);
};

export const createApp = () => {
  const app = new OpenAPIHono();

  messageHandler(app);
  sseHandler(app);

  return app;
};
