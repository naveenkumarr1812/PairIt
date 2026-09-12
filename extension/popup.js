const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const providerEl = document.getElementById("provider");
const providersEl = document.getElementById("providers");
const errorEl = document.getElementById("error");

const PROVIDER_NAMES = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
};

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.error) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

function renderProviders(providers = {}) {
  providersEl.innerHTML = "";

  for (const provider of ["chatgpt", "claude", "gemini"]) {
    const tabs = providers[provider] || [];
    const open = tabs.some((tab) => tab.usable);

    const row = document.createElement("div");
    row.className = `provider ${open ? "open" : "closed"}`;

    const name = document.createElement("span");
    name.textContent = PROVIDER_NAMES[provider];

    const state = document.createElement("span");
    state.textContent = open ? "Open" : "Not open";

    row.append(name, state);
    providersEl.appendChild(row);
  }
}

function render(status) {
  errorEl.textContent = "";
  providerEl.value = status.provider || "chatgpt";

  if (!status.enabled) {
    statusEl.innerHTML =
      "<strong>PAIR is off</strong>Turn it on to connect this browser session to the local development bridge.";
    toggleEl.textContent = "Turn PAIR on";
    renderProviders(status.providers);
    return;
  }

  if (status.connected) {
    statusEl.innerHTML =
      "<strong>PAIR is connected</strong>Your local development environment is connected to this extension.";
    toggleEl.textContent = "Turn PAIR off";
  } else {
    const connectionError = status.connectionError
      ? `<br><small>${status.connectionError}</small>`
      : "";
    statusEl.innerHTML =
      `<strong>PAIR is on</strong>Waiting for the local development bridge. PAIR will keep trying to connect.${connectionError}`;
    toggleEl.textContent = "Turn PAIR off";
  }

  renderProviders(status.providers);
}

async function refresh() {
  try {
    const status = await send({ type: "get_status" });
    render(status);
  } catch (error) {
    errorEl.textContent = error.message;
  }
}

toggleEl.addEventListener("click", async () => {
  toggleEl.disabled = true;
  errorEl.textContent = "";

  try {
    const status = await send({
      type: "set_enabled",
      enabled: !(await send({ type: "get_status" })).enabled,
    });
    render(status);
  } catch (error) {
    errorEl.textContent = error.message;
  } finally {
    toggleEl.disabled = false;
  }
});

providerEl.addEventListener("change", async () => {
  try {
    await send({
      type: "set_provider",
      provider: providerEl.value,
    });
    await refresh();
  } catch (error) {
    errorEl.textContent = error.message;
  }
});

refresh();
setInterval(refresh, 1000);
