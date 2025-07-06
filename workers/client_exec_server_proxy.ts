import {
  createClientExecServer,
  type ClientExecServer,
} from "../decorators/client_exec_server.ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WorkerServerTransport } from "../transports/server/web-worker.ts";

export const runClientExecServerWoker: () => ClientExecServer & Server = () => {
  const server = createClientExecServer(
    new Server(
      {
        name: "cmcp-server",
        version: "0.1.0",
      },
      { capabilities: { tools: {} } }
    ),
    "cmcp-server"
  );
  server.connect(new WorkerServerTransport());
  return server;
};
