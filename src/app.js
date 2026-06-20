const ROW_HEIGHT = 76;
const OVERSCAN = 6;
const DENSITY_BUCKETS = 44;
const SEARCH_LIMIT = 4000;
const SAMPLE_FILE = "./examples/sample.jsonl";
const SAMPLE_NAME = "sample.jsonl";
const ASSET_VERSION = "20260619-clear";
const EMPTY_FILE_NAME = "No file loaded";

const state = {
  ready: false,
  busy: false,
  rowCount: 0,
  selected: -1,
  rows: new Map(),
  tab: "summary",
  matches: null,
  query: "",
  fileName: EMPTY_FILE_NAME,
  fileSize: 0,
  indexTime: 0,
};

let worker = null;
let requestId = 0;
let renderScheduled = false;
let searchTimer = 0;
let searchToken = 0;

const pending = new Map();

const els = {
  engine: document.getElementById("engine"),
  fileInput: document.getElementById("fileInput"),
  loadSample: document.getElementById("loadSample"),
  clearFile: document.getElementById("clearFile"),
  themeToggle: document.getElementById("themeToggle"),
  currentFileName: document.getElementById("currentFileName"),
  statFileSize: document.getElementById("statFileSize"),
  statRows: document.getElementById("statRows"),
  statIndexTime: document.getElementById("statIndexTime"),
  searchInput: document.getElementById("searchInput"),
  clearSearch: document.getElementById("clearSearch"),
  density: document.getElementById("density"),
  densityBars: document.getElementById("densityBars"),
  densityEnd: document.getElementById("densityEnd"),
  status: document.getElementById("status"),
  list: document.getElementById("list"),
  spacer: document.getElementById("spacer"),
  rows: document.getElementById("rows"),
  jumpInput: document.getElementById("jumpInput"),
  lineLabel: document.getElementById("lineLabel"),
  domainLabel: document.getElementById("domainLabel"),
  rowTitle: document.getElementById("rowTitle"),
  prevRow: document.getElementById("prevRow"),
  nextRow: document.getElementById("nextRow"),
  tabs: document.querySelector(".tabs"),
  detail: document.getElementById("detail"),
};

initTheme();

try {
  worker = new Worker(new URL(`./worker.js?v=${ASSET_VERSION}`, import.meta.url), {
    type: "module",
  });
} catch (_error) {
  showFatal(
    "This browser blocked the worker. Serve the app from http://localhost:8765/index.html instead of opening index.html directly."
  );
}

function callWorker(type, payload = {}, transfer) {
  if (!worker) {
    return Promise.reject(new Error("Worker unavailable. Open http://localhost:8765/index.html."));
  }

  const id = ++requestId;
  worker.postMessage({ id, type, ...payload }, transfer || []);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

if (worker) {
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error));
      else resolve(message);
      return;
    }

    if (message.type === "ready") {
      state.ready = true;
      els.engine.textContent = message.wasm
        ? "Rust/WASM scanner active"
        : "JS scanner fallback active";
    }

    if (message.type === "progress") {
      setStatus(
        `Indexing ${formatNumber(message.lines)} rows · ${formatBytes(message.bytes)} scanned`
      );
      els.statRows.textContent = `${formatNumber(message.lines)} rows`;
    }

    if (message.type === "search-progress") {
      setStatus(
        `Searching line ${formatNumber(message.line)} · ${formatNumber(message.matches)} matches`
      );
    }
  };

  worker.onerror = (event) => {
    const message = event.message || "The worker crashed while processing the file.";
    rejectPending(message);
    showFatal(message);
  };

  worker.onmessageerror = () => {
    const message = "The browser could not pass data to the worker.";
    rejectPending(message);
    showFatal(message);
  };
}

function initTheme() {
  const saved = localStorage.getItem("giant-jsonl-theme");
  const preferred =
    saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(preferred);
}

function setTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("giant-jsonl-theme", next);
  els.themeToggle.textContent = next === "dark" ? "Light mode" : "Dark mode";
}

function rejectPending(message) {
  for (const { reject } of pending.values()) {
    reject(new Error(message));
  }
  pending.clear();
}

function showFatal(message) {
  els.engine.textContent = "Worker blocked";
  setStatus(message);
  els.rowTitle.textContent = "Cannot start worker";
  els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(message)}</span></div>`;
  els.fileInput.disabled = true;
  els.loadSample.disabled = true;
  els.clearFile.disabled = true;
}

function setStatus(message) {
  els.status.textContent = message;
}

function setBusy(isBusy, message) {
  state.busy = isBusy;
  updateControls();
  if (message) setStatus(message);
}

function updateControls() {
  const hasFile = state.fileName !== EMPTY_FILE_NAME;
  els.fileInput.disabled = state.busy;
  els.loadSample.disabled = state.busy;
  els.clearFile.disabled = state.busy || !hasFile;
}

function updateMeta() {
  els.currentFileName.textContent = state.fileName;
  els.statFileSize.textContent = formatBytes(state.fileSize);
  els.statRows.textContent = `${formatNumber(state.rowCount)} rows`;
  els.statIndexTime.textContent = `indexed ${Math.round(state.indexTime)} ms`;
  els.densityEnd.textContent = `line ${formatNumber(state.rowCount)}`;
  els.jumpInput.max = String(state.rowCount || 1);
  updateControls();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlighted(value) {
  const safe = escapeHtml(value);
  if (!state.query) return safe;
  return safe.replace(new RegExp(escapeRegExp(escapeHtml(state.query)), "ig"), (match) => {
    return `<mark>${match}</mark>`;
  });
}

async function openFile(file) {
  searchToken++;
  if (worker) worker.postMessage({ type: "cancel-search" });
  setBusy(true, "Starting byte-offset index");
  state.rows.clear();
  state.rowCount = 0;
  state.selected = -1;
  state.matches = null;
  state.query = "";
  state.fileName = file.name;
  state.fileSize = file.size;
  state.indexTime = 0;
  els.searchInput.value = "";
  els.clearSearch.hidden = true;
  els.density.hidden = true;
  els.spacer.style.height = "0px";
  els.rows.innerHTML = "";
  updateMeta();
  renderEmpty("Indexing file", "Line starts are being indexed in a worker.");

  try {
    const result = await callWorker("open-file", { file });
    state.rowCount = result.rowCount;
    state.indexTime = result.elapsed;
    updateMeta();
    setStatus(
      `${formatNumber(result.rowCount)} rows · indexed in ${Math.round(result.elapsed)} ms`
    );
    els.spacer.style.height = `${result.rowCount * ROW_HEIGHT}px`;

    if (result.rowCount) {
      await selectLine(0, true);
    } else {
      renderEmpty("Empty file", "This file has no JSONL rows.");
    }

    scheduleRenderRows();
  } finally {
    setBusy(false);
  }
}

async function loadSample() {
  const response = await fetch(SAMPLE_FILE, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not fetch sample: ${response.status}`);
  const blob = await response.blob();
  await openFile(new File([blob], SAMPLE_NAME, { type: "application/jsonl" }));
}

async function clearCurrentFile() {
  searchToken++;
  window.clearTimeout(searchTimer);
  if (worker) {
    worker.postMessage({ type: "cancel-search" });
    await callWorker("clear-file");
  }

  state.rows.clear();
  state.rowCount = 0;
  state.selected = -1;
  state.matches = null;
  state.query = "";
  state.fileName = EMPTY_FILE_NAME;
  state.fileSize = 0;
  state.indexTime = 0;
  els.fileInput.value = "";
  els.searchInput.value = "";
  els.clearSearch.hidden = true;
  els.density.hidden = true;
  els.spacer.style.height = "0px";
  els.rows.innerHTML = "";
  els.list.scrollTop = 0;
  els.jumpInput.value = "1";
  updateMeta();
  setStatus("Open a JSONL file or load the sample.");
  renderEmpty(
    "Open a JSONL file or load the sample",
    "Files stay in this browser. Nothing is indexed until you choose a file or press Load sample."
  );
}

function visibleTotal() {
  return state.matches ? state.matches.list.length : state.rowCount;
}

function sourceLineAt(displayIndex) {
  return state.matches ? state.matches.list[displayIndex] : displayIndex;
}

function displayIndexForLine(line) {
  return state.matches ? state.matches.list.indexOf(line) : line;
}

function visibleRange() {
  const total = visibleTotal();
  const start = Math.max(0, Math.floor(els.list.scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visible = Math.ceil(els.list.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
  return { start, count: Math.min(visible, Math.max(0, total - start)), total };
}

async function renderRows() {
  renderScheduled = false;
  const { start, count, total } = visibleRange();
  els.spacer.style.height = `${total * ROW_HEIGHT}px`;

  if (!count) {
    els.rows.innerHTML = "";
    return;
  }

  const displayIndexes = Array.from({ length: count }, (_, i) => start + i);
  const missing = displayIndexes
    .map((displayIndex) => sourceLineAt(displayIndex))
    .filter((line) => line != null && !state.rows.has(line));

  if (missing.length) {
    try {
      const fetched = await callWorker("rows", { lines: missing });
      for (const row of fetched.rows) {
        state.rows.set(row.index, { ...(state.rows.get(row.index) || {}), ...row });
      }
    } catch (error) {
      setStatus(`Could not load visible rows: ${error.message}`);
      els.rows.innerHTML = "";
      return;
    }
  }

  els.rows.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
  els.rows.innerHTML = displayIndexes
    .map((displayIndex) => {
      const line = sourceLineAt(displayIndex);
      const row = state.rows.get(line);
      const active = line === state.selected ? " active" : "";
      const title = row?.title || "Loading row";
      const bytes = row?.bytes ? formatBytes(row.bytes) : "";
      const chips = row?.chips || [];
      return `
        <div class="row${active}" role="button" tabindex="-1" style="top:${(displayIndex - start) * ROW_HEIGHT}px" data-line="${line}">
          <span class="row-index-label">
            <strong>#${formatNumber(line + 1)}</strong>
            <small>${escapeHtml(bytes)}</small>
          </span>
          <span class="row-main">
            <span class="row-title">${highlighted(title)}</span>
            <span class="chips">${chips
              .slice(0, 5)
              .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
              .join("")}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function scheduleRenderRows() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(renderRows);
}

async function selectLine(line, scrollIntoView = false) {
  if (line < 0 || line >= state.rowCount) return;
  state.selected = line;
  els.jumpInput.value = String(line + 1);

  if (scrollIntoView) {
    const displayIndex = displayIndexForLine(line);
    if (displayIndex >= 0) {
      els.list.scrollTop = Math.max(0, displayIndex * ROW_HEIGHT - ROW_HEIGHT);
    }
  }

  try {
    let row = state.rows.get(line);
    if (!row?.raw) {
      els.lineLabel.textContent = `Line ${formatNumber(line + 1)}`;
      els.domainLabel.textContent = "loading";
      els.rowTitle.textContent = "Loading row";
      els.detail.innerHTML = `<div class="empty-state"><strong>Loading row</strong><span>Parsing line ${formatNumber(line + 1)} lazily.</span></div>`;
      const fetched = await callWorker("row-detail", { line });
      row = fetched.row;
      state.rows.set(line, { ...(state.rows.get(line) || {}), ...row });
    }

    renderDetail(row);
    scheduleRenderRows();
  } catch (error) {
    setStatus(`Could not load line ${formatNumber(line + 1)}: ${error.message}`);
    els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderEmpty(title, body) {
  els.lineLabel.textContent = "No row selected";
  els.domainLabel.textContent = "dataset";
  els.rowTitle.textContent = title;
  els.prevRow.disabled = true;
  els.nextRow.disabled = true;
  els.detail.innerHTML = `
    <div class="empty-state">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body)}</span>
      </div>
    </div>
  `;
}

function renderDetail(row) {
  const json = row.json || {};
  els.lineLabel.textContent = `Line ${formatNumber(row.index + 1)} · ${formatBytes(row.bytes)}`;
  els.domainLabel.textContent = domainLabel(json);
  els.rowTitle.textContent = detailTitle(json, row.title);
  els.prevRow.disabled = !canNavigate(-1);
  els.nextRow.disabled = !canNavigate(1);

  if (row.error) {
    els.detail.innerHTML = `
      <div class="detail-inner">
        <div class="error-banner">${escapeHtml(row.error)}</div>
        <pre class="raw-panel">${escapeHtml(row.raw || "")}</pre>
      </div>
    `;
    return;
  }

  if (state.tab === "tree") {
    els.detail.innerHTML = `<div class="detail-inner"><div class="tree-panel">${renderTree(json)}</div></div>`;
  } else if (state.tab === "raw") {
    els.detail.innerHTML = `<div class="detail-inner"><pre class="raw-panel">${escapeHtml(JSON.stringify(json, null, 2))}</pre></div>`;
  } else {
    els.detail.innerHTML = `<div class="detail-inner">${renderSummary(json)}</div>`;
  }
}

function detailTitle(json, fallback) {
  const prompt = promptMessages(json);
  const userMessage = prompt.find((msg) => msg.role === "user") || prompt[0];
  return userMessage?.content || json.title || json.id || fallback || "Selected row";
}

function domainLabel(json) {
  if (json.domain) return cleanLabel(json.domain);
  const tags = [...(json.example_tags || []), ...(json.tags || [])];
  const theme = tags.find((tag) => String(tag).startsWith("theme:"));
  if (theme) return cleanLabel(String(theme).replace("theme:", ""));
  const group = json.ideal_completions_data?.ideal_completions_group;
  if (group) return cleanLabel(group);
  return "jsonl";
}

function cleanLabel(value) {
  return String(value).replaceAll("_", " ").replaceAll("-", " ").slice(0, 28);
}

function promptMessages(json) {
  if (Array.isArray(json.prompt)) return json.prompt;
  if (Array.isArray(json.messages)) return json.messages;
  return [];
}

function idealText(json) {
  return (
    json.ideal_completions_data?.ideal_completion ||
    json.ideal ||
    json.completion ||
    json.answer ||
    ""
  );
}

function renderSummary(json) {
  const messages = promptMessages(json);
  const ideal = idealText(json);
  const rubrics = Array.isArray(json.rubrics) ? json.rubrics : [];
  const generic = !messages.length && !ideal && !rubrics.length;

  return `
    ${
      messages.length
        ? `<section class="section">
            <h3>Conversation</h3>
            <div class="message-stack">
              ${messages.map(renderMessage).join("")}
            </div>
          </section>`
        : ""
    }
    ${
      generic
        ? `<section class="section">
            <h3>Fields</h3>
            <div class="fields-card">${Object.entries(json).map(renderField).join("")}</div>
          </section>`
        : ""
    }
    ${
      ideal
        ? `<section class="section">
            <h3>Ideal completion</h3>
            <div class="ideal-card">
              <div class="ideal-header">★ reference answer</div>
              <div class="ideal-body">${escapeHtml(ideal)}</div>
            </div>
          </section>`
        : ""
    }
    ${
      rubrics.length
        ? `<section class="section">
            <h3>Grading rubrics</h3>
            <div class="rubric-table">
              <div class="rubric-head"><span>Points</span><span>Criterion</span><span>Tags</span></div>
              ${rubrics.map(renderRubric).join("")}
            </div>
          </section>`
        : ""
    }
  `;
}

function renderMessage(message) {
  const role = String(message.role || "message").toLowerCase();
  const roleClass = ["system", "user", "assistant"].includes(role) ? role : "other";
  return `
    <div class="message-card">
      <div class="role-header role-${roleClass}">${escapeHtml(role)}</div>
      <div class="message-body">${escapeHtml(message.content || "")}</div>
    </div>
  `;
}

function renderField([key, value]) {
  return `
    <div class="field-row">
      <span class="field-key">${escapeHtml(key)}</span>
      <span class="field-value">${escapeHtml(previewValue(value))}</span>
    </div>
  `;
}

function previewValue(value) {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === "object") return `{ ${Object.keys(value).slice(0, 5).join(", ")} }`;
  return String(value);
}

function renderRubric(rubric) {
  const points = Number(rubric.points || 0);
  const pointClass = points > 0 ? "pos" : points < 0 ? "neg" : "zero";
  const pointText = points > 0 ? `+${points}` : String(points);
  return `
    <div class="rubric-row">
      <span class="points ${pointClass}">${escapeHtml(pointText)}</span>
      <span class="criterion">${escapeHtml(rubric.criterion || "")}</span>
      <span class="rubric-tags">${escapeHtml((rubric.tags || []).join(" · "))}</span>
    </div>
  `;
}

function renderTree(value, key = "root", depth = 0) {
  if (value === null || typeof value !== "object") {
    return `<div class="leaf ${leafClass(value)}"><span class="tree-key">${escapeHtml(key)}</span>: ${escapeHtml(JSON.stringify(value))}</div>`;
  }

  const isArray = Array.isArray(value);
  const entries = Object.entries(value);
  const open = depth < 2 ? " open" : "";
  return `
    <details${open}>
      <summary><span class="tree-key">${escapeHtml(key)} ${isArray ? `[${value.length}]` : `{${entries.length}}`}</span> <span class="tree-type">${isArray ? "array" : "object"}</span></summary>
      ${entries.map(([childKey, childValue]) => renderTree(childValue, childKey, depth + 1)).join("")}
    </details>
  `;
}

function leafClass(value) {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return "";
}

function runSearchDebounced() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 220);
}

async function runSearch() {
  const query = els.searchInput.value.trim();
  state.query = query;
  els.clearSearch.hidden = !query;

  if (!state.rowCount) {
    setStatus("Open a JSONL file before searching.");
    return;
  }

  if (!query) {
    searchToken++;
    if (worker) worker.postMessage({ type: "cancel-search" });
    state.matches = null;
    state.rows.clear();
    els.density.hidden = true;
    setStatus(
      `${formatNumber(state.rowCount)} rows · indexed in ${Math.round(state.indexTime)} ms`
    );
    scheduleRenderRows();
    return;
  }

  const token = ++searchToken;
  if (worker) worker.postMessage({ type: "cancel-search" });
  state.matches = { list: [], truncated: false };
  state.rows.clear();
  els.list.scrollTop = 0;
  setStatus(`Searching for "${query}"`);
  scheduleRenderRows();

  try {
    const result = await callWorker("search", { query, limit: SEARCH_LIMIT });
    if (token !== searchToken) return;
    state.matches = { list: result.matches, truncated: result.truncated };
    renderDensity(result.matches);
    setStatus(
      `${formatNumber(result.matches.length)} matches for "${query}"${
        result.truncated ? ` · first ${formatNumber(SEARCH_LIMIT)} shown` : ""
      }`
    );
    scheduleRenderRows();

    if (result.matches.length) {
      await selectLine(result.matches[0], false);
    } else {
      state.selected = -1;
      renderEmpty("No matches", `No rows matched "${query}".`);
    }
  } catch (error) {
    if (token === searchToken && error.message !== "Search cancelled") {
      setStatus(error.message);
    }
  }
}

function renderDensity(matches) {
  els.density.hidden = !state.query;
  const buckets = new Array(DENSITY_BUCKETS).fill(0);
  for (const line of matches) {
    const bucket = Math.min(
      DENSITY_BUCKETS - 1,
      Math.floor((line / Math.max(1, state.rowCount)) * DENSITY_BUCKETS)
    );
    buckets[bucket]++;
  }
  const max = Math.max(1, ...buckets);
  els.densityBars.innerHTML = buckets
    .map((count) => {
      if (!count) return '<div class="density-bar empty"></div>';
      const height = Math.max(3, Math.round((count / max) * 30));
      return `<div class="density-bar" style="height:${height}px"></div>`;
    })
    .join("");
}

function clearSearch() {
  els.searchInput.value = "";
  runSearch();
}

function canNavigate(direction) {
  const total = visibleTotal();
  if (!total || state.selected < 0) return false;
  const displayIndex = displayIndexForLine(state.selected);
  return displayIndex + direction >= 0 && displayIndex + direction < total;
}

function navigate(direction) {
  const total = visibleTotal();
  if (!total) return;
  const current = state.selected < 0 ? -1 : displayIndexForLine(state.selected);
  const nextDisplay = Math.max(0, Math.min(total - 1, current + direction));
  const line = sourceLineAt(nextDisplay);
  if (line != null) selectLine(line, true);
}

function jumpToLine() {
  const line = Math.max(1, Math.min(state.rowCount || 1, Number(els.jumpInput.value || 1))) - 1;
  selectLine(line, true);
}

els.themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await openFile(file);
  } catch (error) {
    setStatus(error.message);
    els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(error.message)}</span></div>`;
  }
});

els.loadSample.addEventListener("click", async () => {
  try {
    await loadSample();
  } catch (error) {
    setStatus(error.message);
    els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(error.message)}</span></div>`;
  }
});

els.clearFile.addEventListener("click", async () => {
  try {
    await clearCurrentFile();
  } catch (error) {
    setStatus(error.message);
    els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(error.message)}</span></div>`;
  }
});

els.searchInput.addEventListener("input", runSearchDebounced);
els.clearSearch.addEventListener("click", clearSearch);
els.list.addEventListener("scroll", scheduleRenderRows);

els.rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-line]");
  if (button) selectLine(Number(button.dataset.line));
});

els.prevRow.addEventListener("click", () => navigate(-1));
els.nextRow.addEventListener("click", () => navigate(1));
els.jumpInput.addEventListener("change", jumpToLine);

els.tabs.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.tab = button.dataset.tab;
  for (const tab of els.tabs.querySelectorAll("button")) {
    tab.classList.toggle("active", tab === button);
  }

  let row = state.rows.get(state.selected);
  if (row && !row.raw) {
    try {
      const fetched = await callWorker("row-detail", { line: state.selected });
      row = fetched.row;
      state.rows.set(state.selected, { ...(state.rows.get(state.selected) || {}), ...row });
    } catch (error) {
      els.detail.innerHTML = `<div class="error-state"><span>${escapeHtml(error.message)}</span></div>`;
      return;
    }
  }
  if (row) renderDetail(row);
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const tag = target?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    navigate(1);
  }
  if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    navigate(-1);
  }
});

if (worker) {
  updateMeta();
  renderEmpty(
    "Open a JSONL file or load the sample",
    "Files stay in this browser. Nothing is indexed until you choose a file or press Load sample."
  );
}
