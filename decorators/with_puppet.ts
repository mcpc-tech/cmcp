/**
 * Universal puppet capability decorator for MCP transports.
 *
 * This simple wrapper adds puppet functionality to ANY transport implementation
 * (SSE, stdio, WebSocket, or custom transports).
 *
 * @example
 * ```typescript
 * // Works with SSE
 * const transport = withPuppet(new SSEServerTransport("/messages"));
 *
 * // Works with stdio
 * const transport = withPuppet(new StdioServerTransport());
 *
 * // Works with WebSocket
 * const transport = withPuppet(new WebSocketServerTransport());
 *
 * // Bind puppet clients
 * transport.bindPuppet("session-123", puppetTransport, ["tools/list", "tools/call"]);
 * ```
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type JSONRPCMessage,
  JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Methods that can be forwarded to puppet clients
 */
export const PUPPET_METHODS = {
  ListTools: "tools/list",
  CallTool: "tools/call",
  ListResources: "resources/list",
  ReadResource: "resources/read",
  ListPrompts: "prompts/list",
} as const;

/**
 * Default methods forwarded to puppet
 */
const DEFAULT_FORWARDED = [
  PUPPET_METHODS.ListTools,
  PUPPET_METHODS.CallTool,
] as const;

/**
 * Transport with puppet capabilities
 */
interface PuppetTransport<T extends Transport> extends Transport {
  /** Bind a puppet client to intercept specific methods */
  bindPuppet(
    puppet: Transport,
    methods?: readonly string[],
  ): void;

  /** Unbind a puppet client */
  unbindPuppet(sessionId: string): void;

  /** Get the underlying transport */
  unwrap(): T;
}

const puppets = new Map<string, Transport>();
const originalHandlers = new Map<
  string,
  ((message: JSONRPCMessage) => void) | undefined
>();

/**
 * Add puppet capabilities to any transport.
 *
 * Simple, type-safe wrapper that works with all transport types.
 */
export function withPuppet<T extends Transport>(
  transport: T,
): PuppetTransport<T> & T {
  // Store puppet mappings

  /**
   * Bind a puppet client to intercept methods
   */
  function bindPuppet(
    puppet: Transport,
    methods: readonly string[] = [...DEFAULT_FORWARDED],
  ): void {
    const originalSend = puppet.send?.bind(transport);
    const originalHandler = transport.onmessage?.bind(transport);

    // Intercept host onmessage events, protocol level
    transport.onmessage = (msg: JSONRPCMessage) => {
      console.log(`intercepted transport onmessage: ${JSON.stringify(msg)}`);
      const parsed = JSONRPCMessageSchema.safeParse(msg);
      if (!parsed.success) {
        originalHandler?.(msg);
        return;
      }

      const method = "method" in parsed.data ? parsed.data.method : null;
      const shouldForward = method && methods.includes(method);
      console.log(
        `should forward to puppet: ${shouldForward}`,
        puppet.onmessage,
      );
      if (shouldForward) {
        return puppet?.onmessage?.(msg);
      }

      originalHandler?.(msg);
    };

    // Intercept puppet sends, use transport send
    puppet.send = async (
      message: JSONRPCMessage,
    ): Promise<void> => {
      console.log(`intercepted puppet send: ${JSON.stringify(message)}`);
      await transport.send?.(message);
      await originalSend?.(message);
    };
  }

  /**
   * Remove puppet binding
   */
  function unbindPuppet(sessionId: string): void {
    puppets.delete(sessionId);

    const original = originalHandlers.get(sessionId);
    if (original) {
      const transportWithHandler = transport as Transport;
      transportWithHandler.onmessage = original;
      originalHandlers.delete(sessionId);
    }
  }

  /**
   * Get the original transport
   */
  function unwrap(): T {
    return transport;
  }

  // Simply add methods to the transport object
  return Object.assign(transport, {
    bindPuppet,
    unbindPuppet,
    unwrap,
  }) as PuppetTransport<T> & T;
}
