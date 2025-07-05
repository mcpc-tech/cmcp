import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { handleConnecting } from "../../../shared/sse.ts";
import { INCOMING_MSG_ROUTE_PATH } from "../const.ts";
import { createMCPServer } from "../server.ts";

export const sseHandler = (app: OpenAPIHono): OpenAPIHono =>
  app.openapi(
    createRoute({
      hide: true,
      method: "get",
      path: "/sse",
      responses: {
        200: {
          content: {
            "text/event-stream": {
              schema: z.any(),
            },
          },
          description: "Returns the processed message",
        },
        400: {
          content: {
            "application/json": {
              schema: z.any(),
            },
          },
          description: "Returns an error",
        },
      },
    }),
    async (c) => {
      const response = await handleConnecting(
        c.req.raw,
        createMCPServer,
        INCOMING_MSG_ROUTE_PATH,
      );
      return response;
    },
    (result, c) => {
      if (!result.success) {
        return c.json(
          {
            code: 400,
            message: result.error.message,
          },
          400,
        );
      }
    },
  );
