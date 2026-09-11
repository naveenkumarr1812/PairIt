import {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types";

export class ClaudeAdapter
  implements ProviderAdapter
{
  name = "claude" as const;

  isAvailable(): boolean {
    return true;
  }

  async sendMessage(
    request: ProviderRequest,
  ): Promise<ProviderResponse> {
    const lastUserMessage =
      [...request.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "user",
        );

    return {
      content:
        `[Claude adapter] Received: ${
          lastUserMessage?.content ?? ""
        }`,
    };
  }
}