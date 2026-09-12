const ChatGPTProvider = {
  name: "chatgpt",

  async startMessage(tabId, requestId, messages) {
    if (!Number.isInteger(tabId)) {
      throw new Error("Invalid ChatGPT tab ID.");
    }

    if (!requestId) {
      throw new Error("Missing ChatGPT request ID.");
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["providers/chatgpt-content.js"],
    });

    const response = await chrome.tabs.sendMessage(
      tabId,
      {
        type: "pair_chatgpt_start",
        requestId,
        messages,
      }
    );

    if (!response || response.ok !== true) {
      throw new Error(
        response?.error ||
        "ChatGPT content script could not start the request."
      );
    }

    return true;
  },
};
