import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "npm:hono/cors";
import { messageHandler } from "./controller/messages.controller.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createClientExecServer } from "../../decorators/client_exec_server.ts";
import process from "node:process";
import { sseHandler } from "./controller/sse.controller.ts";

export const createMCPServer = () => {
  const server = new Server(
    {
      name: "dynamic-mcp-server",
      version: "0.1.0",
    },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
      tools: [
        {
          name: "example-tool",
          description: "An example tool",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, (request, _extra) => {
    if (request.params.name === "example-tool") {
      return {
        content: [{ type: "text", text: "This is an example tool response 1" }],
      };
    }
    throw new McpError(ErrorCode.InvalidRequest, "Tool not found");
  });

  return Promise.resolve(
    createClientExecServer(server, "dynamic-server-with-tools"),
  );
};

export const createApp = () => {
  const app = new OpenAPIHono();

  // Add CORS middleware
  app.use(
    "*",
    cors({
      origin: "*", // Allow all origins for development
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "mcp-protocol-version",
        "Accept",
        "Cache-Control",
      ],
      credentials: true,
    }),
  );

  messageHandler(app);
  sseHandler(app);

  return app;
};

// Main server startup - only start if this file is the main module
if (import.meta.main) {
  const app = createApp();

  const port = Number(process.env.PORT || 9000);
  const hostname = "0.0.0.0";

  console.log(`Starting server on http://${hostname}:${port}`);
  Deno.serve({ port, hostname }, app.fetch);
}
