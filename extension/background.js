/*
 * PAIR - browser connection service worker
 *
 * Provider handlers live in extension/providers/*.js.
 * PAIR keeps one local connection between the extension and the Python
 * bridge. Provider tabs are located only when a request arrives.
 */

importScripts(
  "providers/chatgpt.js",
  "providers/claude.js",
  "providers/gemini.js"
);

/*
 * Provider page observers send these messages into the extension runtime.
 * The service worker forwards them over the single PAIR WebSocket.
 */
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

        `${providerConfig.name} is not open. Open ${providerConfig.name} in a Browser tab and try again.`,

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
     * True browser-side streaming.
     *
     * Each provider's page observer emits incremental deltas while the
     * provider is generating. The final event has done=true.
     */
    if (message.stream) {
      if (
        provider === "chatgpt" &&
        typeof handler.startMessage === "function"
      ) {
        await handler.startMessage(
          tab.tabId,
          requestId,
          message.messages,
          true
        );
        return;
      }

      if (
        typeof handler.startStreamMessage === "function"
      ) {
        await handler.startStreamMessage(
          tab.tabId,
          requestId,
          message.messages
        );
        return;
      }

      sendChatError(
        requestId,
        `${providerConfig.name} streaming is not implemented yet.`,
        "stream_not_supported",
        provider
      );

      await releaseProviderDebugger(
        selectedTabId
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

    /* ------------------------------------------------------------
     * Provider streaming chunk
     *
     * Handle provider messages in this listener so they never
     * fall through to handlePopupMessage().
     * ------------------------------------------------------------ */
    if (
      message?.type ===
      "pair_provider_stream_chunk"
    ) {
      if (
        message.requestId &&
        message.provider
      ) {
        sendSocketMessage({
          type:
            "chat_stream_chunk",
          requestId:
            message.requestId,
          provider:
            message.provider,
          content:
            message.content || "",
          done:
            Boolean(message.done),
        });

        if (
          message.done &&
          sender?.tab?.id != null
        ) {
          releaseProviderDebugger(
            sender.tab.id
          ).catch(() => {});
        }
      }

      sendResponse({
        ok: true,
      });

      return false;
    }


    /* ------------------------------------------------------------
     * Provider streaming error
     * ------------------------------------------------------------ */
    if (
      message?.type ===
      "pair_provider_stream_error"
    ) {
      if (
        message.requestId &&
        message.provider
      ) {
        sendSocketMessage({
          type:
            "chat_stream_error",
          requestId:
            message.requestId,
          provider:
            message.provider,
          error:
            message.error ||
            `${message.provider} streaming failed.`,
          errorCode:
            message.errorCode ||
            "provider_error",
        });

        if (sender?.tab?.id != null) {
          releaseProviderDebugger(
            sender.tab.id
          ).catch(() => {});
        }
      }

      sendResponse({
        ok: true,
      });

      return false;
    }


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