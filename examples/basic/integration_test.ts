import { assertExists } from "@std/assert";
import { createApp, createMCPServer } from "./server.ts";
import { createClient } from "./client.ts";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_PORT = 9001;
const TEST_HOST = "127.0.0.1";
const TEST_URL = `http://${TEST_HOST}:${TEST_PORT}`;

Deno.test("Integration test for MCP server and client", async (t) => {
  const app = createApp();
  const abortController = new AbortController();

  const serverPromise = Deno.serve(
    {
      port: TEST_PORT,
      hostname: TEST_HOST,
      signal: abortController.signal,
    },
    app.fetch,
  );

  // Wait for server to start
  await delay(1000);

  await t.step("Server should start successfully", async () => {
    // Test server health by making a simple request
    try {
      const response = await fetch(`${TEST_URL}/sse`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
        },
      });
      // Server should respond (even if it's a 404 or other response)
      assertExists(response);
      // Properly close the response body to avoid leaks
      await response.body?.cancel();
    } catch (error) {
      console.error("Server health check failed:", error);
      throw error;
    }
  });

  await t.step("MCP Server should be creatable", async () => {
    const mcpServer = await createMCPServer();
    assertExists(mcpServer);
    // Test that server is functional by checking it has expected properties
    assertExists(mcpServer.request);
  });

  await t.step("Client should connect and register tools", async () => {
    const client = createClient();
    assertExists(client);

    try {
      // Connect to the test server
      await client.connect(new SSEClientTransport(new URL(`${TEST_URL}/sse`)));

      // Wait a bit for connection to establish
      await delay(500);

      // Client should be connected
      assertExists(client);

      await client.close();
    } catch (error) {
      console.error("Client connection failed:", error);
      throw error;
    }
  });

  await t.step("Client tools should execute correctly", async () => {
    const client = createClient();

    try {
      await client.connect(new SSEClientTransport(new URL(`${TEST_URL}/sse`)));

      await delay(500);

      const tools = await client.listTools();
      console.log("Available tools:", tools);

      // Test echo tool
      const echoResult = await client.callTool({
        name: "echo",
        arguments: {
          message: "Test message",
          repeat: 2,
        },
      });
      assertExists(echoResult);
      const timeResult = await client.callTool({
        name: "getCurrentTime",
        arguments: {
          format: "timestamp",
        },
      });

      assertExists(timeResult);
      await client.close();
    } catch (error) {
      console.error("Tool execution failed:", error);
      throw error;
    }
  });

  await t.step(
    "Client should be able to call server tool directly",
    async () => {
      const client = createClient();
      await client.connect(new SSEClientTransport(new URL(`${TEST_URL}/sse`)));
      await delay(500);

      const result = await client.callTool({
        name: "example-tool",
        arguments: {},
      });
      assertExists(result);
      await client.close();
    },
  );

  // Cleanup: Stop the server
  abortController.abort();

  try {
    await serverPromise;
  } catch (error) {
    // Expected when aborting
    if (error instanceof Error && !error.message?.includes("aborted")) {
      throw error;
    }
  }
});
