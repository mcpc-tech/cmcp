/**
 * Universal puppet capability decorator for MCP transports.
 *
 * Adds puppet (delegation) functionality to any MCP transport implementation.
 * A puppet transport can handle specific MCP methods on behalf of the main transport,
 * enabling scenarios like remote tool execution, resource proxying, etc.
 *
 * @example
 * ```typescript
 * // Create a main SSE transport
 * const mainTransport = new SSEServerTransport("/messages");
 *
 * // Get a puppet transport from another session
 * const puppetTransport = getPuppetTransport("session-123");
 *
 * // Bind the puppet to handle specific methods
 * const transport = bindPuppet(
 *   mainTransport,
 *   puppetTransport,
 *   ["tools/list", "tools/call"]
 * );
 *
 * // Now when "tools/list" or "tools/call" requests arrive,
 * // they will be forwarded to the puppet transport
 * ```
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  type JSONRPCMessage,
  JSONRPCMessageSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ExecuteToolNotificationSchema } from "./client_exec_client.ts";
import {
  ClientToolRegistrationRequestSchema,
  ToolResponseRequestSchema,
} from "./client_exec_server.ts";

const DEFAULT_FORWARDED = [
  ListToolsRequestSchema.shape.method.value,
  CallToolRequestSchema.shape.method.value,
] as const;

/**
 * Transport with puppet capabilities
 */
interface PuppetTransport<T extends Transport> extends Transport {
  /** Unbind the puppet and restore original handlers */
  unbindPuppet(): void;

  /** Get the original unwrapped transport */
  unwrap(): T;

  /** ID of the currently bound puppet transport (if any) */
  boundPuppetId?: string;
}

/**
 * Add puppet capabilities to a transport.
 *
 * This function wraps a transport to enable method forwarding to a puppet transport.
 * When the main transport receives a message matching one of the specified methods,
 * it will be forwarded to the puppet's onmessage handler instead.
 * Similarly, when the puppet sends a message, it will use the main transport's send method.
 *
 * @param transport - The main transport to wrap
 * @param puppet - The puppet transport that will handle forwarded methods (optional)
 * @param methods - Array of method names to forward (default: tools/list, tools/call)
 * @returns The wrapped transport with puppet capabilities
 *
 * @example
 * ```typescript
 * const transport = bindPuppet(
 *   mainTransport,
 *   puppetTransport,
 *   ["tools/list", "tools/call", "resources/read"]
 * );
 * ```
 */
export function bindPuppet<T extends Transport>(
  transport: T,
  puppet: T | null | undefined,
  methods: readonly string[] = [...DEFAULT_FORWARDED],
): PuppetTransport<T> & T {
  // Store original handlers for restoration
  let originalTransportHandler: ((message: JSONRPCMessage) => void) | undefined;
  let originalPuppetSend:
    | ((message: JSONRPCMessage) => Promise<void>)
    | undefined;
  let boundPuppet: Transport | null = null;

  /**
   * Apply the puppet binding to the transport.
   *
   * This intercepts the transport's onmessage handler to forward matching methods
   * to the puppet, and intercepts the puppet's send method to use the main transport.
   */
  function applyPuppetBinding(
    puppet: Transport,
    methods: readonly string[],
  ): void {
    boundPuppet = puppet;
    originalPuppetSend = puppet.send?.bind(puppet);
    originalTransportHandler = transport.onmessage?.bind(transport);

    // Intercept main transport's onmessage to forward matching methods to puppet
    transport.onmessage = (msg: JSONRPCMessage) => {
      console.error(
        `[puppet] intercepted transport onmessage: ${JSON.stringify(msg)}`,
      );
      const parsed = JSONRPCMessageSchema.safeParse(msg);
      if (!parsed.success) {
        originalTransportHandler?.(msg);
        return;
      }

      const method = "method" in parsed.data ? parsed.data.method : null;

      // Never forward internal protocol methods
      if (
        method === ToolResponseRequestSchema.shape.method.value ||
        method === ExecuteToolNotificationSchema.shape.method.value ||
        method === ClientToolRegistrationRequestSchema.shape.method.value
      ) {
        originalTransportHandler?.(msg);
        return;
      }

      const shouldForward = method && methods.includes(method);
      console.error(
        `[puppet] should forward to puppet=${shouldForward}, method=${method}`,
      );
      if (shouldForward) {
        return puppet?.onmessage?.(msg);
      }

      originalTransportHandler?.(msg);
    };

    // Intercept puppet's send to use main transport's connection
    puppet.send = async (message: JSONRPCMessage): Promise<void> => {
      console.error(
        `[puppet] intercepted puppet send: ${JSON.stringify(message)}`,
      );
      await transport.send?.(message);
      await originalPuppetSend?.(message);
    };
  }

  /**
   * Remove puppet binding and restore original handlers.
   *
   * This restores both the main transport's onmessage handler and
   * the puppet's send method to their original implementations.
   */
  function unbindPuppet(): void {
    if (!boundPuppet) {
      console.error("[puppet] no puppet bound, nothing to unbind");
      return;
    }

    console.error("[puppet] unbinding puppet and restoring original handlers");

    // Restore transport's original onmessage handler
    if (originalTransportHandler) {
      transport.onmessage = originalTransportHandler;
    }

    // Restore puppet's original send method
    if (boundPuppet && originalPuppetSend) {
      boundPuppet.send = originalPuppetSend;
    }

    // Clear references
    boundPuppet = null;
    originalTransportHandler = undefined;
    originalPuppetSend = undefined;
  }

  /**
   * Get the original unwrapped transport instance
   */
  function unwrap(): T {
    return transport;
  }

  if (puppet) {
    // Wrap the start method to apply puppet binding after the transport connection is established.
    // This ensures the transport has its onmessage handler set before we intercept it.
    const originalStart = transport.start?.bind(transport);
    const originalPuppetStart = puppet.start?.bind(puppet);

    transport.start = async function () {
      await originalStart?.();
      // Apply puppet binding after connection is ready
      if (puppet) {
        console.error(
          `[puppet] applying puppet binding after connection established, controler: ${transport.sessionId}, puppet: ${puppet.sessionId}`,
        );
        applyPuppetBinding(puppet, methods);
      }
    };

    puppet.start = async function () {
      await originalPuppetStart?.();
      // If the puppet re-connects, re-apply the binding as well
      applyPuppetBinding(puppet, methods);
    };
  }

  // Return the transport with added puppet management methods
  return Object.assign(transport, {
    unbindPuppet,
    unwrap,
    boundPuppetId: puppet?.sessionId,
  }) as PuppetTransport<T> & T;
}
