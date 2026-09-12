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

            if (
              value.length < 2
            ) {
              return true;
            }

            if (
              lower === "new chat" ||
              lower === "settings" ||
              lower === "projects"
            ) {
              return true;
            }

            return false;
          };

          const findComposer = () => {
            const selectors = [
              "textarea",
              '[contenteditable="true"]',
              '[role="textbox"]',
            ];

            for (
              const selector of selectors
            ) {
              const elements =
                Array.from(
                  document.querySelectorAll(
                    selector
                  )
                );

              const visible =
                elements.find(
                  (element) =>
                    isVisible(element)
                );

              if (visible) {
                return visible;
              }
            }

            return null;
          };

          const findSendButton = () => {
            const buttons =
              Array.from(
                document.querySelectorAll(
                  "button"
                )
              );

            const candidates =
              buttons.filter(
                (button) =>
                  isVisible(button)
              );

            for (
              const button of candidates
            ) {
              const text =
                getText(button)
                  .toLowerCase();

              const aria =
                (
                  button.getAttribute(
                    "aria-label"
                  ) || ""
                ).toLowerCase();

              const title =
                (
                  button.getAttribute(
                    "title"
                  ) || ""
                ).toLowerCase();

              if (
                text === "send" ||
                aria.includes("send") ||
                title.includes("send")
              ) {
                return button;
              }
            }

            return null;
          };

          const setComposerValue = (
            composer,
            value
          ) => {
            if (
              composer instanceof
              HTMLTextAreaElement
            ) {
              const setter =
                Object.getOwnPropertyDescriptor(
                  HTMLTextAreaElement.prototype,
                  "value"
                )?.set;

              if (setter) {
                setter.call(
                  composer,
                  value
                );
              } else {
                composer.value =
                  value;
              }

              composer.dispatchEvent(
                new Event(
                  "input",
                  {
                    bubbles: true,
                  }
                )
              );

              composer.dispatchEvent(
                new Event(
                  "change",
                  {
                    bubbles: true,
                  }
                )
              );

              return;
            }

            composer.focus();

            document.execCommand(
              "selectAll",
              false,
              null
            );

            document.execCommand(
              "insertText",
              false,
              value
            );

            composer.dispatchEvent(
              new InputEvent(
                "input",
                {
                  bubbles: true,
                  inputType:
                    "insertText",
                  data: value,
                }
              )
            );
          };

          const getMessageText =
            () => {
              const selectors = [
                '[data-testid*="message"]',
                '[data-testid*="assistant"]',
                '[class*="message"]',
                '[class*="response"]',
                '[class*="prose"]',
              ];

              const candidates = [];

              for (
                const selector of
                  selectors
              ) {
                for (
                  const element of
                    document.querySelectorAll(
                      selector
                    )
                ) {
                  if (
                    !isVisible(
                      element
                    )
                  ) {
                    continue;
                  }

                  const text =
                    getText(
                      element
                    );

                  if (
                    !text ||
                    isIgnoredText(
                      text
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

              if (
                candidates.length === 0
              ) {
                return "";
              }

              candidates.sort(
                (a, b) =>
                  b.text.length -
                  a.text.length
              );

              return candidates[0]
                .text;
            };

          const beforeText =
            getMessageText();

          const composer =
            findComposer();

          if (!composer) {
            throw new Error(
              "Claude message composer was not found."
            );
          }

          const prompt =
            incomingMessages
              .map(
                (message) =>
                  message?.content || ""
              )
              .filter(Boolean)
              .join("\n\n");

          if (!prompt.trim()) {
            throw new Error(
              "Claude prompt is empty."
            );
          }

          setComposerValue(
            composer,
            prompt
          );

          await sleep(100);

          const sendButton =
            findSendButton();

          if (sendButton) {
            sendButton.click();
          } else {
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
          }

          let lastText =
            beforeText;

          let stableCount = 0;

          const startTime =
            Date.now();

          while (true) {
            await sleep(250);

            const currentText =
              getMessageText();

            if (
              currentText &&
              currentText !==
                beforeText
            ) {
              if (
                currentText ===
                lastText
              ) {
                stableCount += 1;
              } else {
                stableCount = 0;
                lastText =
                  currentText;
              }

              if (
                stableCount >= 6
              ) {
                await sleep(500);

                const verifiedText =
                  getMessageText();

                if (
                  verifiedText ===
                  currentText
                ) {
                  return verifiedText;
                }
              }
            }

            /*
             * This is NOT a generation timeout.
             *
             * It only prevents the page script from running forever
             * if Claude's page becomes completely unusable.
             *
             * The normal generation flow is based on completion/stability.
             */
            if (
              Date.now() -
                startTime >
              30 * 60 * 1000
            ) {
              throw new Error(
                "Claude response did not complete."
              );
            }
          }
        },
        args: [messages],
      });

    const result =
      results?.[0]?.result;

    if (
      typeof result !==
        "string" ||
      !result.trim()
    ) {
      throw new Error(
        "Claude returned an empty response."
      );
    }

    return result.trim();
  },
};


/* ===== INLINED: providers/gemini.js ===== */

const GeminiProvider = {
  name: "gemini",

  async sendMessage(tabId, messages) {
    if (!Number.isInteger(tabId)) {
      throw new Error(
        "Invalid Gemini tab ID."
      );
    }

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

          const isIgnoredText = (text) => {
            const value =
              normalizeText(text);

            if (!value) {
              return true;
            }

            const ignored = [
              "Thinking",
              "Generating",
              "Loading",
              "Send",
              "Copy",
              "Retry",
              "Share",
            ];

            return (
              ignored.includes(value) ||
              value.length < 2
            );
          };

          const findComposer = () => {
            const selectors = [
              "textarea",
              '[contenteditable="true"]',
              '[role="textbox"]',
            ];

            for (
              const selector of selectors
            ) {
              const elements =
                Array.from(
                  document.querySelectorAll(
                    selector
                  )
                );

              const visible =
                elements.find(
                  (element) =>
                    isVisible(element)
                );

              if (visible) {
                return visible;
              }
            }

            return null;
          };

          const findSendButton = () => {
            const buttons =
              Array.from(
                document.querySelectorAll(
                  "button"
                )
              );

            for (
              const button of buttons
            ) {
              if (
                !isVisible(button)
              ) {
                continue;
              }

              const text =
                getText(button)
                  .toLowerCase();

              const aria =
                (
                  button.getAttribute(
                    "aria-label"
                  ) || ""
                ).toLowerCase();

              const title =
                (
                  button.getAttribute(
                    "title"
                  ) || ""
                ).toLowerCase();

              if (
                text === "send" ||
                aria.includes("send") ||
                title.includes("send")
              ) {
                return button;
              }
            }

            return null;
          };

          const setComposerValue = (
            composer,
            value
          ) => {
            if (
              composer instanceof
              HTMLTextAreaElement
            ) {
              const setter =
                Object.getOwnPropertyDescriptor(
                  HTMLTextAreaElement.prototype,
                  "value"
                )?.set;

              if (setter) {
                setter.call(
                  composer,
                  value
                );
              } else {
                composer.value =
                  value;
              }

              composer.dispatchEvent(
                new Event(
                  "input",
                  {
                    bubbles: true,
                  }
                )
              );

              composer.dispatchEvent(
                new Event(
                  "change",
                  {
                    bubbles: true,
                  }
                )
              );

              return;
            }

            composer.focus();

            document.execCommand(
              "selectAll",
              false,
              null
            );

            document.execCommand(
              "insertText",
              false,
              value
            );

            composer.dispatchEvent(
              new InputEvent(
                "input",
                {
                  bubbles: true,
                  inputType:
                    "insertText",
                  data: value,
                }
              )
            );
          };

          const getCandidateResponse =
            () => {
              const selectors = [
                '[data-message-author-role="model"]',
                '[data-message-author-role="assistant"]',
                ".model-response",
                ".markdown",
                '[class*="model"]',
                '[class*="response"]',
              ];

              const candidates = [];

              for (
                const selector of
                  selectors
              ) {
                for (
                  const element of
                    document.querySelectorAll(
                      selector
                    )
                ) {
                  if (
                    !isVisible(
                      element
                    )
                  ) {
                    continue;
                  }

                  const text =
                    getText(
                      element
                    );

                  if (
                    !text ||
                    isIgnoredText(
                      text
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

              candidates.sort(
                (a, b) =>
                  b.text.length -
                  a.text.length
              );

              return (
                candidates[0]?.text ||
                ""
              );
            };

          const beforeText =
            getCandidateResponse();

          const composer =
            findComposer();

          if (!composer) {
            throw new Error(
              "Gemini message composer was not found."
            );
          }

          const prompt =
            incomingMessages
              .map(
                (message) =>
                  message?.content || ""
              )
              .filter(Boolean)
              .join("\n\n");

          if (!prompt.trim()) {
            throw new Error(
              "Gemini prompt is empty."
            );
          }

          setComposerValue(
            composer,
            prompt
          );

          await sleep(100);

          const sendButton =
            findSendButton();

          if (sendButton) {
            sendButton.click();
          } else {
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
          }

          let lastText =
            beforeText;

          let stableCount = 0;

          while (true) {
            await sleep(250);

            const currentText =
              getCandidateResponse();

            if (
              currentText &&
              currentText !==
                beforeText
            ) {
              if (
                currentText ===
                lastText
              ) {
                stableCount += 1;
              } else {
                stableCount = 0;
                lastText =
                  currentText;
              }

              if (
                stableCount >= 6
              ) {
                await sleep(500);

                const verifiedText =
                  getCandidateResponse();

                if (
                  verifiedText ===
                  currentText
                ) {
                  return verifiedText;
                }
              }
            }
          }
        },
        args: [messages],
      });

    const result =
      results?.[0]?.result;

    if (
      typeof result !==
        "string" ||
      !result.trim()
    ) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    return result.trim();
  },
};


/* ================================================================
 * PAIR BRIDGE CONNECTION
 * ================================================================ */

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 8765;

const WS_URL =
  `ws://${BRIDGE_HOST}:${BRIDGE_PORT}/ws`;

const HTTP_URL =
  `http://${BRIDGE_HOST}:${BRIDGE_PORT}/`;

const WATCHDOG_ALARM =
  "pair_bridge_watchdog";

const RECONNECT_DELAY_MS = 2000;

const ENABLED_KEY =
  "pairEnabled";

let socket = null;
let reconnectTimer = null;
let bridgeCheckInProgress = false;

let activeProvider =
  "chatgpt";

let pairEnabled =
  false;

let lastConnectionError =
  null;

const debuggerTabs =
  new Set();


const PROVIDERS = {
  chatgpt: {
    name: "ChatGPT",

    urlPatterns: [
      "https://chatgpt.com/",
      "https://chat.openai.com/",
    ],

    handler: () =>
      ChatGPTProvider,
  },

  claude: {
    name: "Claude",

    urlPatterns: [
      "https://claude.ai/",
    ],

    handler: () =>
      ClaudeProvider,
  },

  gemini: {
    name: "Gemini",

    urlPatterns: [
      "https://gemini.google.com/",
    ],

    handler: () =>
      GeminiProvider,
  },
};


function detectProviderFromUrl(url) {
  if (!url) {
    return null;
  }

  for (
    const [
      provider,
      config,
    ] of Object.entries(
      PROVIDERS
    )
  ) {
    if (
      config.urlPatterns.some(
        (pattern) =>
          url.startsWith(
            pattern
          )
      )
    ) {
      return provider;
    }
  }

  return null;
}


function isProviderTabUsable(
  provider,
  tab
) {
  if (
    !tab ||
    !tab.url
  ) {
    return false;
  }

  if (
    detectProviderFromUrl(
      tab.url
    ) !== provider
  ) {
    return false;
  }

  const url =
    tab.url.toLowerCase();

  const title =
    (
      tab.title || ""
    ).toLowerCase();

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
    (word) =>
      url.includes(word) ||
      title.includes(word)
  );
}


async function getProviderTabs() {
  const tabs =
    await chrome.tabs.query({});

  const result = {
    chatgpt: [],
    claude: [],
    gemini: [],
  };

  for (
    const tab of tabs
  ) {
    const provider =
      detectProviderFromUrl(
        tab.url
      );

    if (!provider) {
      continue;
    }

    result[provider].push({
      tabId: tab.id,
      windowId: tab.windowId,
      title:
        tab.title || "",
      url:
        tab.url || "",
      active:
        Boolean(tab.active),
      usable:
        isProviderTabUsable(
          provider,
          tab
        ),
    });
  }

  return result;
}


async function getActiveProviderTab(
  provider
) {
  const tabs =
    await getProviderTabs();

  const providerTabs =
    tabs[provider] || [];

  const activeTab =
    providerTabs.find(
      (tab) =>
        tab.active &&
        tab.usable
    );

  if (activeTab) {
    return activeTab;
  }

  return (
    providerTabs.find(
      (tab) =>
        tab.usable
    ) || null
  );
}


/*
 * Keep the provider renderer active while Chrome is minimized.
 *
 * IMPORTANT:
 * Do NOT use Page.bringToFront().
 */
async function activateProviderLifecycle(
  tabId,
  provider
) {
  if (
    !Number.isInteger(tabId)
  ) {
    throw new Error(
      `Invalid ${provider} tab ID.`
    );
  }

  if (
    debuggerTabs.has(tabId)
  ) {
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setFocusEmulationEnabled",
      {
        enabled: true,
      }
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Page.setWebLifecycleState",
      {
        state: "active",
      }
    );

    return;
  }

  try {
    await chrome.debugger.attach(
      { tabId },
      "1.3"
    );

    debuggerTabs.add(tabId);

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setFocusEmulationEnabled",
      {
        enabled: true,
      }
    );

    await chrome.debugger.sendCommand(
      { tabId },
      "Page.setWebLifecycleState",
      {
        state: "active",
      }
    );

    console.log(
      `${provider} lifecycle forced active: ${tabId}`
    );
  } catch (error) {
    debuggerTabs.delete(
      tabId
    );

    try {
      await chrome.debugger.detach(
        { tabId }
      );
    } catch (_) {}

    throw new Error(
      `Could not activate ${provider} page: ${
        error?.message ||
        error
      }`
    );
  }
}


async function releaseProviderDebugger(
  tabId
) {
  if (
    !debuggerTabs.has(
      tabId
    )
  ) {
    return;
  }

  debuggerTabs.delete(
    tabId
  );

  try {
    await chrome.debugger.detach(
      { tabId }
    );
  } catch (error) {
    console.warn(
      "PAIR could not detach debugger:",
      error
    );
  }
}


async function releaseAllProviderDebuggers() {
  const tabs =
    Array.from(
      debuggerTabs
    );

  await Promise.all(
    tabs.map(
      (tabId) =>
        releaseProviderDebugger(
          tabId
        ).catch(
          () => {}
        )
    )
  );
}


chrome.debugger.onDetach.addListener(
  (source) => {
    if (
      source?.tabId != null
    ) {
      debuggerTabs.delete(
        source.tabId
      );
    }
  }
);


/* ================================================================
 * RECONNECT / BRIDGE HEALTH
 * ================================================================ */

function clearReconnectTimer() {
  if (
    reconnectTimer
  ) {
    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      null;
  }
}


function scheduleReconnect() {
  if (
    !pairEnabled ||
    reconnectTimer
  ) {
    return;
  }

  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer =
          null;

        connectToBridge();
      },
      RECONNECT_DELAY_MS
    );
}


/*
 * Check whether the Python bridge is actually running BEFORE creating
 * a WebSocket.
 *
 * This is the important fix.
 *
 * If Python has called client.close(), port 8765 is closed.
 * Instead of doing:
 *
 *     new WebSocket(...)
 *
 * and producing:
 *
 *     ERR_CONNECTION_REFUSED
 *
 * we simply wait and retry later.
 */
async function isBridgeReachable() {
  if (
    bridgeCheckInProgress
  ) {
    return false;
  }

  bridgeCheckInProgress =
    true;

  try {
    const controller =
      new AbortController();

    const timeoutId =
      setTimeout(
        () =>
          controller.abort(),
        1000
      );

    try {
      const response =
        await fetch(
          HTTP_URL,
          {
            method: "GET",
            cache: "no-store",
            signal:
              controller.signal,
          }
        );

      return response.ok;
    } finally {
      clearTimeout(
        timeoutId
      );
    }
  } catch (_) {
    /*
     * Bridge is not running.
     *
     * Deliberately do NOT log an error here.
     *
     * This is normal when the Python client has been closed.
     */
    return false;
  } finally {
    bridgeCheckInProgress =
      false;
  }
}


function sendSocketMessage(
  message
) {
  if (
    !socket ||
    socket.readyState !==
      WebSocket.OPEN
  ) {
    return false;
  }

  try {
    socket.send(
      JSON.stringify(
        message
      )
    );

    return true;
  } catch (error) {
    console.warn(
      "PAIR could not send bridge message:",
      error
    );

    return false;
  }
}


function closeBridgeConnection() {
  clearReconnectTimer();

  const currentSocket =
    socket;

  socket =
    null;

  if (!currentSocket) {
    return;
  }

  try {
    currentSocket.close(
      1000,
      "PAIR disabled"
    );
  } catch (_) {}
}


/*
 * Connect to bridge only when:
 *
 * 1. PAIR is enabled
 * 2. There isn't already an OPEN/CONNECTING socket
 * 3. The local bridge is actually reachable
 */
async function connectToBridge() {
  if (!pairEnabled) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  const reachable =
    await isBridgeReachable();

  if (
    !reachable
  ) {
    /*
     * Do not report this as an error.
     *
     * The bridge may simply not be running yet.
     */
    lastConnectionError =
      null;

    scheduleReconnect();

    return;
  }

  if (!pairEnabled) {
    return;
  }

  if (
    socket &&
    (
      socket.readyState ===
        WebSocket.OPEN ||
      socket.readyState ===
        WebSocket.CONNECTING
    )
  ) {
    return;
  }

  console.log(
    "PAIR connecting to local development bridge..."
  );

  const newSocket =
    new WebSocket(
      WS_URL
    );

  socket =
    newSocket;


  newSocket.addEventListener(
    "open",
    () => {
      if (
        socket !==
          newSocket ||
        !pairEnabled
      ) {
        try {
          newSocket.close();
        } catch (_) {}

        return;
      }

      clearReconnectTimer();

      lastConnectionError =
        null;

      console.log(
        "PAIR connected to local development bridge."
      );

      sendSocketMessage({
        type:
          "extension_ready",

        name:
          "PAIR",

        version:
          chrome.runtime.getManifest()
            .version,
      });
    }
  );


  newSocket.addEventListener(
    "message",
    async (event) => {
      try {
        const message =
          JSON.parse(
            event.data
          );

        await handleServerMessage(
          message
        );
      } catch (error) {
        console.error(
          "PAIR failed to process bridge message:",
          error
        );
      }
    }
  );


  newSocket.addEventListener(
    "close",
    () => {
      console.log(
        "PAIR disconnected from local development bridge."
      );

      /*
       * IMPORTANT:
       *
       * Only the currently active socket is allowed to modify
       * the global socket state.
       */
      if (
        socket ===
        newSocket
      ) {
        socket =
          null;

        if (
          pairEnabled
        ) {
          /*
           * Don't display connection errors for a normal
           * bridge shutdown/restart.
           *
           * The watchdog will reconnect when the bridge returns.
           */
          lastConnectionError =
            null;

          scheduleReconnect();
        }
      }
    }
  );


  newSocket.addEventListener(
    "error",
    () => {
      /*
       * WebSocket errors are intentionally not surfaced as
       * noisy extension errors.
       *
       * The close event will schedule the reconnect.
       */
      if (
        socket ===
        newSocket
      ) {
        lastConnectionError =
          null;
      }
    }
  );
}


/* ================================================================
 * SERVER MESSAGE HANDLING
 * ================================================================ */

async function handleServerMessage(
  message
) {
  switch (
    message.type
  ) {
    case "chat_request":
      await handleChatRequest(
        message
      );
      break;

    case "provider_changed":
      if (
        PROVIDERS[
          message.provider
        ]
      ) {
        activeProvider =
          message.provider;
      }
      break;

    case "ping":
      sendSocketMessage({
        type: "pong",
      });
      break;

    default:
      console.log(
        "PAIR received unknown bridge message:",
        message
      );
  }
}


function sendChatError(
  requestId,
  error,
  errorCode,
  provider
) {
  sendSocketMessage({
    type:
      "chat_response",

    requestId,

    error:
      String(error),

    errorCode:
      errorCode ||
      "provider_error",

    provider,
  });
}


async function handleChatRequest(
  message
) {
  const requestId =
    message.requestId;

  if (!requestId) {
    return;
  }

  if (
    !pairEnabled ||
    !socket ||
    socket.readyState !==
      WebSocket.OPEN
  ) {
    sendChatError(
      requestId,

      "PAIR is not connected to the local development bridge.",

      "bridge_not_connected",

      message.provider
    );

    return;
  }

  const provider =
    message.provider ||
    activeProvider;

  const providerConfig =
    PROVIDERS[
      provider
    ];

  if (!providerConfig) {
    sendChatError(
      requestId,

      `Unknown provider: ${provider}`,

      "unknown_provider",

      provider
    );

    return;
  }

  let selectedTabId =
    null;

  try {
    const tab =
      await getActiveProviderTab(
        provider
      );

    selectedTabId =
      tab?.tabId ??
      null;

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

    const handler =
      providerConfig.handler();

    if (
      !handler ||
      (
        typeof handler.sendMessage !==
          "function" &&
        typeof handler.startMessage !==
          "function"
      )
    ) {
      throw new Error(
        `${providerConfig.name} handler is not available.`
      );
    }


    /*
     * ChatGPT uses a content script because the response
     * is observed continuously from the page.
     *
     * The content script itself waits until the response
     * is completely generated before sending pair_provider_result.
     */
    if (
      provider === "chatgpt" &&
      typeof handler.startMessage ===
        "function"
    ) {
      await handler.startMessage(
        tab.tabId,
        requestId,
        message.messages
      );

      return;
    }


    /*
     * Claude/Gemini providers return only after their
     * response is complete.
     */
    const content =
      await handler.sendMessage(
        tab.tabId,
        message.messages
      );

    sendSocketMessage({
      type:
        "chat_response",

      requestId,

      content,

      provider,
    });

    await releaseProviderDebugger(
      selectedTabId
    );
  } catch (error) {
    console.error(
      `${providerConfig.name} request failed:`,
      error
    );

    await releaseProviderDebugger(
      selectedTabId
    );

    sendChatError(
      requestId,

      error?.message ||
        `Failed to process ${providerConfig.name} request.`,

      "provider_error",

      provider
    );
  }
}


/* ================================================================
 * POPUP / CONTENT SCRIPT MESSAGES
 * ================================================================ */

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

    if (
      message?.type ===
      "pair_provider_result"
    ) {
      if (
        sender?.tab?.id !=
        null
      ) {
        releaseProviderDebugger(
          sender.tab.id
        ).catch(
          () => {}
        );
      }

      sendSocketMessage({
        type:
          "chat_response",

        requestId:
          message.requestId,

        content:
          message.content,

        provider:
          "chatgpt",
      });

      sendResponse({
        ok: true,
      });

      return false;
    }


    if (
      message?.type ===
      "pair_provider_error"
    ) {
      if (
        sender?.tab?.id !=
        null
      ) {
        releaseProviderDebugger(
          sender.tab.id
        ).catch(
          () => {}
        );
      }

      sendChatError(
        message.requestId,

        message.error ||
          "Provider request failed.",

        "provider_error",

        "chatgpt"
      );

      sendResponse({
        ok: true,
      });

      return false;
    }


    handlePopupMessage(
      message,
      sender
    )
      .then(
        sendResponse
      )
      .catch(
        (error) => {
          console.error(
            "PAIR popup message error:",
            error
          );

          sendResponse({
            error:
              error?.message ||
              "Unknown error",
          });
        }
      );

    return true;
  }
);


/* ================================================================
 * ENABLE / DISABLE
 * ================================================================ */

async function getPairEnabled() {
  try {
    const result =
      await chrome.storage.session.get(
        ENABLED_KEY
      );

    return (
      result[
        ENABLED_KEY
      ] === true
    );
  } catch (_) {
    return false;
  }
}


async function setPairEnabled(
  enabled
) {
  pairEnabled =
    Boolean(enabled);

  await chrome.storage.session.set({
    [ENABLED_KEY]:
      pairEnabled,
  });

  if (
    pairEnabled
  ) {
    lastConnectionError =
      null;

    connectToBridge();
  } else {
    lastConnectionError =
      null;

    closeBridgeConnection();

    await releaseAllProviderDebuggers();
  }

  return getStatus();
}


async function getStatus() {
  const connected =
    Boolean(
      socket &&
      socket.readyState ===
        WebSocket.OPEN
    );

  const providerTabs =
    await getProviderTabs();

  return {
    enabled:
      pairEnabled,

    connected,

    connectionError:
      lastConnectionError,

    provider:
      activeProvider,

    providers:
      providerTabs,
  };
}


/* ================================================================
 * POPUP COMMANDS
 * ================================================================ */

async function handlePopupMessage(
  message
) {
  switch (
    message?.type
  ) {

    case "get_status":

      if (
        pairEnabled &&
        (
          !socket ||
          socket.readyState ===
            WebSocket.CLOSED
        )
      ) {
        connectToBridge();
      }

      return getStatus();


    case "set_enabled":

      return setPairEnabled(
        message.enabled === true
      );


    case "connect":

      return setPairEnabled(
        true
      );


    case "disconnect":

      return setPairEnabled(
        false
      );


    case "get_provider":

      return {
        provider:
          activeProvider,
      };


    case "get_provider_tabs":

      return getProviderTabs();


    case "get_active_provider_tab": {
      const provider =
        message.provider ||
        activeProvider;

      return getActiveProviderTab(
        provider
      );
    }


    case "set_provider": {
      const provider =
        message.provider;

      if (
        !PROVIDERS[
          provider
        ]
      ) {
        throw new Error(
          `Unknown provider: ${provider}`
        );
      }

      activeProvider =
        provider;

      sendSocketMessage({
        type:
          "provider_changed",

        provider,
      });

      return {
        success: true,

        provider:
          activeProvider,
      };
    }


    default:

      throw new Error(
        `Unknown popup message type: ${message?.type}`
      );
  }
}


/* ================================================================
 * TAB / LIFECYCLE EVENTS
 * ================================================================ */

chrome.tabs.onRemoved.addListener(
  (tabId) => {
    releaseProviderDebugger(
      tabId
    ).catch(
      () => {}
    );
  }
);


chrome.runtime.onStartup.addListener(
  async () => {

    /*
     * PAIR must be manually enabled for each
     * new Chrome session.
     */
    pairEnabled =
      false;

    clearReconnectTimer();

    closeBridgeConnection();

    await chrome.storage.session.set({
      [ENABLED_KEY]:
        false,
    });
  }
);


chrome.runtime.onInstalled.addListener(
  async () => {

    pairEnabled =
      false;

    clearReconnectTimer();

    closeBridgeConnection();

    await chrome.storage.session.set({
      [ENABLED_KEY]:
        false,
    });
  }
);


/* ================================================================
 * WATCHDOG
 *
 * Checks periodically whether the bridge has returned.
 * There is no maximum connection timeout.
 * ================================================================ */

chrome.alarms.onAlarm.addListener(
  async (alarm) => {

    if (
      alarm?.name !==
        WATCHDOG_ALARM ||
      !pairEnabled
    ) {
      return;
    }

    connectToBridge();
  }
);


chrome.alarms.create(
  WATCHDOG_ALARM,
  {
    periodInMinutes: 0.5,
  }
);


/* ================================================================
 * INITIAL STATE
 * ================================================================ */

(async () => {
  pairEnabled =
    await getPairEnabled();

  lastConnectionError =
    null;

  if (
    pairEnabled
  ) {
    connectToBridge();
  }
})();