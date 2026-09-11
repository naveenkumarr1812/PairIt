const statusElement =
  document.getElementById(
    "status"
  );


const saveButton =
  document.getElementById(
    "saveBtn"
  );


const messageElement =
  document.getElementById(
    "message"
  );


const providerInputs =
  document.querySelectorAll(
    'input[name="provider"]'
  );


/*
|--------------------------------------------------------------------------
| Get Background Status
|--------------------------------------------------------------------------
*/

async function getStatus() {

  return new Promise(
    (resolve) => {

      chrome.runtime.sendMessage(
        {
          type:
            "get_status",
        },

        (response) => {

          if (
            chrome.runtime.lastError
          ) {

            resolve(null);

            return;
          }


          resolve(
            response
          );
        }
      );
    }
  );
}


/*
|--------------------------------------------------------------------------
| Update UI
|--------------------------------------------------------------------------
*/

async function updateUI() {

  const status =
    await getStatus();


  if (!status) {

    statusElement.textContent =
      "Bridge unavailable ❌";

    return;
  }


  statusElement.textContent =
    status.connected
      ? "Connected ✅"
      : "Disconnected ❌";


  providerInputs.forEach(
    (input) => {

      input.checked =
        input.value ===
        status.provider;
    }
  );
}


/*
|--------------------------------------------------------------------------
| Save Provider
|--------------------------------------------------------------------------
*/

async function saveProvider() {

  const selected =
    document.querySelector(
      'input[name="provider"]:checked'
    );


  if (!selected) {

    messageElement.textContent =
      "Please select a provider.";

    return;
  }


  const provider =
    selected.value;


  try {

    /*
     * Update local/server provider.
     */

    const response =
      await fetch(
        "http://127.0.0.1:8765/v1/provider",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              provider,
            }),
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
          "Failed to change provider."
      );
    }


    messageElement.textContent =
      `Active provider: ${data.active}`;


    await updateUI();

  } catch (error) {

    messageElement.textContent =
      error?.message ||
      "Unable to connect to bridge.";
  }
}


/*
|--------------------------------------------------------------------------
| Events
|--------------------------------------------------------------------------
*/

saveButton.addEventListener(
  "click",
  saveProvider
);


/*
|--------------------------------------------------------------------------
| Initial UI
|--------------------------------------------------------------------------
*/

updateUI();