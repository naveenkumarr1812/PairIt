// ====================================================================
// PairIt Minimal Popup Controller
// ====================================================================

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const statelessListEl = document.getElementById("stateless-list");
const storageUsedEl = document.getElementById("storage-used");
const storageCountEl = document.getElementById("storage-count");
const runtimeBadgeEl = document.getElementById("runtime-badge");
const runtimeDescEl = document.getElementById("runtime-desc");
const errorEl = document.getElementById("error");

// Views & Navigation
const viewMain = document.getElementById("view-main");
const viewSettings = document.getElementById("view-settings");
const btnSettings = document.getElementById("btn-settings");
const btnSettingsBack = document.getElementById("btn-settings-back");

// Tabs & Filters
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanes = document.querySelectorAll(".tab-pane");
const pillBtns = document.querySelectorAll(".pill-btn");

// Stateful Provider Elements
const stateChatGPT = document.getElementById("state-chatgpt");
const stateClaude = document.getElementById("state-claude");
const stateGemini = document.getElementById("state-gemini");
const btnOpenChatGPT = document.getElementById("btn-open-chatgpt");
const btnOpenClaude = document.getElementById("btn-open-claude");
const btnOpenGemini = document.getElementById("btn-open-gemini");

// Model Details Modal Elements
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const modalDesc = document.getElementById("modal-desc");
const modalCaps = document.getElementById("modal-caps");
const modalSource = document.getElementById("modal-source");
const modalLicense = document.getElementById("modal-license");
const modalRuntime = document.getElementById("modal-runtime");
const modalClose = document.getElementById("modal-close");

// State
let activeFilter = "all";
let cachedModels = [];
const modelCardDomMap = new Map(); // modelId -> { cardEl, elements }
let isUpdating = false;

// --------------------------------------------------------------------
// Messaging & Formatting Helpers
// --------------------------------------------------------------------
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

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function showError(msg) {
  if (!msg) {
    errorEl.style.display = "none";
    errorEl.textContent = "";
    return;
  }
  errorEl.style.display = "block";
  errorEl.textContent = msg;
}

// --------------------------------------------------------------------
// View Navigation (Main vs Settings)
// --------------------------------------------------------------------
function showView(viewName) {
  if (viewName === "settings") {
    viewMain.classList.remove("active");
    viewSettings.classList.add("active");
    btnSettings.classList.add("active");
  } else {
    viewSettings.classList.remove("active");
    viewMain.classList.add("active");
    btnSettings.classList.remove("active");
  }
}

if (btnSettings) {
  btnSettings.addEventListener("click", () => {
    const isSettingsActive = viewSettings.classList.contains("active");
    showView(isSettingsActive ? "main" : "settings");
  });
}

if (btnSettingsBack) {
  btnSettingsBack.addEventListener("click", () => {
    showView("main");
  });
}

const btnPopout = document.getElementById("btn-popout");

// Check if running in standalone window or side panel
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("mode") === "window" || window.innerWidth > 400) {
  document.body.classList.add("standalone");
  if (btnPopout) {
    btnPopout.style.display = "none";
  }
}

if (btnPopout) {
  btnPopout.addEventListener("click", () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?mode=window"),
      type: "popup",
      width: 380,
      height: 640,
      focused: true,
    });
    window.close();
  });
}

// --------------------------------------------------------------------
// Tab Navigation & Category Filtering
// --------------------------------------------------------------------
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanes.forEach((p) => p.classList.remove("active"));

    btn.classList.add("active");
    const targetPane = document.getElementById(btn.dataset.tab);
    if (targetPane) {
      targetPane.classList.add("active");
    }
  });
});

pillBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    pillBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    applyFilter();
  });
});

function applyFilter() {
  for (const [modelId, dom] of modelCardDomMap.entries()) {
    const model = cachedModels.find((m) => m.id === modelId);
    if (!model) continue;

    const cat = (model.category || "llm").toLowerCase();
    const isVisible = activeFilter === "all" || cat === activeFilter;
    dom.cardEl.style.display = isVisible ? "flex" : "none";
  }
}

// --------------------------------------------------------------------
// Stateful Providers
// --------------------------------------------------------------------
function renderProviders(providers = {}) {
  const checkTab = (name, el) => {
    const tabs = providers[name] || [];
    const open = tabs.some((t) => t.usable);
    if (open) {
      el.className = "open";
      el.textContent = "Open ✓";
    } else {
      el.className = "closed";
      el.textContent = "Not open";
    }
  };

  checkTab("chatgpt", stateChatGPT);
  checkTab("claude", stateClaude);
  checkTab("gemini", stateGemini);
}

btnOpenChatGPT.addEventListener("click", () => chrome.tabs.create({ url: "https://chatgpt.com/" }));
btnOpenClaude.addEventListener("click", () => chrome.tabs.create({ url: "https://claude.ai/" }));
btnOpenGemini.addEventListener("click", () => chrome.tabs.create({ url: "https://gemini.google.com/" }));

// --------------------------------------------------------------------
// In-Place Stateless Cards Rendering (Smooth Steady Progress)
// --------------------------------------------------------------------
function createModelCard(model) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.dataset.modelId = model.id;

  const totalSize = formatBytes(model.totalBytes);

  card.innerHTML = `
    <div class="model-card-header">
      <div class="model-title-wrap">
        <span class="model-name">${model.displayName || model.id}</span>
        <button class="btn-copy-model" data-model-id="${model.id}" title="Click to copy '${model.id}' for client('${model.id}')">
          <svg class="copy-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="copy-id-text">${model.id}</span>
          <span class="copy-pill-badge">Copy</span>
        </button>
      </div>
      <span class="model-badge">${(model.category || "llm").toUpperCase()}</span>
    </div>

    <div class="model-meta">
      <span>Download: ~${totalSize}</span>
      <span>License: ${model.license?.name || model.license || "Apache-2.0"}</span>
    </div>

    <!-- Smooth Progress Bar -->
    <div class="progress-section">
      <div class="progress-info">
        <span class="progress-label">Downloading...</span>
        <span class="progress-percent">0%</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill"></div>
      </div>
    </div>

    <div class="model-status-row">
      <span class="status-badge status-available">Available</span>
      <div class="actions-wrap">
        <button class="btn-sm btn-details">Details</button>
        <button class="btn-sm primary btn-action">Download</button>
      </div>
    </div>
  `;

  const elements = {
    cardEl: card,
    progressSection: card.querySelector(".progress-section"),
    progressLabel: card.querySelector(".progress-label"),
    progressPercent: card.querySelector(".progress-percent"),
    progressBarFill: card.querySelector(".progress-bar-fill"),
    statusBadge: card.querySelector(".status-badge"),
    btnDetails: card.querySelector(".btn-details"),
    btnAction: card.querySelector(".btn-action"),
  };

  elements.btnDetails.addEventListener("click", () => showDetailsModal(model));

  // Copy model ID for client("model")
  const btnCopy = card.querySelector(".btn-copy-model");
  if (btnCopy) {
    btnCopy.addEventListener("click", async (e) => {
      e.stopPropagation();
      const textToCopy = model.id;
      let copied = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
          copied = true;
        }
      } catch (_) { }

      if (!copied) {
        try {
          const ta = document.createElement("textarea");
          ta.value = textToCopy;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          copied = true;
        } catch (_) { }
      }

      btnCopy.classList.add("copied");
      const badge = btnCopy.querySelector(".copy-pill-badge");
      const icon = btnCopy.querySelector(".copy-icon");
      if (badge) badge.textContent = "Copied! ✓";
      if (icon) {
        icon.innerHTML = `<polyline points="20 6 9 17 4 12"></polyline>`;
      }

      setTimeout(() => {
        btnCopy.classList.remove("copied");
        if (badge) badge.textContent = "Copy";
        if (icon) {
          icon.innerHTML = `
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          `;
        }
      }, 1500);
    });
  }

  modelCardDomMap.set(model.id, elements);
  statelessListEl.appendChild(card);
  return elements;
}

function updateModelCardDom(model) {
  let dom = modelCardDomMap.get(model.id);
  if (!dom) {
    dom = createModelCard(model);
  }

  const isReady = Boolean(model.ready || model.status === "READY");
  const isDownloading = model.status === "DOWNLOADING" || model.status === "VERIFYING";
  const isFailed = model.status === "FAILED";

  // 1. Progress Bar Update (Constant, Smooth In-Place)
  if (isDownloading) {
    dom.progressSection.classList.add("visible");
    const pct = Math.min(100, Math.max(0, model.progress || 0));
    dom.progressBarFill.style.width = `${pct}%`;
    dom.progressPercent.textContent = `${pct}%`;
    dom.progressLabel.textContent =
      model.status === "VERIFYING"
        ? "Verifying checksums..."
        : `Downloading (${formatBytes(model.downloadedBytes || 0)} / ${formatBytes(model.totalBytes || 0)})`;
  } else {
    dom.progressSection.classList.remove("visible");
  }

  // 2. Status Label & Action Buttons
  const actionBtn = dom.btnAction;
  actionBtn.disabled = false;

  if (isReady) {
    dom.statusBadge.className = "status-badge status-ready";
    dom.statusBadge.textContent = `Downloaded ✓ (${formatBytes(model.downloadedBytes || model.totalBytes)})`;
    actionBtn.className = "btn-sm btn-danger";
    actionBtn.textContent = "Delete";
    actionBtn.onclick = async () => {
      // Optimistic instant cancel/delete UI update
      model.status = "NOT_INSTALLED";
      model.progress = 0;
      model.ready = false;
      model.downloadedBytes = 0;
      updateModelCardDom(model);

      try {
        await send({ type: "delete_stateless_model", modelId: model.id });
        await refresh();
      } catch (err) {
        showError(err.message);
      }
    };
  } else if (isDownloading) {
    dom.statusBadge.className = "status-badge status-downloading";
    dom.statusBadge.textContent = `${model.status === "VERIFYING" ? "Verifying..." : "Downloading..."} ${model.progress || 0}%`;
    actionBtn.className = "btn-sm btn-danger";
    actionBtn.textContent = "Cancel";
    actionBtn.onclick = async () => {
      // Optimistic instant cancel UI update
      model.status = "NOT_INSTALLED";
      model.progress = 0;
      model.ready = false;
      model.downloadedBytes = 0;
      updateModelCardDom(model);

      try {
        await send({ type: "cancel_stateless_download", modelId: model.id });
        await refresh();
      } catch (err) {
        showError(err.message);
      }
    };
  } else if (isFailed) {
    dom.statusBadge.className = "status-badge";
    dom.statusBadge.style.color = "var(--danger)";
    dom.statusBadge.textContent = "Download failed";
    actionBtn.className = "btn-sm primary";
    actionBtn.textContent = "Download";
    actionBtn.onclick = async () => {
      model.status = "DOWNLOADING";
      model.progress = 0;
      updateModelCardDom(model);

      try {
        await send({ type: "download_stateless_model", modelId: model.id });
        await refresh();
      } catch (err) {
        showError(err.message);
      }
    };
  } else {
    dom.statusBadge.className = "status-badge status-available";
    dom.statusBadge.textContent = "Available";
    actionBtn.className = "btn-sm primary";
    actionBtn.textContent = "Download";
    actionBtn.onclick = async () => {
      model.status = "DOWNLOADING";
      model.progress = 0;
      updateModelCardDom(model);

      try {
        await send({ type: "download_stateless_model", modelId: model.id });
        await refresh();
      } catch (err) {
        showError(err.message);
      }
    };
  }
}

function renderStatelessModels(models = []) {
  for (const model of models) {
    const existing = cachedModels.find((m) => m.id === model.id);
    if (existing && (existing.status === "DOWNLOADING" || existing.status === "VERIFYING") && model.status === "DOWNLOADING") {
      if ((existing.progress || 0) > (model.progress || 0)) {
        model.progress = existing.progress;
        model.downloadedBytes = Math.max(model.downloadedBytes || 0, existing.downloadedBytes || 0);
      }
    }
  }

  cachedModels = models;

  const currentModelIds = new Set(models.map((m) => m.id));
  for (const [id, dom] of modelCardDomMap.entries()) {
    if (!currentModelIds.has(id)) {
      dom.cardEl.remove();
      modelCardDomMap.delete(id);
    }
  }

  for (const model of models) {
    updateModelCardDom(model);
  }

  applyFilter();
}

// --------------------------------------------------------------------
// Details Modal
// --------------------------------------------------------------------
function showDetailsModal(model) {
  modalTitle.textContent = `${model.displayName || model.id}`;
  modalDesc.textContent = model.description || "Local inference model.";
  modalCaps.textContent = `Category: ${(model.category || "llm").toUpperCase()} | Operations: ${(model.capabilities || []).join(", ")}`;
  modalSource.textContent = `${model.source?.repository || model.id} @ ${model.source?.revision ? model.source.revision.slice(0, 10) : "pinned"}`;
  modalLicense.textContent = `License: ${model.license?.name || model.license || "Apache-2.0"}`;
  modalRuntime.innerHTML = `
    Pipeline: <code>${model.runtime?.pipeline || "text-generation"}</code><br>
    Quantization: <code>${model.runtime?.dtype || "q4"}</code><br>
    Storage: <code>/stateless/${model.id}/</code><br><br>
    <div style="padding: 8px 10px; background: rgba(127,127,127,0.12); border-radius: 6px; border: 1px solid rgba(127,127,127,0.2);">
      <div style="font-size: 10px; opacity: 0.75; font-weight: 600; margin-bottom: 4px;">PYTHON CLIENT USAGE:</div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <code style="font-size: 11.5px; font-weight: 600; color: var(--accent);">client = Client("${model.id}")</code>
        <button id="btn-modal-copy-id" class="btn-sm primary" style="padding: 3px 8px; font-size: 10.5px;">Copy</button>
      </div>
    </div>
  `;
  modalOverlay.style.display = "flex";

  const btnModalCopy = document.getElementById("btn-modal-copy-id");
  if (btnModalCopy) {
    btnModalCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(model.id);
      } catch (_) { }
      btnModalCopy.textContent = "Copied! ✓";
      setTimeout(() => {
        if (btnModalCopy) btnModalCopy.textContent = "Copy";
      }, 1500);
    });
  }
}

modalClose.addEventListener("click", () => {
  modalOverlay.style.display = "none";
});

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.style.display = "none";
  }
});

// --------------------------------------------------------------------
// Overall Status & Main Refresh Loop
// --------------------------------------------------------------------
function render(status) {
  showError(null);

  if (!status.enabled) {
    statusEl.innerHTML =
      "<strong>PairIt is off</strong>Turn it on when you want your local development environment connected.";
    toggleEl.textContent = "Turn PairIt on";
    renderProviders(status.providers);
    return;
  }

  if (status.connected) {
    statusEl.innerHTML =
      "<strong>PairIt is connected</strong>Your local development environment is connected to this extension.";
    toggleEl.textContent = "Turn PairIt off";
  } else {
    const connectionError = status.connectionError
      ? `<br><small>${status.connectionError}</small>`
      : "";
    statusEl.innerHTML =
      `<strong>PairIt is on</strong>Waiting for local development bridge. PairIt will keep trying to connect.${connectionError}`;
    toggleEl.textContent = "Turn PairIt off";
  }

  renderProviders(status.providers);
}

async function refresh() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const status = await send({ type: "get_status" });
    render(status);

    const [statelessModels, storageInfo, backend] = await Promise.all([
      send({ type: "get_stateless_models" }),
      send({ type: "get_stateless_storage" }),
      send({ type: "get_runtime_backend" }),
    ]);

    if (Array.isArray(statelessModels)) {
      renderStatelessModels(statelessModels);
    }

    if (storageInfo) {
      if (storageUsedEl) storageUsedEl.textContent = storageInfo.formattedUsage || "0 MB";
      if (storageCountEl) storageCountEl.textContent = storageInfo.installedCount || 0;
    }

    if (backend) {
      if (runtimeBadgeEl) runtimeBadgeEl.textContent = backend.webgpu ? "WebGPU ✓" : "CPU (WASM)";
      if (runtimeDescEl) runtimeDescEl.textContent = backend.webgpu ? "WebGPU (Hardware Accelerated)" : "WASM SIMD Multithreaded (CPU)";
    }
  } catch (error) {
    showError(error.message);
  } finally {
    isUpdating = false;
  }
}

// Master Toggle
toggleEl.addEventListener("click", async () => {
  toggleEl.disabled = true;
  showError(null);

  try {
    const current = await send({ type: "get_status" });
    const status = await send({
      type: "set_enabled",
      enabled: !current.enabled,
    });
    render(status);
    await refresh();
  } catch (error) {
    showError(error.message);
  } finally {
    toggleEl.disabled = false;
  }
});

// Real-Time Progress Broadcast (Direct In-Place without DOM wipes)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "stateless_progress") {
    const { modelId, progress } = message;
    let model = cachedModels.find((m) => m.id === modelId);
    if (!model) {
      model = { id: modelId };
      cachedModels.push(model);
    }
    model.status = progress.status;
    model.progress = progress.percent;
    model.downloadedBytes = progress.downloadedBytes;
    model.totalBytes = progress.totalBytes || model.totalBytes;
    model.ready = progress.status === "READY";
    updateModelCardDom(model);
  }
});

refresh();
setInterval(refresh, 2000);
