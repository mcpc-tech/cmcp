import { assertEquals, assertExists } from "@std/assert";
import { createApp } from "./server.ts";
import { createClient } from "./client.ts";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createClientExecClient } from "../../decorators/client_exec_client.ts";
import type { ClientToolDefinition } from "../../shared/types.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_PORT = 9002;
const TEST_HOST = "127.0.0.1";
const TEST_URL = `http://${TEST_HOST}:${TEST_PORT}`;

Deno.test("Puppet client integration test", async (t) => {
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
    await t.step(
      "Puppet client should be able to call puppet's tools",
      async () => {
        // Create puppet client (Chrome) with specific tools
        const puppetClient = createClientExecClient(
          new Client(
            { name: "puppet-client", version: "1.0.0" },
            { capabilities: {} },
          ),
          "puppet-client-001",
        );

        const puppetTools: ClientToolDefinition[] = [
          {
            name: "puppetTool",
            description: "A tool provided by the puppet client",
            inputSchema: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "Message to process",
                },
              },
              required: ["message"],
            },
            implementation: (args: Record<string, unknown>) => {
              return {
                content: [
                  {
                    type: "text",
                    text: `Puppet processed: ${args.message}`,
                  },
                ],
              };
            },
          },
        ];

        puppetClient.registerTools(puppetTools);

        // Connect puppet client first
        const puppetTransport = new SSEClientTransport(
          new URL(`${TEST_URL}/sse?sessionId=puppet-007`),
        );
        await puppetClient.connect(puppetTransport);

        await delay(500);

        // Create controller client and bind puppet to it
        const controllerClient = createClient();
        const controllerTransport = new SSEClientTransport(
          new URL(`${TEST_URL}/sse?puppetId=puppet-007`),
        );

        await controllerClient.connect(controllerTransport);

        await delay(500);

        // Controller client delegates tool calls to puppet
        // When controller calls listTools, it actually calls puppet's listTools
        const tools = await controllerClient.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        // Should have puppet's tools (because listTools is forwarded to puppet)
        assertEquals(toolNames.includes("puppetTool"), true);

        // Test calling puppet's tool through controller
        const puppetResult = await controllerClient.callTool({
          name: "puppetTool",
          arguments: {
            message: "Hello from controller",
          },
        });

        assertExists(puppetResult);
        // Type assertion for the result
        const resultContent = puppetResult.content as Array<{
          type: string;
          text: string;
        }>;
        assertEquals(
          resultContent[0].type === "text" && resultContent[0].text,
          "Puppet processed: Hello from controller",
        );

        console.log("✅ Puppet tool successfully called through controller!");

        // Give a moment for all messages to be processed
        await delay(200);

        // Cleanup
        await controllerClient.close();
        await puppetClient.close();
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
