# Client-Execution MCP Server 🚀

> Register tools on server, execute them on client via MCP magic ✨

## Core Value 🎯

**The magic**: Dynamic tool registration and execution via MCP ✨

This enables you to:
- 🔄 Register custom tools dynamically from any client (browser, CLI, app)
- ✅ Execute those tools seamlessly through the MCP protocol  
- 🌐 Build flexible, client-driven AI tool ecosystems

## Getting Started 🚀

### Basic Setup

1. **Clone the repo**
2. **Start the server demo**: `deno run --allow-net --allow-read server.ts`
3. **Run the client demo**: `deno run --allow-net client.ts`

### Server Usage 📡

The server only registers tool schemas and proxies execution to clients:

```typescript
import { createDynServer, ToolDefinition } from "./decorators/dyn-server.ts";

// Server only defines tool schemas, no implementations
const toolSchemas: Pick<ToolDefinition, 'name' | 'description' | 'inputSchema'>[] = [
  {
    name: "querySelector",
    description: "Query DOM elements using CSS selectors",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to query"
        },
        action: {
          type: "string", 
          description: "Action to perform: 'getText', 'click', 'getAttribute'",
          enum: ["getText", "click", "getAttribute"]
        },
        attribute: {
          type: "string",
          description: "Attribute name (required for getAttribute action)"
        }
      },
      required: ["selector", "action"]
    }
  }
];

const server = createDynServer(
  new Server({ name: "browser-tools", version: "1.0.0" }),
  "browser-client"
);

server.registerToolSchemas(toolSchemas);
```

### Client Usage 🖥️

The client provides actual tool implementations:

```typescript
import { createDynClient } from "./decorators/dyn-client.ts";

const client = createDynClient(
  new Client({ name: "browser-client", version: "1.0.0" }),
  "browser-client"
);

// Client implements the actual tools
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

client.registerTools(tools);
await client.connect(new SSEClientTransport(new URL("http://localhost:9000/sse")));

// Tool execution happens automatically when server receives requests
```

### Example Tool Call 🔧

```typescript
// Server receives this call and routes to client
const result = await client.callTool({
  name: "querySelector",
  arguments: {
    selector: "#my-button",
    action: "click"
  }
});

console.log(result); // "Clicked element: #my-button"
```

### Architecture Flow 🔄

1. **Server**: Registers tool definitions with schemas
2. **Client**: Connects and registers tool implementations  
3. **MCP Call**: External system calls tool via server
4. **Proxy**: Server proxies call to appropriate client
5. **Execute**: Client runs implementation (e.g., browser API)
6. **Response**: Result flows back through server to caller