import { assertExists } from "@std/assert";
import { createApp } from "./server.ts";
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

  try {
    await t.step("Client should connect and register tools", async () => {
      const client = createClient();

      try {
        // Connect to the test server
        await client.connect(
          new SSEClientTransport(new URL(`${TEST_URL}/sse`)),
        );

        // Wait a bit for connection to establish
        await delay(500);

        await client.close();
      } catch (error) {
        console.error("Client connection failed:", error);
        throw error;
      }
    });

    await t.step("Client tools should execute correctly", async () => {
      const client = createClient();

      try {
        await client.connect(
          new SSEClientTransport(new URL(`${TEST_URL}/sse`)),
        );

        await delay(500);

        const tools = await client.listTools();

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
        await client.connect(
          new SSEClientTransport(new URL(`${TEST_URL}/sse`)),
        );
        await delay(500);

        const result = await client.callTool({
          name: "example-tool",
          arguments: {},
        });
        assertExists(result);
        await client.close();
      },
    );
  } finally {
    // Cleanup: Stop the server
    abortController.abort();

    // Give the server time to clean up
    await delay(100);

    try {
      await serverPromise;
    } catch (error) {
      // Expected when aborting
      if (error instanceof Error && !error.message?.includes("aborted")) {
        throw error;
      }
    }
  }
});
