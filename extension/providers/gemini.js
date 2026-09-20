const GeminiProvider = {
  name: "gemini",

  async sendMessage(tabId, messages) {
    console.log(
      "[GeminiProvider] Sending request to tab:",
      tabId
    );

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      throw new Error(
        "GeminiProvider received empty messages."
      );
    }

    const results =
      await chrome.scripting.executeScript({
        target: {
          tabId,
        },

        func: async (incomingMessages) => {
          /*
           * Everything inside this function runs inside
           * gemini.google.com page context.
           */

          const sleep = (ms) =>
            new Promise((resolve) => {
              setTimeout(resolve, ms);
            });

          const normalizeText = (value) => {
            if (!value) {
              return "";
            }

            return String(value)
              .replace(/\u00a0/g, " ")
              .replace(/\r/g, "")
              .replace(
                /[ \t]+\n/g,
                "\n"
              )
              .replace(
                /\n[ \t]+/g,
                "\n"
              )
              .trim();
          };

          const getText = (element) => {
            if (!element) {
              return "";
            }

            return normalizeText(
              element.innerText ||
              element.textContent ||
              ""
            );
          };

          const isVisible = (element) => {
            if (!element) {
              return false;
            }

            const style =
              window.getComputedStyle(
                element
              );

            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            ) {
              return false;
            }

            const rect =
              element.getBoundingClientRect();

            return (
              rect.width > 0 &&
              rect.height > 0
            );
          };

          /*
           * ------------------------------------------------------
           * FIND GEMINI COMPOSER
           * ------------------------------------------------------
           */

          const findComposer = () => {
            const selectors = [
              'rich-textarea [contenteditable="true"]',
              '[contenteditable="true"]',
              'textarea',
              '[role="textbox"]',
            ];

            for (
              const selector of
                selectors
            ) {
              const elements =
                Array.from(
                  document.querySelectorAll(
                    selector
                  )
                );

              for (
                const element of
                  elements
              ) {
                if (
                  !isVisible(element)
                ) {
                  continue;
                }

                if (
                  element.hasAttribute(
                    "disabled"
                  )
                ) {
                  continue;
                }

                if (
                  element.getAttribute(
                    "aria-disabled"
                  ) === "true"
                ) {
                  continue;
                }

                return element;
              }
            }

            return null;
          };

          /*
           * ------------------------------------------------------
           * FIND SEND BUTTON
           * ------------------------------------------------------
           */

          const findSendButton = () => {
            const selectors = [
              'button[aria-label*="Send"]',
              'button[aria-label*="send"]',
              'button[data-testid*="send"]',
              'button[type="submit"]',
            ];

            for (
              const selector of
                selectors
            ) {
              const elements =
                Array.from(
                  document.querySelectorAll(
                    selector
                  )
                );

              for (
                const element of
                  elements
              ) {
                if (
                  !isVisible(element)
                ) {
                  continue;
                }

                if (
                  element.disabled
                ) {
                  continue;
                }

                if (
                  element.getAttribute(
                    "aria-disabled"
                  ) === "true"
                ) {
                  continue;
                }

                return element;
              }
            }

            /*
             * Fallback.
             */

            const buttons =
              Array.from(
                document.querySelectorAll(
                  "button"
                )
              );

            for (
              const button of
                buttons
            ) {
              if (
                !isVisible(button)
              ) {
                continue;
              }

              if (
                button.disabled
              ) {
                continue;
              }

              const aria =
                normalizeText(
                  button.getAttribute(
                    "aria-label"
                  )
                );

              const title =
                normalizeText(
                  button.getAttribute(
                    "title"
                  )
                );

              const text =
                getText(button);

              const combined =
                `${aria} ${title} ${text}`
                  .toLowerCase();

              if (
                combined.includes(
                  "send"
                )
              ) {
                return button;
              }
            }

            return null;
          };

          /*
           * ------------------------------------------------------
           * SET COMPOSER TEXT
           * ------------------------------------------------------
           */

          const setComposerText = (
            composer,
            text
          ) => {
            composer.focus();

            /*
             * TEXTAREA
             */

            if (
              composer instanceof
              HTMLTextAreaElement
            ) {
              const prototype =
                Object.getPrototypeOf(
                  composer
                );

              const descriptor =
                Object.getOwnPropertyDescriptor(
                  prototype,
                  "value"
                );

              if (
                descriptor &&
                descriptor.set
              ) {
                descriptor.set.call(
                  composer,
                  text
                );
              } else {
                composer.value =
                  text;
              }

              composer.dispatchEvent(
                new Event("input", {
                  bubbles: true,
                })
              );

              composer.dispatchEvent(
                new Event("change", {
                  bubbles: true,
                })
              );

              return;
            }

            /*
             * CONTENTEDITABLE
             */

            const selection =
              window.getSelection();

            const range =
              document.createRange();

            range.selectNodeContents(
              composer
            );

            selection.removeAllRanges();

            selection.addRange(
              range
            );

            document.execCommand(
              "delete"
            );

            document.execCommand(
              "insertText",
              false,
              text
            );

            composer.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType:
                  "insertText",
                data: text,
              })
            );

            composer.dispatchEvent(
              new Event("change", {
                bubbles: true,
              })
            );
          };

          /*
           * ------------------------------------------------------
           * RESPONSE SELECTORS
           * ------------------------------------------------------
           */

          const responseSelectors = [
            "message-content",
            "model-response",
            ".model-response-text",
            '[data-message-author-role="model"]',
            '[data-message-author-role="assistant"]',
            ".markdown",
            ".markdown-main-panel",
          ];

          const getResponseCandidates = () => {
            const candidates = [];

            for (
              const selector of
                responseSelectors
            ) {
              const elements =
                Array.from(
                  document.querySelectorAll(
                    selector
                  )
                );

              for (
                const element of
                  elements
              ) {
                if (
                  !isVisible(element)
                ) {
                  continue;
                }

                const text =
                  getText(element);

                if (!text) {
                  continue;
                }

                /*
                 * Never treat composer as response.
                 */

                if (
                  element.matches(
                    'textarea, [contenteditable="true"], [role="textbox"]'
                  )
                ) {
                  continue;
                }

                candidates.push({
                  element,
                  text,
                });
              }
            }

            /*
             * Remove duplicates.
             */

            const unique = [];

            const seen =
              new Set();

            for (
              const candidate of
                candidates
            ) {
              if (
                seen.has(
                  candidate.element
                )
              ) {
                continue;
              }

              seen.add(
                candidate.element
              );

              unique.push(
                candidate
              );
            }

            return unique;
          };

          const getLatestResponse = () => {
            const candidates =
              getResponseCandidates();

            if (
              candidates.length ===
              0
            ) {
              return "";
            }

            return candidates[
              candidates.length - 1
            ].text;
          };

          /*
           * ------------------------------------------------------
           * WAIT FOR COMPOSER
           * ------------------------------------------------------
           */

          const waitForComposer =
            async (
              timeoutMs = 10000
            ) => {
              const start =
                Date.now();

              while (
                Date.now() - start <
                timeoutMs
              ) {
                const composer =
                  findComposer();

                if (composer) {
                  return composer;
                }

                await sleep(300);
              }

              return null;
            };

          /*
           * ------------------------------------------------------
           * WAIT FOR RESPONSE
           * ------------------------------------------------------
           */

          const waitForResponse =
            async (
              previousResponse,
              timeoutMs = 30000
            ) => {
              const start =
                Date.now();

              let lastResponse =
                "";

              let stableSince =
                0;

              while (
                Date.now() - start <
                timeoutMs
              ) {
                const currentResponse =
                  getLatestResponse();

                if (
                  currentResponse &&
                  currentResponse !==
                    previousResponse
                ) {
                  if (
                    currentResponse ===
                    lastResponse
                  ) {
                    if (
                      !stableSince
                    ) {
                      stableSince =
                        Date.now();
                    }

                    /*
                     * Wait for response to stop changing.
                     */

                    if (
                      Date.now() -
                        stableSince >=
                      1200
                    ) {
                      return currentResponse;
                    }
                  } else {
                    lastResponse =
                      currentResponse;

                    stableSince =
                      Date.now();
                  }
                }

                await sleep(500);
              }

              /*
               * Final attempt.
               */

              const finalResponse =
                getLatestResponse();

              if (
                finalResponse &&
                finalResponse !==
                  previousResponse
              ) {
                return finalResponse;
              }

              return "";
            };

          /*
           * ------------------------------------------------------
           * MAIN
           * ------------------------------------------------------
           */

          try {
            console.log(
              "[GeminiPage] Script started."
            );

            console.log(
              "[GeminiPage] URL:",
              window.location.href
            );

            if (
              !window.location.hostname.includes(
                "gemini.google.com"
              )
            ) {
              return {
                ok: false,

                error:
                  "Current tab is not gemini.google.com.",
              };
            }

            if (
              !Array.isArray(
                incomingMessages
              ) ||
              incomingMessages.length ===
                0
            ) {
              return {
                ok: false,

                error:
                  "No messages were provided.",
              };
            }

            const lastUserMessage =
              [...incomingMessages]
                .reverse()
                .find(
                  (message) =>
                    message &&
                    message.role ===
                      "user"
                );

            if (
              !lastUserMessage
            ) {
              return {
                ok: false,

                error:
                  "No user message found.",
              };
            }

            const userText =
              typeof lastUserMessage.content ===
              "string"
                ? lastUserMessage.content.trim()
                : "";

            if (!userText) {
              return {
                ok: false,

                error:
                  "User message is empty.",
              };
            }

            console.log(
              "[GeminiPage] User text:",
              userText
            );

            /*
             * Get current response before sending.
             */

            const previousResponse =
              getLatestResponse();

            console.log(
              "[GeminiPage] Previous response:",
              previousResponse
            );

            /*
             * Find composer.
             */

            const composer =
              await waitForComposer();

            if (!composer) {
              return {
                ok: false,

                error:
                  "Gemini composer was not found.",
              };
            }

            console.log(
              "[GeminiPage] Composer found:",
              composer.tagName
            );

            /*
             * Insert message.
             */

            setComposerText(
              composer,
              userText
            );

            await sleep(700);

            console.log(
              "[GeminiPage] Composer content:",
              getText(composer)
            );

            /*
             * Find Send button.
             */

            let sendButton =
              findSendButton();

            if (!sendButton) {
              await sleep(500);

              sendButton =
                findSendButton();
            }

            if (sendButton) {
              console.log(
                "[GeminiPage] Clicking send button."
              );

              sendButton.click();
            } else {
              /*
               * Fallback Enter.
               */

              console.log(
                "[GeminiPage] Send button not found. Using Enter."
              );

              composer.focus();

              composer.dispatchEvent(
                new KeyboardEvent(
                  "keydown",
                  {
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                  }
                )
              );

              await sleep(100);

              composer.dispatchEvent(
                new KeyboardEvent(
                  "keyup",
                  {
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                  }
                )
              );
            }

            /*
             * Wait for Gemini.
             */

            console.log(
              "[GeminiPage] Waiting for response..."
            );

            const response =
              await waitForResponse(
                previousResponse
              );

            console.log(
              "[GeminiPage] Detected response:",
              response
            );

            if (!response) {
              return {
                ok: false,

                error:
                  "Gemini generated a response, but the response text could not be detected.",

                debug: {
                  url:
                    window.location.href,

                  candidates:
                    getResponseCandidates()
                      .slice(-5)
                      .map(
                        (item) =>
                          item.text.slice(
                            0,
                            500
                          )
                      ),
                },
              };
            }

            return {
              ok: true,

              content:
                response,
            };
          } catch (error) {
            console.error(
              "[GeminiPage] Error:",
              error
            );

            return {
              ok: false,

              error:
                error?.message ||
                String(error),
            };
          }
        },

        args: [messages],
      });

    console.log(
      "[GeminiProvider] Script results:",
      results
    );

    const result =
      results?.[0]?.result;

    console.log(
      "[GeminiProvider] Page result:",
      result
    );

    if (!result) {
      throw new Error(
        "Gemini page script returned an empty result."
      );
    }

    if (!result.ok) {
      console.error(
        "[GeminiProvider] Debug:",
        result.debug
      );

      throw new Error(
        result.error ||
        "Gemini page script failed."
      );
    }

    if (
      typeof result.content !==
        "string" ||
      !result.content.trim()
    ) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    return result.content.trim();
  },

  async startStreamMessage(tabId, requestId, messages) {
    if (!Number.isInteger(tabId)) {
      throw new Error("Invalid gemini tab ID.");
    }

    if (!requestId) {
      throw new Error("Missing gemini request ID.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: streamGeminiPage,
      args: [messages, requestId],
    });

    const result = results?.[0]?.result;

    if (!result || result.ok !== true) {
      throw new Error(
        result?.error ||
        "Gemini streaming page could not start."
      );
    }

    return true;
  },

};

async function streamGeminiPage(incomingMessages, requestId) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
  const textOf = (el) => normalize(el?.innerText || el?.textContent || "");
  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const findComposer = () => {
    for (const selector of [
      'rich-textarea [contenteditable="true"]',
      '[contenteditable="true"]',
      "textarea",
      '[role="textbox"]'
    ]) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  };

  const setComposer = (el, text) => {
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc?.set) desc.set.call(el, text); else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete");
    document.execCommand("insertText", false, text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  };

  const findSend = () => {
    for (const selector of [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[data-testid*="send"]',
      'button[type="submit"]'
    ]) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  };

  const responseSelectors = [
    "message-content",
    "model-response",
    ".model-response-text",
    '[data-message-author-role="model"]',
    '[data-message-author-role="assistant"]',
    ".markdown",
    ".markdown-main-panel"
  ];

  const getResponse = () => {
    const candidates = [];
    for (const selector of responseSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        if (el.matches('textarea,[contenteditable="true"],[role="textbox"]')) continue;
        const text = textOf(el);
        if (text) candidates.push(text);
      }
    }
    return candidates.at(-1) || "";
  };

  const isGenerating = () => {
    const stop = document.querySelector(
      'button[aria-label*="Stop"],button[title*="Stop"],button[data-testid*="stop"]'
    );
    return Boolean(stop && visible(stop) && !stop.disabled);
  };

  const prompt = [...(Array.isArray(incomingMessages) ? incomingMessages : [])]
    .reverse().find((m) => m?.role === "user")?.content;
  const userText = typeof prompt === "string" ? prompt.trim() : "";
  if (!userText) throw new Error("User message is empty.");

  let lastText = "";
  let resolved = false;
  let settleTimer = null;
  let observer = null;

  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});
  const cleanup = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    observer?.disconnect();
    observer = null;
  };
  const fail = (error) => {
    if (resolved) return;
    resolved = true;
    cleanup();
    send({
      type: "pairit_provider_stream_error",
      provider: "gemini",
      requestId,
      error: error?.message || String(error)
    });
  };
  const emit = (text) => {
    if (resolved || text === lastText) return;
    const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
    lastText = text;
    if (delta) send({
      type: "pairit_provider_stream_chunk",
      provider: "gemini",
      requestId,
      content: delta,
      done: false
    });
  };
  const finish = (text) => {
    if (resolved) return;
    emit(text);
    resolved = true;
    cleanup();
    send({
      type: "pairit_provider_stream_chunk",
      provider: "gemini",
      requestId,
      content: "",
      done: true
    });
  };

  const process = () => {
    if (resolved) return;
    const current = getResponse();
    if (!current) return;
    emit(current);

    if (isGenerating()) {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      return;
    }

    if (settleTimer !== null) return;
    const expected = current;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (resolved) return;
      const verified = getResponse();
      if (!verified) return;
      if (isGenerating()) {
        process();
        return;
      }
      if (verified !== expected) {
        process();
        return;
      }
      finish(verified);
    }, 1500);
  };

  try {
    if (!window.location.hostname.includes("gemini.google.com")) {
      throw new Error("Current tab is not gemini.google.com.");
    }

    const composer = findComposer();
    if (!composer) throw new Error("Gemini composer was not found.");

    observer = new MutationObserver(process);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "disabled", "class"]
    });

    setComposer(composer, userText);
    await sleep(500);

    const button = findSend();
    if (button) {
      button.click();
    } else {
      composer.focus();
      composer.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }

    process();
    return { ok: true };
  } catch (error) {
    fail(error);
    return { ok: false, error: error?.message || String(error) };
  }
}
