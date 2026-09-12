/*
 * PAIR - ChatGPT Provider
 *
 * This single file serves BOTH purposes:
 *
 * 1. Service-worker side:
 *      ChatGPTProvider.startMessage(...)
 *
 * 2. Page/content-script side:
 *      ChatGPT DOM automation
 *
 * This allows PAIR to keep ChatGPT in exactly one file.
 */

const ChatGPTProvider = {
  name: "chatgpt",

  async startMessage(
    tabId,
    requestId,
    messages
  ) {
    if (!Number.isInteger(tabId)) {
      throw new Error(
        "Invalid ChatGPT tab ID."
      );
    }

    if (!requestId) {
      throw new Error(
        "Missing ChatGPT request ID."
      );
    }

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      throw new Error(
        "ChatGPT messages are empty."
      );
    }

    /*
     * Execute THIS SAME chatgpt.js file inside
     * the ChatGPT page.
     *
     * The content-script section below detects
     * that it is running inside a normal page.
     */
    await chrome.scripting.executeScript({
      target: {
        tabId,
      },

      files: [
        "chatgpt.js",
      ],
    });

    const response =
      await chrome.tabs.sendMessage(
        tabId,
        {
          type:
            "pair_chatgpt_start",

          requestId,

          messages,
        }
      );

    if (
      !response ||
      response.ok !== true
    ) {
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
 *
 * Everything below runs inside chatgpt.com.
 * ================================================================ */

(() => {
  /*
   * The same file is also loaded by the extension service worker.
   *
   * The service worker does NOT have a document.
   *
   * Therefore only execute this section when
   * the file is injected into a normal web page.
   */
  if (
    typeof document ===
    "undefined"
  ) {
    return;
  }


  /*
   * Prevent duplicate initialization.
   *
   * ChatGPT requests can cause the same file to be
   * injected multiple times.
   */
  if (
    globalThis
      .__PAIR_CHATGPT_CONTENT_INITIALIZED__
  ) {
    return;
  }

  globalThis
    .__PAIR_CHATGPT_CONTENT_INITIALIZED__ =
    true;


  const activeRequests =
    new Map();


  /* ==============================================================
   * MESSAGE LISTENER
   * ============================================================== */

  chrome.runtime.onMessage.addListener(
    (
      message,
      sender,
      sendResponse
    ) => {

      if (
        message?.type !==
        "pair_chatgpt_start"
      ) {
        return false;
      }

      const requestId =
        message.requestId;

      if (!requestId) {
        sendResponse({
          ok: false,

          error:
            "Missing ChatGPT request ID.",
        });

        return false;
      }


      /*
       * Prevent duplicate request execution.
       */
      if (
        activeRequests.has(
          requestId
        )
      ) {
        sendResponse({
          ok: true,

          duplicate: true,
        });

        return false;
      }


      const request = {
        requestId,

        messages:
          Array.isArray(
            message.messages
          )
            ? message.messages
            : [],

        baseline:
          getAssistantMessages(),

        observer:
          null,

        settleTimer:
          null,

        submitted:
          false,

        resolved:
          false,

        lastObservedText:
          "",

        text:
          "",
      };


      activeRequests.set(
        requestId,
        request
      );


      /*
       * Watch the entire ChatGPT DOM.
       *
       * ChatGPT streams the response by continuously
       * changing DOM nodes.
       */
      request.observer =
        new MutationObserver(
          () => {
            processRequest(
              request
            );
          }
        );


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


      startRequest(
        request
      ).catch(
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

  async function startRequest(
    request
  ) {
    const lastUserMessage =
      [
        ...request.messages,
      ]
        .reverse()
        .find(
          (message) =>
            message?.role ===
            "user"
        );


    if (!lastUserMessage) {
      throw new Error(
        "No user message found."
      );
    }


    const text =
      String(
        lastUserMessage.content ||
          ""
      );


    if (!text.trim()) {
      throw new Error(
        "User message is empty."
      );
    }


    request.text =
      text;


    /*
     * Start the submission process.
     */
    processRequest(
      request
    );
  }


  /* ==============================================================
   * REQUEST PROCESSING
   * ============================================================== */

  function processRequest(
    request
  ) {
    if (
      request.resolved
    ) {
      return;
    }


    /*
     * STEP 1
     *
     * Find the ChatGPT composer and submit the prompt.
     */
    if (
      !request.submitted
    ) {
      const composer =
        findComposer();


      if (composer) {
        request.submitted =
          true;


        setComposerValue(
          composer,
          request.text
        );


        /*
         * Give React/ChatGPT a chance to process
         * the input event before clicking send.
         */
        queueMicrotask(
          () => {
            if (
              request.resolved
            ) {
              return;
            }


            const sendButton =
              findSendButton();


            if (
              sendButton &&
              !isDisabled(
                sendButton
              )
            ) {
              sendButton.click();
            } else {
              sendEnter(
                composer
              );
            }
          }
        );
      }


      return;
    }


    /*
     * STEP 2
     *
     * Look for a new assistant message.
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


    if (
      newMessages.length ===
      0
    ) {
      return;
    }


    /*
     * ChatGPT can expose multiple assistant
     * DOM elements while rendering.
     *
     * The newest one is the response we're
     * interested in.
     */
    const latest =
      newMessages[
        newMessages.length - 1
      ];


    const text =
      extractText(
        latest
      );


    if (!text) {
      return;
    }


    /*
     * STEP 3
     *
     * If ChatGPT is still generating, DO NOT return.
     */
    if (
      isStillGenerating(
        latest
      )
    ) {
      request.lastObservedText =
        text;

      clearSettleTimer(
        request
      );

      return;
    }


    /*
     * STEP 4
     *
     * ChatGPT can temporarily expose a partial
     * assistant message.
     *
     * Therefore we require the text to remain
     * unchanged before resolving.
     */
    if (
      request.lastObservedText !==
      text
    ) {
      request.lastObservedText =
        text;

      scheduleSettleCheck(
        request
      );

      return;
    }


    /*
     * STEP 5
     *
     * Run another verification after the
     * settling period.
     */
    scheduleSettleCheck(
      request
    );
  }


  /* ==============================================================
   * RESPONSE SETTLING
   * ============================================================== */

  /*
   * This is NOT a generation timeout.
   *
   * It is only a debounce period used to verify
   * that the response has stopped changing.
   */
  const RESPONSE_SETTLE_MS =
    1500;


  function clearSettleTimer(
    request
  ) {
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


  function scheduleSettleCheck(
    request
  ) {
    if (
      request.resolved ||
      request.settleTimer !==
        null
    ) {
      return;
    }


    request.settleTimer =
      setTimeout(
        () => {
          request.settleTimer =
            null;


          if (
            request.resolved
          ) {
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


          if (
            newMessages.length ===
            0
          ) {
            return;
          }


          const latest =
            newMessages[
              newMessages.length -
                1
            ];


          const text =
            extractText(
              latest
            );


          if (!text) {
            return;
          }


          /*
           * Generation has started again.
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
           * Text changed during settling.
           *
           * Wait again.
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
           * The DOM still contains the same text
           * and ChatGPT no longer exposes an active
           * generation signal.
           */
          resolveRequest(
            request,
            text
          );
        },

        RESPONSE_SETTLE_MS
      );
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
          HTMLTextAreaElement
            .prototype,

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
      /*
       * Contenteditable ChatGPT composer.
       */
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
   * ENTER SEND
   * ============================================================== */

  function sendEnter(
    element
  ) {
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


  function extractText(
    element
  ) {
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

  function isStillGenerating(
    element
  ) {
    /*
     * Explicit streaming indicator.
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
     * Busy indicator.
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
     * ChatGPT normally exposes a Stop button
     * while generation is active.
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
      isVisible(
        stopButton
      ) &&
      !isDisabled(
        stopButton
      )
    );
  }


  /* ==============================================================
   * RESOLVE
   * ============================================================== */

  function resolveRequest(
    request,
    content
  ) {
    if (
      request.resolved
    ) {
      return;
    }


    request.resolved =
      true;


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
     * back to the PAIR background service worker.
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
    if (
      request.resolved
    ) {
      return;
    }


    request.resolved =
      true;


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

  function isVisible(
    element
  ) {
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

  function isDisabled(
    element
  ) {
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