import {
  ProviderAdapter,
  ProviderName,
  ProviderRequest,
  ProviderResponse,
} from "./types";

import { ChatGPTAdapter } from "./chatgpt";
import { ClaudeAdapter } from "./claude";
import { GeminiAdapter } from "./gemini";

export class ProviderManager {
  private providers: Map<ProviderName, ProviderAdapter>;

  private activeProvider: ProviderName = "chatgpt";

  constructor() {
    this.providers = new Map();

    this.register(new ChatGPTAdapter());
    this.register(new ClaudeAdapter());
    this.register(new GeminiAdapter());
  }

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.name, provider);
  }

  getActiveProvider(): ProviderName {
    return this.activeProvider;
  }

  setActiveProvider(provider: ProviderName): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    if (this.activeProvider === provider) {
      return;
    }

    this.activeProvider = provider;

    console.log(
      `Active provider changed to: ${provider}`,
    );
  }

  getProviders() {
    return Array.from(this.providers.values()).map(
      (provider) => ({
        id: provider.name,
        available: provider.isAvailable(),
        active:
          provider.name === this.activeProvider,
      }),
    );
  }

  getProvider(
    provider: ProviderName,
  ): ProviderAdapter {
    const adapter = this.providers.get(provider);

    if (!adapter) {
      throw new Error(
        `Provider ${provider} is not registered.`,
      );
    }

    return adapter;
  }

  async sendMessage(
    request: ProviderRequest,
  ): Promise<ProviderResponse> {
    const provider =
      this.providers.get(this.activeProvider);

    if (!provider) {
      throw new Error(
        `Provider ${this.activeProvider} is not registered.`,
      );
    }

    if (!provider.isAvailable()) {
      throw new Error(
        `Provider ${this.activeProvider} is not available.`,
      );
    }

    console.log(
      `Routing request to ${this.activeProvider}`,
    );

    return provider.sendMessage(request);
  }
}