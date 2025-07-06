import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * A Transport implementation for communicating with a Web Worker.
 * It acts as the bridge between a Client instance on the main thread
 * and a server running inside the worker.
 */
export class WorkerTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  public readonly sessionId: string;

  constructor(private worker: Worker) {
    this.sessionId = crypto.randomUUID();

    this.worker.onmessage = (event: MessageEvent) => {
      // When a message is received from the worker, forward it to the client's handler
      this.onmessage?.(event.data);
    };

    this.worker.onerror = (event: ErrorEvent) => {
      // When an error occurs in the worker, forward it
      this.onerror?.(new Error(event.message));
    };
  }

  // For workers, the connection is implicitly "started" upon instantiation.
  public start(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Sends a message from the client (main thread) to the worker.
   */
  public send(message: JSONRPCMessage): Promise<void> {
    try {
      this.worker.postMessage(message);
      return Promise.resolve();
    } catch (error) {
      this.onerror?.(error as Error);
      return Promise.reject(error);
    }
  }

  /**
   * Closes the connection by terminating the worker.
   */
  public close(): Promise<void> {
    this.worker.terminate();
    this.onclose?.();
    return Promise.resolve();
  }
}
