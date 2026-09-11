import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";

import {
  ProviderName,
  ChatMessage,
} from "./providers/types";

import { ProviderManager } from "./providers/manager";

/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const PORT = 8765;
const HOST = "127.0.0.1";

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

type ChatCompletionRequest = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/*
|--------------------------------------------------------------------------
| Fastify
|--------------------------------------------------------------------------
*/

const app = Fastify({
  logger: true,
});

/*
|--------------------------------------------------------------------------
| Provider Manager
|--------------------------------------------------------------------------
*/

const providerManager =
  new ProviderManager();

/*
|--------------------------------------------------------------------------
| WebSocket State
|--------------------------------------------------------------------------
*/

let extensionSocket: WebSocket | null = null;

/*
|--------------------------------------------------------------------------
| Pending Requests
|--------------------------------------------------------------------------
*/

const pendingRequests =
  new Map<string, PendingRequest>();

/*
|--------------------------------------------------------------------------
| Generate Request ID
|--------------------------------------------------------------------------
*/

function generateId(): string {
  return `cw_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", async () => {
  return {
    name: "AI Window Bridge",
    version: "0.4.0",
    status: "running",

    extensionConnected:
      extensionSocket !== null &&
      extensionSocket.readyState === WebSocket.OPEN,

    activeProvider:
      providerManager.getActiveProvider(),
  };
});

/*
|--------------------------------------------------------------------------
| Models
|--------------------------------------------------------------------------
*/

app.get("/v1/models", async () => {
  return {
    object: "list",

    data: providerManager
      .getProviders()
      .map((provider) => ({
        id: provider.id,
        object: "model",
        created: 0,
        owned_by: provider.id,

        available:
          provider.available,

        active:
          provider.active,
      })),
  };
});

/*
|--------------------------------------------------------------------------
| Get Active Provider
|--------------------------------------------------------------------------
*/

app.get("/v1/provider", async () => {
  return {
    active:
      providerManager.getActiveProvider(),

    providers:
      providerManager.getProviders(),
  };
});

/*
|--------------------------------------------------------------------------
| Change Active Provider
|--------------------------------------------------------------------------
*/

app.post(
  "/v1/provider",
  async (request, reply) => {

    const body =
      request.body as {
        provider?: ProviderName;
      };

    const provider =
      body?.provider;

    /*
     * Validate provider
     */

    if (
      provider !== "chatgpt" &&
      provider !== "claude" &&
      provider !== "gemini"
    ) {
      return reply.code(400).send({
        error: {
          message:
            "provider must be chatgpt, claude, or gemini.",

          type:
            "invalid_request_error",
        },
      });
    }

    /*
     * Get previous provider
     */

    const previousProvider =
      providerManager.getActiveProvider();

    /*
     * Change provider
     */

    providerManager.setActiveProvider(
      provider,
    );

    /*
     * Get new provider
     */

    const activeProvider =
      providerManager.getActiveProvider();

    /*
     * Notify extension only if
     * provider actually changed.
     */

    if (
      previousProvider !== activeProvider &&
      extensionSocket &&
      extensionSocket.readyState ===
        WebSocket.OPEN
    ) {

      extensionSocket.send(
        JSON.stringify({
          type:
            "provider_changed",

          provider:
            activeProvider,
        }),
      );
    }

    /*
     * Response
     */

    return reply.send({
      success: true,

      active:
        activeProvider,

      providers:
        providerManager.getProviders(),
    });
  },
);

/*
|--------------------------------------------------------------------------
| Chat Completions
|--------------------------------------------------------------------------
|
| POST /v1/chat/completions
|
|--------------------------------------------------------------------------
*/

app.post(
  "/v1/chat/completions",
  async (request, reply) => {

    /*
     * Check extension connection
     */

    if (
      !extensionSocket ||
      extensionSocket.readyState !==
        WebSocket.OPEN
    ) {

      return reply.code(503).send({
        error: {
          message:
            "Chrome extension is not connected.",

          type:
            "bridge_error",
        },
      });
    }

    /*
     * Parse request body
     */

    const body =
      request.body as ChatCompletionRequest;

    /*
     * Validate messages
     */

    if (
      !body ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {

      return reply.code(400).send({
        error: {
          message:
            "messages is required and must be a non-empty array.",

          type:
            "invalid_request_error",
        },
      });
    }

    /*
     * Get active provider
     *
     * ProviderManager is the source
     * of truth.
     */

    const provider =
      providerManager.getActiveProvider();

    /*
     * Generate request ID
     */

    const requestId =
      generateId();

    /*
     * Wait for extension response
     */

    const responsePromise =
      new Promise<any>(
        (resolve, reject) => {

          const timer =
            setTimeout(() => {

              pendingRequests.delete(
                requestId,
              );

              reject(
                new Error(
                  "Request timed out waiting for Chrome extension.",
                ),
              );

            }, 120_000);

          pendingRequests.set(
            requestId,
            {
              resolve,
              reject,
              timer,
            },
          );
        },
      );

    /*
     * Build browser request
     */

    const browserRequest = {
      type:
        "chat_request",

      requestId,

      /*
       * Server explicitly sends the
       * currently selected provider.
       */

      provider,

      model:
        body.model ||
        "chat-window",

      messages:
        body.messages,

      stream:
        Boolean(body.stream),
    };

    /*
     * Send request to extension
     */

    try {

      extensionSocket.send(
        JSON.stringify(
          browserRequest,
        ),
      );

    } catch (error: any) {

      const pending =
        pendingRequests.get(
          requestId,
        );

      if (pending) {

        clearTimeout(
          pending.timer,
        );

        pendingRequests.delete(
          requestId,
        );

        pending.reject(
          new Error(
            error?.message ||
              "Failed to send request to Chrome extension.",
          ),
        );
      }
    }

    /*
     * Wait for response
     */

    try {

      const result =
        await responsePromise;

      /*
       * Provider returned error
       */

      if (result?.error) {

        return reply.code(500).send({
          error: {
            message:
              result.error,

            type:
              "provider_error",

            provider,
          },
        });
      }

      /*
       * OpenAI-compatible response
       */

      return reply.send({

        id:
          requestId,

        object:
          "chat.completion",

        created:
          Math.floor(
            Date.now() / 1000,
          ),

        model:
          body.model ||
          "chat-window",

        choices: [
          {
            index: 0,

            message: {
              role:
                "assistant",

              content:
                result?.content ||
                "",
            },

            finish_reason:
              "stop",
          },
        ],

        /*
         * Extra bridge information.
         */

        provider,
      });

    } catch (error: any) {

      return reply.code(500).send({
        error: {
          message:
            error?.message ||
            "Failed to process chat request.",

          type:
            "bridge_error",

          provider,
        },
      });
    }
  },
);

/*
|--------------------------------------------------------------------------
| WebSocket Server
|--------------------------------------------------------------------------
*/

const wss =
  new WebSocketServer({
    server:
      app.server,

    path:
      "/ws",
  });

/*
|--------------------------------------------------------------------------
| WebSocket Connection
|--------------------------------------------------------------------------
*/

wss.on(
  "connection",
  (socket) => {

    console.log(
      "Chrome Extension connected",
    );

    /*
     * Close old connection if
     * another extension connects.
     */

    if (
      extensionSocket &&
      extensionSocket.readyState ===
        WebSocket.OPEN
    ) {

      console.log(
        "Closing previous Chrome Extension connection",
      );

      extensionSocket.close();
    }

    /*
     * Store new connection.
     */

    extensionSocket =
      socket;

    /*
     * Tell extension current provider.
     */

    socket.send(
      JSON.stringify({
        type:
          "provider_changed",

        provider:
          providerManager.getActiveProvider(),
      }),
    );

    /*
     * Handle messages
     */

    socket.on(
      "message",
      (rawMessage) => {

        try {

          const message =
            JSON.parse(
              rawMessage.toString(),
            );

          console.log(
            "Message from extension:",
            message,
          );

          /*
           * Extension ready
           */

          if (
            message.type ===
            "extension_ready"
          ) {

            console.log(
              "Extension is ready",
            );

            return;
          }

          /*
           * Provider changed
           */

          if (
            message.type ===
            "provider_changed"
          ) {

            const provider =
              message.provider;

            if (
              provider === "chatgpt" ||
              provider === "claude" ||
              provider === "gemini"
            ) {

              providerManager.setActiveProvider(
                provider,
              );
            }

            return;
          }

          /*
           * Chat response
           */

          if (
            message.type ===
            "chat_response"
          ) {

            const requestId =
              message.requestId;

            if (!requestId) {

              console.warn(
                "chat_response missing requestId",
              );

              return;
            }

            const pending =
              pendingRequests.get(
                requestId,
              );

            if (!pending) {

              console.warn(
                `No pending request found for ${requestId}`,
              );

              return;
            }

            /*
             * Clear timeout
             */

            clearTimeout(
              pending.timer,
            );

            /*
             * Remove request
             */

            pendingRequests.delete(
              requestId,
            );

            /*
             * Resolve request
             */

            pending.resolve({
              content:
                message.content ||
                "",

              error:
                message.error,
            });

            return;
          }

          /*
           * Pong
           */

          if (
            message.type ===
            "pong"
          ) {

            return;
          }

          /*
           * Unknown message
           */

          console.log(
            "Unknown extension message:",
            message,
          );

        } catch (error) {

          console.error(
            "Failed to parse extension message:",
            error,
          );
        }
      },
    );

    /*
     * Socket closed
     */

    socket.on(
      "close",
      () => {

        console.log(
          "Chrome Extension disconnected",
        );

        if (
          extensionSocket === socket
        ) {

          extensionSocket =
            null;
        }
      },
    );

    /*
     * Socket error
     */

    socket.on(
      "error",
      (error) => {

        console.error(
          "Chrome Extension WebSocket error:",
          error,
        );
      },
    );
  },
);

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

async function startServer() {

  try {

    /*
     * Register CORS inside the
     * async startup function.
     *
     * This avoids the CJS
     * top-level-await error.
     */

    await app.register(cors, {
      origin: true,
    });

    /*
     * Start Fastify
     */

    await app.listen({
      port: PORT,
      host: HOST,
    });

    console.log(
      `Server listening at http://${HOST}:${PORT}`,
    );

    console.log(
      "AI Window Bridge v0.4.0",
    );

    console.log(
      `HTTP      http://${HOST}:${PORT}`,
    );

    console.log(
      `WebSocket ws://${HOST}:${PORT}/ws`,
    );

  } catch (error) {

    app.log.error(
      error,
    );

    process.exit(1);
  }
}

/*
|--------------------------------------------------------------------------
| Run
|--------------------------------------------------------------------------
*/

startServer();