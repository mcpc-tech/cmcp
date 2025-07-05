# Dynamic MCP Server 🚀

> Dynamic tool registration and execution via MCP protocol ✨

## Core Features 🎯

**Dynamic Tool Registration**: Clients connect and register their tools automatically
**Multi-Client Support**: Multiple clients can connect simultaneously 
**Tool Execution**: Execute client tools seamlessly through the MCP protocol

This enables you to:
- 🔄 Register custom tools dynamically when clients connect
- ✅ Execute tools seamlessly through the MCP protocol  
- 🌐 Support multiple concurrent clients
- ⚡ Build flexible, client-driven AI tool ecosystems

## Getting Started 🚀

### Basic Setup

1. **Clone the repo**
2. **Start the server demo**: `deno run --allow-net --allow-read --allow-env server.ts`
3. **Run the client demo**: `deno run --allow-net client.ts`

### Server Usage 📡

The server starts with no predefined tools and waits for clients to register them dynamically:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createDynServer } from "./decorators/dyn-server.ts";

// Server starts empty - no predefined tools
const server = createDynServer(
  new Server({ name: "dynamic-mcp-server", version: "1.0.0" }),
  "dynamic-server"
);

// No tool registration needed - clients will register dynamically
// Tools are registered when clients connect
```

### Client Usage 🖥️

Clients register their tool implementations and connect to the server:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createDynClient } from "./decorators/dyn-client.ts";
import { ToolDefinition } from "./decorators/dyn-server.ts";

const client = createDynClient(
  new Client({ name: "browser-client", version: "1.0.0" }),
  "browser-client-001"
);

// Define tools with implementations
const tools: ToolDefinition[] = [
  {
    name: "querySelector",
    description: "Query DOM elements using CSS selectors",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to query" },
        action: { 
          type: "string", 
          description: "Action to perform",
          enum: ["getText", "click", "getAttribute"]
        },
        attribute: { type: "string", description: "Attribute name" }
      },
      required: ["selector", "action"]
    },
    implementation: async (args: Record<string, unknown>) => {
      const { selector, action, attribute } = args;
      const element = document.querySelector(selector as string);
      
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      
      switch (action) {
        case "getText":
          return element.textContent || "";
        case "click":
          element.click();
          return `Clicked element: ${selector}`;
        case "getAttribute":
          return element.getAttribute(attribute as string);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }
  }
];

// Register tools (stored locally until connection)
client.registerTools(tools);

// Connect and automatically register tools to server
await client.connect(new SSEClientTransport(new URL("http://localhost:9000/sse")));

console.log("Client connected and tools registered!");
// Client stays connected to handle tool execution requests
```

### Example Tool Call 🔧

```typescript
// External system calls tool via server
const result = await mcpClient.callTool({
  name: "querySelector",
  arguments: {
    selector: "#my-button",
    action: "click"
  }
});

console.log(result); // "Clicked element: #my-button"
```

### Architecture Flow 🔄

1. **Server**: Starts empty with no predefined tools
2. **Client Connect**: Client establishes SSE connection to server
3. **Tool Registration**: Client automatically sends tool definitions via `client/register_tools`
4. **Server Registry**: Server updates its tool registry with client's tools
5. **MCP Call**: External system discovers and calls tools via server
6. **Proxy**: Server proxies call to appropriate client via notification
7. **Execute**: Client runs implementation and sends result back
8. **Response**: Result flows back through server to caller
9. **Client Disconnect**: Server automatically removes client's tools