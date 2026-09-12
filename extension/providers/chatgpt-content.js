(() => {
  if (globalThis.__PAIR_CHATGPT_CONTENT_INITIALIZED__) {
    return;
  }

  globalThis.__PAIR_CHATGPT_CONTENT_INITIALIZED__ = true;

  const activeRequests = new Map();

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message?.type !== "pair_chatgpt_start") {
        return false;
      }

      const requestId = message.requestId;

      if (!requestId) {
        sendResponse({
          ok: false,
          error: "Missing ChatGPT request ID.",
        });
        return false;
      }

      if (activeRequests.has(requestId)) {
        sendResponse({
          ok: true,
          duplicate: true,
        });
        return false;
      }

      const request = {
        requestId,
        messages: Array.isArray(message.messages)
          ? message.messages
          : [],
        baseline: getAssistantMessages(),
        observer: null,
        settleTimer: null,
        submitted: false,
        resolved: false,
        lastObservedText: "",
      };

      activeRequests.set(requestId, request);

      request.observer = new MutationObserver(() => {
        processRequest(request);
      });

      request.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "data-is-streaming",
          "aria-busy",
          "disabled",
          "class",
        ],
      });

      startRequest(request).catch((error) => {
        failRequest(request, error);
      });

      sendResponse({ ok: true });
      return false;
    }
  );

  async function startRequest(request) {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((message) => message?.role === "user");

    if (!lastUserMessage) {
      throw new Error("No user message found.");
    }

    const text = String(lastUserMessage.content || "");

    if (!text.trim()) {
      throw new Error("User message is empty.");
    }

    request.text = text;
    processRequest(request);
  }

  function processRequest(request) {
    if (request.resolved) {
      return;
    }

    if (!request.submitted) {
      const composer = findComposer();

      if (composer) {
        request.submitted = true;
        setComposerValue(composer, request.text);

        queueMicrotask(() => {
          if (request.resolved) {
            return;
          }

          const sendButton = findSendButton();

          if (sendButton && !isDisabled(sendButton)) {
            sendButton.click();
          } else {
            sendEnter(composer);
          }
        });
      }

      return;
    }

    const current = getAssistantMessages();
    const newMessages = current.filter(
      (element) => !request.baseline.includes(element)
    );

    if (newMessages.length === 0) {
      return;
    }

    const latest = newMessages[newMessages.length - 1];
    const text = extractText(latest);

    if (!text) {
      return;
    }

    if (isStillGenerating(latest)) {
      request.lastObservedText = text;
      clearSettleTimer(request);
      return;
    }

    // ChatGPT can temporarily expose a partial assistant message while the
    // response is still being generated. Do not resolve on the first DOM
    // mutation. Wait until the text has remained unchanged for a short
    // settling period, then verify it again before returning it to Python.
    if (request.lastObservedText !== text) {
      request.lastObservedText = text;
      scheduleSettleCheck(request);
      return;
    }

    scheduleSettleCheck(request);
  }


  const RESPONSE_SETTLE_MS = 1500;

  function clearSettleTimer(request) {
    if (request.settleTimer !== null) {
      clearTimeout(request.settleTimer);
      request.settleTimer = null;
    }
  }

  function scheduleSettleCheck(request) {
    if (request.resolved || request.settleTimer !== null) {
      return;
    }

    request.settleTimer = setTimeout(() => {
      request.settleTimer = null;

      if (request.resolved) {
        return;
      }

      const current = getAssistantMessages();
      const newMessages = current.filter(
        (element) => !request.baseline.includes(element)
      );

      if (newMessages.length === 0) {
        return;
      }

      const latest = newMessages[newMessages.length - 1];
      const text = extractText(latest);

      if (!text) {
        return;
      }

      if (isStillGenerating(latest)) {
        request.lastObservedText = text;
        return;
      }

      if (text !== request.lastObservedText) {
        request.lastObservedText = text;
        scheduleSettleCheck(request);
        return;
      }

      // Final verification: the DOM still contains the same complete-looking
      // text and ChatGPT is no longer exposing an active generation signal.
      resolveRequest(request, text);
    }, RESPONSE_SETTLE_MS);
  }

  function findComposer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector(
        '[contenteditable="true"][data-lexical-editor="true"]'
      ) ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector("textarea") ||
      document.querySelector('[role="textbox"]')
    );
  }

  function setComposerValue(element, text) {
    element.focus();

    if (element instanceof HTMLTextAreaElement) {
      const setter =
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set;

      if (setter) {
        setter.call(element, text);
      } else {
        element.value = text;
      }
    } else {
      element.textContent = text;
    }

    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      })
    );
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[type="submit"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && isVisible(button)) {
        return button;
      }
    }

    return null;
  }

  function sendEnter(element) {
    const options = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };

    element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keypress", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  function getAssistantMessages() {
    return Array.from(
      document.querySelectorAll(
        '[data-message-author-role="assistant"]'
      )
    );
  }

  function extractText(element) {
    return String(
      element?.innerText || element?.textContent || ""
    )
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isStillGenerating(element) {
    if (
      element.matches('[data-is-streaming="true"]') ||
      element.querySelector('[data-is-streaming="true"]')
    ) {
      return true;
    }

    if (
      element.matches('[aria-busy="true"]') ||
      element.querySelector('[aria-busy="true"]')
    ) {
      return true;
    }

    const stopButton =
      document.querySelector('button[data-testid*="stop"]') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="stop"]') ||
      document.querySelector('button[title*="Stop"]') ||
      document.querySelector('button[title*="stop"]');

    return Boolean(
      stopButton &&
      isVisible(stopButton) &&
      !isDisabled(stopButton)
    );
  }

  function resolveRequest(request, content) {
    if (request.resolved) {
      return;
    }

    request.resolved = true;
    clearSettleTimer(request);
    request.observer?.disconnect();
    request.observer = null;
    activeRequests.delete(request.requestId);

    chrome.runtime
      .sendMessage({
        type: "pair_provider_result",
        provider: "chatgpt",
        requestId: request.requestId,
        content,
      })
      .catch(() => {});
  }

  function failRequest(request, error) {
    if (request.resolved) {
      return;
    }

    request.resolved = true;
    clearSettleTimer(request);
    request.observer?.disconnect();
    request.observer = null;
    activeRequests.delete(request.requestId);

    chrome.runtime
      .sendMessage({
        type: "pair_provider_error",
        provider: "chatgpt",
        requestId: request.requestId,
        error: error?.message || "ChatGPT request failed.",
      })
      .catch(() => {});
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return Boolean(
      !element ||
      element.disabled === true ||
      element.getAttribute("aria-disabled") === "true"
    );
  }
})();
