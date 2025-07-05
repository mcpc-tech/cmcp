import { OpenAPIHono } from "@hono/zod-openapi";
import { messageHandler } from "./controller/messages.controller.ts";
import { sseHandler } from "./controller/sse.controller.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  createDynServer,
} from "./decorators/dyn-server.ts";

export const createMCPServer = () => {
  const server = createDynServer(
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

  messageHandler(app);
  sseHandler(app);

  return app;
};
