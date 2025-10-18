/**
 * Server transport for SSE: this will send messages over an SSE connection and receive messages from HTTP POST requests.
 *
 * This implementation follows the Web Server-Sent Events API standard as implemented by Deno.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#fields
 * @see https://github.com/denoland/std/blob/9d765df2d9dd4653f68aecf4b0e387b9651cd16c/http/server_sent_event_stream.ts#L96
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  type JSONRPCMessage,
  JSONRPCMessageSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ServerSentEventStream } from "@std/http/server-sent-event-stream";
import type { ClientExecServer } from "../../decorators/client_exec_server.ts";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { withPuppet } from "../../decorators/with_puppet.ts";

type SupportedServer = McpServer | (ClientExecServer & Server) | Server;

/**
 * Session Manager: Map of session IDs to SSE server transports
 */
const transportManager = new Map<string, SSEServerTransport>();

/**
 * Handles the initial connection and outgoing sse messages.
 */
export async function handleConnecting(
  request: Request,
  createMCPServer: () => Promise<SupportedServer>,
  incomingMsgRoutePath: string
): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const puppetId = url.searchParams.get("puppetId");

  // Return existing session if valid sessionId provided
  if (sessionId) {
    const transport = transportManager.get(sessionId);
    if (transport) {
      return transport.sseResponse;
    }
    // return new Response("Invalid or expired sessionId", { status: 404 });
  }

  // Create new session
  const transport = withPuppet(
    new SSEServerTransport(incomingMsgRoutePath, sessionId ?? undefined)
  );
  const puppetTransport = puppetId ? transportManager.get(puppetId) : undefined;
  transportManager.set(transport.sessionId, transport);

  await createMCPServer().then((srv: SupportedServer) => {
    if (puppetTransport && "setRequestHandler" in srv) {
      srv.setRequestHandler(CallToolRequestSchema, (request, _extra) => {
        if (request.params.name === "example-tool") {
          return {
            content: [
              { type: "text", text: "This is an example tool response 2" },
            ],
          };
        }
        throw new McpError(ErrorCode.InvalidRequest, "Tool not found");
      });
    }

    srv.connect(transport).then(() => {
      if (puppetTransport) {
        console.log(
          `Binding puppet ${puppetId} transport for session ${transport.sessionId}
This forward calls to puppet transport and receive messages from it.`
        );
        transport.bindPuppet(puppetTransport);
      }
    });
  });

  console.log(
    `Created new SSE transport with sessionId: ${transport.sessionId}`
  );

  return transport.sseResponse;
}

/**
 * Handles POST messages for all SSE transports
 * @param request The HTTP request object
 * @returns A Response object indicating success or failure
 */
export async function handleIncoming(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return new Response("Missing sessionId parameter", { status: 400 });
  }

  const transport = transportManager.get(sessionId);
  if (!transport) {
    return new Response("Invalid or expired sessionId", { status: 404 });
  }

  if (!transport.isConnected) {
    return new Response("SSE connection not established", { status: 500 });
  }

  // Validate content type
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return new Response("Unsupported content-type: Expected application/json", {
      status: 415,
    });
  }

  try {
    return await transport.handlePostMessage(request);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(errorMessage, { status: 400 });
  }
}

/**
 * Server transport for SSE: this will send messages over an SSE connection and receive messages from HTTP POST requests.
 *
 * This implementation uses web standard APIs and is compatible with Deno.
 */
export class SSEServerTransport implements Transport {
  #sseResponse?: Response;
  #sessionId: string;
  #controller?: ReadableStreamDefaultController;
  #stream: ReadableStream;
  #endpoint: string;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Creates a new SSE server transport, which will direct the client to POST messages to the relative or absolute URL identified by `endpoint`.
   */
  constructor(endpoint: string, sessionId?: string) {
    this.#endpoint = endpoint;
    this.#sessionId = sessionId || crypto.randomUUID();
    this.#stream = this.#createStream();
  }

  #createStream(): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        this.#controller = controller;
      },
      cancel: (reason) => {
        console.log(
          `SSE stream cancelled with sessionId: ${this.#sessionId}`,
          reason
        );
        this.#cleanup();
      },
    }).pipeThrough(new ServerSentEventStream());
  }

  #cleanup(): void {
    this.#controller = undefined;
    this.#sseResponse = undefined;
    transportManager.delete(this.#sessionId);
    this.onclose?.();
  }

  /**
   * Handles the initial SSE connection request.
   *
   * This should be called when a GET request is made to establish the SSE stream.
   */
  start(): Promise<void> {
    if (this.#sseResponse) {
      throw new Error(
        "SSEServerTransport already started! If using Server class, note that connect() calls start() automatically."
      );
    }

    this.#controller?.enqueue({
      event: "endpoint",
      data: `${this.#endpoint}?sessionId=${this.#sessionId}`,
      id: Date.now().toString(),
    });

    this.#sseResponse = new Response(this.#stream, {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });

    return Promise.resolve();
  }

  /**
   * Handles incoming POST messages.
   *
   * This should be called when a POST request is made to send a message to the server.
   */
  async handlePostMessage(request: Request): Promise<Response> {
    if (!this.#sseResponse) {
      return new Response("SSE connection not established", { status: 500 });
    }

    try {
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Unsupported content-type: ${contentType}`);
      }

      const body = await request.json();
      await this.handleMessage(body);

      return new Response("Accepted", { status: 202 });
    } catch (error) {
      console.log(error);
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.onerror?.(errorObj);
      return new Response(String(error), { status: 400 });
    }
  }

  /**
   * Handle a client message, regardless of how it arrived. This can be used to inform the server of messages that arrive via a means different than HTTP POST.
   */
  handleMessage(message: unknown): Promise<void> {
    try {
      const parsedMessage = JSONRPCMessageSchema.parse(message);
      this.onmessage?.(parsedMessage);
      return Promise.resolve();
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.onerror?.(errorObj);
      return Promise.reject(error);
    }
  }

  close(): Promise<void> {
    this.#controller?.close();
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (!this.#controller) {
      throw new Error("Not connected");
    }

    this.#controller.enqueue({
      data: JSON.stringify(message),
      event: "message",
      id: Date.now().toString(),
    });

    return Promise.resolve();
  }

  /**
   * Returns the session ID for this transport.
   *
   * This can be used to route incoming POST requests.
   */
  get sessionId(): string {
    return this.#sessionId;
  }

  get sseStream(): ReadableStream {
    return this.#stream;
  }

  get sseResponse(): Response {
    return this.#sseResponse!;
  }

  get isConnected(): boolean {
    return this.#controller !== undefined;
  }
}
