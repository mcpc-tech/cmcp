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
  /** Unbind the puppet and restore original handlers */
  unbindPuppet(): void;

  /** Get the original unwrapped transport */
  unwrap(): T;
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
        `[Puppet] Intercepted transport onmessage: ${JSON.stringify(msg)}`,
      );
      const parsed = JSONRPCMessageSchema.safeParse(msg);
      if (!parsed.success) {
        originalTransportHandler?.(msg);
        return;
      }

      const method = "method" in parsed.data ? parsed.data.method : null;
      const shouldForward = method && methods.includes(method);
      console.error(
        `[Puppet] Should forward to puppet=${shouldForward}, method=${method}`,
        puppet.onmessage,
      );
      if (shouldForward) {
        return puppet?.onmessage?.(msg);
      }

      originalTransportHandler?.(msg);
    };

    // Intercept puppet's send to use main transport's connection
    puppet.send = async (message: JSONRPCMessage): Promise<void> => {
      console.error(
        `[Puppet] Intercepted puppet send: ${JSON.stringify(message)}`,
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
      console.error("[Puppet] No puppet bound, nothing to unbind");
      return;
    }

    console.error("[Puppet] Unbinding puppet and restoring original handlers");

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

  // Wrap the start method to apply puppet binding after the transport connection is established.
  // This ensures the transport has its onmessage handler set before we intercept it.
  const originalStart = transport.start?.bind(transport);
  if (originalStart) {
    transport.start = async function () {
      await originalStart();
      // Apply puppet binding after connection is ready
      if (puppet) {
        console.error(
          "[Puppet] Applying puppet binding after connection established",
        );
        applyPuppetBinding(puppet, methods);
      }
    };
  }

  // Return the transport with added puppet management methods
  return Object.assign(transport, {
    unbindPuppet,
    unwrap,
  }) as PuppetTransport<T> & T;
}
