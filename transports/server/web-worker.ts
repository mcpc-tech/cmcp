import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * A Transport implementation for the SERVER side, running inside a Web Worker.
 * It adapts the worker's global `self.onmessage` and `self.postMessage`
 * to the Transport interface required by the MCP Server class.
 */
export class WorkerServerTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  public readonly sessionId: string;

  constructor() {
    this.sessionId = crypto.randomUUID();

    // Listen for any message coming INTO the worker from the main thread.
    // @ts-ignore -
    self.onmessage = (event: MessageEvent<JSONRPCMessage>) => {
      // When a message is received, forward it to the Server's handler.
      this.onmessage?.(event.data);
    };
  }

  /**
   * For a worker, the connection is always considered "started".
   */
  public start(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Sends a message from the Server (inside the worker) OUT to the main thread.
   */
  public send(message: JSONRPCMessage): Promise<void> {
    try {
      // @ts-ignore -
      self.postMessage(message);
      return Promise.resolve();
    } catch (error) {
      // This can happen if the message contains non-cloneable data.
      this.onerror?.(error as Error);
      return Promise.reject(error);
    }
  }

  /**
   * Closing a worker is typically initiated by the main thread.
   * This method just triggers the callback.
   */
  public close(): Promise<void> {
    this.onclose?.();
    return Promise.resolve();
  }
}
