/**
 * Client-Execution MCP Server - Register tools on server, execute them on client via MCP magic ✨
 */

// Export core client-execution decorators
export {
  createDynServer as createClientExecutionServer,
  DynServer as ClientExecutionServer,
} from "./decorators/dyn-server.ts";

export { createDynClient, DynClient } from "./decorators/dyn-client.ts";

// Export types
export { type ToolDefinition } from "./shared/types.ts";

export {
  createLegacyDynamicClient,
  type LegacyClientTool,
  LegacyDynamicClientDecorator,
} from "./decorators/dynamic-client.ts";

// Export SSE utilities for real-time communication
export {
  handleConnecting,
  handleIncoming,
  SSEServerTransport,
} from "./shared/sse.ts";

// Export constants
export * from "./shared/const.ts";

// Export controllers for client communication
export { messageHandler } from "./controller/messages.controller.ts";

export { sseHandler } from "./controller/sse.controller.ts";
