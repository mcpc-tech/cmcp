/**
 * Client-Execution MCP Server - Register tools on server, execute them on client via MCP magic ✨
 */

// Export core client-execution decorators
export {
  createDynServer as createClientExecutionServer,
  DynServer as ClientExecutionServer,
  type ToolDefinition,
} from "./decorators/dyn-server.ts";

export {
  createDynClient as createClientExecutionClient,
  DynClient as ClientExecutionClient,
} from "./decorators/dyn-client.ts";

// Export SSE utilities for real-time communication
export {
  handleConnecting,
  handleIncoming,
  SSEServerTransport,
} from "./shared/sse.ts";

// Export constants
export * from "./shared/const.ts";

// Export controllers for client communication
export {
  messageHandler as ClientExecutionMessageHandler,
} from "./controller/messages.controller.ts";

export {
  sseHandler as ClientExecutionSSEHandler,
} from "./controller/sse.controller.ts";
