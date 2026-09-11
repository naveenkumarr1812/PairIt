import {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types";

export class GeminiAdapter
  implements ProviderAdapter
{
  name = "gemini" as const;

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
        `[Gemini adapter] Received: ${
          lastUserMessage?.content ?? ""
        }`,
    };
  }
}