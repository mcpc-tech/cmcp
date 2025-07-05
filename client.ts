import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { tools } from "./app.ts";
import { createDynClient } from "./decorators/dyn-client.ts";

const client = createDynClient(
  new Client(
    { name: "my-client", version: "1.0.0" },
    { capabilities: {} },
  ),
  "1",
);

client.registerTools(tools);

await client.connect(
  new SSEClientTransport(new URL("http://0.0.0.0:9000/sse")),
);

const res = await client.callTool({
  name: "echo",
  arguments: {
    message: "hello",
  },
});

console.log(res);
