import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "npm:hono/cors";
import { messageHandler } from "./controller/messages.controller.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createClientExecServer } from "../../decorators/client_exec_server.ts";
import process from "node:process";
import { sseHandler } from "./controller/sse.controller.ts";

export const createMCPServer = () => {
  const server = createClientExecServer(
    new Server({
      name: "dynamic-mcp-server",
      version: "0.1.0",
    }, { capabilities: { tools: {} } }),
    "dynamic-server",
  );

  return Promise.resolve(server);
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

// Main server startup
const app = createApp();

const port = Number(process.env.PORT || 9000);
const hostname = "localhost";

console.log(`Starting server on http://${hostname}:${port}`);
Deno.serve({ port, hostname }, app.fetch);
