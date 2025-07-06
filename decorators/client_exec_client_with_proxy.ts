import type {
  C2W_RegisterToolsMessage,
  C2W_ToolResponseMessage,
  C2W_UnregisterMessage,
  ClientToolDefinition,
  WorkerToClientMessage,
} from "../shared/types.ts";
import { WorkerTransport } from "../transports/worker.ts";

export class ClientExecClientProxy {
  public readonly clientId: string;
  private tools: Map<string, ClientToolDefinition["implementation"]> =
    new Map();
  private toolDefinitions: Omit<ClientToolDefinition, "implementation">[] = [];
  private worker: Worker | null = null;

  constructor(clientId: string) {
    if (!clientId) {
      throw new Error("A unique clientId must be provided.");
    }
    this.clientId = clientId;
  }

  /**
   * Registers tools to be exposed to the worker.
   * If already connected, this will notify the worker of the new tools.
   */
  public registerTools(tools: ClientToolDefinition[]): void {
    this.toolDefinitions = [];
    this.tools.clear();
    for (const tool of tools) {
      this.tools.set(tool.name, tool.implementation);
      const { implementation, ...definition } = tool;
      this.toolDefinitions.push(definition);
    }

    if (this.worker) {
      this.notifyWorkerOfTools();
    }
  }

  /**
   * Connects to the web worker and registers its tools.
   * @param worker The Web Worker instance to communicate with.
   */
  public connect(worker: Worker): void {
    if (this.worker) {
      console.warn(
        `Client ${this.clientId} is already connected. Disconnecting from the old worker first.`,
      );
      return;
    }
    this.worker = worker;
    this.worker.addEventListener("message", this.handleWorkerMessage);
    this.notifyWorkerOfTools();
    console.log(`Client ${this.clientId} connected to worker.`);
  }

  /**
   * Disconnects from the web worker and cleans up listeners.
   */
  public disconnect(): void {
    if (!this.worker) return;

    // Notify the worker that this client is disconnecting
    const unregisterMessage: C2W_UnregisterMessage = {
      type: "c2w/unregister",
      payload: { clientId: this.clientId },
    };
    this.worker.postMessage(unregisterMessage);

    this.worker.removeEventListener("message", this.handleWorkerMessage);
    this.worker = null;
    console.log(`Client ${this.clientId} disconnected from worker.`);
  }

  private notifyWorkerOfTools(): void {
    if (!this.worker) return;
    const registrationMessage: C2W_RegisterToolsMessage = {
      type: "c2w/register_tools",
      payload: {
        clientId: this.clientId,
        tools: this.toolDefinitions,
      },
    };
    this.worker.postMessage(registrationMessage);
  }

  private handleWorkerMessage = async (
    event: MessageEvent<WorkerToClientMessage>,
  ): Promise<void> => {
    if (event.data?.type === "w2c/execute_tool") {
      const response = await this.executeTool(event.data.payload);
      if (this.worker) {
        this.worker.postMessage(response);
      }
    }
  };

  private async executeTool(params: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<C2W_ToolResponseMessage> {
    let success = false;
    let result: unknown;
    let error: string | undefined;

    try {
      const implementation = this.tools.get(params.toolName);
      if (!implementation) {
        throw new Error(
          `Tool "${params.toolName}" not found on client "${this.clientId}"`,
        );
      }
      result = await implementation(params.args);
      success = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    return {
      type: "c2w/tool_response",
      payload: {
        requestId: params.requestId,
        success,
        result,
        error,
      },
    };
  }

  /**
   * Gets the current status of the client proxy.
   */
  public getStatus() {
    return {
      clientId: this.clientId,
      isConnected: !!this.worker,
      toolCount: this.tools.size,
      tools: this.toolDefinitions.map((t) => t.name),
    };
  }
}

export function createClientExecProxyClient(
  clientId: string,
): ClientExecClientProxy {
  return new ClientExecClientProxy(clientId);
}

export function createClientExecProxyTransport(): WorkerTransport {
  const worker = new Worker(
    new URL("../workers/client_exec_server_proxy.ts", import.meta.url),
    {
      type: "module",
    },
  );

  globalThis.addEventListener("beforeunload", () => {
    console.log("Terminating the shared worker instance...");
    worker.terminate();
  });

  const transport = new WorkerTransport(worker);
  return transport;
}
