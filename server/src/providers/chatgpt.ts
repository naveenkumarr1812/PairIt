import {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types";

export class ChatGPTAdapter
  implements ProviderAdapter
{
  name = "chatgpt" as const;

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
        `[ChatGPT adapter] Received: ${
          lastUserMessage?.content ?? ""
        }`,
    };
  }
}