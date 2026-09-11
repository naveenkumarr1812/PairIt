const ChatGPTProvider = {
  name: "chatgpt",

  async sendMessage(tabId, messages) {
    const results =
      await chrome.scripting.executeScript({
        target: {
          tabId,
        },

        func: chatGPTPageHandler,

        args: [
          messages,
        ],
      });

    return parseProviderResult(
      results,
      "ChatGPT"
    );
  },
};


/*
|--------------------------------------------------------------------------
| ChatGPT Page Handler
|--------------------------------------------------------------------------
|
| This function executes inside the ChatGPT tab.
|
*/

async function chatGPTPageHandler(
  messages
) {
  const lastUserMessage =
    [...(messages || [])]
      .reverse()
      .find(
        (message) =>
          message.role === "user"
      );

  if (!lastUserMessage) {
    return {
      error:
        "No user message found.",
    };
  }

  const text =
    String(
      lastUserMessage.content || ""
    );


  /*
   * Find composer.
   */

  const composer =
    document.querySelector(
      "#prompt-textarea"
    ) ||
    document.querySelector(
      '[contenteditable="true"]'
    ) ||
    document.querySelector(
      "textarea"
    );


  if (!composer) {
    return {
      error:
        "ChatGPT composer not found. Make sure a normal ChatGPT conversation is open.",
    };
  }


  /*
   * Get existing assistant messages
   * before sending.
   */

  const beforeMessages =
    getChatGPTMessages();


  /*
   * Focus composer.
   */

  composer.focus();


  /*
   * Put text into composer.
   */

  setComposerValue(
    composer,
    text
  );


  /*
   * Give React/UI time to process
   * the input event.
   */

  await sleep(500);


  /*
   * Find send button.
   */

  const sendButton =
    document.querySelector(
      'button[data-testid="send-button"]'
    ) ||
    document.querySelector(
      'button[aria-label*="Send"]'
    ) ||
    document.querySelector(
      'button[aria-label*="send"]'
    );


  if (!sendButton) {
    return {
      error:
        "ChatGPT send button not found.",
    };
  }


  /*
   * Send message.
   */

  sendButton.click();


  /*
   * Wait for a new assistant response.
   */

  const response =
    await waitForResponse(
      getChatGPTMessages,
      beforeMessages
    );


  if (!response) {
    return {
      error:
        "Timed out waiting for ChatGPT response.",
    };
  }


  return {
    content:
      response,
  };
}


/*
|--------------------------------------------------------------------------
| Get ChatGPT Messages
|--------------------------------------------------------------------------
*/

function getChatGPTMessages() {

  const elements =
    document.querySelectorAll(
      '[data-message-author-role="assistant"]'
    );


  return Array.from(
    elements
  );
}


/*
|--------------------------------------------------------------------------
| Set Composer Value
|--------------------------------------------------------------------------
*/

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
        bubbles:
          true,

        inputType:
          "insertText",

        data:
          text,
      }
    )
  );
}


/*
|--------------------------------------------------------------------------
| Wait For Response
|--------------------------------------------------------------------------
*/

async function waitForResponse(
  getMessages,
  beforeMessages
) {

  const timeout =
    120_000;

  const start =
    Date.now();


  while (
    Date.now() - start <
    timeout
  ) {

    const currentMessages =
      getMessages();


    /*
     * New assistant message appeared.
     */

    if (
      currentMessages.length >
      beforeMessages.length
    ) {

      const latest =
        currentMessages[
          currentMessages.length - 1
        ];


      const text =
        latest?.innerText?.trim();


      if (text) {

        /*
         * Wait for streaming to settle.
         */

        const stableText =
          await waitForStableText(
            latest
          );


        if (stableText) {
          return stableText;
        }
      }
    }


    await sleep(1000);
  }


  return null;
}


/*
|--------------------------------------------------------------------------
| Wait Until Text Stops Changing
|--------------------------------------------------------------------------
*/

async function waitForStableText(
  element
) {

  let previous =
    element?.innerText?.trim() || "";


  if (!previous) {
    return null;
  }


  let stableChecks =
    0;


  const maxChecks =
    10;


  while (
    stableChecks <
    maxChecks
  ) {

    await sleep(1000);


    const current =
      element?.innerText?.trim() || "";


    if (
      current &&
      current === previous
    ) {

      stableChecks++;

    } else {

      stableChecks =
        0;

      previous =
        current;
    }
  }


  return previous || null;
}


/*
|--------------------------------------------------------------------------
| Parse Provider Result
|--------------------------------------------------------------------------
*/

function parseProviderResult(
  results,
  providerName
) {

  if (
    !results ||
    results.length === 0
  ) {

    throw new Error(
      `${providerName} returned no result.`
    );
  }


  const result =
    results[0].result;


  if (!result) {

    throw new Error(
      `${providerName} returned an empty result.`
    );
  }


  if (result.error) {

    throw new Error(
      result.error
    );
  }


  return result.content;
}


/*
|--------------------------------------------------------------------------
| Sleep
|--------------------------------------------------------------------------
*/

function sleep(ms) {

  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms
      );
    }
  );
}