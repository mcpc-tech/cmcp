# Client-Tool-Execution MCP Server 🚀

[![JSR](https://jsr.io/badges/@mcpc/cmcp)](https://jsr.io/@mcpc/cmcp)
[![JSR Score](https://jsr.io/badges/@mcpc/cmcp/score)](https://jsr.io/@mcpc/cmcp)

> Truly Useful Anti-Patterns: Client-Tool-Execution MCP Server

## Core Features 🎯

- **Dynamic Tool Registration**: Clients connect and register their tools automatically
- **Client-Side Tool Execution**: Tools execute on the client side, not the server - perfect for browser DOM manipulation, local file access, or environment-specific operations
- **Transparent Proxy**: Server acts as a proxy, routing tool calls to the appropriate client for execution

This enables you to:

- 🔄 Register custom tools dynamically when clients connect
- ⚡ Execute tools **directly on the client** - not on the server
- 🌐 Build tools that interact with client-specific environments (browser DOM, local files, etc.)
- 🔗 Create flexible, client-driven AI tool ecosystems where execution happens where the data lives

## Getting Started 🚀

### Installation

```bash
# Using Deno (recommended)
import { createClientExecutionServer, createDynClient } from "jsr:@mcpc/cmcp";

# Or add to your deno.json
{
  "imports": {
    "@mcpc/cmcp": "jsr:@mcpc/cmcp@^0.0.1"
  }
}
```

### Basic Setup

1. **Install the package**: Add `@mcpc/cmcp` to your project
2. **Start the server demo**: `deno run --allow-net --allow-read --allow-env server.ts`
3. **Run the client demo**: `deno run --allow-net client.ts`

### Complete Example

Here's a minimal working example:

**Server (server.ts):**
```typescript
import { createClientExecutionServer } from "@mcpc/cmcp";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = createClientExecutionServer(
  new Server({ name: "my-server", version: "1.0.0" }),
  "my-server"
);

// Start server on port 9000
// (Add your HTTP server setup here)
```

**Client (client.ts):**
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createDynClient, type ToolDefinition } from "@mcpc/cmcp";

const client = createDynClient(
  new Client({ name: "my-client", version: "1.0.0" }),
  "my-client-001"
);

const tools: ToolDefinition[] = [
  {
    name: "greet",
    description: "Greet someone",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name to greet" }
      },
      required: ["name"]
    },
    implementation: (args) => `Hello, ${args.name}!`
  }
];

client.registerTools(tools);
await client.connect(new SSEClientTransport(new URL("http://localhost:9000/sse")));
```

### Server Usage 📡

The server acts as a **proxy and registry** - it has no predefined tools and simply routes execution to clients:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createClientExecutionServer } from "@mcpc/cmcp";

// Server is just a proxy - no tools, no execution logic
const server = createClientExecutionServer(
  new Server({ name: "dynamic-mcp-server", version: "1.0.0" }),
  "dynamic-server"
);

// Server routes all tool calls to the appropriate client
// All execution happens on the client side
```

### Client Usage 🖥️

Clients register tools **with implementations** that execute locally on the client:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createDynClient, type ToolDefinition } from "@mcpc/cmcp";

const client = createDynClient(
  new Client({ name: "browser-client", version: "1.0.0" }),
  "browser-client-001"
);

// Define tools with LOCAL implementations (executed on client)
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
          enum: ["getText", "click", "getAttribute"],
        },
        attribute: { type: "string", description: "Attribute name" },
      },
      required: ["selector", "action"],
    },
    // 🔥 Implementation runs on CLIENT side - has access to DOM, local files, etc.
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
    },
  },
];

// Register tools (stored locally until connection)
client.registerTools(tools);

// Connect and register tools to server
await client.connect(
  new SSEClientTransport(new URL("http://localhost:9000/sse"))
);

console.log("Client connected and tools registered!");
// Client stays connected to handle tool execution requests
```

### Example Tool Call 🔧

```typescript
// External MCP client connecting to the server
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const mcpClient = new Client({
  name: "external-client",
  version: "1.0.0"
});

await mcpClient.connect(
  new SSEClientTransport(new URL("http://localhost:9000/sse"))
);

// Call tools registered by connected clients
const result = await mcpClient.callTool({
  name: "querySelector",
  arguments: {
    selector: "#my-button",
    action: "click",
  },
});

console.log(result); // "Clicked element: #my-button"
// ✨ The actual DOM manipulation happened on the CLIENT side!
```

## Why Client-Side Execution? 🤔

**Traditional MCP**: Tools execute on the server
- ❌ Server needs access to all resources (files, DOM, APIs)
- ❌ Security concerns with server-side execution
- ❌ Limited to server environment capabilities

**Client-Tool-Execution MCP**: Tools execute on the client
- ✅ Client has natural access to its own environment (DOM, local files, etc.)
- ✅ Better security - no need to expose sensitive resources to server
- ✅ Scalable - each client handles its own execution load
- ✅ Environment-specific - browser clients can manipulate DOM, desktop clients can access files

### Architecture Flow 🔄

1. **Server**: Starts as an empty proxy with no predefined tools
2. **Client Connect**: Client establishes SSE connection to server
3. **Tool Registration**: Client sends tool definitions (schema only) via `client/register_tools`
4. **Server Registry**: Server updates its tool registry with client's tool schemas
5. **MCP Call**: External system discovers and calls tools via server
6. **Proxy Call**: Server proxies call to appropriate client via notification
7. **Client Execution**: 🔥 **Tool runs on CLIENT side** with full access to client environment
8. **Response**: Result flows back through server to caller
9. **Client Disconnect**: Server automatically removes client's tools

> **Key Point**: The server never executes tools - it only routes calls to clients where the actual execution happens!
