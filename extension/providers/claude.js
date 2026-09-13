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

  async startStreamMessage(tabId, requestId, messages) {
    if (!Number.isInteger(tabId)) {
      throw new Error("Invalid claude tab ID.");
    }

    if (!requestId) {
      throw new Error("Missing claude request ID.");
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: streamClaudePage,
      args: [messages, requestId],
    });

    const result = results?.[0]?.result;

    if (!result || result.ok !== true) {
      throw new Error(
        result?.error ||
        "Claude streaming page could not start."
      );
    }

    return true;
  },

};

async function streamClaudePage(incomingMessages, requestId) {
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

  const ignored = new Set([
    "just now", "Write a message…", "Write a message...", "Send",
    "Send Message", "New", "Projects", "Artifacts", "Code", "Customize",
    "Share", "Upgrade", "Copy", "Retry", "Regenerate", "Like", "Dislike",
    "Crystallizing", "Thinking", "Claude is thinking",
    "Claude is thinking…", "Claude is thinking...", "Working",
    "Generating", "Processing", "Loading"
  ]);

  const meaningful = (el, userText) => {
    if (!visible(el)) return "";
    if (el.matches("textarea,input,[contenteditable='true'],[role='textbox']")) return "";
    const text = textOf(el);
    if (!text || text === userText || ignored.has(text) || text.length > 5000) return "";
    return text;
  };

  const findComposer = () => {
    for (const selector of ["textarea", '[contenteditable="true"]', '[role="textbox"]', ".ProseMirror"]) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  };

  const setComposer = (el, text) => {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
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
      'button[aria-label="Send Message"]',
      'button[aria-label="Send message"]',
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

  const isGenerating = () => {
    const stop = document.querySelector(
      'button[aria-label*="Stop"],button[title*="Stop"],button[data-testid*="stop"]'
    );
    const busy = document.querySelector('[aria-busy="true"]');
    return Boolean((stop && visible(stop) && !stop.disabled) || busy);
  };

  const userText = [...(Array.isArray(incomingMessages) ? incomingMessages : [])]
    .reverse().find((m) => m?.role === "user")?.content;
  const prompt = typeof userText === "string" ? userText.trim() : "";
  if (!prompt) throw new Error("User message is empty.");

  const findResponse = () => {
    const candidates = [];
    for (const selector of [
      '[data-is-streaming]',
      '[data-testid*="assistant"]',
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]'
    ]) {
      for (const el of document.querySelectorAll(selector)) {
        const text = meaningful(el, prompt);
        if (text) candidates.push(text);
      }
    }
    if (candidates.length) return candidates[candidates.length - 1];

    const users = [];
    for (const el of document.querySelectorAll("div,p,span")) {
      if (visible(el) && textOf(el) === prompt) users.push(el);
    }
    const user = users.at(-1);
    if (!user) return "";

    let current = user;
    for (let level = 0; level < 6 && current; level++) {
      const parent = current.parentElement;
      if (!parent) break;
      const siblings = [...parent.children];
      const index = siblings.indexOf(current);
      for (let i = index + 1; i < siblings.length; i++) {
        const direct = meaningful(siblings[i], prompt);
        if (direct) return direct;
        for (const d of siblings[i].querySelectorAll("div,p,span")) {
          const t = meaningful(d, prompt);
          if (t && t.length <= 5000) return t;
        }
      }
      current = parent;
    }
    return "";
  };

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
      type: "pair_provider_stream_error",
      provider: "claude",
      requestId,
      error: error?.message || String(error)
    });
  };

  const emit = (text) => {
    if (resolved || text === lastText) return;
    let delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
    lastText = text;
    if (delta) send({
      type: "pair_provider_stream_chunk",
      provider: "claude",
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
      type: "pair_provider_stream_chunk",
      provider: "claude",
      requestId,
      content: "",
      done: true
    });
  };

  const process = () => {
    if (resolved) return;
    const current = findResponse();
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
      const verified = findResponse();
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
    const composer = findComposer();
    if (!composer) throw new Error("Claude composer was not found.");

    observer = new MutationObserver(process);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "disabled", "class"]
    });

    setComposer(composer, prompt);
    await sleep(300);

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
