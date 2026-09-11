/*
|--------------------------------------------------------------------------
| Load Provider Handlers
|--------------------------------------------------------------------------
|
| MV3 service workers support importScripts().
|
*/

importScripts(
  "providers/chatgpt.js",
  "providers/claude.js",
  "providers/gemini.js"
);


/*
|--------------------------------------------------------------------------
| State
|--------------------------------------------------------------------------
*/

let socket = null;

let reconnectTimer = null;

let activeProvider =
  "chatgpt";


const WS_URL =
  "ws://127.0.0.1:8765/ws";


/*
|--------------------------------------------------------------------------
| Providers
|--------------------------------------------------------------------------
*/

const PROVIDERS = {

  chatgpt: {
    name: "ChatGPT",

    urlPatterns: [
      "https://chatgpt.com/",
      "https://chat.openai.com/",
    ],

    handler:
      () =>
        ChatGPTProvider,
  },


  claude: {
    name: "Claude",

    urlPatterns: [
      "https://claude.ai/",
    ],

    handler:
      () =>
        ClaudeProvider,
  },


  gemini: {
    name: "Gemini",

    urlPatterns: [
      "https://gemini.google.com/",
    ],

    handler:
      () =>
        GeminiProvider,
  },
};


/*
|--------------------------------------------------------------------------
| Detect Provider From URL
|--------------------------------------------------------------------------
*/

function detectProviderFromUrl(
  url
) {

  if (!url) {
    return null;
  }


  for (
    const [provider, config]
    of Object.entries(PROVIDERS)
  ) {

    const matched =
      config.urlPatterns.some(
        (pattern) =>
          url.startsWith(pattern)
      );


    if (matched) {
      return provider;
    }
  }


  return null;
}


/*
|--------------------------------------------------------------------------
| Check Provider Tab
|--------------------------------------------------------------------------
*/

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


  const detectedProvider =
    detectProviderFromUrl(
      tab.url
    );


  if (
    detectedProvider !==
    provider
  ) {
    return false;
  }


  const url =
    tab.url.toLowerCase();


  const title =
    (
      tab.title ||
      ""
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


  const blocked =
    blockedWords.some(
      (word) =>
        url.includes(word) ||
        title.includes(word)
    );


  return !blocked;
}


/*
|--------------------------------------------------------------------------
| Get Provider Tabs
|--------------------------------------------------------------------------
*/

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

      tabId:
        tab.id,

      windowId:
        tab.windowId,

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


/*
|--------------------------------------------------------------------------
| Get Active Provider Tab
|--------------------------------------------------------------------------
*/

async function getActiveProviderTab(
  provider
) {

  const tabs =
    await getProviderTabs();


  const providerTabs =
    tabs[provider] || [];


  if (
    providerTabs.length === 0
  ) {

    return null;
  }


  /*
   * Prefer active usable tab.
   */

  const activeTab =
    providerTabs.find(
      (tab) =>
        tab.active &&
        tab.usable
    );


  if (activeTab) {
    return activeTab;
  }


  /*
   * Otherwise first usable tab.
   */

  return (
    providerTabs.find(
      (tab) =>
        tab.usable
    ) || null
  );
}


/*
|--------------------------------------------------------------------------
| Connect To Bridge
|--------------------------------------------------------------------------
*/

function connectToBridge() {

  if (
    socket &&
    socket.readyState ===
      WebSocket.OPEN
  ) {

    return;
  }


  console.log(
    "Connecting to AI Window Bridge..."
  );


  socket =
    new WebSocket(
      WS_URL
    );


  socket.addEventListener(
    "open",
    () => {

      console.log(
        "Connected to AI Window Bridge"
      );


      clearReconnectTimer();


      sendSocketMessage({

        type:
          "extension_ready",
      });
    }
  );


  socket.addEventListener(
    "message",
    async (event) => {

      try {

        const message =
          JSON.parse(
            event.data
          );


        console.log(
          "Message from server:",
          message
        );


        await handleServerMessage(
          message
        );

      } catch (error) {

        console.error(
          "Failed to process server message:",
          error
        );
      }
    }
  );


  socket.addEventListener(
    "close",
    () => {

      console.log(
        "Disconnected from AI Window Bridge"
      );


      socket =
        null;


      scheduleReconnect();
    }
  );


  socket.addEventListener(
    "error",
    (error) => {

      console.error(
        "WebSocket error:",
        error
      );
    }
  );
}


/*
|--------------------------------------------------------------------------
| Reconnect
|--------------------------------------------------------------------------
*/

function scheduleReconnect() {

  if (reconnectTimer) {
    return;
  }


  reconnectTimer =
    setTimeout(
      () => {

        reconnectTimer =
          null;

        connectToBridge();

      },
      2000
    );
}


function clearReconnectTimer() {

  if (reconnectTimer) {

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer =
      null;
  }
}


/*
|--------------------------------------------------------------------------
| Send Socket Message
|--------------------------------------------------------------------------
*/

function sendSocketMessage(
  message
) {

  if (
    !socket ||
    socket.readyState !==
      WebSocket.OPEN
  ) {

    console.warn(
      "Bridge socket is not connected"
    );

    return false;
  }


  socket.send(
    JSON.stringify(
      message
    )
  );


  return true;
}


/*
|--------------------------------------------------------------------------
| Server Message Handler
|--------------------------------------------------------------------------
*/

async function handleServerMessage(
  message
) {

  switch (
    message.type
  ) {

    /*
     * ----------------------------------------------------
     * Chat Request
     * ----------------------------------------------------
     */

    case "chat_request":

      await handleChatRequest(
        message
      );

      break;


    /*
     * ----------------------------------------------------
     * Provider Changed
     * ----------------------------------------------------
     */

    case "provider_changed":

      if (
        PROVIDERS[
          message.provider
        ]
      ) {

        activeProvider =
          message.provider;


        console.log(
          "Active provider:",
          activeProvider
        );
      }

      break;


    /*
     * ----------------------------------------------------
     * Ping
     * ----------------------------------------------------
     */

    case "ping":

      sendSocketMessage({
        type:
          "pong",
      });

      break;


    default:

      console.log(
        "Unknown server message:",
        message
      );
  }
}


/*
|--------------------------------------------------------------------------
| Handle Chat Request
|--------------------------------------------------------------------------
*/

async function handleChatRequest(
  message
) {

  const requestId =
    message.requestId;


  if (!requestId) {

    console.error(
      "chat_request missing requestId"
    );

    return;
  }


  /*
   * Server provider takes priority.
   */

  const provider =
    message.provider ||
    activeProvider;


  /*
   * Check provider.
   */

  const providerConfig =
    PROVIDERS[provider];


  if (!providerConfig) {

    sendChatError(
      requestId,

      `Unknown provider: ${provider}`
    );

    return;
  }


  console.log(
    `Handling ${requestId} using ${provider}`
  );


  try {

    /*
     * Find browser tab.
     */

    const tab =
      await getActiveProviderTab(
        provider
      );


    if (!tab) {

      throw new Error(
        `No usable ${providerConfig.name} tab found.`
      );
    }


    console.log(
      `Using ${providerConfig.name} tab:`,
      tab
    );


    /*
     * Get provider handler.
     */

    const handler =
      providerConfig.handler();


    if (
      !handler ||
      typeof handler.sendMessage !==
        "function"
    ) {

      throw new Error(
        `${providerConfig.name} handler is not available.`
      );
    }


    /*
     * Send message to provider.
     */

    const content =
      await handler.sendMessage(
        tab.tabId,
        message.messages
      );


    /*
     * Send response back to server.
     */

    sendSocketMessage({

      type:
        "chat_response",

      requestId,

      content,
    });


  } catch (error) {

    console.error(
      `${providerConfig.name} request failed:`,
      error
    );


    sendChatError(
      requestId,

      error?.message ||
        `Failed to process ${providerConfig.name} request.`
    );
  }
}


/*
|--------------------------------------------------------------------------
| Chat Error
|--------------------------------------------------------------------------
*/

function sendChatError(
  requestId,
  error
) {

  sendSocketMessage({

    type:
      "chat_response",

    requestId,

    error:
      String(error),
  });
}


/*
|--------------------------------------------------------------------------
| Popup Messages
|--------------------------------------------------------------------------
*/

chrome.runtime.onMessage.addListener(
  (
    message,
    sender,
    sendResponse
  ) => {

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
            "Popup message error:",
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


/*
|--------------------------------------------------------------------------
| Popup Handler
|--------------------------------------------------------------------------
*/

async function handlePopupMessage(
  message,
  sender
) {

  switch (
    message.type
  ) {

    /*
     * ----------------------------------------------------
     * Status
     * ----------------------------------------------------
     */

    case "get_status": {

      const connected =
        socket &&
        socket.readyState ===
          WebSocket.OPEN;


      return {

        connected:
          Boolean(
            connected
          ),

        provider:
          activeProvider,
      };
    }


    /*
     * ----------------------------------------------------
     * Connect
     * ----------------------------------------------------
     */

    case "connect": {

      connectToBridge();


      return {
        success:
          true,
      };
    }


    /*
     * ----------------------------------------------------
     * Get Provider
     * ----------------------------------------------------
     */

    case "get_provider": {

      return {

        provider:
          activeProvider,
      };
    }


    /*
     * ----------------------------------------------------
     * Get Provider Tabs
     * ----------------------------------------------------
     */

    case "get_provider_tabs": {

      return await getProviderTabs();
    }


    /*
     * ----------------------------------------------------
     * Get Active Provider Tab
     * ----------------------------------------------------
     */

    case "get_active_provider_tab": {

      const provider =
        message.provider ||
        activeProvider;


      return await getActiveProviderTab(
        provider
      );
    }


    /*
     * ----------------------------------------------------
     * Set Provider
     * ----------------------------------------------------
     */

    case "set_provider": {

      const provider =
        message.provider;


      if (
        !PROVIDERS[provider]
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

        success:
          true,

        provider:
          activeProvider,
      };
    }


    default:

      throw new Error(
        `Unknown popup message type: ${message.type}`
      );
  }
}


/*
|--------------------------------------------------------------------------
| Tab Updated
|--------------------------------------------------------------------------
*/

chrome.tabs.onUpdated.addListener(
  async (
    tabId,
    changeInfo,
    tab
  ) => {

    if (
      changeInfo.status !==
      "complete"
    ) {

      return;
    }


    const provider =
      detectProviderFromUrl(
        tab.url
      );


    if (!provider) {
      return;
    }


    console.log(
      `Provider tab updated: ${provider}`,
      {
        tabId,

        title:
          tab.title,

        url:
          tab.url,
      }
    );
  }
);


/*
|--------------------------------------------------------------------------
| Tab Removed
|--------------------------------------------------------------------------
*/

chrome.tabs.onRemoved.addListener(
  (tabId) => {

    console.log(
      `Tab removed: ${tabId}`
    );
  }
);


/*
|--------------------------------------------------------------------------
| Startup
|--------------------------------------------------------------------------
*/

connectToBridge();