# Client-Tool-Execution MCP Server 🚀

[![JSR](https://jsr.io/badges/@mcpc/cmcp)](https://jsr.io/@mcpc/cmcp)
[![npm](https://img.shields.io/npm/v/@mcpc-tech/cmcp)](https://www.npmjs.com/package/@mcpc-tech/cmcp)

> Create Client-Tool-Execution MCP Server

## Core Features 🎯

- **Dynamic Tool Registration**: Clients connect and register their tools
  automatically
- **Client-Side Tool Execution**: Tools execute on the client side, not the
  server - perfect for browser DOM manipulation, local file access, or
  environment-specific operations
- **Transparent Proxy**: Server acts as a proxy, routing tool calls to the
  appropriate client for execution
- **Puppet Transport**: Delegate MCP methods to another transport - for example,
  let Cursor's AI call tools that execute in Chrome's browser environment

This enables you to:

- 🔄 Register custom tools dynamically when clients connect
- ⚡ Execute tools **directly on the client** - not on the server
- 🌐 Build tools that interact with client-specific environments (browser DOM,
  local files, etc.)
- 🔗 Create flexible, client-driven AI tool ecosystems where execution happens
  where the data lives

## Getting Started 🚀

### Installation

```bash
# Using Node (better compatibility)
npm i @mcpc-tech/cmcp

# Using Deno
deno add jsr:@mcpc/cmcp
```

### Complete Example

Here's a minimal working example:

### Server Usage 📡

The server acts as a **proxy and registry** - it has no predefined tools and
simply routes execution to clients:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createClientExecServer } from "@mcpc/cmcp";

// Server is just a proxy - no tools, no execution logic
const server = createClientExecServer(
  new Server({ name: "dynamic-mcp-server", version: "1.0.0" }),
  "dynamic-server",
);

// Server routes all tool calls to the appropriate client
// All execution happens on the client side
```

### Client Usage 🖥️

Clients register tools **with implementations** that execute locally on the
client:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { type ClientToolDefinition, createClientExecClient } from "@mcpc/cmcp";

const client = createClientExecClient(
  new Client({ name: "browser-client", version: "1.0.0" }),
  "browser-client-001",
);

// Define tools with LOCAL implementations (executed on client)
const tools: ClientToolDefinition[] = [
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
  new SSEClientTransport(new URL("http://localhost:9000/sse")),
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
  version: "1.0.0",
});

await mcpClient.connect(
  new SSEClientTransport(new URL("http://localhost:9000/sse")),
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

> Want more ready-made client tools? Find many example tool definitions at the
> AI Tools Registry: https://ai-tools-registry.vercel.app/

## Why Client-Side Execution? 🤔

**Traditional MCP**: Tools execute on the server

- ❌ Server needs access to all resources (files, DOM, APIs)
- ❌ Security concerns with server-side execution
- ❌ Limited to server environment capabilities

**Client-Tool-Execution MCP**: Tools execute on the client

- ✅ Client has natural access to its own environment (DOM, local files, etc.)
- ✅ Better security - no need to expose sensitive resources to server
- ✅ Scalable - each client handles its own execution load
- ✅ Environment-specific - browser clients can manipulate DOM, desktop clients
  can access files

### Architecture Flow 🔄

1. **Server**: Starts as an empty proxy with no predefined tools
2. **Client Connect**: Client establishes SSE connection to server
3. **Tool Registration**: Client sends tool definitions (schema only) via
   `client/register_tools`
4. **Server Registry**: Server updates its tool registry with client's tool
   schemas
5. **MCP Call**: External system discovers and calls tools via server
6. **Proxy Call**: Server proxies call to appropriate client via notification
7. **Client Execution**: 🔥 **Tool runs on CLIENT side** with full access to
   client environment
8. **Response**: Result flows back through server to caller
9. **Client Disconnect**: Server automatically removes client's tools

> **Key Point**: The server never executes tools - it only routes calls to
> clients where the actual execution happens!

## Advanced: Puppet Transport 🎭

`bindPuppet` connects two client transports so one client can use another
client's tools.

**Core Idea**: Bind Cursor's transport to Chrome's transport → Cursor's requests
forward to Chrome.

### Example: Cursor → Chrome

```typescript
import { bindPuppet, SSEServerTransport } from "@mcpc/cmcp";

// Chrome's transport (connected to Chrome client with DOM tools)
const chromeTransport = new SSEServerTransport("/messages", "chrome");

// Cursor's transport, bound to Chrome's
const cursorTransport = new SSEServerTransport("/messages", "cursor");
const boundTransport = bindPuppet(
  cursorTransport, // Main transport
  chromeTransport, // Puppet - receives forwarded calls
  ["tools/list", "tools/call"],
);

// Result: When Cursor calls a tool → forwards to Chrome → Chrome executes
```

**How it works:**

1. 🌐 Chrome connects and registers DOM tools
2. 💻 Cursor connects with `bindPuppet` pointing to Chrome's transport
3. 🤖 AI calls tool via Cursor → `bindPuppet` forwards to Chrome → Chrome
   executes
4. ✨ Result returns through Chrome → Cursor → AI

**In practice** (using `handleConnecting`):

```typescript
// Chrome: GET /sse?sessionId=chrome
// Cursor: GET /sse?sessionId=cursor&puppetId=chrome
// !!!NOW Cursor controls Chrome like a puppet
```

### Use Cases

- **🖥️ Cursor + Chrome**: AI in your editor controls browser automation
- **🤖 AI Agent + Multiple Browsers**: One AI coordinating tools across multiple
  browser tabs
- **📱 Desktop App + Mobile Client**: Desktop AI accessing mobile-specific
  capabilities
- **🔗 Multi-Environment Workflows**: Chain tools across different runtime
  environments

### Available Methods

Methods you can delegate (from `PUPPET_METHODS`):

- `tools/list`, `tools/call` - Tool operations
- `resources/list`, `resources/read` - Resource operations
- `prompts/list` - Prompt operations
