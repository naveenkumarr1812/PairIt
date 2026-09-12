/*
 * PAIR - browser connection service worker
 *
 * PAIR has one local connection:
 *
 *   Developer app <-> local PAIR bridge <-> PAIR Chrome extension
 *
 * Provider tabs are NOT connected permanently. A provider tab is located
 * only when a request for that provider arrives.
 */

/* ===== INLINED: chatgpt.js ===== */
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

/* ===== INLINED: providers/claude.js ===== */
const ClaudeProvider = {
  name: "claude",

  async sendMessage(tabId, messages) {
    console.log(
      "[ClaudeProvider] Sending request to tab:",
      tabId
    );

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      throw new Error(
        "ClaudeProvider received empty messages."
      );
    }

    const results =
      await chrome.scripting.executeScript({
        target: {
          tabId,
        },

        func: async (incomingMessages) => {
          /*
           * Everything in this function runs inside claude.ai.
           * Keep it self-contained.
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
           * UI TEXT THAT MUST NEVER BE RETURNED AS AI RESPONSE
           * ------------------------------------------------------
           */

          const isIgnoredText = (text) => {
            const value =
              normalizeText(text);

            if (!value) {
              return true;
            }

            const exactIgnored = new Set([
              "just now",
              "Write a message…",
              "Write a message...",
              "Send",
              "Send Message",
              "New",
              "Projects",
              "Artifacts",
              "Code",
              "Customize",
              "Share",
              "Upgrade",
              "Copy",
              "Retry",
              "Regenerate",
              "Like",
              "Dislike",
              "Crystallizing",
              "Thinking",
              "Claude is thinking",
              "Claude is thinking…",
              "Claude is thinking...",
              "Working",
              "Generating",
              "Processing",
              "Loading",
            ]);

            if (
              exactIgnored.has(value)
            ) {
              return true;
            }

            const lower =
              value.toLowerCase();

            const ignoredPatterns = [
              /^just now$/i,
              /^\d+\s*(seconds?|minutes?|hours?)\s*ago$/i,
              /^free plan$/i,
              /^upgrade$/i,
              /^share$/i,
              /^copy$/i,
              /^retry$/i,
              /^regenerate$/i,
              /^like$/i,
              /^dislike$/i,
              /^crystallizing$/i,
              /^thinking$/i,
              /^claude is thinking(?:…|\.\.\.)?$/i,
              /^working$/i,
              /^generating$/i,
              /^processing$/i,
              /^loading$/i,
            ];

            for (
              const pattern of
                ignoredPatterns
            ) {
              if (
                pattern.test(value)
              ) {
                return true;
              }
            }

            /*
             * Don't return very short UI fragments.
             */

            if (
              value.length < 2
            ) {
              return true;
            }

            /*
             * Some common navigation strings.
             */

            if (
              lower === "new chat" ||
              lower === "settings" ||
              lower === "projects"
            ) {
              return true;
            }

            return false;
          };

          /*
           * ------------------------------------------------------
           * FIND COMPOSER
           * ------------------------------------------------------
           */

          const findComposer = () => {
            const selectors = [
              "textarea",
              '[contenteditable="true"]',
              '[role="textbox"]',
              ".ProseMirror",
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
              'button[aria-label="Send Message"]',
              'button[aria-label="Send message"]',
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
             * TEXTAREA / INPUT
             */

            if (
              composer instanceof
                HTMLTextAreaElement ||
              composer instanceof
                HTMLInputElement
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
           * FIND ALL EXACT USER MESSAGE ELEMENTS
           * ------------------------------------------------------
           */

          const findUserMessageElements =
            (userText) => {
              const candidates =
                Array.from(
                  document.querySelectorAll(
                    "div, p, span"
                  )
                );

              const matches = [];

              for (
                const element of
                  candidates
              ) {
                if (
                  !isVisible(element)
                ) {
                  continue;
                }

                const text =
                  getText(element);

                if (
                  text !== userText
                ) {
                  continue;
                }

                /*
                 * Avoid selecting a nested duplicate if its
                 * parent has exactly the same text.
                 */

                let parent =
                  element.parentElement;

                let duplicateParent =
                  false;

                for (
                  let i = 0;
                  i < 3 && parent;
                  i++
                ) {
                  if (
                    getText(parent) ===
                    userText
                  ) {
                    duplicateParent =
                      true;

                    break;
                  }

                  parent =
                    parent.parentElement;
                }

                if (
                  duplicateParent
                ) {
                  continue;
                }

                matches.push(
                  element
                );
              }

              return matches;
            };

          /*
           * ------------------------------------------------------
           * EXTRACT TEXT FROM A NODE
           * ------------------------------------------------------
           */

          const getMeaningfulText =
            (element, userText) => {
              if (!element) {
                return "";
              }

              if (
                !isVisible(element)
              ) {
                return "";
              }

              /*
               * Never use the composer.
               */

              if (
                element.matches(
                  "textarea, input, [contenteditable='true'], [role='textbox']"
                )
              ) {
                return "";
              }

              const text =
                getText(element);

              if (!text) {
                return "";
              }

              if (
                text === userText
              ) {
                return "";
              }

              if (
                isIgnoredText(text)
              ) {
                return "";
              }

              /*
               * Don't return giant containers containing the
               * entire conversation.
               */

              if (
                text.length > 5000
              ) {
                return "";
              }

              return text;
            };

          /*
           * ------------------------------------------------------
           * FIND RESPONSE AROUND LATEST USER MESSAGE
           * ------------------------------------------------------
           */

          const findResponseNearUser =
            (userText) => {
              const matches =
                findUserMessageElements(
                  userText
                );

              if (
                matches.length === 0
              ) {
                return "";
              }

              /*
               * The LAST exact user-message element should be the
               * request we just sent.
               */

              const userElement =
                matches[
                  matches.length - 1
                ];

              console.log(
                "[ClaudePage] User element found:",
                userElement
              );

              /*
               * --------------------------------------------------
               * STRATEGY 1
               * Look at following siblings.
               * --------------------------------------------------
               */

              let current =
                userElement;

              for (
                let level = 0;
                level < 6;
                level++
              ) {
                const parent =
                  current.parentElement;

                if (!parent) {
                  break;
                }

                const siblings =
                  Array.from(
                    parent.children
                  );

                const index =
                  siblings.indexOf(
                    current
                  );

                if (
                  index >= 0
                ) {
                  for (
                    let i =
                      index + 1;
                    i <
                      siblings.length;
                    i++
                  ) {
                    const sibling =
                      siblings[i];

                    const directText =
                      getMeaningfulText(
                        sibling,
                        userText
                      );

                    if (
                      directText
                    ) {
                      return directText;
                    }

                    /*
                     * Inspect descendants.
                     */

                    const descendants =
                      Array.from(
                        sibling.querySelectorAll(
                          "div, p, span"
                        )
                      );

                    for (
                      const descendant of
                        descendants
                    ) {
                      const text =
                        getMeaningfulText(
                          descendant,
                          userText
                        );

                      if (
                        text
                      ) {
                        /*
                         * Avoid metadata-only text.
                         */

                        if (
                          !isIgnoredText(
                            text
                          )
                        ) {
                          return text;
                        }
                      }
                    }
                  }
                }

                current =
                  parent;
              }

              /*
               * --------------------------------------------------
               * STRATEGY 2
               * Walk ancestors and inspect their later content.
               * --------------------------------------------------
               */

              let ancestor =
                userElement.parentElement;

              for (
                let level = 0;
                level < 8 && ancestor;
                level++
              ) {
                const all =
                  Array.from(
                    ancestor.querySelectorAll(
                      "div, p, span"
                    )
                  );

                const userIndex =
                  all.indexOf(
                    userElement
                  );

                if (
                  userIndex >= 0
                ) {
                  for (
                    let i =
                      userIndex + 1;
                    i <
                      all.length;
                    i++
                  ) {
                    const candidate =
                      all[i];

                    const text =
                      getMeaningfulText(
                        candidate,
                        userText
                      );

                    if (
                      text
                    ) {
                      /*
                       * Don't return a parent container containing
                       * unrelated conversation content.
                       */

                      if (
                        text.length <=
                        3000
                      ) {
                        return text;
                      }
                    }
                  }
                }

                ancestor =
                  ancestor.parentElement;
              }

              return "";
            };

          /*
           * ------------------------------------------------------
           * FIND LIKELY ASSISTANT RESPONSE USING KNOWN CLAUDE
           * ATTRIBUTES
           * ------------------------------------------------------
           */

          const findResponseByAttributes =
            (userText) => {
              const selectors = [
                '[data-is-streaming]',
                '[data-testid*="assistant"]',
                '[data-message-author-role="assistant"]',
                '[data-testid="assistant-message"]',
              ];

              const candidates = [];

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
                    !isVisible(
                      element
                    )
                  ) {
                    continue;
                  }

                  const text =
                    getMeaningfulText(
                      element,
                      userText
                    );

                  if (
                    text
                  ) {
                    candidates.push(
                      text
                    );
                  }
                }
              }

              if (
                candidates.length ===
                0
              ) {
                return "";
              }

              return candidates[
                candidates.length - 1
              ];
            };

          /*
           * ------------------------------------------------------
           * RESPONSE DETECTION
           * ------------------------------------------------------
           */

          const detectResponse =
            (userText) => {
              /*
               * First try explicit assistant markers.
               */

              const attributeResponse =
                findResponseByAttributes(
                  userText
                );

              if (
                attributeResponse
              ) {
                return attributeResponse;
              }

              /*
               * Then use conversation structure.
               */

              const nearbyResponse =
                findResponseNearUser(
                  userText
                );

              if (
                nearbyResponse
              ) {
                return nearbyResponse;
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
              "[ClaudePage] Script started."
            );

            console.log(
              "[ClaudePage] URL:",
              window.location.href
            );

            if (
              !window.location.hostname.includes(
                "claude.ai"
              )
            ) {
              return {
                ok: false,

                error:
                  "Current tab is not claude.ai.",
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
              "[ClaudePage] User text:",
              userText
            );

            /*
             * Find composer.
             */

            const composer =
              findComposer();

            if (!composer) {
              return {
                ok: false,

                error:
                  "Claude composer was not found.",
              };
            }

            /*
             * IMPORTANT:
             *
             * Record how many exact user-message elements exist
             * before sending.
             */

            const beforeUserElements =
              findUserMessageElements(
                userText
              );

            console.log(
              "[ClaudePage] User message count BEFORE:",
              beforeUserElements.length
            );

            /*
             * Insert text.
             */

            setComposerText(
              composer,
              userText
            );

            await sleep(500);

            /*
             * Find send button.
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
                "[ClaudePage] Clicking send button."
              );

              sendButton.click();
            } else {
              /*
               * Fallback Enter.
               */

              console.log(
                "[ClaudePage] Send button not found. Pressing Enter."
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
             * Wait for Claude to create a NEW user message and
             * then produce its response.
             */

            console.log(
              "[ClaudePage] Waiting for Claude response..."
            );

            const start =
              Date.now();

            const timeoutMs =
              30000;

            let lastResponse =
              "";

            let stableSince =
              0;

            while (
              Date.now() - start <
              timeoutMs
            ) {
              const currentUserElements =
                findUserMessageElements(
                  userText
                );

              /*
               * Once Claude has added our latest user message,
               * look for its corresponding response.
               */

              if (
                currentUserElements.length >
                beforeUserElements.length
              ) {
                const response =
                  detectResponse(
                    userText
                  );

                if (
                  response &&
                  !isIgnoredText(
                    response
                  )
                ) {
                  console.log(
                    "[ClaudePage] Candidate response:",
                    response
                  );

                  if (
                    response ===
                    lastResponse
                  ) {
                    if (
                      !stableSince
                    ) {
                      stableSince =
                        Date.now();
                    }

                    /*
                     * Wait 1 second so we don't capture an
                     * incomplete streaming response.
                     */

                    if (
                      Date.now() -
                        stableSince >=
                      1000
                    ) {
                      return {
                        ok: true,

                        content:
                          response,
                      };
                    }
                  } else {
                    lastResponse =
                      response;

                    stableSince =
                      Date.now();
                  }
                }
              }

              await sleep(400);
            }

            /*
             * Final detection attempt.
             */

            const finalResponse =
              detectResponse(
                userText
              );

            console.log(
              "[ClaudePage] Final detected response:",
              finalResponse
            );

            if (
              finalResponse &&
              !isIgnoredText(
                finalResponse
              )
            ) {
              return {
                ok: true,

                content:
                  finalResponse,
              };
            }

            return {
              ok: false,

              error:
                "Claude generated a response, but the response text could not be identified.",

              debug: {
                beforeUserMessageCount:
                  beforeUserElements.length,

                afterUserMessageCount:
                  findUserMessageElements(
                    userText
                  ).length,

                currentResponse:
                  finalResponse,

                pageTextTail:
                  normalizeText(
                    document.body?.innerText ||
                      ""
                  ).slice(-3000),
              },
            };
          } catch (error) {
            console.error(
              "[ClaudePage] Error:",
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
      "[ClaudeProvider] Script results:",
      results
    );

    const result =
      results?.[0]?.result;

    console.log(
      "[ClaudeProvider] Page result:",
      result
    );

    if (!result) {
      throw new Error(
        "Claude page script returned an empty result."
      );
    }

    if (!result.ok) {
      console.error(
        "[ClaudeProvider] Debug:",
        result.debug
      );

      throw new Error(
        result.error ||
        "Claude page script failed."
      );
    }

    if (
      typeof result.content !==
        "string" ||
      !result.content.trim()
    ) {
      throw new Error(
        "Claude returned an empty response."
      );
    }

    return result.content.trim();
  },
};

/* ===== INLINED: providers/gemini.js ===== */
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
};

const WS_URL = "ws://127.0.0.1:8765/ws";
const WATCHDOG_ALARM = "pair_bridge_watchdog";
const RECONNECT_DELAY_MS = 2000;
const ENABLED_KEY = "pairEnabled";

let socket = null;
let reconnectTimer = null;
let activeProvider = "chatgpt";
let pairEnabled = false;
let lastConnectionError = null;

const debuggerTabs = new Set();

const PROVIDERS = {
  chatgpt: {
    name: "ChatGPT",
    urlPatterns: [
      "https://chatgpt.com/",
      "https://chat.openai.com/",
    ],
    handler: () => ChatGPTProvider,
  },

  claude: {
    name: "Claude",
    urlPatterns: [
      "https://claude.ai/",
    ],
    handler: () => ClaudeProvider,
  },

  gemini: {
    name: "Gemini",
    urlPatterns: [
      "https://gemini.google.com/",
    ],
    handler: () => GeminiProvider,
  },
};

function detectProviderFromUrl(url) {
  if (!url) {
    return null;
  }

  for (const [provider, config] of Object.entries(PROVIDERS)) {
    if (config.urlPatterns.some((pattern) => url.startsWith(pattern))) {
      return provider;
    }
  }

  return null;
}

function isProviderTabUsable(provider, tab) {
  if (!tab || !tab.url) {
    return false;
  }

  if (detectProviderFromUrl(tab.url) !== provider) {
    return false;
  }

  const url = tab.url.toLowerCase();
  const title = (tab.title || "").toLowerCase();

  const blockedWords = [
    "login",
    "log in",
    "sign in",
    "signin",
    "create account",
    "verify",
    "authentication",
  ];

  return !blockedWords.some(
    (word) => url.includes(word) || title.includes(word)
  );
}

async function getProviderTabs() {
  const tabs = await chrome.tabs.query({});

  const result = {
    chatgpt: [],
    claude: [],
    gemini: [],
  };

  for (const tab of tabs) {
    const provider = detectProviderFromUrl(tab.url);

    if (!provider) {
      continue;
    }

    result[provider].push({
      tabId: tab.id,
      windowId: tab.windowId,
      title: tab.title || "",
      url: tab.url || "",
      active: Boolean(tab.active),
      usable: isProviderTabUsable(provider, tab),
    });
  }

  return result;
}

async function getActiveProviderTab(provider) {
  const tabs = await getProviderTabs();
  const providerTabs = tabs[provider] || [];

  const activeTab = providerTabs.find(
    (tab) => tab.active && tab.usable
  );

  if (activeTab) {
    return activeTab;
  }

  return providerTabs.find((tab) => tab.usable) || null;
}

/*
 * Keep the provider renderer active while Chrome is minimized.
 * This does not bring the tab/window to the foreground.
 */
async function activateProviderLifecycle(tabId, provider) {
  if (!Number.isInteger(tabId)) {
    throw new Error(`Invalid ${provider} tab ID.`);
  }

  if (debuggerTabs.has(tabId)) {
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setFocusEmulationEnabled",
      { enabled: true }
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Page.setWebLifecycleState",
      { state: "active" }
    );

    return;
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerTabs.add(tabId);

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setFocusEmulationEnabled",
      { enabled: true }
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Page.setWebLifecycleState",
      { state: "active" }
    );

    console.log(`${provider} lifecycle forced active: ${tabId}`);
  } catch (error) {
    debuggerTabs.delete(tabId);

    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) {}

    throw new Error(
      `Could not activate ${provider} page: ${error?.message || error}`
    );
  }
}

async function releaseProviderDebugger(tabId) {
  if (!debuggerTabs.has(tabId)) {
    return;
  }

  debuggerTabs.delete(tabId);

  try {
    await chrome.debugger.detach({ tabId });
  } catch (error) {
    console.warn("PAIR could not detach debugger:", error);
  }
}

async function releaseAllProviderDebuggers() {
  const tabs = Array.from(debuggerTabs);
  await Promise.all(
    tabs.map((tabId) => releaseProviderDebugger(tabId).catch(() => {}))
  );
}

chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId != null) {
    debuggerTabs.delete(source.tabId);
  }
});

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!pairEnabled || reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToBridge();
  }, RECONNECT_DELAY_MS);
}

function sendSocketMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.warn("PAIR could not send bridge message:", error);
    return false;
  }
}

function closeBridgeConnection() {
  clearReconnectTimer();

  const currentSocket = socket;
  socket = null;

  if (!currentSocket) {
    return;
  }

  try {
    currentSocket.close(1000, "PAIR disabled");
  } catch (_) {}
}

function connectToBridge() {
  if (!pairEnabled) {
    return;
  }

  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  console.log("PAIR connecting to local development bridge...");

  const newSocket = new WebSocket(WS_URL);
  socket = newSocket;

  newSocket.addEventListener("open", () => {
    if (socket !== newSocket || !pairEnabled) {
      try {
        newSocket.close();
      } catch (_) {}
      return;
    }

    clearReconnectTimer();
    lastConnectionError = null;
    console.log("PAIR connected to local development bridge.");

    sendSocketMessage({
      type: "extension_ready",
      name: "PAIR",
      version: chrome.runtime.getManifest().version,
    });
  });

  newSocket.addEventListener("message", async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleServerMessage(message);
    } catch (error) {
      console.error("PAIR failed to process bridge message:", error);
    }
  });

  newSocket.addEventListener("close", () => {
    console.log("PAIR disconnected from local development bridge.");

    if (socket === newSocket) {
      socket = null;
      if (pairEnabled) {
        lastConnectionError = "Local PAIR bridge is not reachable at 127.0.0.1:8765.";
        scheduleReconnect();
      }
    }
  });

  newSocket.addEventListener("error", (error) => {
    console.error("PAIR bridge WebSocket error:", error);
    lastConnectionError = "Could not connect to the local PAIR bridge at 127.0.0.1:8765.";
  });
}

async function handleServerMessage(message) {
  switch (message.type) {
    case "chat_request":
      await handleChatRequest(message);
      break;

    case "provider_changed":
      if (PROVIDERS[message.provider]) {
        activeProvider = message.provider;
      }
      break;

    case "ping":
      sendSocketMessage({ type: "pong" });
      break;

    default:
      console.log("PAIR received unknown bridge message:", message);
  }
}

function sendChatError(requestId, error, errorCode, provider) {
  sendSocketMessage({
    type: "chat_response",
    requestId,
    error: String(error),
    errorCode: errorCode || "provider_error",
    provider,
  });
}

async function handleChatRequest(message) {
  const requestId = message.requestId;

  if (!requestId) {
    return;
  }

  if (!pairEnabled || !socket || socket.readyState !== WebSocket.OPEN) {
    sendChatError(
      requestId,
      "PAIR is not connected to the local development bridge.",
      "bridge_not_connected",
      message.provider
    );
    return;
  }

  const provider = message.provider || activeProvider;
  const providerConfig = PROVIDERS[provider];

  if (!providerConfig) {
    sendChatError(
      requestId,
      `Unknown provider: ${provider}`,
      "unknown_provider",
      provider
    );
    return;
  }

  let selectedTabId = null;

  try {
    const tab = await getActiveProviderTab(provider);
    selectedTabId = tab?.tabId ?? null;

    if (!tab) {
      sendChatError(
        requestId,
        `${providerConfig.name} is not open. Open ${providerConfig.name} in a Chrome tab and try again.`,
        "provider_not_open",
        provider
      );
      return;
    }

    await activateProviderLifecycle(
      tab.tabId,
      provider
    );

    const handler = providerConfig.handler();

    if (
      !handler ||
      (typeof handler.sendMessage !== "function" &&
        typeof handler.startMessage !== "function")
    ) {
      throw new Error(`${providerConfig.name} handler is not available.`);
    }

    if (
      provider === "chatgpt" &&
      typeof handler.startMessage === "function"
    ) {
      await handler.startMessage(
        tab.tabId,
        requestId,
        message.messages
      );
      return;
    }

    const content = await handler.sendMessage(
      tab.tabId,
      message.messages
    );

    sendSocketMessage({
      type: "chat_response",
      requestId,
      content,
      provider,
    });

    await releaseProviderDebugger(selectedTabId);
  } catch (error) {
    console.error(`${providerConfig.name} request failed:`, error);

    await releaseProviderDebugger(selectedTabId);

    sendChatError(
      requestId,
      error?.message || `Failed to process ${providerConfig.name} request.`,
      "provider_error",
      provider
    );
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pair_provider_result") {
    if (sender?.tab?.id != null) {
      releaseProviderDebugger(sender.tab.id).catch(() => {});
    }

    sendSocketMessage({
      type: "chat_response",
      requestId: message.requestId,
      content: message.content,
      provider: "chatgpt",
    });

    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "pair_provider_error") {
    if (sender?.tab?.id != null) {
      releaseProviderDebugger(sender.tab.id).catch(() => {});
    }

    sendChatError(
      message.requestId,
      message.error || "Provider request failed.",
      "provider_error",
      "chatgpt"
    );

    sendResponse({ ok: true });
    return false;
  }

  handlePopupMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("PAIR popup message error:", error);
      sendResponse({
        error: error?.message || "Unknown error",
      });
    });

  return true;
});

async function getPairEnabled() {
  try {
    const result = await chrome.storage.session.get(ENABLED_KEY);
    return result[ENABLED_KEY] === true;
  } catch (_) {
    return false;
  }
}

async function setPairEnabled(enabled) {
  pairEnabled = Boolean(enabled);

  await chrome.storage.session.set({
    [ENABLED_KEY]: pairEnabled,
  });

  if (pairEnabled) {
    lastConnectionError = null;
    connectToBridge();
  } else {
    lastConnectionError = null;
    closeBridgeConnection();
    await releaseAllProviderDebuggers();
  }

  return getStatus();
}

async function getStatus() {
  const connected = Boolean(
    socket && socket.readyState === WebSocket.OPEN
  );

  const providerTabs = await getProviderTabs();

  return {
    enabled: pairEnabled,
    connected,
    connectionError: lastConnectionError,
    provider: activeProvider,
    providers: providerTabs,
  };
}

async function handlePopupMessage(message) {
  switch (message?.type) {
    case "get_status":
      if (pairEnabled && (!socket || socket.readyState === WebSocket.CLOSED)) {
        connectToBridge();
      }
      return getStatus();

    case "set_enabled":
      return setPairEnabled(message.enabled === true);

    case "connect":
      return setPairEnabled(true);

    case "disconnect":
      return setPairEnabled(false);

    case "get_provider":
      return { provider: activeProvider };

    case "get_provider_tabs":
      return getProviderTabs();

    case "get_active_provider_tab": {
      const provider = message.provider || activeProvider;
      return getActiveProviderTab(provider);
    }

    case "set_provider": {
      const provider = message.provider;

      if (!PROVIDERS[provider]) {
        throw new Error(`Unknown provider: ${provider}`);
      }

      activeProvider = provider;

      sendSocketMessage({
        type: "provider_changed",
        provider,
      });

      return {
        success: true,
        provider: activeProvider,
      };
    }

    default:
      throw new Error(
        `Unknown popup message type: ${message?.type}`
      );
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  releaseProviderDebugger(tabId).catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  // PAIR must be manually enabled for each new Chrome session.
  pairEnabled = false;
  clearReconnectTimer();
  closeBridgeConnection();
  await chrome.storage.session.set({
    [ENABLED_KEY]: false,
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  pairEnabled = false;
  clearReconnectTimer();
  closeBridgeConnection();
  await chrome.storage.session.set({
    [ENABLED_KEY]: false,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name !== WATCHDOG_ALARM || !pairEnabled) {
    return;
  }

  connectToBridge();
});

chrome.alarms.create(WATCHDOG_ALARM, {
  periodInMinutes: 0.5,
});

(async () => {
  pairEnabled = await getPairEnabled();
  lastConnectionError = null;

  if (pairEnabled) {
    connectToBridge();
  }
})();
