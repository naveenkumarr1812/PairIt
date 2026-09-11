export type ProviderName =
  | "chatgpt"
  | "claude"
  | "gemini";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderRequest = {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
};

export type ProviderResponse = {
  content: string;
};

export type BrowserTabInfo = {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  usable: boolean;
};

export interface ProviderAdapter {
  name: ProviderName;

  isAvailable(): boolean;

  sendMessage(
    request: ProviderRequest,
  ): Promise<ProviderResponse>;
}