var ChatGPTProvider = globalThis.ChatGPTProvider || {
  name: "chatgpt",

  async startMessage(tabId, requestId, messages) {
    if (!Number.isInteger(tabId)) {
      throw new Error("Invalid ChatGPT tab ID.");
    }

    if (!requestId) {
      throw new Error("Missing ChatGPT request ID.");
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("ChatGPT messages are empty.");
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["providers/chatgpt.js"],
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


/* ================================================================
 * CHATGPT PAGE / CONTENT SCRIPT
 * ================================================================ */

(() => {
  /*
   * The service worker has no document.
   * This section only runs when this file is injected
   * into the ChatGPT browser tab.
   */
  if (typeof document === "undefined") {
    return;
  }


  /*
   * Prevent duplicate initialization when the same file
   * is injected more than once.
   */
  if (globalThis.__PAIR_CHATGPT_CONTENT_INITIALIZED__) {
    return;
  }

  globalThis.__PAIR_CHATGPT_CONTENT_INITIALIZED__ = true;


  const activeRequests = new Map();


  /* ==============================================================
   * MESSAGE LISTENER
   * ============================================================== */

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

        text: "",
      };

      activeRequests.set(
        requestId,
        request
      );


      /*
       * Watch the ChatGPT DOM while the response
       * is being generated.
       */
      request.observer =
        new MutationObserver(() => {
          processRequest(request);
        });


      request.observer.observe(
        document.documentElement,
        {
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
        }
      );


      startRequest(request).catch(
        (error) => {
          failRequest(
            request,
            error
          );
        }
      );


      sendResponse({
        ok: true,
      });

      return false;
    }
  );


  /* ==============================================================
   * START REQUEST
   * ============================================================== */

  async function startRequest(request) {
    const lastUserMessage =
      [...request.messages]
        .reverse()
        .find(
          (message) =>
            message?.role === "user"
        );


    if (!lastUserMessage) {
      throw new Error(
        "No user message found."
      );
    }


    const text =
      String(
        lastUserMessage.content || ""
      );


    if (!text.trim()) {
      throw new Error(
        "User message is empty."
      );
    }


    request.text = text;


    processRequest(request);
  }


  /* ==============================================================
   * PROCESS REQUEST
   * ============================================================== */

  function processRequest(request) {
    if (request.resolved) {
      return;
    }


    /*
     * Submit the prompt.
     */
    if (!request.submitted) {
      const composer =
        findComposer();


      if (composer) {
        request.submitted = true;


        setComposerValue(
          composer,
          request.text
        );


        /*
         * Allow ChatGPT/React to process the input
         * before attempting to send.
         */
        queueMicrotask(() => {
          if (request.resolved) {
            return;
          }


          const sendButton =
            findSendButton();


          if (
            sendButton &&
            !isDisabled(sendButton)
          ) {
            sendButton.click();
          } else {
            sendEnter(composer);
          }
        });
      }


      return;
    }


    /*
     * Find assistant messages created after
     * the request was submitted.
     */
    const current =
      getAssistantMessages();


    const newMessages =
      current.filter(
        (element) =>
          !request.baseline.includes(
            element
          )
      );


    if (newMessages.length === 0) {
      return;
    }


    const latest =
      newMessages[
        newMessages.length - 1
      ];


    const text =
      extractText(latest);


    if (!text) {
      return;
    }


    /*
     * IMPORTANT:
     *
     * Do not return anything while ChatGPT is
     * still generating.
     */
    if (isStillGenerating(latest)) {
      request.lastObservedText =
        text;

      clearSettleTimer(request);

      return;
    }


    /*
     * ChatGPT may expose a partial response before
     * the generation state changes.
     *
     * Wait until the text becomes stable.
     */
    if (
      request.lastObservedText !==
      text
    ) {
      request.lastObservedText =
        text;

      scheduleSettleCheck(request);

      return;
    }


    /*
     * Perform another verification.
     */
    scheduleSettleCheck(request);
  }


  /* ==============================================================
   * RESPONSE SETTLING
   * ============================================================== */

  /*
   * This is NOT a generation timeout.
   *
   * It is only the amount of time we wait after
   * the response appears stable before verifying it.
   */
  const RESPONSE_SETTLE_MS = 1500;


  function clearSettleTimer(request) {
    if (
      request.settleTimer !==
      null
    ) {
      clearTimeout(
        request.settleTimer
      );

      request.settleTimer =
        null;
    }
  }


  function scheduleSettleCheck(request) {
    if (
      request.resolved ||
      request.settleTimer !==
        null
    ) {
      return;
    }


    request.settleTimer =
      setTimeout(() => {
        request.settleTimer =
          null;


        if (request.resolved) {
          return;
        }


        const current =
          getAssistantMessages();


        const newMessages =
          current.filter(
            (element) =>
              !request.baseline.includes(
                element
              )
          );


        if (newMessages.length === 0) {
          return;
        }


        const latest =
          newMessages[
            newMessages.length - 1
          ];


        const text =
          extractText(latest);


        if (!text) {
          return;
        }


        /*
         * Generation is active again.
         */
        if (
          isStillGenerating(
            latest
          )
        ) {
          request.lastObservedText =
            text;

          return;
        }


        /*
         * Text changed during the settling
         * period, so wait again.
         */
        if (
          text !==
          request.lastObservedText
        ) {
          request.lastObservedText =
            text;

          scheduleSettleCheck(
            request
          );

          return;
        }


        /*
         * FINAL VERIFICATION
         *
         * The response has remained unchanged
         * and ChatGPT no longer reports active
         * generation.
         */
        resolveRequest(
          request,
          text
        );
      }, RESPONSE_SETTLE_MS);
  }


  /* ==============================================================
   * COMPOSER
   * ============================================================== */

  function findComposer() {
    return (
      document.querySelector(
        "#prompt-textarea"
      ) ||

      document.querySelector(
        '[contenteditable="true"][data-lexical-editor="true"]'
      ) ||

      document.querySelector(
        '[contenteditable="true"]'
      ) ||

      document.querySelector(
        "textarea"
      ) ||

      document.querySelector(
        '[role="textbox"]'
      )
    );
  }


  function setComposerValue(
    element,
    text
  ) {
    element.focus();


    if (
      element instanceof
      HTMLTextAreaElement
    ) {
      const setter =
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set;


      if (setter) {
        setter.call(
          element,
          text
        );
      } else {
        element.value =
          text;
      }
    } else {
      element.textContent =
        text;
    }


    element.dispatchEvent(
      new InputEvent(
        "input",
        {
          bubbles: true,

          inputType:
            "insertText",

          data: text,
        }
      )
    );
  }


  /* ==============================================================
   * SEND BUTTON
   * ============================================================== */

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',

      'button[aria-label="Send prompt"]',

      'button[aria-label*="Send"]',

      'button[aria-label*="send"]',

      'button[type="submit"]',
    ];


    for (
      const selector of
        selectors
    ) {
      const button =
        document.querySelector(
          selector
        );


      if (
        button &&
        isVisible(button)
      ) {
        return button;
      }
    }


    return null;
  }


  /* ==============================================================
   * ENTER
   * ============================================================== */

  function sendEnter(element) {
    const options = {
      key: "Enter",

      code: "Enter",

      keyCode: 13,

      which: 13,

      bubbles: true,

      cancelable: true,
    };


    element.dispatchEvent(
      new KeyboardEvent(
        "keydown",
        options
      )
    );


    element.dispatchEvent(
      new KeyboardEvent(
        "keypress",
        options
      )
    );


    element.dispatchEvent(
      new KeyboardEvent(
        "keyup",
        options
      )
    );
  }


  /* ==============================================================
   * ASSISTANT MESSAGES
   * ============================================================== */

  function getAssistantMessages() {
    return Array.from(
      document.querySelectorAll(
        '[data-message-author-role="assistant"]'
      )
    );
  }


  function extractText(element) {
    return String(
      element?.innerText ||
      element?.textContent ||
      ""
    )
      .replace(
        /\u00a0/g,
        " "
      )
      .trim();
  }


  /* ==============================================================
   * GENERATION DETECTION
   * ============================================================== */

  function isStillGenerating(element) {
    /*
     * ChatGPT streaming indicator.
     */
    if (
      element.matches(
        '[data-is-streaming="true"]'
      ) ||

      element.querySelector(
        '[data-is-streaming="true"]'
      )
    ) {
      return true;
    }


    /*
     * aria-busy indicator.
     */
    if (
      element.matches(
        '[aria-busy="true"]'
      ) ||

      element.querySelector(
        '[aria-busy="true"]'
      )
    ) {
      return true;
    }


    /*
     * ChatGPT exposes a Stop button while
     * generation is active.
     */
    const stopButton =
      document.querySelector(
        'button[data-testid*="stop"]'
      ) ||

      document.querySelector(
        'button[aria-label*="Stop"]'
      ) ||

      document.querySelector(
        'button[aria-label*="stop"]'
      ) ||

      document.querySelector(
        'button[title*="Stop"]'
      ) ||

      document.querySelector(
        'button[title*="stop"]'
      );


    return Boolean(
      stopButton &&
      isVisible(stopButton) &&
      !isDisabled(stopButton)
    );
  }


  /* ==============================================================
   * RESOLVE REQUEST
   * ============================================================== */

  function resolveRequest(
    request,
    content
  ) {
    if (request.resolved) {
      return;
    }


    request.resolved = true;


    clearSettleTimer(
      request
    );


    request.observer?.disconnect();

    request.observer =
      null;


    activeRequests.delete(
      request.requestId
    );


    /*
     * Send ONLY the complete response
     * back to background.js.
     */
    chrome.runtime
      .sendMessage({
        type:
          "pair_provider_result",

        provider:
          "chatgpt",

        requestId:
          request.requestId,

        content,
      })
      .catch(
        () => {}
      );
  }


  /* ==============================================================
   * ERROR
   * ============================================================== */

  function failRequest(
    request,
    error
  ) {
    if (request.resolved) {
      return;
    }


    request.resolved = true;


    clearSettleTimer(
      request
    );


    request.observer?.disconnect();

    request.observer =
      null;


    activeRequests.delete(
      request.requestId
    );


    chrome.runtime
      .sendMessage({
        type:
          "pair_provider_error",

        provider:
          "chatgpt",

        requestId:
          request.requestId,

        error:
          error?.message ||
          "ChatGPT request failed.",
      })
      .catch(
        () => {}
      );
  }


  /* ==============================================================
   * VISIBILITY
   * ============================================================== */

  function isVisible(element) {
    if (!element) {
      return false;
    }


    const style =
      window.getComputedStyle(
        element
      );


    if (
      style.display ===
        "none" ||

      style.visibility ===
        "hidden" ||

      style.opacity ===
        "0"
    ) {
      return false;
    }


    const rect =
      element.getBoundingClientRect();


    return (
      rect.width > 0 &&
      rect.height > 0
    );
  }


  /* ==============================================================
   * DISABLED
   * ============================================================== */

  function isDisabled(element) {
    return Boolean(
      !element ||

      element.disabled ===
        true ||

      element.getAttribute(
        "aria-disabled"
      ) === "true"
    );
  }
})();